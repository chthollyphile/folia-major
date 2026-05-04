import type { LyricData, Line } from '../../types';
import { ensureLyricDataRenderHints } from './renderHints';
import { finalizeParsedLyricLines, isInterludeLine } from './parserCore';
import type { LyricProcessingOptions } from './types';

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

export const resolveLyricProcessingOptions = (
    options: LyricProcessingOptions = {}
): LyricProcessingOptions => {
    const regex = compileLyricFilterPattern(options.filterPattern);
    return {
        ...options,
        includeInterludes: options.includeInterludes ?? !regex,
    };
};

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

export const applyLyricDisplayFilter = (
    lyrics: LyricData | null | undefined,
    pattern?: string | null
): LyricData | null => {
    if (!lyrics) {
        return null;
    }

    const regex = compileLyricFilterPattern(pattern);
    if (!regex) {
        return ensureLyricDataRenderHints(lyrics);
    }

    const filteredLines = stripInterludes(lyrics.lines).filter(line => !regex.test(line.fullText));

    return {
        ...lyrics,
        lines: finalizeParsedLyricLines(filteredLines, { includeInterludes: true }),
    };
};
