import type { LyricData, Line } from '../../types';
import { isInterludeLine } from './parserCore';
import type { LyricProcessingOptions } from './types';

// src/utils/lyrics/filtering.ts
// The single expression of the old lyric filter: checking and compiling it. A written rule of
// lyricLineRules compiles through here, so it removes exactly the lines the old filter did.

export const LYRIC_FILTER_REGEX_EXAMPLE = '^(?=.*[：:（）()])(?=.*(?:词|曲|制作|发行)).*$';

const normalizeFilterPattern = (pattern?: string | null): string => pattern?.trim() || '';

export const getLyricFilterError = (pattern?: string | null): string | null => {
    const normalized = normalizeFilterPattern(pattern);
    if (!normalized) {
        return null;
    }

    try {
        new RegExp(normalized);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : 'Invalid regular expression';
    }
};

export const hasLyricFilterPattern = (pattern?: string | null): boolean => normalizeFilterPattern(pattern).length > 0;

export const compileLyricFilterPattern = (pattern?: string | null): RegExp | null => {
    const normalized = normalizeFilterPattern(pattern);
    if (!normalized) {
        return null;
    }

    try {
        return new RegExp(normalized);
    } catch {
        return null;
    }
};

// Parsing keeps interludes unless told not to. The line rules no longer run at parse time (they run
// where lyrics are shown, see lyricLineRules), so nothing here depends on them.
export const resolveLyricProcessingOptions = (
    options: LyricProcessingOptions = {}
): LyricProcessingOptions => ({
    ...options,
    includeInterludes: options.includeInterludes ?? true,
});

const stripInterludes = (lines: Line[]): Line[] => lines.filter(line => !isInterludeLine(line));

export interface LyricFilterPreviewLine {
    line: Line;
    removed: boolean;
    index: number;
}

export interface LyricFilterPreviewResult {
    lines: LyricFilterPreviewLine[];
    removedCount: number;
    totalCount: number;
    error: string | null;
}

export const buildLyricFilterPreview = (
    lyrics: LyricData | null | undefined,
    pattern?: string | null
): LyricFilterPreviewResult => {
    const baseLines = lyrics ? stripInterludes(lyrics.lines) : [];
    const error = getLyricFilterError(pattern);
    const regex = error ? null : compileLyricFilterPattern(pattern);

    const lines = baseLines.map((line, index) => ({
        line,
        index,
        removed: Boolean(regex?.test(line.fullText)),
    }));

    return {
        lines,
        removedCount: lines.filter(item => item.removed).length,
        totalCount: lines.length,
        error,
    };
};
