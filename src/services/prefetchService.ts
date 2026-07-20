/**
 * Song Prefetch Service
 * 
 * Prefetches nearby songs in the queue to enable smooth transitions.
 * Handles URL expiration (1200s TTL) and re-prefetches on queue changes.
 */

import { SongResult, LyricData, OnlineLyricsState, type LyricProviderSource } from '../types';
import { migrateLyricDataRenderHints } from '../utils/lyrics/renderHints';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { autoMatchBestLyric } from '../utils/lyrics/autoMatchBestLyric';
import { loadOnlineLyricsState, resolveOnlineLyrics, saveOnlineLyricsState } from '../utils/onlineLyricsState';
import type { AudioQualityPreference, MediaId } from '../types/onlineMusic';
import { getPlaybackSourceRef } from '../utils/appPlaybackGuards';
import { omni } from './onlineMusic/omni';
import { getSongResourceCacheKey } from './onlineMusic/resourceKeys';
import { getSongCacheWithLegacyMigration, hasCachedSongAudio } from './onlineMusic/resourceCache';
import { toSafeRemoteUrl } from '../utils/appPlaybackHelpers';
import { getProviderSongMetadata } from './onlineMusic/songMetadata';

// Prefetch configuration
const PREFETCH_COUNT_NEXT = 2;  // Prefetch 2 songs ahead
const PREFETCH_COUNT_PREV = 1;  // Prefetch 1 song behind
const URL_TTL_MS = 1200 * 1000; // 1200 seconds = 20 minutes
const MAX_PREFETCH_CACHE_SIZE = 200; // Evict least recently used entries beyond this limit

export interface PrefetchedSongData {
    songKey: string;
    songId: MediaId;
    audioUrl: string | null;
    audioUrlFetchedAt: number;
    audioUrlQuality: string | null; // Track which quality the URL was fetched for
    lyrics: LyricData | null;
    lyricRaw: {
        mainLrc: string | null;
        yrcLrc: string | null;
        transLrc: string | null;
        isPureMusic: boolean;
    } | null;
    lyricPreferenceSource: LyricProviderSource | null;
    coverUrl: string | null;
}

// In-memory prefetch cache (not persisted to IndexedDB to avoid stale URLs)
const prefetchCache = new Map<string, PrefetchedSongData>();

const getPrefetchSongKey = (song: SongResult): string => getSongResourceCacheKey('audio', song);

const touchPrefetchCacheEntry = (songKey: string, data: PrefetchedSongData): PrefetchedSongData => {
    prefetchCache.delete(songKey);
    prefetchCache.set(songKey, data);
    return data;
};

// Track current prefetch operation to cancel on queue change
let currentPrefetchAbortController: AbortController | null = null;
/**
 * Check if a prefetched URL is still valid (not expired)
 */
export const isUrlValid = (fetchedAt: number): boolean => {
    return Date.now() - fetchedAt < URL_TTL_MS;
};

/**
 * Get prefetched data for a song
 * @param songId - The song ID to get prefetched data for
 * @param requiredQuality - The audio quality to validate against (optional)
 */
export const getPrefetchedData = (song: SongResult, requiredQuality?: AudioQualityPreference): PrefetchedSongData | null => {
    const songKey = getPrefetchSongKey(song);
    const songId = song.id;
    const cached = prefetchCache.get(songKey);
    if (!cached) return null;

    if (cached.audioUrl && cached.audioUrl !== 'CACHED_IN_DB') {
        cached.audioUrl = toSafeRemoteUrl(cached.audioUrl) ?? null;
    }

    // Check if URL is expired
    if (cached.audioUrl && !isUrlValid(cached.audioUrlFetchedAt)) {
        console.log(`[Prefetch] URL expired for song ${songId}, will refetch`);
        cached.audioUrl = null;
        cached.audioUrlQuality = null;
    }

    // Check if quality matches (if requiredQuality is specified)
    if (cached.audioUrl && requiredQuality && cached.audioUrlQuality !== requiredQuality) {
        console.log(`[Prefetch] Quality mismatch for song ${songId}: cached=${cached.audioUrlQuality}, required=${requiredQuality}`);
        // Don't use cached URL, but keep other data (lyrics, cover)
        cached.audioUrl = null;
        cached.audioUrlQuality = null;
    }

    return touchPrefetchCacheEntry(songKey, cached);
};

/**
 * Prefetch a single song's resources
 */
const prefetchSong = async (
    song: SongResult,
    audioQuality: AudioQualityPreference,
    signal: AbortSignal,
    userId?: MediaId | null
): Promise<void> => {
    if (signal.aborted) return;

    const sourceRef = getPlaybackSourceRef(song);
    if (sourceRef.kind !== 'online') {
        console.log(`[Prefetch] Skipping non-online song: ${song.name}`);
        return;
    }
    if (!omni.canPlaySong(song)) {
        console.log(`[Prefetch] Skipping unavailable provider for song: ${song.name}`);
        return;
    }

    const songId = song.id;
    const songKey = getPrefetchSongKey(song);

    // Check if already prefetched with valid URL
    const existing = prefetchCache.get(songKey);
    if (existing?.audioUrl && existing.audioUrl !== 'CACHED_IN_DB') {
        existing.audioUrl = toSafeRemoteUrl(existing.audioUrl) ?? null;
    }
    const currentSettings = useSettingsUiStore.getState();
    const lyricPreferenceMatches = !currentSettings.autoUseBestLyric
        || existing?.lyricPreferenceSource === currentSettings.preferredAlternativeLyricSource;
    if (existing && lyricPreferenceMatches && existing.audioUrl && isUrlValid(existing.audioUrlFetchedAt) && (existing.lyrics || existing.lyricRaw?.isPureMusic)) {
        console.log(`[Prefetch] Already cached: ${song.name}`);
        touchPrefetchCacheEntry(songKey, existing);
        return;
    }

    console.log(`[Prefetch] Starting prefetch for: ${song.name} (quality: ${audioQuality})`);

    const data: PrefetchedSongData = {
        songKey,
        songId,
        audioUrl: existing?.audioUrl && existing.audioUrlQuality === audioQuality && isUrlValid(existing.audioUrlFetchedAt) ? existing.audioUrl : null,
        audioUrlFetchedAt: existing?.audioUrlFetchedAt || 0,
        audioUrlQuality: existing?.audioUrlQuality || null,
        lyrics: existing?.lyrics || null,
        lyricRaw: existing?.lyricRaw || null,
        lyricPreferenceSource: existing?.lyricPreferenceSource || null,
        coverUrl: existing?.coverUrl || null,
    };

    // Prefetch audio URL (if not cached or expired)
    if (!data.audioUrl) {
        try {
            const audioExists = await hasCachedSongAudio(song);
            if (audioExists) {
                console.log(`[Prefetch] Audio already cached for: ${song.name}`);
                data.audioUrl = 'CACHED_IN_DB';
                data.audioUrlFetchedAt = Date.now();
            } else if (!signal.aborted) {
                const audioSource = await omni.getAudioSource(song, audioQuality);
                const url = toSafeRemoteUrl(audioSource?.url) ?? null;
                if (url) {
                    data.audioUrl = url;
                    data.audioUrlFetchedAt = Date.now();
                    data.audioUrlQuality = audioQuality;
                    console.log(`[Prefetch] Got audio URL for: ${song.name} (quality: ${audioQuality})`);
                }
            }
        } catch (e) {
            console.warn(`[Prefetch] Failed to get audio URL for ${song.name}:`, e);
        }
    }

    // Prefetch lyrics (if not cached)
    if (!data.lyrics) {
        try {
            // Check IndexedDB cache first
            const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
            if (cachedLyrics) {
                console.log(`[Prefetch] Lyrics in IndexedDB for: ${song.name}`);
                data.lyrics = cachedLyrics;
            } else if (!signal.aborted) {
                const lyricResult = await omni.getLyrics(song, { userId });
                const processed = {
                    mainLrc: lyricResult.mainText ?? null,
                    yrcLrc: lyricResult.wordByWordText ?? null,
                    transLrc: lyricResult.translationText ?? null,
                    isPureMusic: lyricResult.isPureMusic,
                    lyrics: lyricResult.lyrics,
                    chorusRanges: lyricResult.chorusRanges || [],
                };
                data.lyricRaw = {
                    mainLrc: processed.mainLrc,
                    yrcLrc: processed.yrcLrc,
                    transLrc: processed.transLrc,
                    isPureMusic: processed.isPureMusic
                };

                let parsedLyrics = processed.lyrics;
                let finalLyrics = parsedLyrics;

                const onlineLyricsState = await loadOnlineLyricsState(song);
                const resolvedLyrics = resolveOnlineLyrics(onlineLyricsState, parsedLyrics);

                const settings = useSettingsUiStore.getState();
                const autoUseBest = settings.autoUseBestLyric;
                const preferredSource = settings.preferredAlternativeLyricSource;
                const shouldAutoMatch = autoUseBest && !onlineLyricsState?.hasOnlineOverride;

                if (shouldAutoMatch) {
                    try {
                        const metadata = getProviderSongMetadata(song);
                        const artistName = metadata.artists.map(a => a.name).join(', ');
                        const bestMatch = await autoMatchBestLyric(song.name, artistName, metadata.durationMs, {
                            album: metadata.album?.name,
                            preferredSource: settings.preferredAlternativeLyricSource,
                            ...(sourceRef.providerId === 'netease' || sourceRef.providerId === 'kugou'
                                ? { providerCandidate: {
                                    providerId: sourceRef.providerId as 'netease' | 'kugou',
                                    song,
                                    lyricsResult: {
                                        lyrics: parsedLyrics,
                                        mainText: processed.mainLrc,
                                        wordByWordText: processed.yrcLrc,
                                        translationText: processed.transLrc,
                                        isPureMusic: processed.isPureMusic,
                                        chorusRanges: processed.chorusRanges,
                                    },
                                } }
                                : {})
                        });
                        if (bestMatch && 'lyrics' in bestMatch && bestMatch.source !== sourceRef.providerId) {
                            const overrideState: OnlineLyricsState = {
                                lyricsSource: 'online',
                                matchedSongId: bestMatch.id,
                                hasOnlineOverride: true,
                                onlineOverrideLyrics: bestMatch.lyrics,
                                matchedLyricsSource: bestMatch.source,
                                matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                            };
                            await saveOnlineLyricsState(song, overrideState);
                            finalLyrics = bestMatch.lyrics;
                        } else if (bestMatch && 'isPureMusic' in bestMatch) {
                            finalLyrics = null;
                            if (data.lyricRaw) data.lyricRaw.isPureMusic = true;
                        }
                    } catch (error) {
                        console.warn('[Prefetch] Failed to auto-match best lyric:', error);
                    }
                } else {
                    console.log(
                        `[Prefetch] Skipping autoMatchBestLyric for "${song.name}": ` +
                        `preferredSource=${preferredSource}, ` +
                        `autoUseBestLyric=${autoUseBest}`
                    );
                    if (resolvedLyrics) {
                        finalLyrics = resolvedLyrics;
                    }
                }

                data.lyrics = finalLyrics;
                data.lyricPreferenceSource = autoUseBest ? preferredSource : null;

                if (data.lyrics) {
                    console.log(`[Prefetch] Parsed and processed lyrics for: ${song.name}`);
                }
            }
        } catch (e) {
            console.warn(`[Prefetch] Failed to get lyrics for ${song.name}:`, e);
        }
    }

    // Prefetch cover URL (just store the URL, don't download)
    if (!data.coverUrl) {
        const coverUrl = getProviderSongMetadata(song).coverUrl;
        if (coverUrl) {
            data.coverUrl = coverUrl.startsWith('http:') ? coverUrl.replace('http:', 'https:') : coverUrl;
        }
    }

    prefetchCache.delete(songKey);

    // Evict least recently used entries if cache exceeds limit
    while (prefetchCache.size >= MAX_PREFETCH_CACHE_SIZE) {
        const oldestKey = prefetchCache.keys().next().value;
        if (oldestKey !== undefined) {
            prefetchCache.delete(oldestKey);
        } else {
            break;
        }
    }

    prefetchCache.set(songKey, data);
};

export const updatePrefetchedAudioUrl = (
    song: SongResult,
    audioUrl: string,
    audioQuality: string
): void => {
    const songKey = getPrefetchSongKey(song);
    const existing = prefetchCache.get(songKey);

    const nextData: PrefetchedSongData = {
        songKey,
        songId: song.id,
        audioUrl,
        audioUrlFetchedAt: Date.now(),
        audioUrlQuality: audioQuality,
        lyrics: existing?.lyrics || null,
        lyricRaw: existing?.lyricRaw || null,
        lyricPreferenceSource: existing?.lyricPreferenceSource || null,
        coverUrl: existing?.coverUrl || null,
    };

    touchPrefetchCacheEntry(songKey, nextData);
};

/**
 * Prefetch nearby songs based on current song and queue
 */
export const prefetchNearbySongs = async (
    currentSong: SongResult,
    queue: SongResult[],
    audioQuality: AudioQualityPreference,
    userId?: MediaId | null
): Promise<void> => {
    // Cancel any ongoing prefetch
    if (currentPrefetchAbortController) {
        currentPrefetchAbortController.abort();
    }
    currentPrefetchAbortController = new AbortController();
    const signal = currentPrefetchAbortController.signal;

    // Find current song index in queue
    const currentSongKey = getPrefetchSongKey(currentSong);
    const currentIndex = queue.findIndex(song => getPrefetchSongKey(song) === currentSongKey);
    if (currentIndex === -1) {
        console.log('[Prefetch] Current song not in queue, skipping prefetch');
        return;
    }

    // Determine songs to prefetch
    const songsToPrefetch: SongResult[] = [];

    // Previous songs
    for (let i = 1; i <= PREFETCH_COUNT_PREV; i++) {
        const idx = currentIndex - i;
        if (idx >= 0) {
            songsToPrefetch.push(queue[idx]);
        }
    }

    // Next songs
    for (let i = 1; i <= PREFETCH_COUNT_NEXT; i++) {
        const idx = currentIndex + i;
        if (idx < queue.length) {
            songsToPrefetch.push(queue[idx]);
        }
    }

    console.log(`[Prefetch] Will prefetch ${songsToPrefetch.length} songs near index ${currentIndex}`);

    // Prefetch using requestIdleCallback for non-blocking execution
    const prefetchWithIdle = (songs: SongResult[], index: number) => {
        if (signal.aborted || index >= songs.length) return;

        const song = songs[index];

        if ('requestIdleCallback' in window) {
            requestIdleCallback(
                async () => {
                    if (signal.aborted) return;
                    await prefetchSong(song, audioQuality, signal, userId);
                    prefetchWithIdle(songs, index + 1);
                },
                { timeout: 5000 }
            );
        } else {
            // Fallback for browsers without requestIdleCallback
            setTimeout(async () => {
                if (signal.aborted) return;
                await prefetchSong(song, audioQuality, signal, userId);
                prefetchWithIdle(songs, index + 1);
            }, 100);
        }
    };

    prefetchWithIdle(songsToPrefetch, 0);
};

/**
 * Clear prefetch cache for songs not in the current queue
 * Call this after queue shuffle to free memory
 */
export const cleanupPrefetchCache = (currentQueue: SongResult[]): void => {
    const queueIds = new Set(currentQueue.map((song) => getPrefetchSongKey(song)));

    for (const songKey of prefetchCache.keys()) {
        if (!queueIds.has(songKey)) {
            prefetchCache.delete(songKey);
        }
    }

    console.log(`[Prefetch] Cleanup complete, cache size: ${prefetchCache.size}`);
};

export const invalidatePrefetchedLyrics = (): void => {
    for (const [songKey, cached] of prefetchCache.entries()) {
        prefetchCache.set(songKey, {
            ...cached,
            lyrics: null,
            lyricRaw: null,
            lyricPreferenceSource: null,
        });
    }

    console.log(`[Prefetch] Invalidated lyrics for ${prefetchCache.size} prefetched songs`);
};

// Aborts provider-bound work and releases every in-memory prefetch entry.
export const clearPrefetchRuntime = (): void => {
    currentPrefetchAbortController?.abort();
    currentPrefetchAbortController = null;
    prefetchCache.clear();
};

/**
 * Force re-prefetch (e.g., after queue shuffle)
 */
export const invalidateAndRefetch = async (
    currentSong: SongResult,
    queue: SongResult[],
    audioQuality: AudioQualityPreference,
    userId?: MediaId | null
): Promise<void> => {
    console.log('[Prefetch] Queue changed, invalidating and re-prefetching');
    cleanupPrefetchCache(queue);
    await prefetchNearbySongs(currentSong, queue, audioQuality, userId);
};
