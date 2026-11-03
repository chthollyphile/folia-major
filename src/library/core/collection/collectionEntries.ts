import type { SongResult } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';

// src/library/core/collection/collectionEntries.ts
// 集合内「条目」的身份。同一首歌可以在一个歌单里出现多次，所以条目身份不能只用歌曲身份：
// 第 n 次出现记作 `${playbackKey}-${n}`（首次为 0）。这正是网格卡片 id 的格式，
// 换成别的 renderer 也用同一个键，焦点和恢复记录才能互通。

/**
 * id 里的重复序号必须在使用前知道：同一首歌在歌单里出现两次时，第二个的 id 是 `<key>-1`。
 * 这需要一遍「key → 已出现次数」的扫描 —— 但它只做字符串比较与 Map 计数，比塑形整个对象便宜
 * 一个量级；而且前缀没变时可以复用上一次的结果（分页追加是最常见的情形）。
 */
export interface DuplicateOccurrenceCache {
    source: SongResult[];
    seen: Map<string, number>;
    occurrences: Map<number, number>;
}

export interface DuplicateOccurrences {
    seen: Map<string, number>;
    occurrences: Map<number, number>;
}

export const buildDuplicateOccurrences = (
    tracks: SongResult[],
    previous: DuplicateOccurrenceCache | null,
): DuplicateOccurrences => {
    const reusablePrefix = Boolean(previous)
        && previous!.source.length <= tracks.length
        && previous!.source.every((track, index) => track === tracks[index]);
    const seen = reusablePrefix ? previous!.seen : new Map<string, number>();
    const occurrences = reusablePrefix ? previous!.occurrences : new Map<number, number>();
    for (let index = reusablePrefix ? previous!.source.length : 0; index < tracks.length; index += 1) {
        const key = getPlaybackSongKey(tracks[index]);
        const count = seen.get(key) ?? 0;
        if (count > 0) {
            occurrences.set(index, count);
        }
        seen.set(key, count + 1);
    }
    return { seen, occurrences };
};

/** 条目键的唯一拼法。 */
export const formatEntryKey = (playbackKey: string, occurrence: number): string => `${playbackKey}-${occurrence}`;

/** 第 index 个条目的键；越界时返回 null。 */
export const entryKeyAt = (
    tracks: readonly SongResult[],
    occurrences: ReadonlyMap<number, number>,
    index: number,
): string | null => {
    const track = tracks[index];
    return track ? formatEntryKey(getPlaybackSongKey(track), occurrences.get(index) ?? 0) : null;
};

/** 按条目键找下标；找不到返回 -1。只比较字符串，不需要塑形任何视图对象。 */
export const findEntryIndex = (
    tracks: readonly SongResult[],
    occurrences: ReadonlyMap<number, number>,
    entryKey: string,
): number => {
    for (let index = 0; index < tracks.length; index += 1) {
        if (entryKeyAt(tracks, occurrences, index) === entryKey) {
            return index;
        }
    }
    return -1;
};

/**
 * 焦点所在的条目被删掉（或被替换，例如每日推荐「不喜欢」换上的新歌）之后，焦点该落在第几行：
 * 原位置的下一行；删的是最后一行时落到新的最后一行（即上一行）；没有行了返回 -1。
 *
 * 不按条目键去找「下一行」：同一首歌的重复条目被删掉一个之后，后面那些的重复序号会前移，
 * 键会变。改为数「被删那一行之前、仍然留在新列表里的行」——它们的键不受影响（重复序号只看前面），
 * 这个数就是下一行在新列表里的位置。按歌删（在线 / 本地歌单删掉同一首的全部条目）时，
 * 前面那些同歌条目也一起消失，结果照样正确。
 */
export const resolveRowAfterRemoval = (
    previousRowKeys: readonly string[],
    removedRow: number,
    nextRowKeys: readonly string[],
): number => {
    if (nextRowKeys.length === 0) return -1;
    const remaining = new Set(nextRowKeys);
    let survivorsBefore = 0;
    for (let row = 0; row < Math.min(removedRow, previousRowKeys.length); row += 1) {
        if (remaining.has(previousRowKeys[row])) survivorsBefore += 1;
    }
    return Math.min(survivorsBefore, nextRowKeys.length - 1);
};
