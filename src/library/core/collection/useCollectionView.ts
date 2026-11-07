import { useCallback, useMemo, useRef } from 'react';
import type { SongResult } from '../../../types';
import { isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import {
    buildDuplicateOccurrences,
    entryKeyAt,
    findEntryIndex,
    type DuplicateOccurrenceCache,
} from './collectionEntries';
import { matchTrackIndexes } from './collectionQuery';
import {
    deriveDisplayTracks,
    derivePlayableTracks,
    resolveContextTracks,
    type LocalTrackSortContext,
} from './collectionView';

// src/library/core/collection/useCollectionView.ts
// 把资源里的曲目派生成 renderer 要的那几样：展示顺序、可播放曲目、筛选命中、操作范围、条目键。
// 规则都在 core/collection 的纯规则文件里，这里只负责按依赖记忆化，并缓存重复序号的扫描（分页追加时复用前缀）。

const NO_HIDDEN_KEYS: ReadonlySet<string> = new Set();

export type CollectionView = {
    displayTracks: SongResult[];
    playableTracks: SongResult[];
    /** 筛选命中的下标（在 displayTracks 里）；没有筛选时为 null。 */
    matchIndexes: number[] | null;
    /** 播放 / 入队「当前范围」作用的歌。 */
    contextTracks: SongResult[];
    isFilterActive: boolean;
    occurrences: ReadonlyMap<number, number>;
    entryKeyAt: (index: number) => string | null;
    findEntryIndex: (entryKey: string) => number;
};

export const useCollectionView = ({
    tracks,
    committedQuery,
    hiddenKeys = NO_HIDDEN_KEYS,
    localSort = null,
}: {
    tracks: SongResult[];
    committedQuery: string;
    hiddenKeys?: ReadonlySet<string>;
    localSort?: LocalTrackSortContext | null;
}): CollectionView => {
    const displayTracks = useMemo(
        () => deriveDisplayTracks(tracks, hiddenKeys, localSort),
        [hiddenKeys, localSort, tracks],
    );
    const playableTracks = useMemo(() => derivePlayableTracks(displayTracks, isSongUnavailable), [displayTracks]);

    const occurrenceCacheRef = useRef<DuplicateOccurrenceCache | null>(null);
    const occurrences = useMemo(() => {
        const { seen, occurrences: next } = buildDuplicateOccurrences(displayTracks, occurrenceCacheRef.current);
        occurrenceCacheRef.current = { source: displayTracks, seen, occurrences: next };
        return next;
    }, [displayTracks]);

    const matchIndexes = useMemo(() => matchTrackIndexes(displayTracks, committedQuery), [committedQuery, displayTracks]);
    const contextTracks = useMemo(() => resolveContextTracks(
        matchIndexes ? matchIndexes.map(index => displayTracks[index]) : null,
        playableTracks,
        isSongUnavailable,
    ), [displayTracks, matchIndexes, playableTracks]);

    const entryKeyAtIndex = useCallback((index: number) => entryKeyAt(displayTracks, occurrences, index), [displayTracks, occurrences]);
    const findEntry = useCallback((entryKey: string) => findEntryIndex(displayTracks, occurrences, entryKey), [displayTracks, occurrences]);

    return useMemo(() => ({
        displayTracks,
        playableTracks,
        matchIndexes,
        contextTracks,
        isFilterActive: matchIndexes !== null,
        occurrences,
        entryKeyAt: entryKeyAtIndex,
        findEntryIndex: findEntry,
    }), [contextTracks, displayTracks, entryKeyAtIndex, findEntry, matchIndexes, occurrences, playableTracks]);
};
