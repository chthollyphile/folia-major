import fs from 'node:fs';
import path from 'node:path';
import { textualHits } from './files.mjs';
import { rankSymbols } from './format.mjs';
// dev/mcp/ts-code-map/resolve.mjs

/**
 * 把 agent 说得出口的东西（符号名、文件名）解析成 LSP 要的 position。
 *
 * agent 不知道行列号，所有工具因此都按名字寻址，位置解析集中在这里。
 */

/**
 * 标出所有 import / re-export 声明占用的行。
 *
 * documentSymbol 会把 import 说明符当成 Variable 符号返回（`import React` 里的 React
 * 会以 kind=13 出现在第 0 行），不滤掉的话每个 outline 顶部都是一堆假符号。
 * 支持跨行的 `import {\n A,\n B\n} from '...'`。
 */
export function importLineSet(text) {
    const lines = text.split('\n');
    const marked = new Set();
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*(import\b|export\s+(type\s+)?\{)/.test(lines[i])) continue;
        marked.add(i);
        // 单行就结束的情况：本行已经出现 from '...' 或以 ; 收尾。
        if (/\bfrom\s*['"]/.test(lines[i]) || /;\s*$/.test(lines[i])) continue;
        for (let j = i + 1; j < lines.length && j <= i + 60; j++) {
            marked.add(j);
            if (/\bfrom\s*['"]/.test(lines[j]) || /;\s*$/.test(lines[j])) { i = j; break; }
        }
    }
    return marked;
}

/** 取文件的符号树，并滤掉 import 噪声。 */
export async function outlineOf(client, relPath) {
    const uri = await client.ensureOpen(relPath);
    const symbols = (await client.request('textDocument/documentSymbol', { textDocument: { uri } })) ?? [];
    const text = fs.readFileSync(path.resolve(client.root, relPath), 'utf8');
    const importLines = importLineSet(text);
    const keep = nodes => nodes
        .filter(node => !importLines.has((node.selectionRange ?? node.range).start.line))
        .map(node => ({ ...node, children: node.children ? keep(node.children) : [] }));
    return { uri, symbols: keep(symbols), lines: text.split('\n') };
}

/** 在符号树里按名字深度优先查找，收集所有同名命中。 */
export function collectByName(symbols, name, out = []) {
    for (const symbol of symbols) {
        if (symbol.name === name) out.push(symbol);
        if (symbol.children?.length) collectByName(symbol.children, name, out);
    }
    return out;
}

/**
 * 分层角色排序：越靠前越可能是「定义处」而不是「使用处」。
 * 组件几乎总是消费方，测试永远排最后。
 */
const ROLE_ORDER = [
    [/^src\/stores\//, 0],
    [/^src\/types/, 1],
    [/^src\/services\//, 2],
    [/^src\/utils\//, 3],
    [/^(shared|sync-server|worker|api|api-ts)\//, 4],
    [/^src\/hooks\//, 5],
    [/^src\/components\//, 7],
    [/(^|\/)(test|tests)\/|\.(test|spec)\.[tj]sx?$/, 9],
];
const roleRank = rel => ROLE_ORDER.find(([pattern]) => pattern.test(rel))?.[1] ?? 6;

/**
 * 解析成 { relPath, uri, position, symbol }。
 * 给了 file 就在该文件内定位；没给就走 workspace/symbol 全库找并排序取最优。
 */
export async function resolveTarget(client, { symbol: name, file, line }) {
    if (!name) throw new Error('缺少 symbol 参数');

    if (file) {
        const { uri, symbols } = await outlineOf(client, file);
        const hits = collectByName(symbols, name);
        if (hits.length === 0) throw new Error(`${file} 里没有名为 ${name} 的符号`);
        const picked = (line && hits.find(h => (h.selectionRange ?? h.range).start.line === line - 1)) || hits[0];
        return {
            relPath: file,
            uri,
            position: (picked.selectionRange ?? picked.range).start,
            symbol: picked,
            alternatives: hits.length - 1,
        };
    }

    await client.start();
    const found = (await client.request('workspace/symbol', { query: name })) ?? [];
    const exact = found.filter(s => s.name === name);
    const pool = exact.length ? exact : found.filter(s => s.name.toLowerCase() === name.toLowerCase());
    if (pool.length === 0) {
        throw new Error(`全库没有找到符号 ${name}。先用 find_symbol 做模糊搜索确认名字。`);
    }

    const relOf = s => client.relFor(s.location.uri);
    let ranked = rankSymbols(pool, name, relOf);

    // 同名声明有多个时怎么选主声明。
    //
    // 按 LSP 返回顺序会挑中函数内的局部变量（lyricsFontScale 曾解析到某个 hook 里只用两次的
    // 局部值）；纯按文本密度又会挑中用得最凶的消费方（VisualizerFume 里出现 24 次）。
    // 两者都不是「定义在哪」。这里改用分层角色排序：状态和契约层比消费层更可能是源头，
    // 同层内再按密度。这只是启发式，所以候选列表一定要报给调用方自己判断。
    let candidates = [];
    if (ranked.length > 1) {
        const weights = textualHits(client.root, name);
        ranked = [...ranked].sort((a, b) => roleRank(relOf(a)) - roleRank(relOf(b))
            || (weights.get(relOf(b)) ?? 0) - (weights.get(relOf(a)) ?? 0));
        const seen = new Set();
        for (const symbol of ranked) {
            const rel = relOf(symbol);
            if (seen.has(rel)) continue;
            seen.add(rel);
            candidates.push({ rel, line: symbol.location.range.start.line + 1, weight: weights.get(rel) ?? 0 });
        }
    }

    const best = (line && ranked.find(s => s.location.range.start.line === line - 1)) || ranked[0];
    const relPath = relOf(best);
    await client.ensureOpen(relPath);
    return {
        relPath,
        uri: best.location.uri,
        position: best.location.range.start,
        symbol: best,
        alternatives: ranked.length - 1,
        candidates,
    };
}
