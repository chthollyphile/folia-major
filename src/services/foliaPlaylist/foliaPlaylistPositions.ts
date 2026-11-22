// src/services/foliaPlaylist/foliaPlaylistPositions.ts
// 条目在歌单里的位置号（纯函数）。位置号是留着空隙的整数：新加的条目排在最后，号是「最大的号 + 步长」；
// 重排时只给挪了地方的条目换号——没挪的那些（新顺序里原来的先后没变的最长的一串）号不动，挪了的在两边
// 没挪的条目的号之间取整数。两个号之间的空隙装不下要放进去的条目时，整张歌单重新编号（每条都要重写一次）。

/** 相邻两条的号差这么多：两条之间能再插进 1023 条而不用整张重编。 */
export const FOLIA_POSITION_STEP = 1024;

/** 追加 count 条时它们的号：接在 lastPosition 后面（歌单是空的传 null）。 */
export const appendPositions = (lastPosition: number | null, count: number): number[] => {
    const base = lastPosition ?? 0;
    return Array.from({ length: count }, (_, index) => base + (index + 1) * FOLIA_POSITION_STEP);
};

/** 整张重新编号：第 n 条（从 0 数）是 (n + 1) × 步长。 */
export const renumberedPositions = (count: number): number[] => appendPositions(null, count);

// 最长递增子序列里的下标（values 两两不同）。O(n log n)。
const longestIncreasingRun = (values: readonly number[]): Set<number> => {
    const tails: number[] = [];
    const before = new Array<number>(values.length).fill(-1);
    values.forEach((value, index) => {
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (values[tails[middle]] < value) low = middle + 1;
            else high = middle;
        }
        if (low > 0) before[index] = tails[low - 1];
        tails[low] = index;
    });
    const kept = new Set<number>();
    for (let index = tails.length > 0 ? tails[tails.length - 1] : -1; index !== -1; index = before[index]) kept.add(index);
    return kept;
};

export type FoliaReorderPlan =
    /** 只有这些 key 要换号。 */
    | { kind: 'move'; positions: Map<string, number> }
    /** 空隙不够：每条都换号，按新的顺序。 */
    | { kind: 'renumber'; positions: Map<string, number> };

/**
 * 重排要改哪些条目的号。current 是歌单现在的条目（按位置号从小到大），orderedKeys 是它们的 key 的一个排列。
 * 调用方保证是排列；顺序没变时返回一个空的 move。
 */
export const planReorder = (current: ReadonlyArray<{ key: string; position: number }>, orderedKeys: readonly string[]): FoliaReorderPlan => {
    const indexByKey = new Map(current.map((item, index) => [item.key, index]));
    const oldIndexes = orderedKeys.map(key => indexByKey.get(key) as number);
    const kept = longestIncreasingRun(oldIndexes);
    const positions = new Map<string, number>();
    const renumber = (): FoliaReorderPlan => {
        const fresh = renumberedPositions(orderedKeys.length);
        return { kind: 'renumber', positions: new Map(orderedKeys.map((key, index) => [key, fresh[index]])) };
    };

    let at = 0;
    // 上一条没挪的条目的号；最前面那一段之前没有。
    let lower: number | null = null;
    while (at < orderedKeys.length) {
        if (kept.has(at)) {
            lower = current[oldIndexes[at]].position;
            at += 1;
            continue;
        }
        let end = at;
        while (end < orderedKeys.length && !kept.has(end)) end += 1;
        const count = end - at;
        const upper = end < orderedKeys.length ? current[oldIndexes[end]].position : null;
        for (let index = 0; index < count; index += 1) {
            let position: number;
            if (lower !== null && upper !== null) {
                // 夹在两条没挪的中间：空隙里均匀地取整数，装不下就整张重编。
                if (upper - lower - 1 < count) return renumber();
                position = lower + Math.floor(((upper - lower) * (index + 1)) / (count + 1));
            } else if (upper !== null) {
                position = upper - (count - index) * FOLIA_POSITION_STEP;
            } else {
                position = (lower ?? 0) + (index + 1) * FOLIA_POSITION_STEP;
            }
            if (!Number.isSafeInteger(position)) return renumber();
            positions.set(orderedKeys[at + index], position);
        }
        at = end;
    }
    return { kind: 'move', positions };
};
