import { LyricData, OnlineLyricsState, SongResult } from '../types';
import { getFromCacheWithMigration, saveToCache } from './db';
import { getCachedAudioBlob } from './audioCache';
import { getOnlineSongCacheKey, isCloudSong, neteaseApi } from './netease';
import { PrefetchedSongData, isUrlValid, updatePrefetchedAudioUrl } from './prefetchService';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../utils/lyrics/renderHints';
import { processNeteaseLyrics } from '../utils/lyrics/neteaseProcessing';
import { detectTimedLyricFormat } from '../utils/lyrics/formatDetection';
import { parseLyricsAsync } from '../utils/lyrics/workerClient';
import { loadOnlineLyricsState, resolveOnlineLyrics, saveOnlineLyricsState } from '../utils/onlineLyricsState';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { autoMatchBestLyric } from '../utils/lyrics/autoMatchBestLyric';
import { createSafeObjectUrl } from '../utils/blobGuards';

const normalizeAudioUrl = (url?: string | null) => {
    if (!url) return null;
    return url.startsWith('http:') ? url.replace('http:', 'https:') : url;
};

const extractCloudLyricText = (response: any): string => {
    if (typeof response?.lrc === 'string') return response.lrc;
    if (typeof response?.data?.lrc === 'string') return response.data.lrc;
    if (typeof response?.lyric === 'string') return response.lyric;
    if (typeof response?.data?.lyric === 'string') return response.data.lyric;
    return '';
};

export async function loadOnlineSongAudioSource(
    song: SongResult,
    audioQuality: string,
    prefetched: PrefetchedSongData | null
): Promise<
    | { kind: 'ok'; audioSrc: string; blobUrl?: string }
    | { kind: 'unavailable' }
> {
    const audioCacheKey = getOnlineSongCacheKey('audio', song);
    const cachedAudioBlob = await getCachedAudioBlob(audioCacheKey);
    if (cachedAudioBlob) {
        const blobUrl = createSafeObjectUrl(cachedAudioBlob);
        if (blobUrl) return { kind: 'ok', audioSrc: blobUrl, blobUrl };
    }

    if (prefetched?.audioUrl && prefetched.audioUrl !== 'CACHED_IN_DB' && isUrlValid(prefetched.audioUrlFetchedAt)) {
        return { kind: 'ok', audioSrc: prefetched.audioUrl };
    }

    const urlRes = await neteaseApi.getSongUrl(song.id, audioQuality);
    const url = normalizeAudioUrl(urlRes.data?.[0]?.url);
    if (!url) {
        return { kind: 'unavailable' };
    }

    updatePrefetchedAudioUrl(song, url, audioQuality);
    return { kind: 'ok', audioSrc: url };
}

export async function loadOnlineSongLyrics(
    song: SongResult,
    prefetched: PrefetchedSongData | null,
    userId: number | null | undefined,
    callbacks: {
        isCurrent: () => boolean;
        onLyrics: (lyrics: LyricData | null) => void;
        onPureMusicChange?: (isPureMusic: boolean) => void;
        onStateChange?: (state: OnlineLyricsState | null) => void;
        onAutoMatchStart?: () => void;
        onDone: () => void;
    }
): Promise<void> {
    const { isCurrent, onLyrics, onPureMusicChange, onStateChange, onAutoMatchStart, onDone } = callbacks;
    const lyricCacheKey = getOnlineSongCacheKey('lyric', song);
    const onlineLyricsState = await loadOnlineLyricsState(song);

    if (!isCurrent()) return;
    onStateChange?.(onlineLyricsState);

    const cachedLyrics = await getFromCacheWithMigration<LyricData>(lyricCacheKey, migrateLyricDataRenderHints);
    if (!isCurrent()) return;
    const preferredCachedLyrics = resolveOnlineLyrics(onlineLyricsState, cachedLyrics);
    if (preferredCachedLyrics) {
        const cachedText = preferredCachedLyrics.lines.map(line => line.fullText).join('\n');
        onPureMusicChange?.(
            onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                ? onlineLyricsState.matchedIsPureMusic
                : isPureMusicLyricText(cachedText)
        );
        onLyrics(preferredCachedLyrics);
        onDone();
        return;
    }

    if (prefetched?.lyricRaw?.isPureMusic && !prefetched.lyrics) {
        onPureMusicChange?.(true);
        onLyrics(null);
        onDone();
        return;
    }

    if (prefetched?.lyrics) {
        const preferredPrefetchedLyrics = resolveOnlineLyrics(onlineLyricsState, prefetched.lyrics);
        const effectiveLyrics = preferredPrefetchedLyrics ?? prefetched.lyrics;

        const settings = useSettingsUiStore.getState();
        const shouldAutoMatch = settings.enableAlternativeLyricSources &&
                                settings.autoUseBestLyric &&
                                (!effectiveLyrics || !effectiveLyrics.isWordByWord ||
                                 (!onlineLyricsState?.hasOnlineOverride && settings.preferredAlternativeLyricSource !== 'netease'));

        if (!shouldAutoMatch) {
            const effectiveText = effectiveLyrics?.lines.map(line => line.fullText).join('\n') ?? '';
            onPureMusicChange?.(
                onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                    ? onlineLyricsState.matchedIsPureMusic
                    : (prefetched.lyricRaw?.isPureMusic || isPureMusicLyricText(effectiveText) || isPureMusicLyricText(prefetched.lyricRaw?.mainLrc))
            );
            onLyrics(effectiveLyrics);
            saveToCache(lyricCacheKey, prefetched.lyrics);
            onDone();
            return;
        }
    }

    const processed = prefetched?.lyrics
        ? {
            mainLrc: prefetched.lyricRaw?.mainLrc ?? null,
            yrcLrc: prefetched.lyricRaw?.yrcLrc ?? null,
            transLrc: prefetched.lyricRaw?.transLrc ?? null,
            isPureMusic: prefetched.lyricRaw?.isPureMusic ?? false,
            lyrics: prefetched.lyrics,
            chorusRanges: [],
          }
        : (isCloudSong(song) && userId
            ? await (async () => {
                const lyricRes = await neteaseApi.getCloudLyric(userId, song.id);
                const mainLrc = extractCloudLyricText(lyricRes);
                const isPureMusic = isPureMusicLyricText(mainLrc);
                if (!mainLrc || isPureMusic) {
                    return {
                        mainLrc,
                        yrcLrc: null,
                        transLrc: null,
                        isPureMusic,
                        lyrics: null,
                        chorusRanges: [],
                    };
                }

                const lyrics = await parseLyricsAsync(detectTimedLyricFormat(mainLrc), mainLrc, '');
                return {
                    mainLrc,
                    yrcLrc: null,
                    transLrc: null,
                    isPureMusic,
                    lyrics,
                    chorusRanges: [],
                };
            })()
            : await (async () => {
                const lyricRes = await neteaseApi.getLyric(song.id);
                return processNeteaseLyrics(neteaseApi.getProcessedLyricPayload(lyricRes), { songId: song.id });
            })());
    const parsedLyrics = processed.lyrics;

    if (!isCurrent()) return;

    let resolvedLyrics = resolveOnlineLyrics(onlineLyricsState, parsedLyrics);
    let finalState = onlineLyricsState;

    const settings = useSettingsUiStore.getState();
    const shouldAutoMatch = settings.enableAlternativeLyricSources &&
                            settings.autoUseBestLyric &&
                            (!resolvedLyrics || !resolvedLyrics.isWordByWord ||
                             (!onlineLyricsState?.hasOnlineOverride && settings.preferredAlternativeLyricSource !== 'netease'));

    if (shouldAutoMatch) {
        try {
            onAutoMatchStart?.();
            const artistName = song.artists?.map(a => a.name).join(', ') || '';
            const bestMatch = await autoMatchBestLyric(song.name, artistName, song.duration || song.dt || 0, {
                album: song.album?.name || song.al?.name,
                preferredSource: settings.preferredAlternativeLyricSource,
                neteaseCandidate: {
                    id: song.id,
                    lyrics: parsedLyrics,
                    isPureMusic: processed.isPureMusic,
                    chorusRanges: processed.chorusRanges
                }
            });
            if (bestMatch && 'lyrics' in bestMatch && bestMatch.source !== 'netease') {
                const overrideState: OnlineLyricsState = {
                    lyricsSource: 'online',
                    matchedSongId: typeof bestMatch.id === 'number' ? bestMatch.id : parseInt(String(bestMatch.id), 10) || 0,
                    hasOnlineOverride: true,
                    onlineOverrideLyrics: bestMatch.lyrics,
                    matchedLyricsSource: bestMatch.source,
                    matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                };
                await saveOnlineLyricsState(song, overrideState);
                resolvedLyrics = bestMatch.lyrics;
                finalState = overrideState;
                onStateChange?.(overrideState);
            }
        } catch (error) {
            console.warn('[OnlinePlayback] Failed to auto-match best lyric:', error);
        }
    }

    if (!isCurrent()) return;

    const resolvedText = resolvedLyrics?.lines.map(line => line.fullText).join('\n') ?? '';
    onPureMusicChange?.(
        finalState?.lyricsSource === 'online' && typeof finalState.matchedIsPureMusic === 'boolean'
            ? finalState.matchedIsPureMusic
            : (resolvedLyrics ? isPureMusicLyricText(resolvedText) : processed.isPureMusic)
    );

    if (!resolvedLyrics) {
        onLyrics(null);
        onDone();
        return;
    }

    onLyrics(resolvedLyrics);
    saveToCache(lyricCacheKey, resolvedLyrics);
    onDone();
}
