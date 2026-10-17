import type { BeatThisModel } from './beatThisGpu';

// src/services/analysis/beatGridKeys.ts
// The storage key prefixes of the stored beat lists, one per model. A module of its own, with nothing
// but a type import, so services/repositories/cacheRepository.ts can route and categorise these keys
// without importing beatGrid.ts and, through it, the database it is part of. The drum hits htdemucs
// reads for 智能动感模式 (drumHits.ts) are kept beside them, for the same reason.

/** final0 keeps the prefix it always had, so lists stored before small0 existed stay valid. */
export const BEAT_GRID_PREFIXES: Readonly<Record<BeatThisModel, string>> = Object.freeze({
    beat_this: 'beat_this_grid_',
    beat_this_small: 'beat_this_small_grid_',
});

/** Whether `key` is a stored beat list of any model. */
export const isBeatGridKey = (key: string): boolean =>
    Object.values(BEAT_GRID_PREFIXES).some(prefix => key.startsWith(prefix));

/** A track's drum hits off htdemucs' drum stem (drumHits.ts); the version is part of the prefix. */
export const DRUM_HITS_PREFIX = 'drum_hits_v1_';

/** Whether `key` is a track's stored drum hits. */
export const isDrumHitsKey = (key: string): boolean => key.startsWith(DRUM_HITS_PREFIX);
