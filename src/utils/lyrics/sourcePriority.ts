import type { LyricProviderSource } from '../../types';

// src/utils/lyrics/sourcePriority.ts

export const DEFAULT_PREFERRED_LYRIC_SOURCE: LyricProviderSource = 'qq';

const BASE_LYRIC_SOURCE_ORDER: readonly LyricProviderSource[] = ['netease', 'amll', 'qq', 'kugou'];

export const isLyricProviderSource = (value: unknown): value is LyricProviderSource => (
    value === 'netease' || value === 'amll' || value === 'qq' || value === 'kugou'
);

// Places the user preference first while retaining every fallback source exactly once.
export const buildLyricSourceOrder = (
    preferredSource: LyricProviderSource = DEFAULT_PREFERRED_LYRIC_SOURCE,
): LyricProviderSource[] => [
    preferredSource,
    ...BASE_LYRIC_SOURCE_ORDER.filter(source => source !== preferredSource),
];

export const migratePreferredLyricSource = (
    versionedValue: unknown,
    legacyValue: unknown,
): LyricProviderSource => {
    if (versionedValue !== null && versionedValue !== undefined) {
        return isLyricProviderSource(versionedValue) ? versionedValue : DEFAULT_PREFERRED_LYRIC_SOURCE;
    }
    if (legacyValue === 'amll' || legacyValue === 'qq' || legacyValue === 'kugou') return legacyValue;
    return DEFAULT_PREFERRED_LYRIC_SOURCE;
};
