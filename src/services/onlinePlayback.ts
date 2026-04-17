import { LyricData, SongResult } from '../types';
import { getFromCacheWithMigration, saveToCache } from './db';
import { getCachedAudioBlob } from './audioCache';
import { getOnlineSongCacheKey, isCloudSong, neteaseApi } from './netease';
import { PrefetchedSongData, isUrlValid, updatePrefetchedAudioUrl } from './prefetchService';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../utils/lyrics/renderHints';
import { processNeteaseLyrics } from '../utils/lyrics/neteaseProcessing';
import { detectTimedLyricFormat } from '../utils/lyrics/formatDetection';
import { parseLyricsAsync } from '../utils/lyrics/workerClient';

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
        const blobUrl = URL.createObjectURL(cachedAudioBlob);
        return { kind: 'ok', audioSrc: blobUrl, blobUrl };
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
        onDone: () => void;
    }
): Promise<void> {
    const { isCurrent, onLyrics, onPureMusicChange, onDone } = callbacks;
    const lyricCacheKey = getOnlineSongCacheKey('lyric', song);

    const cachedLyrics = await getFromCacheWithMigration<LyricData>(lyricCacheKey, migrateLyricDataRenderHints);
    if (!isCurrent()) return;
    if (cachedLyrics) {
        const cachedText = cachedLyrics.lines.map(line => line.fullText).join('\n');
        onPureMusicChange?.(isPureMusicLyricText(cachedText));
        onLyrics(cachedLyrics);
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
        const prefetchedText = prefetched.lyrics.lines.map(line => line.fullText).join('\n');
        onPureMusicChange?.(prefetched.lyricRaw?.isPureMusic || isPureMusicLyricText(prefetchedText) || isPureMusicLyricText(prefetched.lyricRaw?.mainLrc));
        onLyrics(prefetched.lyrics);
        saveToCache(lyricCacheKey, prefetched.lyrics);
        onDone();
        return;
    }

    const processed = isCloudSong(song) && userId
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
                };
            }

            const lyrics = await parseLyricsAsync(detectTimedLyricFormat(mainLrc), mainLrc, '');
            return {
                mainLrc,
                yrcLrc: null,
                transLrc: null,
                isPureMusic,
                lyrics,
            };
        })()
        : await (async () => {
            const lyricRes = await neteaseApi.getLyric(song.id);
            return processNeteaseLyrics(neteaseApi.getProcessedLyricPayload(lyricRes));
        })();
    const parsedLyrics = processed.lyrics;

    if (!isCurrent()) return;
    onPureMusicChange?.(processed.isPureMusic);

    if (!parsedLyrics) {
        onLyrics(null);
        onDone();
        return;
    }

    onLyrics(parsedLyrics);
    saveToCache(lyricCacheKey, parsedLyrics);
    onDone();
}
