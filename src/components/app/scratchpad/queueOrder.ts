// src/components/app/scratchpad/queueOrder.ts
// 速记簿「播放队列」展开视图的纯函数：把选中的几张卡整块挪到新位置（画布上拖动松手），以及把没提交的草稿接到换了对象的新队列上。
// 不 import React，单测直接测。

/**
 * 把 indices 那几项（保持它们原来的先后）整块挪走，插到其余各项之间第 targetIndex 个位置（0 是最前面，
 * 其余项数是最后面；画布松手时的落点就是这样数的）。顺序没变时返回 items 本身。
 */
export const moveBlockToIndex = <T>(items: readonly T[], indices: readonly number[], targetIndex: number): T[] => {
    const picked = [...new Set(indices)]
        .filter(index => Number.isInteger(index) && index >= 0 && index < items.length)
        .sort((one, other) => one - other);
    if (picked.length === 0) return items as T[];
    const pickedSet = new Set(picked);
    const remaining = items.filter((_, index) => !pickedSet.has(index));
    const insertAt = Math.min(remaining.length, Math.max(0, Math.round(targetIndex)));
    const next = [...remaining.slice(0, insertAt), ...picked.map(index => items[index]), ...remaining.slice(insertAt)];
    return next.some((item, index) => item !== items[index]) ? next : items as T[];
};

/**
 * 把草稿接到一份新的队列上：next 与草稿出发时的 base 按播放键是同一串（只是有的条目换了新对象——每次开播都会把
 * 正在播的那首换成新对象）时，草稿里的条目换成 next 里对应位置的对象；顺序真的变了（入队、移除、换歌单）时 null。
 */
export const rebaseOrder = <T>(
    base: readonly T[],
    order: readonly T[],
    next: readonly T[],
    keyOf: (item: T) => string,
): T[] | null => {
    if (base === next) return order as T[];
    if (base.length !== next.length || order.length !== base.length) return null;
    if (!base.every((item, index) => keyOf(item) === keyOf(next[index]))) return null;
    const swap = new Map<T, T>();
    base.forEach((item, index) => swap.set(item, next[index]));
    const rebased: T[] = [];
    for (const item of order) {
        const replacement = swap.get(item);
        if (replacement === undefined) return null;
        rebased.push(replacement);
    }
    return rebased;
};
