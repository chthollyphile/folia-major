import fs from 'node:fs';
import path from 'node:path';
import { textualHits } from '../files.mjs';
import { compactSignature, location, withTruncation } from '../format.mjs';
import { resolveTarget } from '../resolve.mjs';
// dev/mcp/ts-code-map/tools/references.mjs

const MAX_HIGHLIGHT_FILES = 25;
const MAX_LINES_PER_GROUP = 12;
const MAX_TEXTUAL_FILES = 60;
const IS_TEST = rel => /(^|\/)(test|tests|__tests__)\//.test(rel) || /\.(test|spec)\.[tj]sx?$/.test(rel);
/**
 * 只认无歧义的类型位置标记。`foo: Bar` 里的冒号和对象字面量 `{ key: value }` 无法靠正则
 * 区分，所以宁可漏判（落进 read）也不误判。
 */
const TYPE_MARKER = /(<|\bextends\s+|\bimplements\s+|\bsatisfies\s+|\bas\s+)\s*$/;

export default {
    name: 'references',
    description:
        '找一个符号的完整影响面：语义引用（按 write/read/type/test 分组）、同名的其他声明、'
        + '以及只有文本命中的文件。判断「谁在用它」「改了会影响谁」时用它。'
        + '文件列表不截断，只截断每组的代码行细节。',
    inputSchema: {
        type: 'object',
        properties: {
            symbol: { type: 'string', description: '符号名' },
            file: { type: 'string', description: '限定声明所在文件，省略则全库找' },
            line: { type: 'number', description: '同名符号消歧用的 1-based 行号' },
            lines_per_group: { type: 'number', description: '每组最多显示几行代码细节，默认 12' },
        },
        required: ['symbol'],
    },
    async run({ client, root }, { symbol: name, file, line, lines_per_group = MAX_LINES_PER_GROUP }) {
        const target = await resolveTarget(client, { symbol: name, file, line });

        const refs = (await client.request('textDocument/references', {
            textDocument: { uri: target.uri },
            position: target.position,
            context: { includeDeclaration: false },
        })) ?? [];

        const hover = await client.request('textDocument/hover', {
            textDocument: { uri: target.uri }, position: target.position,
        });
        const declaresType = /^\s*(type|interface)\s/.test(compactSignature(hover?.contents, 80));

        const byFile = new Map();
        for (const ref of refs) {
            const rel = client.relFor(ref.uri);
            if (!byFile.has(rel)) byFile.set(rel, []);
            byFile.get(rel).push(ref);
        }

        const groups = { write: [], read: [], type: [], test: [] };
        let highlighted = 0;
        for (const [rel, fileRefs] of byFile) {
            let writeKeys = new Set();
            if (!IS_TEST(rel) && !declaresType && highlighted < MAX_HIGHLIGHT_FILES) {
                highlighted++;
                const uri = await client.ensureOpen(rel);
                const highlights = (await client.request('textDocument/documentHighlight', {
                    textDocument: { uri }, position: fileRefs[0].range.start,
                }).catch(() => null)) ?? [];
                writeKeys = new Set(highlights.filter(h => h.kind === 3)
                    .map(h => `${h.range.start.line}:${h.range.start.character}`));
            }

            const lines = fs.readFileSync(path.resolve(root, rel), 'utf8').split('\n');
            for (const ref of fileRefs) {
                const { line: lspLine, character } = ref.range.start;
                const text = lines[lspLine] ?? '';
                const entry = `  ${location(rel, lspLine)}  ${text.trim().slice(0, 120)}`;
                if (IS_TEST(rel)) groups.test.push(entry);
                else if (declaresType) groups.type.push(entry);
                else if (writeKeys.has(`${lspLine}:${character}`)) groups.write.push(entry);
                else if (/\bimport\s+type\b/.test(text) || TYPE_MARKER.test(text.slice(0, character))) groups.type.push(entry);
                else groups.read.push(entry);
            }
        }

        // 同名的其他声明：同一个概念常在 store、配置类型、编解码里各声明一次，互不引用。
        const sameName = ((await client.request('workspace/symbol', { query: name })) ?? [])
            .filter(s => s.name === name);
        const declFiles = [...new Set(sameName.map(s => client.relFor(s.location.uri)))]
            .filter(rel => rel !== target.relPath && !rel.startsWith('dev/mcp/'));

        // 只有文本命中的文件：props 透传、对象展开、局部别名——LSP 结构上追不到这些。
        const textual = textualHits(root, name);
        const accounted = new Set([target.relPath, ...byFile.keys(), ...declFiles]);
        const textOnly = [...textual.entries()]
            .filter(([rel]) => !accounted.has(rel))
            .sort((a, b) => b[1] - a[1]);

        const out = [`${name}  声明于 ${location(target.relPath, target.position.line)}`];
        // 同名声明有多个时必须说清楚选了哪个，否则「语义引用只有 2 处」会被当成完整答案。
        if (target.candidates?.length > 1) {
            out.push(`注意: 有 ${target.candidates.length} 个文件各自声明了 ${name}。这里按分层角色挑了最可能是`
                + '定义处的那个（stores/types 优先于 components），这只是启发式。要看别的用 file / line 限定：');
            for (const c of target.candidates.slice(0, 5)) {
                out.push(`  ${c.rel}:${c.line}  (该文件内 ${c.weight} 处)${c.rel === target.relPath ? '  <- 当前' : ''}`);
            }
        }

        out.push('', `== 语义引用 (${refs.length} 处 / ${byFile.size} 个文件) ==`);
        if (refs.length === 0) out.push('  无');
        for (const [label, entries] of Object.entries(groups)) {
            if (entries.length === 0) continue;
            out.push(`${label} (${entries.length}):`);
            out.push(withTruncation(entries.slice(0, lines_per_group), entries.length, lines_per_group, 'lines_per_group'));
        }

        if (declFiles.length > 0) {
            out.push('', `== 同名的其他声明 (${declFiles.length} 个文件) ==`);
            // 路径很便宜，这里绝不截断——截断文件列表正是之前召回率只有 20% 的原因。
            for (const rel of declFiles.sort()) out.push(`  ${rel}`);
        }

        if (textOnly.length > 0) {
            out.push('', `== 仅文本命中 (${textOnly.length} 个文件) ==`);
            out.push('LSP 追不到：多半经 props 透传、对象展开（`...obj`）或局部别名使用。需人工确认。');
            for (const [rel, count] of textOnly.slice(0, MAX_TEXTUAL_FILES)) out.push(`  ${rel}  (${count} 处)`);
            if (textOnly.length > MAX_TEXTUAL_FILES) {
                out.push(`  … 还有 ${textOnly.length - MAX_TEXTUAL_FILES} 个（名字太常见，考虑换更具体的符号名）`);
            }
        }

        const total = new Set([target.relPath, ...byFile.keys(), ...declFiles, ...textOnly.map(([rel]) => rel)]).size;
        out.push('', `合计 ${total} 个文件出现这个名字。语义部分精确，文本部分需人工确认。`);
        return out.join('\n');
    },
};
