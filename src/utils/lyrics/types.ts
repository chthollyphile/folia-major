import { LyricData } from '../../types';
import type { LyricParseFormat } from './parserCore';

export type UnifiedLyric = LyricData;

export interface LyricProcessingOptions {
    includeInterludes?: boolean;
    filterPattern?: string | null;
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
    structuredLyrics?: Array<{ start?: number, value?: string }>;
    // Standard Subsonic plain lyrics string
    plainLyrics?: string;
}

export type RawLyricSource = 
    | RawEmbeddedLyric 
    | RawLocalFileLyric 
    | RawQrcLyric
    | RawNeteaseLyric 
    | RawNavidromeLyric;
