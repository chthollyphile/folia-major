#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { areaOf } from './format.mjs';
import { buildModuleGraph, edgeKey } from './graph/modules.mjs';
// dev/mcp/ts-code-map/codemap.mjs

/**
 * 从编译器推导出的代码地图生成器。
 *
 * 存在的理由：手维护的路径表必然过期（这个仓库的 skill 里曾同时存在 7 处死引用，
 * visualizer 模式清单也少了两个）。地图改成生成的之后，过期在结构上就不可能发生——
 * CI 会重新生成并比对，有 diff 就失败。
 *
 * 输出必须是确定性的：所有集合都排序，否则 CI 每次都会报假 diff。
 */

const HUB_COUNT = 15;
const HUB_MIN_DEPS = 8;

/**
 * 分层边界。左边不该在运行时依赖右边。
 * 只看值导入——`import type` 在运行时不存在，把它算成违规会产生大量假警报
 * （比如 stores 只是 `import type { PanelTab }` 就会被误判成依赖了组件）。
 */
const BOUNDARY_RULES = [
    { from: /^src\/stores\//, to: /^src\/components\//, why: 'store 不应依赖组件' },
    { from: /^src\/utils\//, to: /^src\/(components|hooks|stores)\//, why: '纯变换不应依赖 UI 或状态' },
    { from: /^src\/types/, to: /^src\/(components|hooks|stores|services)\//, why: '契约层不应依赖实现' },
    { from: /^src\/services\//, to: /^src\/components\//, why: 'service 不应依赖组件' },
    {
        from: /^src\/(components|hooks|stores)\//,
        to: /^src\/services\/onlineMusic\/.*(Provider|Transport)\.ts$/,
        why: '普通调用应经过 omni，不应直连 provider adapter/transport',
    },
];

/**
 * 哪些模块在运行时真的会把 React 拉进来。
 *
 * 规则只能看路径，而路径会撒谎：`components/visualizer/colorMix.ts` 是零依赖的纯色彩数学，
 * 只是住在 components 目录下。反过来 `components/visualizer/registry.tsx` 看着人畜无害，
 * 实际用 eager glob 拉进 13 个 renderer。所以「是不是 UI」要从依赖图推，不能从目录猜。
 *
 * 种子是值导入 react 的文件，沿值导入边向依赖方传染（`import type` 不传染，运行时不存在）。
 */
function computeUiModules(graph) {
    const tainted = new Set(graph.uiSeeds);
    const queue = [...graph.uiSeeds];
    while (queue.length > 0) {
        const current = queue.pop();
        for (const dependent of graph.reverse.get(current) ?? []) {
            if (tainted.has(dependent)) continue;
            if (graph.typeOnly.has(edgeKey(dependent, current))) continue;
            tainted.add(dependent);
            queue.push(dependent);
        }
    }
    return tainted;
}

function collect(root) {
    const graph = buildModuleGraph(root);

    const areas = new Map();
    for (const file of graph.files) areas.set(areaOf(file), (areas.get(areaOf(file)) ?? 0) + 1);

    const hubs = [...graph.reverse]
        .map(([file, deps]) => ({ file, count: deps.size }))
        .filter(h => h.count >= HUB_MIN_DEPS)
        .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
        .slice(0, HUB_COUNT);

    const SEP = String.fromCharCode(0);
    const registries = new Map();
    for (const key of graph.globEdges) {
        const [from, to] = key.split(SEP);
        if (!registries.has(from)) registries.set(from, []);
        registries.get(from).push(to);
    }

    const uiModules = computeUiModules(graph);
    const violations = [];
    const misplaced = [];
    for (const [from, targets] of graph.forward) {
        for (const to of targets) {
            if (graph.typeOnly.has(edgeKey(from, to))) continue;
            const rule = BOUNDARY_RULES.find(r => r.from.test(from) && r.to.test(to));
            if (!rule) continue;
            // 指向 components 但目标其实不含 UI：依赖方向没问题，是文件住错了目录。
            const nominal = /^src\/components\//.test(to) && !uiModules.has(to);
            (nominal ? misplaced : violations).push({ from, to, why: rule.why });
        }
    }
    const byPath = (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to);
    violations.sort(byPath);
    misplaced.sort(byPath);

    return { graph, areas, hubs, registries, violations, misplaced };
}

function render({ graph, areas, hubs, registries, violations, misplaced }) {
    const out = [];
    out.push('# 代码地图');
    out.push('');
    out.push('<!-- 这份文件由 `npm run codemap` 生成，不要手改。CI 会重新生成并比对。 -->');
    out.push('');
    out.push('全部内容由 TypeScript 编译器和模块图推导，不是人工维护的清单。');
    out.push('想知道某个具体符号在哪，用 `node dev/mcp/ts-code-map/cli.mjs search \'{"query":"..."}\'`。');
    out.push('');

    let edges = 0;
    for (const set of graph.forward.values()) edges += set.size;
    out.push(
        `规模：${graph.files.length} 个源文件，${edges} 条模块依赖`
        + `（${graph.typeOnly.size} 条是纯类型导入，运行时不存在；`
        + `${graph.dynamic.size} 条是动态 \`import()\`，由 bundler 切成独立 chunk，不进首屏）。`,
    );
    out.push('');

    out.push('## 区域分布');
    out.push('');
    out.push('| 区域 | 文件数 |');
    out.push('| --- | --- |');
    for (const [area, count] of [...areas].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        out.push(`| ${area} | ${count} |`);
    }
    out.push('');

    out.push('## 枢纽模块');
    out.push('');
    out.push('被最多模块依赖的文件。改动它们波及面最大，读代码时也最值得先看。');
    out.push('');
    out.push('| 被依赖数 | 模块 |');
    out.push('| --- | --- |');
    for (const hub of hubs) out.push(`| ${hub.count} | \`${hub.file}\` |`);
    out.push('');

    out.push('## 动态注册点');
    out.push('');
    out.push('这些地方用 `import.meta.glob` 自动发现成员，**清单随目录变化，不要手写**。');
    out.push('以下是当前的完整展开：');
    out.push('');
    for (const [registry, members] of [...registries].sort((a, b) => a[0].localeCompare(b[0]))) {
        out.push(`### \`${registry}\` (${members.length})`);
        out.push('');
        for (const member of [...members].sort()) out.push(`- \`${member}\``);
        out.push('');
    }

    out.push('## 分层边界违规');
    out.push('');
    out.push('规则是人定的（见 `codemap.mjs` 的 `BOUNDARY_RULES`），拿真实的值导入图去比对。');
    out.push('`import type` 不算——它在运行时不存在。');
    out.push('');
    if (violations.length === 0) {
        out.push('当前没有违规。');
    } else {
        out.push('下面这些边的依赖方向本身就是错的：');
        out.push('');
        for (const v of violations) out.push(`- \`${v.from}\` → \`${v.to}\`  —— ${v.why}`);
    }
    out.push('');

    if (misplaced.length > 0) {
        out.push('### 目录归属存疑');
        out.push('');
        out.push('这些边命中了规则，但目标模块在运行时根本不含 UI（不传递依赖 react）。');
        out.push('依赖方向没问题，是文件住在了 `src/components/` 下面。修法是移动文件，不是改依赖。');
        out.push('');
        for (const v of misplaced) out.push(`- \`${v.from}\` → \`${v.to}\``);
        out.push('');
    }

    return `${out.join('\n')}\n`;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const outputPath = path.join(root, 'docs/CODEMAP.md');
const rendered = render(collect(root));

if (process.argv.includes('--check')) {
    const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (existing === rendered) {
        console.log('docs/CODEMAP.md 是最新的。');
        process.exit(0);
    }
    console.error('docs/CODEMAP.md 与代码不一致。跑 `npm run codemap` 重新生成并提交。');
    process.exit(1);
}

fs.writeFileSync(outputPath, rendered);
console.log(`已写入 docs/CODEMAP.md (${Buffer.byteLength(rendered)} 字节)`);
