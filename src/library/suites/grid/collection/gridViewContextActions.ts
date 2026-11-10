import type { SongResult } from '../../../../types';
import { isSongUnavailable } from '../../../../services/onlineMusic/songAvailability';
import { resolveContextTracks } from '../../../core/collection/collectionView';

// src/library/suites/grid/collection/gridViewContextActions.ts

export type GridViewContextItem = {
    rawTrack?: SongResult;
};

// Resolves the exact playable track set represented by the current GridView context.
// The rule itself lives in library/core/collection/collectionView, shared with every other renderer.
export const resolveGridViewContextTracks = (
    visibleItems: readonly GridViewContextItem[],
    allPlayableTracks: SongResult[],
    isFilterActive: boolean
): SongResult[] => resolveContextTracks(
    isFilterActive ? visibleItems.flatMap(item => (item.rawTrack ? [item.rawTrack] : [])) : null,
    allPlayableTracks,
    isSongUnavailable,
);
