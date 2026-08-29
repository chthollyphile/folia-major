import { getFromCacheWithMigration, saveToCache } from '../services/db';
import { getSongResourceCacheKey } from '../services/onlineMusic/resourceKeys';
import type { OnlineLyricsState, SongResult } from '../types';
import type { MigrationResult } from './lyrics/renderHints';
import { migrateLyricDataRenderHints as migrateLyrics } from './lyrics/renderHints';

// src/utils/onlineLyricsState.ts

const ONLINE_LYRICS_STATE_SUFFIX = '_state';

const migrateOnlineLyricsState = (value: OnlineLyricsState): MigrationResult<OnlineLyricsState> => {
    const importedMigration = migrateLyrics(value.importedLyrics);
    const overrideMigration = migrateLyrics(value.onlineOverrideLyrics);

    return {
        value: {
            ...value,
            importedLyrics: importedMigration.value,
            onlineOverrideLyrics: overrideMigration.value,
        },
        changed: importedMigration.changed || overrideMigration.changed,
    };
};

export const getOnlineLyricsStateCacheKey = (song: SongResult) =>
    `${getSongResourceCacheKey('lyric', song)}${ONLINE_LYRICS_STATE_SUFFIX}`;

export const loadOnlineLyricsState = async (song: SongResult): Promise<OnlineLyricsState | null> => {
    const key = getOnlineLyricsStateCacheKey(song);
    return getFromCacheWithMigration<OnlineLyricsState>(key, migrateOnlineLyricsState);
};

export const saveOnlineLyricsState = async (song: SongResult, state: OnlineLyricsState): Promise<void> => {
    const key = getOnlineLyricsStateCacheKey(song);
    await saveToCache(key, migrateOnlineLyricsState(state).value);
};

export const resolveOnlineLyrics = (
    state: OnlineLyricsState | null | undefined,
    fallbackLyrics: OnlineLyricsState['onlineOverrideLyrics']
) => {
    if (!state) {
        return fallbackLyrics ?? null;
    }

    if (state.lyricsSource === 'imported' && state.importedLyrics) {
        return state.importedLyrics;
    }

    if (state.hasOnlineOverride) {
        return state.onlineOverrideLyrics ?? null;
    }

    return fallbackLyrics ?? null;
};

export const getOnlineLyricsSourceLabel = (state: OnlineLyricsState | null | undefined): 'online' | 'imported' =>
    state?.lyricsSource === 'imported' ? 'imported' : 'online';

/**
 * The state to store once auto-match has concluded a track simply has no lyrics.
 *
 * "Every source agrees this one is instrumental" is an ANSWER and has to be persisted like any
 * other match. Storing nothing leaves `hasOnlineOverride` false, which is the flag that decides
 * whether to auto-match at all - so the full multi-provider search runs again on every prefetch
 * pass and every play, forever, for every instrumental in the library.
 *
 * Merged onto whatever was already there rather than replacing it: an imported selection stays
 * imported, and `resolveOnlineLyrics` keeps preferring it, so a background auto-match can never
 * take the listener's own choice away.
 */
export const markOnlineLyricsPureMusic = (
    previous: OnlineLyricsState | null | undefined,
): OnlineLyricsState => ({
    ...previous,
    lyricsSource: previous?.lyricsSource ?? 'online',
    hasOnlineOverride: true,
    // The override IS "there are none". Spelled out rather than left undefined so the stored state
    // reads the same way `resolveOnlineLyrics` will read it.
    onlineOverrideLyrics: null,
    matchedIsPureMusic: true,
});
