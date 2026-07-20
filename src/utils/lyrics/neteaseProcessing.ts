import { LyricData } from '../../types';
import type { NeteaseChorusRange } from './chorusEffects';
import { detectTimedLyricFormat } from './formatDetection';
import { resolveLyricProcessingOptions } from './filtering';
import { hasNeteasePureMusicFlag, isPureMusicLyricText } from './pureMusic';
import type { LyricProcessingOptions, RawNeteaseLyric } from './types';
import { parseLyricsAsync } from './workerClient';

export interface ExtractedNeteaseLyricPayload {
    mainLrc: string | null;
    yrcLrc: string | null;
    transLrc: string | null;
    isPureMusic: boolean;
}

export interface ProcessedNeteaseLyricsResult extends ExtractedNeteaseLyricPayload {
    lyrics: LyricData | null;
    chorusRanges?: NeteaseChorusRange[];
}

export const clearNeteaseChorusRangesCache = (): void => {
    // Kept as a compatibility no-op; chorus range caching is owned by the provider.
};

export const parseNeteaseChorusRanges = (chorusRes: any): NeteaseChorusRange[] => {
    if (!chorusRes || chorusRes.code !== 200) {
        return [];
    }

    const ranges = chorusRes.chorus || chorusRes.data || [];
    if (!Array.isArray(ranges) || ranges.length === 0) {
        return [];
    }

    return ranges
        .map((range: any) => ({
            startTime: (range.startTime ?? 0) / 1000,
            endTime: (range.endTime ?? 0) / 1000
        }))
        .filter(range => Number.isFinite(range.startTime) && Number.isFinite(range.endTime) && range.endTime > range.startTime);
};

export const extractNeteaseLyricPayload = (source?: RawNeteaseLyric | null): ExtractedNeteaseLyricPayload => {
    const mainLrc = source?.lrc?.lyric || null;
    const yrcLrc = source?.yrc?.lyric || source?.lrc?.yrc?.lyric || null;
    const ytlrc = source?.ytlrc?.lyric || source?.lrc?.ytlrc?.lyric || null;
    const tlyric = source?.tlyric?.lyric || null;
    const transLrc = (yrcLrc && ytlrc) ? ytlrc : tlyric;
    const isPureMusic = hasNeteasePureMusicFlag(source) || isPureMusicLyricText(mainLrc);

    return {
        mainLrc,
        yrcLrc,
        transLrc,
        isPureMusic
    };
};

export const processNeteaseLyrics = async (
    source?: RawNeteaseLyric | null,
    options: LyricProcessingOptions = {}
): Promise<ProcessedNeteaseLyricsResult> => {
    const payload = extractNeteaseLyricPayload(source);
    const primaryLyrics = payload.yrcLrc || payload.mainLrc;

    if (!primaryLyrics || payload.isPureMusic) {
        return {
            ...payload,
            lyrics: null,
            chorusRanges: []
        };
    }

    const format = payload.yrcLrc ? 'yrc' : detectTimedLyricFormat(payload.mainLrc || primaryLyrics);
    let lyrics = await parseLyricsAsync(
        format,
        primaryLyrics,
        payload.transLrc || '',
        resolveLyricProcessingOptions(options)
    );

    if (lyrics) {
        lyrics.isWordByWord = !!payload.yrcLrc;
    }

    return {
        ...payload,
        lyrics,
        chorusRanges: [],
    };
};
