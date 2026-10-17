// src/services/analysis/beatGridKeys.ts
// The storage key prefixes of the stored beat lists. A module of its own, importing nothing, so services/repositories/cacheRepository.ts can route and categorise these keys
// without importing beatGrid.ts and, through it, the database it is part of. The drum hits htdemucs
// reads for 智能动感模式 (drumHits.ts) are kept beside them, for the same reason.

/** final0's lists, which automix and the beat FX share; the prefix they always had. */
export const BEAT_GRID_PREFIX = 'beat_this_grid_';

/**
 * small0's lists, from when the beat FX ran it: nothing reads them now, but "clear analysis cache"
 * still clears them with the rest.
 */
const LEGACY_BEAT_GRID_PREFIXES = ['beat_this_small_grid_'] as const;

/** Whether `key` is a stored beat list, this version's or a legacy one. */
export const isBeatGridKey = (key: string): boolean =>
    [BEAT_GRID_PREFIX, ...LEGACY_BEAT_GRID_PREFIXES].some(prefix => key.startsWith(prefix));

/** A track's drum hits off htdemucs' drum stem (drumHits.ts); the version is part of the prefix. */
export const DRUM_HITS_PREFIX = 'drum_hits_v1_';

/** Whether `key` is a track's stored drum hits. */
export const isDrumHitsKey = (key: string): boolean => key.startsWith(DRUM_HITS_PREFIX);
