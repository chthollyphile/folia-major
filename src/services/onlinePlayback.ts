import { LyricData } from '../types';
import { getFromCache, saveToCache } from './db';
import { neteaseApi } from './netease';
import { PrefetchedSongData, isUrlValid, parseLyricsAsync } from './prefetchService';
import { detectChorusLines } from '../utils/chorusDetector';

const CHORUS_EFFECTS: Array<'bars' | 'circles' | 'beams'> = ['bars', 'circles', 'beams'];

const applyChorusEffects = (lyrics: LyricData, mainLrc: string): LyricData => {
    const chorusLines = detectChorusLines(mainLrc);
    if (chorusLines.size === 0) return lyrics;

    const effectMap = new Map<string, 'bars' | 'circles' | 'beams'>();
    chorusLines.forEach(text => {
        effectMap.set(text, CHORUS_EFFECTS[Math.floor(Math.random() * CHORUS_EFFECTS.length)]);
    });

    return {
        ...lyrics,
        lines: lyrics.lines.map(line => {
            const text = line.fullText.trim();
            if (chorusLines.has(text)) {
                return { ...line, isChorus: true, chorusEffect: effectMap.get(text) };
            }
            return line;
        })
    };
};

const normalizeAudioUrl = (url?: string | null) => {
    if (!url) return null;
    return url.startsWith('http:') ? url.replace('http:', 'https:') : url;
};

export async function loadOnlineSongAudioSource(
    songId: number,
    audioQuality: string,
    prefetched: PrefetchedSongData | null
): Promise<
    | { kind: 'ok'; audioSrc: string; blobUrl?: string }
    | { kind: 'unavailable' }
> {
    const cachedAudioBlob = await getFromCache<Blob>(`audio_${songId}`);
    if (cachedAudioBlob) {
        const blobUrl = URL.createObjectURL(cachedAudioBlob);
        return { kind: 'ok', audioSrc: blobUrl, blobUrl };
    }

    if (prefetched?.audioUrl && prefetched.audioUrl !== 'CACHED_IN_DB' && isUrlValid(prefetched.audioUrlFetchedAt)) {
        return { kind: 'ok', audioSrc: prefetched.audioUrl };
    }

    const urlRes = await neteaseApi.getSongUrl(songId, audioQuality);
    const url = normalizeAudioUrl(urlRes.data?.[0]?.url);
    if (!url) {
        return { kind: 'unavailable' };
    }

    return { kind: 'ok', audioSrc: url };
}

export async function loadOnlineSongLyrics(
    songId: number,
    prefetched: PrefetchedSongData | null,
    callbacks: {
        isCurrent: () => boolean;
        onLyrics: (lyrics: LyricData | null) => void;
        onDone: () => void;
    }
): Promise<void> {
    const { isCurrent, onLyrics, onDone } = callbacks;

    const cachedLyrics = await getFromCache<LyricData>(`lyric_${songId}`);
    if (!isCurrent()) return;
    if (cachedLyrics) {
        onLyrics(cachedLyrics);
        onDone();
        return;
    }

    if (prefetched?.lyrics) {
        onLyrics(prefetched.lyrics);

        if (prefetched.lyricRaw?.mainLrc && !prefetched.lyricRaw.isPureMusic) {
            setTimeout(() => {
                if (!isCurrent()) return;
                try {
                    const updatedLyrics = applyChorusEffects(prefetched.lyrics!, prefetched.lyricRaw!.mainLrc!);
                    onLyrics(updatedLyrics);
                    saveToCache(`lyric_${songId}`, updatedLyrics);
                } catch (error) {
                    console.warn('[OnlinePlayback] Chorus detection on prefetched lyrics failed', error);
                    if (prefetched.lyrics) saveToCache(`lyric_${songId}`, prefetched.lyrics);
                } finally {
                    onDone();
                }
            }, 0);
        } else {
            saveToCache(`lyric_${songId}`, prefetched.lyrics);
            onDone();
        }
        return;
    }

    const lyricRes = await neteaseApi.getLyric(songId);
    const mainLrc = lyricRes.lrc?.lyric;
    const yrcLrc = lyricRes.yrc?.lyric || lyricRes.lrc?.yrc?.lyric;
    const ytlrc = lyricRes.ytlrc?.lyric || lyricRes.lrc?.ytlrc?.lyric;
    const tlyric = lyricRes.tlyric?.lyric || '';
    const transLrc = (yrcLrc && ytlrc) ? ytlrc : tlyric;

    let parsedLyrics: LyricData | null = null;
    if (yrcLrc) {
        parsedLyrics = await parseLyricsAsync('yrc', yrcLrc, transLrc);
    } else if (mainLrc) {
        parsedLyrics = await parseLyricsAsync('lrc', mainLrc, transLrc);
    }

    if (!isCurrent()) return;

    if (!parsedLyrics) {
        onLyrics(null);
        onDone();
        return;
    }

    onLyrics(parsedLyrics);

    const isPureMusic = lyricRes.pureMusic || lyricRes.lrc?.pureMusic;
    if (!isPureMusic && mainLrc) {
        setTimeout(() => {
            if (!isCurrent()) return;
            try {
                const updatedLyrics = applyChorusEffects(parsedLyrics!, mainLrc);
                onLyrics(updatedLyrics);
                saveToCache(`lyric_${songId}`, updatedLyrics);
            } catch (error) {
                console.warn('[OnlinePlayback] Chorus detection failed', error);
                saveToCache(`lyric_${songId}`, parsedLyrics!);
            } finally {
                onDone();
            }
        }, 0);
        return;
    }

    saveToCache(`lyric_${songId}`, parsedLyrics);
    onDone();
}
