import fs from 'node:fs';
import path from 'node:path';
import { kindName, location, rankSymbols, refineKind, withTruncation } from '../format.mjs';
// dev/mcp/ts-code-map/tools/findSymbol.mjs

export default {
    name: 'find_symbol',
    description:
        '按名称或模糊名称在整个 TypeScript 项目里查符号，返回 path:line 与种类。'
        + '定位任何函数、组件、hook、store、类型时先用它，不要用 grep 扫全库。',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: '符号名或其片段，大小写不敏感' },
            kind: { type: 'string', description: '只保留某一种，如 function / class / interface / const' },
            limit: { type: 'number', description: '最多返回多少条，默认 30' },
        },
        required: ['query'],
    },
    async run({ client }, { query, kind, limit = 30 }) {
        await client.start();
        const found = (await client.request('workspace/symbol', { query })) ?? [];
        const relOf = symbol => client.relFor(symbol.location.uri);

        const filtered = kind ? found.filter(s => kindName(s.kind) === kind) : found;
        const ranked = rankSymbols(filtered, query, relOf);

        const seen = new Set();
        const rows = [];
        for (const symbol of ranked) {
            const rel = relOf(symbol);
            const key = `${rel}:${symbol.location.range.start.line}:${symbol.name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push(symbol);
        }

        if (rows.length === 0) return `没有匹配 "${query}" 的符号。`;

        // workspace/symbol 不带声明行文本，kind 又很粗糙（const 箭头函数报成 var）。
        // 只为要显示的这几十行读一次源文件，按文件缓存，代价可以忽略。
        const fileCache = new Map();
        const declLine = (rel, lspLine) => {
            if (!fileCache.has(rel)) {
                try {
                    fileCache.set(rel, fs.readFileSync(path.resolve(client.root, rel), 'utf8').split('\n'));
                } catch {
                    fileCache.set(rel, []);
                }
            }
            return fileCache.get(rel)[lspLine];
        };

        const lines = rows.slice(0, limit).map(symbol => {
            const rel = relOf(symbol);
            const lspLine = symbol.location.range.start.line;
            const kind = refineKind(symbol.kind, declLine(rel, lspLine), symbol.name);
            const container = symbol.containerName ? `  (in ${symbol.containerName})` : '';
            return `${location(rel, lspLine)}  ${kind}  ${symbol.name}${container}`;
        });
        return withTruncation(lines, rows.length, limit);
    },
};
