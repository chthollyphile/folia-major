import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from '../files.mjs';
// dev/mcp/ts-code-map/graph/modules.mjs

/**
 * 模块依赖图。
 *
 * 每次调用都整个重建，不做缓存也不落盘：全仓 851 个文件扫一遍 import 只要 ~22ms，
 * 比任何失效策略都便宜，而且**结构上不可能过期** —— 摆脱手维护索引正是这个 server 的目的。
 */

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const RESOLVE_ORDER = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js'];
/**
 * import 与 re-export 的模块说明符，含动态 import()。第一组留着判断是不是纯类型导入，
 * 第三组只在动态 import() 命中时有值——两者在依赖上都成立，但只有静态那条是**急切**的：
 * 动态的那条由 bundler 切成独立 chunk，不进首屏。区分它才能回答「这个模块开机要拉多少」。
 */
const SPECIFIER = /(?:^|\n)(\s*(?:import|export)[^;\n]*?)from\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/g;
/**
 * Vite 的 `import.meta.glob('./x/*.ts')`。visualizer 模式、background、dev probe 全靠它自动注册，
 * 不展开的话依赖图会在 registry 这里整个断掉——而这正是最需要看清依赖的地方。
 */
const GLOB_CALL = /import\.meta\.glob(?:<[^>]*>)?\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g;

/** `import type { X } from` 只在编译期存在，运行时没有这条依赖，不该和值导入混为一谈。 */
const TYPE_ONLY = /^\s*(?:import|export)\s+type\b/;

/**
 * UI 层的种子。值导入了这些包就是 UI 模块，由此沿依赖边向上传染。
 * 用途：分层检查不能只看路径——`components/visualizer/colorMix.ts` 零依赖纯数学，
 * 住在 components 下面不代表它是 UI。
 */
const UI_PACKAGES = /^(react|react-dom)(\/|$)/;
export const edgeKey = (from, to) => `${from}\u0000${to}`;

/** 仓库里只有 `@` -> `src` 一个别名（tsconfig paths 与 vite alias 一致）。 */
const ALIAS = { '@/': 'src/' };

const addEdge = (map, from, to) => {
    if (!map.has(from)) map.set(from, new Set());
    map.get(from).add(to);
};

function resolveSpecifier(spec, fromFile, fileSet) {
    let base;
    if (spec.startsWith('.')) {
        base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
    } else {
        const alias = Object.keys(ALIAS).find(prefix => spec.startsWith(prefix));
        if (!alias) return null; // 裸包名 = 外部依赖，不进图
        base = ALIAS[alias] + spec.slice(alias.length);
    }

    for (const suffix of RESOLVE_ORDER) {
        const candidate = base + suffix;
        if (fileSet.has(candidate)) return candidate;
    }
    // `./x.js` 在 bundler 解析下常常实际指向 `./x.ts`
    const swapped = base.replace(/\.(js|mjs|cjs)$/, '');
    if (swapped !== base) {
        for (const suffix of RESOLVE_ORDER) {
            if (fileSet.has(swapped + suffix)) return swapped + suffix;
        }
    }
    return null;
}

/** 把 glob 模式转成正则。只需支持 `*`（不跨目录）和 `**`（跨目录）。 */
function globToRegExp(pattern) {
    let out = '';
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === '*') {
            if (pattern[i + 1] === '*') { out += '.*'; i++; if (pattern[i + 1] === '/') i++; }
            else out += '[^/]*';
        } else if (char === '.') out += '\\.';
        else if ('+?^${}()|[]\\'.includes(char)) out += `\\${char}`;
        else out += char;
    }
    return new RegExp(`^${out}$`);
}

/** 展开一个文件里的所有 import.meta.glob，返回它实际会拉进来的文件。 */
function resolveGlobs(text, fromFile, files) {
    const targets = [];
    GLOB_CALL.lastIndex = 0;
    let match;
    while ((match = GLOB_CALL.exec(text)) !== null) {
        const raw = match[1];
        const patterns = raw.startsWith('[')
            ? [...raw.matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
            : [raw.slice(1, -1)];
        for (const pattern of patterns) {
            if (pattern.startsWith('!')) continue;
            const base = pattern.startsWith('.')
                ? path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), pattern))
                : pattern.replace(/^\//, '');
            const re = globToRegExp(base);
            for (const candidate of files) {
                if (candidate !== fromFile && re.test(candidate)) targets.push(candidate);
            }
        }
    }
    return targets;
}

export function buildModuleGraph(root) {
    const tracked = listFiles(root).filter(f => SOURCE_EXT.test(f));
    const fileSet = new Set(tracked);

    const forward = new Map();
    const reverse = new Map();
    const typeOnly = new Set();
    const globEdges = new Set();
    const uiSeeds = new Set();
    const dynamic = new Set();
    let unresolved = 0;

    for (const file of tracked) {
        let text;
        try {
            text = fs.readFileSync(path.join(root, file), 'utf8');
        } catch {
            continue;
        }
        SPECIFIER.lastIndex = 0;
        let match;
        while ((match = SPECIFIER.exec(text)) !== null) {
            const spec = match[2] ?? match[3];
            if (!spec) continue;
            const isDynamic = match[3] !== undefined;
            const isTypeImport = Boolean(match[1] && TYPE_ONLY.test(match[1]));
            if (UI_PACKAGES.test(spec) && !isTypeImport) uiSeeds.add(file);
            const target = resolveSpecifier(spec, file, fileSet);
            if (!target) {
                if (spec.startsWith('.') || spec.startsWith('@/')) unresolved++;
                continue;
            }
            if (target === file) continue;
            addEdge(forward, file, target);
            addEdge(reverse, target, file);
            if (isTypeImport) typeOnly.add(edgeKey(file, target));
            if (isDynamic) dynamic.add(edgeKey(file, target));
        }

        for (const target of resolveGlobs(text, file, tracked)) {
            addEdge(forward, file, target);
            addEdge(reverse, target, file);
            globEdges.add(edgeKey(file, target));
        }
    }

    return { files: tracked, fileSet, forward, reverse, typeOnly, dynamic, globEdges, uiSeeds, unresolved };
}

/** 从一组起点沿 forward 或 reverse 走 depth 层，返回 rel -> 命中层数。 */
export function closure(graph, starts, direction, depth) {
    const edges = direction === 'reverse' ? graph.reverse : graph.forward;
    const seen = new Map();
    let frontier = [...starts];
    for (let level = 1; level <= depth && frontier.length > 0; level++) {
        const next = [];
        for (const node of frontier) {
            for (const neighbour of edges.get(node) ?? []) {
                if (seen.has(neighbour) || starts.includes(neighbour)) continue;
                seen.set(neighbour, level);
                next.push(neighbour);
            }
        }
        frontier = next;
    }
    return seen;
}
