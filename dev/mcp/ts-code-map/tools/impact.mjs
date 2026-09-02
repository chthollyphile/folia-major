import { textualHits } from '../files.mjs';
import { location, renderBuckets } from '../format.mjs';
import { buildModuleGraph, closure } from '../graph/modules.mjs';
import { resolveTarget } from '../resolve.mjs';
// dev/mcp/ts-code-map/tools/impact.mjs

const looksLikePath = value => value.includes('/') || /\.[a-z]+$/i.test(value);

export default {
    name: 'impact',
    description:
        '改一个符号或文件会波及哪些地方（blast radius），按目录分桶给出。'
        + '动手改之前先问一下它，判断改动是局部的还是会扩散。'
        + '符号模式会把所有同名声明和文本命中一起算进来，再沿模块依赖外扩。'
        + '结果是传递闭包上界，会高估影响面，只作范围参考。',
    inputSchema: {
        type: 'object',
        properties: {
            target: { type: 'string', description: '符号名，或文件路径' },
            file: { type: 'string', description: '符号模式下限定声明所在文件，用于消歧' },
            line: { type: 'number', description: '符号模式下消歧用的 1-based 行号' },
            depth: { type: 'number', description: '模块依赖追几层，默认 2' },
        },
        required: ['target'],
    },
    async run({ client, root }, { target, file, line, depth = 2 }) {
        const graph = buildModuleGraph(root);
        const out = [];
        let seedFiles;

        if (!file && looksLikePath(target) && graph.fileSet.has(target.replace(/^\.\//, ''))) {
            seedFiles = [target.replace(/^\.\//, '')];
            out.push(`文件 ${seedFiles[0]}  depth=${depth}`);
        } else {
            const resolved = await resolveTarget(client, { symbol: target, file, line });
            const refs = (await client.request('textDocument/references', {
                textDocument: { uri: resolved.uri },
                position: resolved.position,
                context: { includeDeclaration: false },
            })) ?? [];
            const direct = [...new Set(refs.map(ref => client.relFor(ref.uri)))];

            // 只看一个声明会严重低估：lyricsFontScale 曾经解析到某个函数内的局部变量，
            // 于是把一个横跨 46 个文件的功能面报成 3 个。同名声明和文本命中必须一起算。
            const sameName = ((await client.request('workspace/symbol', { query: target })) ?? [])
                .filter(s => s.name === target)
                .map(s => client.relFor(s.location.uri))
                .filter(rel => !rel.startsWith('dev/mcp/'));
            const textual = [...textualHits(root, target).keys()];

            out.push(`符号 ${target}  声明于 ${location(resolved.relPath, resolved.position.line)}  depth=${depth}`);
            if (resolved.alternatives > 0) {
                out.push(`（另有 ${resolved.alternatives} 个同名符号，已一并计入；要只看某一个用 file/line 限定）`);
            }
            out.push('', `直接相关的文件 (${new Set([...direct, ...sameName, ...textual]).size}):`);
            out.push(...renderBuckets([...new Set([...direct, ...sameName, ...textual])]));
            seedFiles = [...new Set([resolved.relPath, ...direct, ...sameName, ...textual])];
        }

        const downstream = closure(graph, seedFiles, 'reverse', depth);
        const indirect = [...downstream.keys()].filter(rel => !seedFiles.includes(rel));

        out.push('', `再往外 ${depth} 层模块依赖 (${indirect.length}):`);
        out.push(...(indirect.length ? renderBuckets(indirect) : ['  无']));

        const total = new Set([...seedFiles, ...indirect]).size;
        out.push('', `合计约 ${total} 个文件在影响范围内。这是传递闭包上界，实际受影响的通常更少。`);
        return out.join('\n');
    },
};
