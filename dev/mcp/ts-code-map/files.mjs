import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// dev/mcp/ts-code-map/files.mjs

/**
 * 列出仓库里的文件。
 *
 * 优先用 `git ls-files`（它天然尊重 .gitignore），但**不能依赖它**：在受限沙箱里
 * spawn git 会直接 EPERM，之前 impact 和 dependency_graph 就是这么整个挂掉的。
 * 拿不到就退回自己走文件系统。
 */

const DENY = new Set([
    'node_modules', '.git', 'dist', 'dist-runtime', 'release', 'build-output',
    'dev-dist', 'test-results', 'coverage', '.next', '.vite', 'out', '__pycache__',
]);

let cached = null;

function walk(root) {
    const found = [];
    const stack = [''];
    while (stack.length > 0) {
        const rel = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.') && entry.name !== '.github') continue;
            if (DENY.has(entry.name)) continue;
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) stack.push(childRel);
            else if (entry.isFile()) found.push(childRel);
        }
    }
    return found.sort();
}

/** 仓库全部文件的相对路径。结果按进程缓存——单次工具调用里会被问好几遍。 */
export function listFiles(root) {
    if (cached && cached.root === root) return cached.files;

    let files;
    let source;
    try {
        // --others --exclude-standard 把「新建但还没 git add」的文件也算进来。
        // 只用 ls-files 的话，本地生成的地图会漏掉新文件，而 CI 的干净检出里没有未跟踪文件，
        // 于是同一份代码在两边生成出不同的地图，codemap:check 会莫名其妙地失败。
        files = execFileSync(
            'git',
            ['ls-files', '--cached', '--others', '--exclude-standard'],
            { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 15_000 },
        )
            .split('\n')
            .filter(Boolean);
        source = 'git';
        if (files.length === 0) throw new Error('git ls-files 返回空');
    } catch {
        files = walk(root);
        source = 'fs';
    }

    cached = { root, files, source };
    return files;
}

/** 上一次 listFiles 是走 git 还是退回了文件系统，用于诊断。 */
export const lastListSource = () => cached?.source ?? 'none';

/** 清掉缓存。改动文件后想立刻反映时用。 */
export const resetFileCache = () => { cached = null; };

const TEXT_SCANNABLE = /\.(ts|tsx|js|jsx|mjs|cjs|snap)$/;

/**
 * 这个名字在每个源文件里的文本出现次数。
 *
 * 语义引用会被对象展开、props 透传和局部别名切断，那部分只能靠文本补。
 * 排除 dev/mcp 自身，免得工具把自己的文档和代码算进影响面。
 */
export function textualHits(root, name) {
    const word = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const perFile = new Map();
    for (const rel of listFiles(root)) {
        if (!TEXT_SCANNABLE.test(rel) || rel.startsWith('dev/mcp/')) continue;
        let text;
        try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
        if (!text.includes(name)) continue;
        const count = (text.match(word) ?? []).length;
        if (count > 0) perFile.set(rel, count);
    }
    return perFile;
}
