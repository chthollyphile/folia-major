// src/library/core/collection/collectionPaging.ts
// 分页追加的去重规则：后续页里已出现过的 key 丢弃，先到先得、保持顺序。
// 原在 components/folia-grid/progressiveGrid.ts；补页循环要搬进 services，不能反向 import 组件目录。

export const appendUniqueByKey = <T>(
    current: readonly T[],
    incoming: readonly T[],
    getKey: (item: T, index: number) => string
): T[] => {
    const seen = new Set(current.map((item, index) => getKey(item, index)));
    const next = [...current];
    incoming.forEach((item, index) => {
        const key = getKey(item, current.length + index);
        if (seen.has(key)) return;
        seen.add(key);
        next.push(item);
    });
    return next;
};
