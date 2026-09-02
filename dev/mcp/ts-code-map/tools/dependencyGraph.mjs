import { withTruncation } from '../format.mjs';
import { buildModuleGraph, closure, edgeKey } from '../graph/modules.mjs';
// dev/mcp/ts-code-map/tools/dependencyGraph.mjs

const PER_LEVEL = 25;

/**
 * 只有直连那一层能确定判断纯类型依赖。多个起点（目录模式）时，所有连到它的边都是
 * 类型边才算；只要有一条是值导入，就是真的运行时依赖。
 */
function typeOnlyAtLevel1(graph, starts, rel, direction) {
    let seen = 0;
    for (const start of starts) {
        const from = direction === 'reverse' ? rel : start;
        const to = direction === 'reverse' ? start : rel;
        if (!graph.forward.get(from)?.has(to)) continue;
        seen++;
        if (!graph.typeOnly.has(edgeKey(from, to))) return false;
    }
    return seen > 0;
}

function renderSide(label, hits, starts, graph, direction) {
    if (hits.size === 0) return [`${label}: 无`];

    const byLevel = new Map();
    for (const [rel, level] of hits) {
        if (!byLevel.has(level)) byLevel.set(level, []);
        byLevel.get(level).push(rel);
    }

    const out = [`${label} (${hits.size}):`];
    for (const [level, items] of [...byLevel].sort((a, b) => a[0] - b[0])) {
        out.push(`  第 ${level} 层 (${items.length}):`);
        const rows = items.slice(0, PER_LEVEL).map(rel => {
            const typeish = level === 1 && typeOnlyAtLevel1(graph, starts, rel, direction);
            const viaGlob = level === 1 && starts.some(start => graph.globEdges.has(
                direction === 'reverse' ? edgeKey(rel, start) : edgeKey(start, rel)));
            return `    ${rel}${typeish ? '  (仅类型)' : ''}${viaGlob ? '  (经 import.meta.glob 自动注册)' : ''}`;
        });
        out.push(withTruncation(rows, items.length, PER_LEVEL, '本层上限 25（不是 depth）'));
    }
    return out;
}

export default {
    name: 'dependency_graph',
    description:
        '看一个文件或目录的模块依赖：正向（它 import 了谁）和反向（谁 import 了它）。'
        + '判断模块边界、找某个 service 的全部使用方时用它。图每次实时重建，不会过期。'
        + '纯 `import type` 的边标记为「仅类型」；`import.meta.glob` 自动注册的边也会展开并标出来。',
    inputSchema: {
        type: 'object',
        properties: {
            target: { type: 'string', description: '文件路径或目录，如 src/services/onlineMusic/omni.ts 或 src/stores' },
            direction: { type: 'string', description: 'forward（依赖谁）/ reverse（被谁依赖）/ both，默认 both' },
            depth: { type: 'number', description: '追几层，默认 1' },
        },
        required: ['target'],
    },
    async run({ root }, { target, direction = 'both', depth = 1 }) {
        const graph = buildModuleGraph(root);
        const normalised = target.replace(/^\.\//, '').replace(/\/$/, '');

        const starts = graph.fileSet.has(normalised)
            ? [normalised]
            : graph.files.filter(f => f.startsWith(`${normalised}/`));

        if (starts.length === 0) {
            return `${target} 不是图里的源文件或目录。图只收录 git 跟踪的 ts/tsx/js/jsx/mjs/cjs。`;
        }

        const scope = starts.length === 1 ? starts[0] : `${normalised}/  (${starts.length} 个文件)`;
        const out = [`${scope}  depth=${depth}`];

        if (direction !== 'reverse') {
            out.push('', ...renderSide('正向依赖（它 import 的）', closure(graph, starts, 'forward', depth), starts, graph, 'forward'));
        }
        if (direction !== 'forward') {
            out.push('', ...renderSide('反向依赖（import 它的）', closure(graph, starts, 'reverse', depth), starts, graph, 'reverse'));
        }
        return out.join('\n');
    },
};
