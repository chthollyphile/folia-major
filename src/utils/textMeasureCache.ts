// Copyright (c) 2026 chthollyphile
// src/components/visualizer/textMeasureCache.ts
// 各模式文字测量共用的两件小事：按插入顺序淘汰的有界缓存，以及按整段前缀累计字素偏移的循环骨架。
// 测量本身（pretext 首行宽、pretext 自然宽加字距、canvas measureText）仍由各模式传入，结果与原实现逐位一致。

/**
 * Stores `value` under `key` in an insertion-ordered Map, first evicting the oldest entry when a new
 * key would push the cache past `limit`. Returns `value` so callers can `return rememberBounded(...)`.
 */
export const rememberBounded = <TKey, TValue>(
    cache: Map<TKey, TValue>,
    key: TKey,
    value: TValue,
    limit: number,
): TValue => {
    if (!cache.has(key) && cache.size >= limit) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, value);
    return value;
};

/**
 * Cumulative grapheme offsets: `offsets[i]` is the advance of the first `i` graphemes, with
 * `offsets[0] = 0`. Each prefix is measured as a whole string (not as a sum of single glyphs) so
 * kerning and shaping across glyph boundaries stay exact; `measurePrefix` also receives the count and
 * the previous offset for modes that add tracking or keep the offsets monotonic.
 */
export const measurePrefixOffsets = (
    graphemes: readonly string[],
    measurePrefix: (prefix: string, count: number, previousOffset: number) => number,
): number[] => {
    const offsets = new Array<number>(graphemes.length + 1).fill(0);
    for (let count = 1; count <= graphemes.length; count += 1) {
        offsets[count] = measurePrefix(graphemes.slice(0, count).join(''), count, offsets[count - 1]);
    }
    return offsets;
};
