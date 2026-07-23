import i18n from '../i18n/config';
import type { LyricData, ReplayGainMode, SongResult } from '../types';
import type { StructuredLyric } from '../types/navidrome';
import { detectTimedLyricFormat } from './lyrics/formatDetection';
import { getLineRenderHints } from './lyrics/renderHints';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong } from './appPlaybackGuards';

// Pure helpers for playback state, debug snapshots, and lyric timing.
export const clampMediaVolume = (value: number) => Math.min(1, Math.max(0, value));

export const extractCloudLyricText = (response: any): string => {
    if (typeof response?.lrc === 'string') return response.lrc;
    if (typeof response?.data?.lrc === 'string') return response.data.lrc;
    if (typeof response?.lyric === 'string') return response.lyric;
    if (typeof response?.data?.lyric === 'string') return response.data.lyric;
    return '';
};

export const findLatestActiveLineIndex = (lines: LyricData['lines'], time: number) => {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line || time < line.startTime) {
            continue;
        }
        if (time <= (line.renderHints?.renderEndTime ?? line.endTime)) {
            return index;
        }
    }
    return -1;
};

export const formatTime = (time: number) => {
    if (isNaN(time)) return '00:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const getReplayGainModeLabel = (mode: ReplayGainMode): string => i18n.t(`replayGain.${mode}`);

export const hasRenderableLyrics = (lyricData: LyricData | null | undefined): lyricData is LyricData => {
    if (!lyricData?.lines?.length) {
        return false;
    }

    return lyricData.lines.some(line =>
        line.fullText.trim().length > 0 || (line.translation?.trim().length ?? 0) > 0
    );
};

export const getAudioSrcKind = (audioSrc: string | null): 'empty' | 'blob' | 'http' | 'other' => {
    if (!audioSrc) {
        return 'empty';
    }

    if (audioSrc.startsWith('blob:')) {
        return 'blob';
    }

    if (audioSrc.startsWith('http://') || audioSrc.startsWith('https://')) {
        return 'http';
    }

    return 'other';
};

export const toSafeRemoteUrl = (url: string | null | undefined): string | null | undefined => {
    if (!url) {
        return url;
    }

    const normalizedUrl = url.split(/,\s*(?=https?:\/\/)/i)[0]?.trim() || url;

    if (normalizedUrl.startsWith('http:') && normalizedUrl.includes('music.126.net')) {
        return normalizedUrl.replace('http:', 'https:');
    }

    try {
        const parsedUrl = new URL(normalizedUrl);
        if (
            parsedUrl.protocol === 'http:' &&
            parsedUrl.hostname.startsWith('fs.') &&
            parsedUrl.hostname.endsWith('.kugou.com')
        ) {
            return normalizedUrl.replace(/^http:/, 'https:');
        }
    } catch {
        return normalizedUrl;
    }

    return normalizedUrl;
};

export const resolveDebugSongSource = (song: SongResult | null): 'none' | 'local' | 'navidrome' | 'online' => {
    if (isStagePlaybackSong(song)) {
        return 'online';
    }

    if (isLocalPlaybackSong(song)) {
        return 'local';
    }

    if (isNavidromePlaybackSong(song)) {
        return 'navidrome';
    }

    return song ? 'online' : 'none';
};

export const resolveDebugLyricsSource = (
    song: SongResult | null,
    lyrics: LyricData | null
): 'none' | 'local' | 'embedded' | 'online' | 'navi' => {
    if (isStagePlaybackSong(song)) {
        return lyrics ? 'local' : 'none';
    }

    if (isLocalPlaybackSong(song)) {
        return lyrics ? 'online' : 'none';
    }

    if (isNavidromePlaybackSong(song)) {
        const navidromeSong = song as NavidromeSongLike;
        if (navidromeSong.lyricsSource) {
            return navidromeSong.lyricsSource;
        }
        if (navidromeSong.matchedLyrics) {
            return 'online';
        }
        const hasStructuredLyrics = Array.isArray(navidromeSong.cachedStructuredLyrics)
            ? navidromeSong.cachedStructuredLyrics.length > 0
            : Boolean(navidromeSong.cachedStructuredLyrics?.line.length || navidromeSong.cachedStructuredLyrics?.cueLine?.length);
        if (lyrics || hasStructuredLyrics || navidromeSong.cachedPlainLyrics?.trim()) {
            return 'navi';
        }
        return 'none';
    }

    if (song && lyrics) {
        return 'online';
    }

    return 'none';
};

type NavidromeSongLike = SongResult & {
    lyricsSource?: 'navi' | 'online';
    matchedLyrics?: LyricData;
    cachedStructuredLyrics?: StructuredLyric | StructuredLyric[] | StructuredLyric['line'];
    cachedPlainLyrics?: string;
};

export const hasEnhancedStructuredLines = (item: StructuredLyric): boolean => {
    return item.cueLine?.some(cueLine => cueLine.cue?.some(cue => typeof cue.start === 'number'))
        || item.line?.some(line => detectTimedLyricFormat(line.value) === 'enhanced-lrc')
        || false;
};

export const toDebugLineSnapshot = (line: LyricData['lines'][number] | null) => {
    if (!line) {
        return null;
    }

    const renderHints = getLineRenderHints(line);
    return {
        text: line.fullText || null,
        translation: line.translation ?? null,
        wordCount: line.words.length,
        startTime: line.startTime,
        endTime: line.endTime,
        renderEndTime: renderHints?.renderEndTime ?? null,
        rawDuration: renderHints?.rawDuration ?? Math.max(line.endTime - line.startTime, 0),
        timingClass: renderHints?.timingClass ?? null,
        lineTransitionMode: renderHints?.lineTransitionMode ?? null,
        wordRevealMode: renderHints?.wordRevealMode ?? null,
    };
};
