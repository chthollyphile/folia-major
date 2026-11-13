import type { LyricProviderSource } from '../../types';
import { getLyricSourceIds, isLyricSourceId } from './lyricSources';

// src/utils/lyrics/sourcePriority.ts

export const DEFAULT_PREFERRED_LYRIC_SOURCE: LyricProviderSource = 'qq';

// Places the user preference first while retaining every fallback source exactly once.
export const buildLyricSourceOrder = (
    preferredSource: LyricProviderSource = DEFAULT_PREFERRED_LYRIC_SOURCE,
): LyricProviderSource[] => [
    preferredSource,
    ...getLyricSourceIds().filter(source => source !== preferredSource),
];

export const migratePreferredLyricSource = (
    versionedValue: unknown,
    legacyValue: unknown,
): LyricProviderSource => {
    if (versionedValue !== null && versionedValue !== undefined) {
        // Any id is kept, registered now or not: a source missing for now (its platform not enabled, a mod not
        // loaded yet) is in force again once it is back (Folium 2.0 plan §7.1). Only what cannot be an id is reset.
        return isLyricSourceId(versionedValue) ? versionedValue : DEFAULT_PREFERRED_LYRIC_SOURCE;
    }
    // A fixed list, not the table: only these three names are carried over from the older key.
    if (legacyValue === 'amll' || legacyValue === 'qq' || legacyValue === 'kugou') return legacyValue;
    return DEFAULT_PREFERRED_LYRIC_SOURCE;
};
