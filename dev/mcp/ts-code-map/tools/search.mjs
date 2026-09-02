import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from '../files.mjs';
import { location, rankSymbols, refineKind, withTruncation } from '../format.mjs';
// dev/mcp/ts-code-map/tools/search.mjs

const SYMBOL_LIMIT = 15;
const FILE_LIMIT = 15;
const TEXT_LIMIT = 20;
const TEXT_SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html)$/;

/** 把自然语言查询切成词。驼峰也拆开，这样 "font size" 能对上 fontScale。 */
export function tokenize(query) {
    return [...new Set(
        query
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .split(/[^\p{L}\p{N}]+/u)
            .map(t => t.toLowerCase())
            .filter(t => t.length >= 2),
    )];
}

const tryRun = (cmd, args, cwd) => {
    try {
        return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout: 20_000, maxBuffer: 16 << 20 }) };
    } catch (error) {
        // rg 没命中时退出码是 1，stdout 仍然有效；真正的失败（ENOENT/EPERM）没有 stdout。
        if (typeof error.stdout === 'string') return { ok: true, out: error.stdout };
        return { ok: false, out: '' };
    }
};

/** rg 不可用时的纯 JS 兜底，慢但不会整个失效。 */
function scanFiles(root, tokens, cap) {
    const hits = [];
    for (const rel of listFiles(root)) {
        if (!TEXT_SCAN_EXT.test(rel)) continue;
        let lines;
        try {
            lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
        } catch { continue; }
        for (let i = 0; i < lines.length; i++) {
            const lowered = lines[i].toLowerCase();
            if (!tokens.every(t => lowered.includes(t))) continue;
            hits.push(`${rel}:${i + 1}:${lines[i].trim().slice(0, 160)}`);
            if (hits.length >= cap) return hits;
        }
    }
    return hits;
}

export default {
    name: 'search',
    description:
        '不确定要找什么时的默认入口：先按符号找，没有再按文件名，最后退回全文搜索。'
        + '支持自然语言多词查询（如 "lyric font size settings"），会按命中词数排序。'
        + '已经知道确切符号名就直接用 find_symbol。',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: '符号名、文件名片段，或几个描述性关键词' },
        },
        required: ['query'],
    },
    async run({ client, root }, { query }) {
        await client.start();

        // 不含字母的查询（`0.85`、`1.4`、`min/max`）是字面量，不是符号名。
        // 分词会把 `0.85` 切成 `85`，然后去匹配 `three@^0.185.1` 这种完全无关的东西。
        if (!/\p{L}/u.test(query)) {
            const literal = tryRun('rg', [
                '-n', '--no-heading', '-F', '--max-columns', '160',
                '--glob', '!node_modules', '--glob', '!dist', '--glob', '!package-lock.json',
                '-e', query, '.',
            ], root);
            const raw = literal.ok
                ? literal.out.split('\n').filter(Boolean).map(l => l.replace(/^\.\//, ''))
                : scanFiles(root, [query.toLowerCase()], TEXT_LIMIT * 5);
            if (raw.length === 0) return `字面量 "${query}" 没有出现在源码里。`;
            return `字面量精确匹配 (${raw.length} 处，未分词):\n`
                + withTruncation(raw.slice(0, TEXT_LIMIT).map(l => l.slice(0, 180)), raw.length, TEXT_LIMIT);
        }

        const tokens = tokenize(query);

        // --- 第一层：符号。先整串精确找，找不到再按分词的命中覆盖度排。 ---
        const relOf = s => client.relFor(s.location.uri);
        const lineCache = new Map();
        const declLine = (rel, n) => {
            if (!lineCache.has(rel)) {
                try { lineCache.set(rel, fs.readFileSync(path.resolve(root, rel), 'utf8').split('\n')); }
                catch { lineCache.set(rel, []); }
            }
            return lineCache.get(rel)[n];
        };
        const renderSymbol = symbol => {
            const rel = relOf(symbol);
            const lspLine = symbol.location.range.start.line;
            return `${location(rel, lspLine)}  ${refineKind(symbol.kind, declLine(rel, lspLine), symbol.name)}  ${symbol.name}`;
        };

        const direct = (await client.request('workspace/symbol', { query })) ?? [];
        if (direct.length > 0) {
            const ranked = rankSymbols(direct, query, relOf);
            return `符号命中 (${direct.length}):\n${withTruncation(ranked.slice(0, SYMBOL_LIMIT).map(renderSymbol), ranked.length, SYMBOL_LIMIT, 'find_symbol 的 limit')}`;
        }

        if (tokens.length > 1) {
            const byKey = new Map();
            for (const token of tokens) {
                for (const symbol of (await client.request('workspace/symbol', { query: token })) ?? []) {
                    const key = `${symbol.location.uri}:${symbol.location.range.start.line}:${symbol.name}`;
                    if (!byKey.has(key)) byKey.set(key, symbol);
                }
            }
            // 名字里命中的词远比路径里命中的重要：路径命中会让目录下每个局部变量都拿到同样的分，
            // 结果就是 `size`、`font` 这种噪声盖过 `lyricsFontScale` 这种真正的答案。
            const scored = [...byKey.values()]
                .map(symbol => {
                    const rel = relOf(symbol);
                    const name = symbol.name.toLowerCase();
                    const inPath = rel.toLowerCase();
                    const nameHits = tokens.filter(t => name.includes(t));
                    const pathHits = tokens.filter(t => !name.includes(t) && inPath.includes(t));
                    let score = nameHits.length * 10 + pathHits.length * 2;
                    if (/(^|\/)(test|tests)\//.test(rel) || /\.(test|spec)\.[tj]sx?$/.test(rel)) score -= 6;
                    if (rel.endsWith('.d.ts')) score -= 4;
                    if (symbol.name.length <= 3) score -= 4;
                    // 函数体内的局部变量（kind=Variable 且有 containerName）几乎不会是想找的答案，
                    // 但名字常常正好撞上关键词——各 visualizer 里的局部 fontSize 就是这样刷屏的。
                    // 接口/类的成员同样带 containerName，但 kind 不是 Variable，不受影响。
                    if (symbol.kind === 13 && symbol.containerName) score -= 7;
                    return { symbol, score, hit: nameHits.length + pathHits.length, depth: rel.split('/').length };
                })
                // 名字里一个词都没中的，基本都是「碰巧在同一个目录下」的局部变量。
                .filter(entry => entry.score > 0 && tokens.some(t => entry.symbol.name.toLowerCase().includes(t)))
                .sort((a, b) => b.score - a.score || a.depth - b.depth || a.symbol.name.length - b.symbol.name.length);

            // 同名符号只留最好的一条：像 `settingsLyricSettings` 这种局部变量名会在七八个文件里
            // 各出现一次，不合并的话前 15 条全被它一个名字吃掉。
            const byName = new Map();
            for (const entry of scored) {
                const existing = byName.get(entry.symbol.name);
                if (existing) existing.dupes++;
                else byName.set(entry.symbol.name, { ...entry, dupes: 0 });
            }
            const unique = [...byName.values()];

            if (unique.length > 0) {
                const rows = unique.slice(0, SYMBOL_LIMIT).map(({ symbol, hit, dupes }) =>
                    `${renderSymbol(symbol)}   [命中 ${hit}/${tokens.length} 词${dupes ? `，另有 ${dupes} 处同名` : ''}]`);
                return `没有整串匹配的符号。按关键词 [${tokens.join(', ')}] 找到 ${unique.length} 个相关符号（按名字命中度排序）:\n`
                    + withTruncation(rows, unique.length, SYMBOL_LIMIT)
                    + '\n\n提示: 这一层是模糊匹配。锁定文件后用 file_outline 看全貌，比继续猜符号名快。';
            }
        }

        // --- 第二层：文件名 ---
        const files = listFiles(root);
        const lowered = query.toLowerCase();
        let named = files.filter(f => f.toLowerCase().includes(lowered));
        if (named.length === 0 && tokens.length > 1) {
            named = files
                .map(f => ({ f, hit: tokens.filter(t => f.toLowerCase().includes(t)).length }))
                .filter(e => e.hit >= 2)
                .sort((a, b) => b.hit - a.hit)
                .map(e => `${e.f}   [命中 ${e.hit}/${tokens.length} 词]`);
        }
        if (named.length > 0) {
            return `没有符号匹配。文件名命中 (${named.length}):\n${withTruncation(named.slice(0, FILE_LIMIT), named.length, FILE_LIMIT)}`;
        }

        // --- 第三层：全文。多词时取最长的词交给 rg，其余在 JS 里过滤。 ---
        const anchor = tokens.length ? tokens.reduce((a, b) => (b.length > a.length ? b : a)) : query;
        const rest = tokens.filter(t => t !== anchor);
        const rg = tryRun('rg', [
            '-n', '--no-heading', '-i', '-F', '--max-columns', '160',
            '--glob', '!node_modules', '--glob', '!dist', '--glob', '!package-lock.json',
            '-e', anchor, '.',
        ], root);

        let hits;
        if (rg.ok) {
            hits = rg.out.split('\n').filter(Boolean)
                .map(l => l.replace(/^\.\//, ''))
                .filter(l => rest.every(t => l.toLowerCase().includes(t)));
        } else {
            hits = scanFiles(root, tokens.length ? tokens : [lowered], TEXT_LIMIT * 5);
        }

        if (hits.length === 0) return `"${query}" 在符号、文件名、全文里都没有命中。`;
        const rows = hits.slice(0, TEXT_LIMIT).map(l => l.slice(0, 180));
        return `没有符号或文件名匹配。全文命中 (${hits.length}${rg.ok ? '' : '，rg 不可用，已用 JS 扫描'}):\n`
            + withTruncation(rows, hits.length, TEXT_LIMIT);
    },
};
