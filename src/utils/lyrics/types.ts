import { LyricData } from '../../types';
import type { LyricParseFormat } from './parserCore';
import type { StructuredLyric, StructuredLyricLine } from '../../types/navidrome';

export type UnifiedLyric = LyricData;

export interface LyricProcessingOptions {
    includeInterludes?: boolean;
    filterPattern?: string | null;
    songId?: number;
    fetchChorusRanges?: (songId: number) => Promise<Array<{ startTime: number; endTime: number }>>;
}

export interface RawEmbeddedLyric {
    type: 'embedded';
    // Raw USLT tags parsed from music-metadata.
    usltTags?: Array<{ language?: string, descriptor?: string, text: string }>;
    // Fallback simple strings (e.g. from IndexedDB cache).
    textContent?: string;
    translationContent?: string;
}

export interface RawLocalFileLyric {
    type: 'local';
    lrcContent: string;
    tLrcContent?: string;
    formatHint?: LyricParseFormat;
}

export interface RawQrcLyric {
    type: 'qrc';
    qrcContent: string;
    translationContent?: string;
}

export interface RawNeteaseLyric {
    type: 'netease';
    lrc?: {
        lyric?: string;
        pureMusic?: boolean;
        yrc?: { lyric?: string; pureMusic?: boolean };
        ytlrc?: { lyric?: string; pureMusic?: boolean };
    };
    yrc?: { lyric?: string; pureMusic?: boolean };
    ytlrc?: { lyric?: string; pureMusic?: boolean };
    tlyric?: { lyric?: string; pureMusic?: boolean };
    pureMusic?: boolean;
}

export interface RawNavidromeLyric {
    type: 'navidrome';
    // OpenSubsonic structured lyrics
    structuredLyrics?: StructuredLyric | StructuredLyric[] | StructuredLyricLine[];
    // Standard Subsonic plain lyrics string
    plainLyrics?: string;
}

export type RawLyricSource = 
    | RawEmbeddedLyric 
    | RawLocalFileLyric 
    | RawQrcLyric
    | RawNeteaseLyric 
    | RawNavidromeLyric;
