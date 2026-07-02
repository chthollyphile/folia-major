import type { Theme } from '../../types';

// src/components/visualizer/wordColoring.ts
// Shared range-based keyword coloring helpers for visualizers that render timed lyric tokens.

export interface WordColorToken {
    key: string;
    timed: boolean;
    startOffset: number;
    endOffset: number;
}

export interface WordColorRange {
    startOffset: number;
    endOffset: number;
    color: string;
    priority: number;
}

export interface WordColorMatcher {
    color: string;
    cjkPhrases: string[];
    englishWords: string[];
    priority: number;
}

export type WordColorCjkMatchMode = 'target-contains-token' | 'bidirectional-contains' | 'exact';

const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;

const isCJK = (text: string) => CJK_REGEX.test(text);

const normalizeWordColorToken = (text: string) => text.toLowerCase().replace(/[^\w]/g, '');

const resolveWordColorEntryText = (entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('word' in entry)) {
        return '';
    }

    const word = (entry as { word?: unknown }).word;
    return typeof word === 'string' ? word.trim() : '';
};

const resolveWordColorEntryColor = (entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('color' in entry)) {
        return '';
    }

    const color = (entry as { color?: unknown }).color;
    return typeof color === 'string' ? color : '';
};

const rangesOverlap = (a: Pick<WordColorRange, 'startOffset' | 'endOffset'>, b: Pick<WordColorRange, 'startOffset' | 'endOffset'>) => (
    a.startOffset < b.endOffset && b.startOffset < a.endOffset
);

const selectNonOverlappingRanges = (ranges: WordColorRange[]): WordColorRange[] => {
    const selected: WordColorRange[] = [];
    const prioritySorted = [...ranges].sort((a, b) => (
        b.priority - a.priority
        || a.startOffset - b.startOffset
        || a.endOffset - b.endOffset
    ));

    prioritySorted.forEach(range => {
        if (!selected.some(current => rangesOverlap(current, range))) {
            selected.push(range);
        }
    });

    return selected.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
};

export const prepareWordColorMatchers = (
    wordColors: Theme['wordColors'],
    keywordColoringEnabled = true,
): WordColorMatcher[] => {
    if (!keywordColoringEnabled || !wordColors || wordColors.length === 0) {
        return [];
    }

    return wordColors.flatMap(entry => {
        const target = resolveWordColorEntryText(entry);
        if (!target) {
            return [];
        }

        const color = resolveWordColorEntryColor(entry);
        if (!color) {
            return [];
        }

        if (isCJK(target)) {
            return [{
                color,
                cjkPhrases: [target],
                englishWords: [],
                priority: target.length,
            }];
        }

        const englishWords = target
            .split(/\s+/)
            .map(normalizeWordColorToken)
            .filter(Boolean);

        if (englishWords.length === 0) {
            return [];
        }

        return [{
            color,
            cjkPhrases: [],
            englishWords,
            priority: Math.max(...englishWords.map(word => word.length)),
        }];
    });
};

/** Builds phrase color ranges once per line so token renderers can resolve colors with a single ordered pass. */
export const buildWordColorRangesFromMatchers = (
    lineText: string,
    matchers: WordColorMatcher[],
): WordColorRange[] => {
    if (!lineText || matchers.length === 0) {
        return [];
    }

    const ranges: WordColorRange[] = [];
    const englishColorByWord = new Map<string, { color: string; priority: number }>();

    matchers.forEach(matcher => {
        matcher.cjkPhrases.forEach(target => {
            let cursor = 0;
            while (cursor < lineText.length) {
                const startOffset = lineText.indexOf(target, cursor);
                if (startOffset < 0) {
                    break;
                }

                ranges.push({
                    startOffset,
                    endOffset: startOffset + target.length,
                    color: matcher.color,
                    priority: matcher.priority,
                });
                cursor = startOffset + Math.max(target.length, 1);
            }
        });

        matcher.englishWords.forEach(word => {
            const current = englishColorByWord.get(word);
            if (!current || matcher.priority > current.priority) {
                englishColorByWord.set(word, { color: matcher.color, priority: matcher.priority });
            }
        });
    });

    if (englishColorByWord.size > 0) {
        const wordRegex = /\w+/g;
        let match: RegExpExecArray | null;
        while ((match = wordRegex.exec(lineText)) !== null) {
            const wordColor = englishColorByWord.get(normalizeWordColorToken(match[0]));
            if (wordColor) {
                ranges.push({
                    startOffset: match.index,
                    endOffset: match.index + match[0].length,
                    color: wordColor.color,
                    priority: wordColor.priority,
                });
            }
        }
    }

    return selectNonOverlappingRanges(ranges);
};

export const buildWordColorRanges = (
    lineText: string,
    wordColors: Theme['wordColors'],
    keywordColoringEnabled = true,
): WordColorRange[] => (
    buildWordColorRangesFromMatchers(
        lineText,
        prepareWordColorMatchers(wordColors, keywordColoringEnabled),
    )
);

export const resolveWordColor = (
    wordText: string,
    wordColors: Theme['wordColors'],
    fallbackColor: string,
    {
        keywordColoringEnabled = true,
        cjkMatchMode = 'target-contains-token',
    }: {
        keywordColoringEnabled?: boolean;
        cjkMatchMode?: WordColorCjkMatchMode;
    } = {},
): string => {
    if (!keywordColoringEnabled || !wordColors || wordColors.length === 0) {
        return fallbackColor;
    }

    const cleanCurrent = wordText.trim();
    if (!cleanCurrent) {
        return fallbackColor;
    }

    const matched = wordColors.find(entry => {
        const target = resolveWordColorEntryText(entry);
        if (!target) {
            return false;
        }

        if (isCJK(cleanCurrent)) {
            if (cjkMatchMode === 'exact') {
                return target === cleanCurrent;
            }
            if (cjkMatchMode === 'bidirectional-contains') {
                return target.includes(cleanCurrent) || cleanCurrent.includes(target);
            }
            return target.includes(cleanCurrent);
        }

        const targetWords = target
            .split(/\s+/)
            .map(normalizeWordColorToken)
            .filter(Boolean);
        const normalizedCurrent = normalizeWordColorToken(cleanCurrent);
        return Boolean(normalizedCurrent) && targetWords.includes(normalizedCurrent);
    });

    return resolveWordColorEntryColor(matched) || fallbackColor;
};

export const resolveTokenColorMap = (
    tokens: WordColorToken[],
    ranges: WordColorRange[],
): Map<string, string> => {
    const colors = new Map<string, string>();
    let rangeIndex = 0;

    tokens.forEach(token => {
        if (!token.timed) {
            return;
        }

        while (rangeIndex < ranges.length && ranges[rangeIndex].endOffset <= token.startOffset) {
            rangeIndex += 1;
        }

        const range = ranges[rangeIndex];
        if (range && rangesOverlap(range, token)) {
            colors.set(token.key, range.color);
        }
    });

    return colors;
};
