import type { LyricData, Line } from '../../types';
import { ensureLyricDataRenderHints } from './renderHints';
import { finalizeParsedLyricLines, isInterludeLine } from './parserCore';
import type { LyricProcessingOptions } from './types';

export const LYRIC_FILTER_REGEX_EXAMPLE = '^(?=.*[：:（）()])(?=.*(?:词|曲|制作|发行)).*$';

// 多行即多规则：按行拆开，每行一条独立正则，空行忽略。
// 存储仍是单个字符串，因此旧的「整段一条正则」写法（无换行）行为完全不变。
const splitFilterRules = (pattern?: string | null): string[] =>
    (pattern ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

export const getLyricFilterError = (pattern?: string | null): string | null => {
    const rules = splitFilterRules(pattern);
    if (rules.length === 0) {
        return null;
    }

    for (const rule of rules) {
        try {
            new RegExp(rule);
        } catch (error) {
            return error instanceof Error ? error.message : 'Invalid regular expression';
        }
    }

    return null;
};

export const hasLyricFilterPattern = (pattern?: string | null): boolean => splitFilterRules(pattern).length > 0;

export const compileLyricFilterPattern = (pattern?: string | null): RegExp | null => {
    const rules = splitFilterRules(pattern);
    if (rules.length === 0) {
        return null;
    }

    // 每行一条独立规则，任一行命中即判定删除，故用「或」并接成单条正则。
    try {
        return new RegExp(rules.join('|'));
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
