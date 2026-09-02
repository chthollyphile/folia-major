import fs from 'node:fs';
import path from 'node:path';
import { CONTAINER_KINDS, compactSignature, extractDoc, refineKind, toDisplayLine } from '../format.mjs';
import { collectByName, outlineOf, resolveTarget } from '../resolve.mjs';
// dev/mcp/ts-code-map/tools/inspectSymbol.mjs

const MAX_BODY_LINES = 200;

export default {
    name: 'inspect_symbol',
    description:
        '看一个符号的签名、类型、JSDoc、所在行范围和成员列表；body=true 时才附上源码。'
        + '想知道某个函数怎么用、参数是什么时用它，不要为了看签名去 Read 整个文件。',
    inputSchema: {
        type: 'object',
        properties: {
            symbol: { type: 'string', description: '符号名' },
            file: { type: 'string', description: '限定文件，省略则全库找' },
            line: { type: 'number', description: '同名符号消歧用的 1-based 行号' },
            body: { type: 'boolean', description: '是否附上实现源码，默认 false' },
            max_body_lines: { type: 'number', description: 'body=true 时最多给多少行，默认 200' },
            body_from: { type: 'number', description: '只要 body 的某一段时，起始的 1-based 行号' },
        },
        required: ['symbol'],
    },
    async run({ client }, { symbol: name, file, line, body = false, max_body_lines = MAX_BODY_LINES, body_from }) {
        const target = await resolveTarget(client, { symbol: name, file, line });
        const { relPath, uri, position } = target;

        const hover = await client.request('textDocument/hover', {
            textDocument: { uri },
            position,
        });

        // workspace/symbol 只给名字位置，成员和完整范围要回到文件的符号树上取。
        const { symbols, lines } = await outlineOf(client, relPath);
        const node = collectByName(symbols, name).find(
            candidate => (candidate.selectionRange ?? candidate.range).start.line === position.line,
        );

        const out = [`${name}  ${refineKind(node?.kind ?? target.symbol.kind, lines[position.line], name)}`];
        const range = node?.range;
        out.push(range
            ? `位置: ${relPath}:${toDisplayLine(range.start.line)}-${toDisplayLine(range.end.line)}`
            : `位置: ${relPath}:${toDisplayLine(position.line)}`);
        if (target.alternatives > 0) {
            out.push(`注意: 另有 ${target.alternatives} 个同名符号，用 file/line 参数消歧`);
        }

        const signature = compactSignature(hover?.contents);
        if (signature) out.push(`签名: ${signature}`);
        const doc = extractDoc(hover?.contents);
        if (doc) out.push(`说明: ${doc}`);

        // 只有 class/interface/enum 这类容器的 children 才是真成员；函数的 children 是解构参数，
        // 签名里已经有了，再列一遍纯属噪声（buildHomeModel 会因此多出 36 行）。
        if (node?.children?.length && CONTAINER_KINDS.has(node.kind)) {
            const members = node.children.map(child => {
                const childLine = (child.selectionRange ?? child.range).start.line;
                return `  ${toDisplayLine(childLine)}: ${refineKind(child.kind, lines[childLine], child.name)} ${child.name}`;
            });
            out.push(`成员 (${node.children.length}):`, ...members.slice(0, 40));
            if (members.length > 40) out.push(`  … 还有 ${members.length - 40} 个`);
        }

        if (body && range) {
            const lines = fs.readFileSync(path.resolve(client.root, relPath), 'utf8').split('\n');
            // body_from 让调用方能取符号体内的任意一段——大组件里想看的那几行常常在两百行之外。
            const from = body_from ? Math.max(range.start.line, body_from - 1) : range.start.line;
            const slice = lines.slice(from, range.end.line + 1);
            const shown = slice.slice(0, max_body_lines);
            out.push('', `\`\`\`ts  // ${relPath}:${toDisplayLine(from)}-${toDisplayLine(from + shown.length - 1)}`, ...shown);
            if (slice.length > shown.length) {
                out.push(`// … 还有 ${slice.length - shown.length} 行；用 body_from=${toDisplayLine(from + shown.length)} 继续，或调大 max_body_lines`);
            }
            out.push('```');
        }

        return out.join('\n');
    },
};
