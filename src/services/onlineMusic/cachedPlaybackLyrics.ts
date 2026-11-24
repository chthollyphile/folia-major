import type { LyricData, SongResult } from '../../types';
import { savedBeforeChorusOrigin } from '../../utils/lyrics/cachedLyrics';
import { ensureLyricDataRenderHints, migrateLyricDataRenderHints } from '../../utils/lyrics/renderHints';
import { loadOnlineLyricsState } from '../../utils/onlineLyricsState';
import { saveToCache } from '../db';
import { omni } from './omni';
import { getSongCacheWithLegacyMigration } from './resourceCache';
import { getSongResourceCacheKey } from './resourceKeys';

// src/services/onlineMusic/cachedPlaybackLyrics.ts
// An online song's cached lyrics as the playback paths read them, with lyrics saved before chorus origins
// (#1333) fetched again so their chorus is marked the way it is now.

// How long a read waits for that fetch before it shows what is cached; the fetch goes on and saves its lyrics.
const REFRESH_WAIT_MS = 4000;

// One fetch per entry a session, whether it brought lyrics or not: a song asked again (another play, the
// prefetch pass, a restore) waits on the same one, and one that could not be refreshed is not asked every play.
const refreshes = new Map<string, Promise<LyricData | null>>();

const refreshStaleLyrics = (song: SongResult, cacheKey: string): Promise<LyricData | null> => {
    const known = refreshes.get(cacheKey);
    if (known) return known;
    const pending = (async (): Promise<LyricData | null> => {
        try {
            const fresh = ensureLyricDataRenderHints((await omni.getLyrics(song)).lyrics);
            if (!fresh || fresh.lines.length === 0) {
                console.info('[LyricCache] Lyrics saved before chorus origins kept: a new fetch brought none', { song: cacheKey });
                return null;
            }
            await saveToCache(cacheKey, fresh);
            console.info('[LyricCache] Lyrics saved before chorus origins replaced by a new fetch', { song: cacheKey });
            return fresh;
        } catch (error) {
            console.warn('[LyricCache] Lyrics saved before chorus origins kept: the new fetch failed', { song: cacheKey }, error);
            return null;
        }
    })();
    refreshes.set(cacheKey, pending);
    return pending;
};

/**
 * The song's cached lyrics (the `lyric` entry), as every cached read on the way to playing them takes them. An entry
 * saved before chorus origins is fetched again where it is what plays (not under an imported or chosen lyric, which
 * the entry does not stand for): the new lyrics when they come within REFRESH_WAIT_MS, else the entry as it is,
 * which is also what an offline or empty fetch leaves. `refresh: false` is for a reader that will not show the
 * entry but fetch the lyrics itself (and write them over it): it gets the entry as it is, without a second fetch.
 */
export const readCachedPlaybackLyrics = async (
    song: SongResult,
    { refresh = true }: { refresh?: boolean } = {},
): Promise<LyricData | null> => {
    const cached = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
    if (!refresh || !cached || !savedBeforeChorusOrigin(cached)) return cached;
    const state = await loadOnlineLyricsState(song);
    if (state?.hasOnlineOverride || (state?.lyricsSource === 'imported' && state.importedLyrics)) return cached;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), REFRESH_WAIT_MS);
    });
    try {
        return (await Promise.race([refreshStaleLyrics(song, getSongResourceCacheKey('lyric', song)), waited])) ?? cached;
    } finally {
        clearTimeout(timer);
    }
};

/** For tests: forgets which entries this session already tried to refresh. */
export const resetCachedPlaybackLyricsRefreshes = (): void => {
    refreshes.clear();
};
