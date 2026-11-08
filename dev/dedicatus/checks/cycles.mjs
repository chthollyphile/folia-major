import { edgeKey } from '../../mcp/ts-code-map/graph/modules.mjs';
// dev/dedicatus/checks/cycles.mjs
// 循环依赖检查（D301）：在值导入图上求强连通分量，处在环里的每个文件记一条。
// 基线记的是“哪些文件已经在环里”，一个原本不在环里的文件进了环就是新违规；这种记法不受环内部结构变化影响。
// 只看会在模块加载时执行的边：`import type` 运行时不存在，动态 `import()` 不参与加载顺序，都不算。

/**
 * 迭代版 Tarjan，返回大小不小于 2 的强连通分量（自环不算：模块图里不会出现自己 import 自己）。
 * 不用递归：全仓四千多个文件，递归深度会顶到默认栈。
 */
export function findCycles(graph) {
    const adjacency = new Map();
    for (const [from, targets] of graph.forward) {
        adjacency.set(from, [...targets].filter(to => {
            const key = edgeKey(from, to);
            return !graph.typeOnly.has(key) && !graph.dynamic.has(key);
        }));
    }

    let counter = 0;
    const index = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];

    for (const start of adjacency.keys()) {
        if (index.has(start)) continue;
        const work = [{ node: start, next: 0 }];
        index.set(start, counter);
        low.set(start, counter);
        counter += 1;
        stack.push(start);
        onStack.add(start);

        while (work.length > 0) {
            const frame = work[work.length - 1];
            const neighbours = adjacency.get(frame.node) ?? [];
            if (frame.next < neighbours.length) {
                const target = neighbours[frame.next];
                frame.next += 1;
                if (!index.has(target)) {
                    index.set(target, counter);
                    low.set(target, counter);
                    counter += 1;
                    stack.push(target);
                    onStack.add(target);
                    work.push({ node: target, next: 0 });
                } else if (onStack.has(target)) {
                    low.set(frame.node, Math.min(low.get(frame.node), index.get(target)));
                }
                continue;
            }
            work.pop();
            if (work.length > 0) {
                const parent = work[work.length - 1].node;
                low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
            }
            if (low.get(frame.node) === index.get(frame.node)) {
                const component = [];
                let member;
                do {
                    member = stack.pop();
                    onStack.delete(member);
                    component.push(member);
                } while (member !== frame.node);
                if (component.length > 1) components.push(component.sort());
            }
        }
    }
    return components.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
}

export function checkCycles(graph) {
    const findings = [];
    for (const component of findCycles(graph)) {
        for (const file of component) {
            findings.push({
                code: 'D301',
                file,
                message: `处在循环依赖里（${component.length} 个文件的环）`,
                key: `D301:${file}`,
            });
        }
    }
    return findings;
}
