import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { SongResult } from '../../../types';
import { isTrackShownUnplayable, readTrackSourcesVersion, subscribeTrackSources } from '../../../services/foliaPlaylist/trackSourceState';
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
    // 播不了的行：平台说下架的，以及来源此刻不在的（Folia 聚合歌单里音源被停用、卸载的那几行）。来源的状态会变，
    // 跟着音源登记表重算。
    const sourcesVersion = useSyncExternalStore(subscribeTrackSources, readTrackSourcesVersion);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sourcesVersion 是 isTrackShownUnplayable 读的状态
    const playableTracks = useMemo(() => derivePlayableTracks(displayTracks, isTrackShownUnplayable), [displayTracks, sourcesVersion]);

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
        isTrackShownUnplayable,
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
