import type { SongResult } from '../../../types';

// src/library/core/collection/collectionQuery.ts
// 集合内筛选：一首歌参与匹配的文本，以及按 query 选出命中的下标。
//
// 匹配文本必须与 GridView 原先对网格项做的那一遍逐字等价（单测里有逐字复制的旧实现做对拍）：
// 歌名 + 别名 + 译名、歌手（逗号拼一次、空格拼一次）、专辑名。网格项的 name 是 ReactNode，
// 原实现里那一项从来不参与匹配，这里也不加。

/** 一首歌参与筛选的文本（已转小写）。 */
export const getTrackSearchText = (track: SongResult): string => {
    const titleText = [
        track.name,
        track.aliases?.join(' '),
        track.translatedNames?.join(' '),
    ].filter(Boolean).join(' ');
    const artistNames = track.artists?.map(artist => artist.name);
    return [
        titleText,
        artistNames?.join(', '),
        track.album?.name,
        artistNames?.join(' '),
    ]
        .filter(value => value !== undefined && value !== null)
        .join(' ')
        .toLowerCase();
};

export const normalizeTrackQuery = (query: string): string => query.trim().toLowerCase();

/**
 * 命中 query 的下标（保持原顺序）。query 为空时返回 null，表示「没有筛选」，
 * 与「筛选后一首都没有」（空数组）区分开。
 */
export const matchTrackIndexes = (tracks: readonly SongResult[], query: string): number[] | null => {
    const needle = normalizeTrackQuery(query);
    if (!needle) return null;
    const matches: number[] = [];
    tracks.forEach((track, index) => {
        if (getTrackSearchText(track).includes(needle)) {
            matches.push(index);
        }
    });
    return matches;
};
