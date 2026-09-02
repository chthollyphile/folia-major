import path from 'node:path';
import { location, withTruncation } from '../format.mjs';
import { resolveTarget } from '../resolve.mjs';
// dev/mcp/ts-code-map/tools/callHierarchy.mjs

const MAX_ROWS = 120;

async function prepare(client, target, name) {
    const items = await client.request('textDocument/prepareCallHierarchy', {
        textDocument: { uri: target.uri },
        position: target.position,
    });
    if (!items?.length) {
        throw new Error(`${name} 上取不到 call hierarchy —— 它可能不是函数/方法。用 references 看引用。`);
    }
    return items[0];
}

/** 依赖库里的东西（Array.filter 之类）对理解本项目代码没有价值，默认不展示。 */
const isVendor = rel => rel.startsWith('node_modules/') || rel.includes('/node_modules/') || rel.endsWith('.d.ts');

/**
 * 模块顶层的调用，LSP 给的 item.name 是文件的绝对路径，直接显示很难看也没信息量。
 */
const displayName = (name, rel) =>
    (path.isAbsolute(name) || name === rel) ? `<模块顶层> ${path.basename(rel)}` : name;

/**
 * 沿调用链走 depth 层。
 * 环要挡住（互相调用的两个函数会无限递归），重复展开也要挡（同一个函数在多条路径上出现时
 * 只展开一次，否则宽的调用图会指数爆炸）。
 */
async function walk(client, item, direction, depth, expanded, rows, level, stats) {
    if (depth <= 0 || rows.length >= MAX_ROWS) return;
    const method = direction === 'in' ? 'callHierarchy/incomingCalls' : 'callHierarchy/outgoingCalls';
    const calls = (await client.request(method, { item }).catch(() => null)) ?? [];

    for (const call of calls) {
        if (rows.length >= MAX_ROWS) return;
        const node = direction === 'in' ? call.from : call.to;
        const rel = client.relFor(node.uri);
        if (isVendor(rel)) { stats.vendor++; continue; }

        const key = `${rel}:${node.selectionRange.start.line}`;
        const seenBefore = expanded.has(key);

        rows.push(`${'  '.repeat(level)}${displayName(node.name, rel)}  ${location(rel, node.selectionRange.start.line)}${seenBefore ? '  (已在上面展开)' : ''}`);
        if (seenBefore) continue;
        expanded.add(key);
        await walk(client, node, direction, depth - 1, expanded, rows, level + 1, stats);
    }
}

function makeTool({ name, direction, description, rootLabel }) {
    return {
        name,
        description,
        inputSchema: {
            type: 'object',
            properties: {
                symbol: { type: 'string', description: '函数或方法名' },
                file: { type: 'string', description: '限定声明所在文件，省略则全库找' },
                line: { type: 'number', description: '同名符号消歧用的 1-based 行号' },
                depth: { type: 'number', description: '追几层，默认 1' },
            },
            required: ['symbol'],
        },
        async run({ client }, { symbol, file, line, depth = 1 }) {
            const target = await resolveTarget(client, { symbol, file, line });
            const item = await prepare(client, target, symbol);

            const rows = [];
            const stats = { vendor: 0 };
            await walk(client, item, direction, depth, new Set(), rows, 1, stats);

            const header = `${symbol}  ${location(target.relPath, target.position.line)}  (${rootLabel}, depth=${depth})`;
            const footer = stats.vendor > 0 ? `\n(已略过 ${stats.vendor} 个依赖库/类型声明里的条目)` : '';
            if (rows.length === 0) return `${header}\n  没有${rootLabel}。${footer}`;
            return `${header}\n${withTruncation(rows, rows.length, MAX_ROWS, 'depth')}${footer}`;
        },
    };
}

export const callers = makeTool({
    name: 'callers',
    direction: 'in',
    rootLabel: '调用方',
    description:
        '谁调用了这个函数，按调用链展开。判断改一个函数会波及哪些上游路径时用它。'
        + '只看引用位置用 references，要顺着调用链往上追用这个。',
});

export const callees = makeTool({
    name: 'callees',
    direction: 'out',
    rootLabel: '被调用方',
    description:
        '这个函数调用了谁，按调用链展开。想快速搞清一个函数的实现依赖、不想读它全部源码时用它。',
});
