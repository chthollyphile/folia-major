/**
 * Song Prefetch Service
 * 
 * Prefetches nearby songs in the queue to enable smooth transitions.
 * Handles URL expiration (1200s TTL) and re-prefetches on queue changes.
 */

import { ReplayGainInfo, SongResult, LyricData, OnlineLyricsState, type LyricProviderSource } from '../types';
import { migrateLyricDataRenderHints } from '../utils/lyrics/renderHints';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { autoMatchBestLyric } from '../utils/lyrics/autoMatchBestLyric';
import { loadOnlineLyricsState, markOnlineLyricsPureMusic, resolveOnlineLyrics, saveOnlineLyricsState } from '../utils/onlineLyricsState';
import type { AudioQualityPreference, MediaId } from '../types/onlineMusic';
import { getPlaybackSourceRef } from '../utils/appPlaybackGuards';
import { omni } from './onlineMusic/omni';
import { getSongResourceCacheKey } from './onlineMusic/resourceKeys';
import { getSongCacheWithLegacyMigration, hasCachedSongAudio } from './onlineMusic/resourceCache';
import { toSafePlaybackUrl } from '../utils/appPlaybackHelpers';
import { getProviderSongMetadata } from './onlineMusic/songMetadata';
import { ensureTrackProfile, setAnalysisScope } from './automix/profileService';
import { modeNeedsBeatGrid } from './automix/transitionStrategy';

// Prefetch configuration
//
// Two ahead and one behind - the ordinary playback window, restored. This governs only the LIGHT
// resources: a resolved URL, a lyric set and a cover URL, so a normal next/previous keypress lands on
// something already fetched rather than a fresh network round-trip.
//
// The heavy automix work - the full decode and the beat-model pass - does NOT scale with this window.
// It is capped separately to the current track plus the immediate next by `setAnalysisScope` below
// (and gated off entirely when blending is disabled, in `analyseForAutomix`). So widening the playback
// window back out costs a URL and some lyrics per extra track, not a decode - the memory the old
// one-ahead value was protecting was already protected a layer down.
const PREFETCH_COUNT_NEXT = 2;  // The next two songs' light resources (URL + lyrics + cover)
const PREFETCH_COUNT_PREV = 1;  // One behind, so "previous" is instant rather than a refetch
const URL_TTL_MS = 1200 * 1000; // 1200 seconds = 20 minutes
const MAX_PREFETCH_CACHE_SIZE = 200; // Evict least recently used entries beyond this limit

/**
 * Hands a track to the automix analyser with whatever URL this file resolved for it.
 *
 * 'CACHED_IN_DB' is this file's sentinel for "the bytes are in the media cache rather than at a
 * URL", and the analyser finds those on its own - so it gets a null instead of a string it would
 * try to fetch. Never awaited: a slow decode must not hold up the song after this one.
 */
const analyseForAutomix = (song: SongResult, audioUrl: string | null | undefined) => {
    const settings = useSettingsUiStore.getState();
    // Nothing reads a profile while blending is switched off, and this is not a cheap thing to
    // produce for nobody: the whole file is read, decoded, and put through the beat model in the
    // inference process - per prefetched track, and a prefetch pass covers three of them. Blending
    // is off by default, so without this gate every listener paid for a feature they never enabled.
    //
    // Off is the only state where the profile itself is never wanted, so that is what gates the
    // call. The mode does not: the crossfade planner reads the profile's SILENCE EDGES - `leadIn`
    // and `leadOut` - so a master with eight seconds of padding does not spend the whole fade
    // blending into nothing. Gating the analysis on `transitionMode` would take the silence trim
    // away from crossfade.
    //
    // The BEAT MODEL is a different question, and it is not this file's to answer. Which modes read
    // a grid is a property of the planners, so it is asked of them - `modeNeedsBeatGrid` - rather
    // than restated here. It was restated here once: crossfade ran the model on every prefetched
    // track and threw the answer away, because a comment in this file said crossfade did "beat
    // alignment" and nothing next to the planner could contradict it.
    if (!settings.automixEnabled) return;
    void ensureTrackProfile({
        song,
        audioUrl: audioUrl === 'CACHED_IN_DB' ? null : audioUrl ?? null,
        enableMediaCache: settings.enableMediaCache,
        wantGrid: modeNeedsBeatGrid(settings.transitionMode),
    });
};

export interface PrefetchedSongData {
    songKey: string;
    songId: MediaId;
    audioUrl: string | null;
    audioUrlFetchedAt: number;
    audioUrlQuality: string | null; // Track which quality the URL was fetched for
    replayGain?: ReplayGainInfo;
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
        cached.audioUrl = toSafePlaybackUrl(cached.audioUrl) ?? null;
    }

    // 'CACHED_IN_DB' is not a URL. It says the bytes are already in the media cache, so it has no
    // expiry to run out and no quality to match against - `audioUrlQuality` stays null for one.
    // Both checks below fired on it anyway (null never equals the required quality), and each one
    // ANSWERED by nulling the sentinel. So the first read of a media-cached track threw away the
    // fact that it was cached, and the next prefetch pass rediscovered it from scratch - which is
    // the "Starting prefetch for X" / "Audio already cached for X" pair repeating for the same
    // song every time the queue moves.
    const hasUrl = Boolean(cached.audioUrl) && cached.audioUrl !== 'CACHED_IN_DB';

    // Check if URL is expired
    if (hasUrl && !isUrlValid(cached.audioUrlFetchedAt)) {
        console.log(`[Prefetch] URL expired for song ${songId}, will refetch`);
        cached.audioUrl = null;
        cached.audioUrlQuality = null;
        cached.replayGain = undefined;
    }

    // Check if quality matches (if requiredQuality is specified)
    if (hasUrl && requiredQuality && cached.audioUrlQuality !== requiredQuality) {
        console.log(`[Prefetch] Quality mismatch for song ${songId}: cached=${cached.audioUrlQuality}, required=${requiredQuality}`);
        // Don't use cached URL, but keep other data (lyrics, cover)
        cached.audioUrl = null;
        cached.audioUrlQuality = null;
        cached.replayGain = undefined;
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
        existing.audioUrl = toSafePlaybackUrl(existing.audioUrl) ?? null;
    }
    const currentSettings = useSettingsUiStore.getState();
    const lyricPreferenceMatches = !currentSettings.autoUseBestLyric
        || existing?.lyricPreferenceSource === currentSettings.preferredAlternativeLyricSource;
    if (existing && lyricPreferenceMatches && existing.audioUrl && isUrlValid(existing.audioUrlFetchedAt) && (existing.lyrics || existing.lyricRaw?.isPureMusic)) {
        console.log(`[Prefetch] Already cached: ${song.name}`);
        touchPrefetchCacheEntry(songKey, existing);
        analyseForAutomix(song, existing.audioUrl);
        return;
    }

    console.log(`[Prefetch] Starting prefetch for: ${song.name} (quality: ${audioQuality})`);

    const data: PrefetchedSongData = {
        songKey,
        songId,
        audioUrl: existing?.audioUrl && existing.audioUrlQuality === audioQuality && isUrlValid(existing.audioUrlFetchedAt) ? existing.audioUrl : null,
        audioUrlFetchedAt: existing?.audioUrlFetchedAt || 0,
        audioUrlQuality: existing?.audioUrlQuality || null,
        replayGain: existing?.replayGain ?? song.replayGain,
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
                const url = toSafePlaybackUrl(audioSource?.url) ?? null;
                if (url) {
                    data.audioUrl = url;
                    data.audioUrlFetchedAt = Date.now();
                    data.audioUrlQuality = audioQuality;
                    data.replayGain = audioSource?.replayGain
                        ? { ...data.replayGain, ...audioSource.replayGain }
                        : data.replayGain;
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
                // The same stamp the fetched path leaves below. Without it a track whose lyrics came
                // from the cache can never satisfy the "already cached" test at the top of this
                // function, so every prefetch pass re-enters the whole thing for it.
                data.lyricPreferenceSource = currentSettings.autoUseBestLyric
                    ? currentSettings.preferredAlternativeLyricSource
                    : null;
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
                            ...(sourceRef.providerId === 'netease' || sourceRef.providerId === 'kugou' || sourceRef.providerId === 'qq'
                                ? { providerCandidate: {
                                    providerId: sourceRef.providerId as 'netease' | 'kugou' | 'qq',
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
                        } else if (bestMatch?.isPureMusic) {
                            // Same discriminator fix as in onlinePlayback: a MATCH object carries
                            // `isPureMusic: false`, so the old `'isPureMusic' in bestMatch` also
                            // caught a best match from the track's own provider and discarded it.
                            await saveOnlineLyricsState(song, markOnlineLyricsPureMusic(onlineLyricsState));
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

    // Measured here because this is where the bytes are cheapest: the track is about to be cached
    // anyway, so with song caching on it is one download feeding both the cache and the analysis,
    // and with it off nothing is fetched at all.
    analyseForAutomix(song, data.audioUrl);
};

export const updatePrefetchedAudioUrl = (
    song: SongResult,
    audioUrl: string,
    audioQuality: string,
    replayGain?: ReplayGainInfo,
): void => {
    const songKey = getPrefetchSongKey(song);
    const existing = prefetchCache.get(songKey);

    const nextData: PrefetchedSongData = {
        songKey,
        songId: song.id,
        audioUrl,
        audioUrlFetchedAt: Date.now(),
        audioUrlQuality: audioQuality,
        replayGain: replayGain
            ? { ...song.replayGain, ...existing?.replayGain, ...replayGain }
            : existing?.replayGain ?? song.replayGain,
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

    // Told before anything is asked for, so the analyser can drop work it has queued for tracks that
    // are no longer either half of the next transition. This function is called on every track change
    // and every queue change, which is exactly when that set moves - and analysis is serial, so a
    // stale entry does not merely waste itself, it delays the track the listener just chose.
    const nextSong = currentIndex >= 0 ? queue[currentIndex + 1] : undefined;
    setAnalysisScope(nextSong ? [currentSong, nextSong] : [currentSong]);

    if (currentIndex === -1) {
        console.log('[Prefetch] Current song not in queue, skipping prefetch');
        return;
    }

    // Determine songs to prefetch.
    //
    // Forwards first, and the immediate next track before anything else. These run strictly one
    // after another, so whatever is first in this list is the only one guaranteed to be finished
    // soon - and the next track is the one every transition is planned against, while the previous
    // track only matters if the listener presses back. Fetching backwards first put a whole song's
    // URL resolve, lyric fetch and auto-match in front of the analysis a blend was waiting on, and
    // a track skipped through inside ten seconds reached its transition still unmeasured.
    const songsToPrefetch: SongResult[] = [];

    // Next songs
    for (let i = 1; i <= PREFETCH_COUNT_NEXT; i++) {
        const idx = currentIndex + i;
        if (idx < queue.length) {
            songsToPrefetch.push(queue[idx]);
        }
    }

    // Previous songs
    for (let i = 1; i <= PREFETCH_COUNT_PREV; i++) {
        const idx = currentIndex - i;
        if (idx >= 0) {
            songsToPrefetch.push(queue[idx]);
        }
    }

    console.log(`[Prefetch] Will prefetch ${songsToPrefetch.length} songs near index ${currentIndex}`);

    // The track playing right now is the other half of every transition it is about to be in, and
    // it is not in the prefetch set, so it would otherwise only ever be analysed on a second
    // listen. Its own prefetch entry usually still holds the URL it was resolved from.
    analyseForAutomix(currentSong, prefetchCache.get(currentSongKey)?.audioUrl);

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
