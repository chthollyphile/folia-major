import { refineKind, toDisplayLine, withTruncation } from '../format.mjs';
import { outlineOf } from '../resolve.mjs';
// dev/mcp/ts-code-map/tools/fileOutline.mjs

export default {
    name: 'file_outline',
    description:
        '列出一个文件的符号结构（带行号），用来代替通读大文件。'
        + '想知道某文件里有什么、某个东西在第几行时用它，不要直接 Read 整个文件。'
        + '默认只列顶层；要看某个符号的成员用 inspect_symbol。',
    inputSchema: {
        type: 'object',
        properties: {
            file: { type: 'string', description: '仓库相对路径，如 src/components/app/Home.tsx' },
            depth: { type: 'number', description: '展开层数，默认 1（只列顶层）' },
            limit: { type: 'number', description: '最多输出多少行，默认 200' },
        },
        required: ['file'],
    },
    async run({ client }, { file, depth = 1, limit = 200 }) {
        const { symbols, lines } = await outlineOf(client, file);
        if (symbols.length === 0) return `${file} 里没有可列出的顶层符号。`;

        const rows = [];
        const walk = (nodes, level) => {
            for (const node of nodes) {
                const lspLine = (node.selectionRange ?? node.range).start.line;
                const kind = refineKind(node.kind, lines[lspLine], node.name);
                rows.push(`${'  '.repeat(level)}${toDisplayLine(lspLine)}: ${kind} ${node.name}`);
                if (level + 1 < depth && node.children?.length) walk(node.children, level + 1);
            }
        };
        walk(symbols, 0);

        return `${file}  (${lines.length} 行, ${symbols.length} 个顶层符号)\n${withTruncation(rows.slice(0, limit), rows.length, limit)}`;
    },
};
