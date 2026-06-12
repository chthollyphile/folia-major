import type { Line, Word } from '../../types';
import { createIntlSegmenter } from '../intlSegmenter';

// src/utils/lyrics/cjkSemanticLayout.ts
// Builds parser-preserving lyric layout units for visualizer display planning.
//
// This file runs after lyrics have already been parsed into Line.words.
// It must not rewrite the Line object or collapse parser words globally, because YRC/QRC/enhanced-LRC
// can intentionally expose tiny timed fragments such as:
//
//   Line.words: ["It", "’", "s", "unbelievable"]
//
// Visualizers often need a more readable display shape than those raw timed fragments. Layout units are
// that display-planning layer: they can group fragments for row splitting and rendering while still keeping
// every original Word inside `words` for timing.
//
// Example with sticky punctuation:
//
//   input words:  It | ’ | s | unbelievable
//   layoutUnits: It’s(isSticky, words=[It, ’, s]) | unbelievable
//
// Example with CJK semantic grouping:
//
//   input words:  世 | 界 | 。
//   layoutUnits: 世界。(isSemantic, isSticky, words=[世, 界, 。])
//
// Display words are derived later. Sticky non-semantic units render as one visual word; semantic CJK units
// still return their original words so per-character timing stays intact.

export interface LyricLayoutUnit {
    // Text used for layout planning. This can differ from the raw parser token when semantic or sticky grouping is applied.
    text: string;
    // Original parser words contained in this layout unit. Their timing is preserved and remains the source of truth.
    words: Word[];
    // Start/end span of the contained parser words.
    startTime: number;
    endTime: number;
    // True when Intl.Segmenter grouped CJK parser words into a semantic layout unit.
    isSemantic: boolean;
    // True when punctuation/contraction fragments have been attached for visual layout stability.
    isSticky?: boolean;
}

export interface BuildPostLyricLayoutUnitsOptions {
    // Enables CJK semantic grouping before sticky punctuation is applied.
    semantic?: boolean;
    // Enables language-agnostic punctuation/contraction attachment.
    sticky?: boolean;
}

interface WordSegment {
    segment: string;
    isWordLike?: boolean;
}

const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
const WHITESPACE_REGEX = /^\s+$/;
const APOSTROPHE_ONLY_REGEX = /^['’]\s*$/;
const CONTRACTION_SUFFIX_REGEX = /^(s|t|m|d|ll|re|ve|em)\s*$/i;
const DIRECT_CONTRACTION_REGEX = /^['’](s|t|m|d|ll|re|ve|em)\s*$/i;
const TRAILING_APOSTROPHE_REGEX = /['’]\s*$/;
const TRAILING_WORD_CHAR_REGEX = /[\p{L}\p{N}]$/u;
const INLINE_CONTRACTION_REGEX = /[\p{L}\p{N}]+['’](s|t|m|d|ll|re|ve|em)/iu;
const STICKY_TRAILING_PUNCTUATION_REGEX = /^[,.;:!?，。！？、：；）】》」』〉〕］)}\]"'’”’]+$/u;

const hasCjkText = (text: string) => CJK_REGEX.test(text);

export const createSingleWordLayoutUnits = (words: Word[]): LyricLayoutUnit[] => words.map(word => ({
    text: word.text,
    words: [word],
    startTime: word.startTime,
    endTime: word.endTime,
    isSemantic: false,
}));

const getWordSegments = (text: string): WordSegment[] | null => {
    const segmenter = createIntlSegmenter('word');
    if (!segmenter) {
        return null;
    }

    try {
        return Array.from(segmenter.segment(text), segment => ({
            segment: segment.segment,
            isWordLike: segment.isWordLike,
        }));
    } catch {
        return null;
    }
};

const appendWordsToUnit = (unit: LyricLayoutUnit, text: string, words: Word[]) => {
    unit.text += text;
    unit.words.push(...words);
    unit.endTime = words[words.length - 1]?.endTime ?? unit.endTime;
};

const cloneUnit = (unit: LyricLayoutUnit): LyricLayoutUnit => ({
    ...unit,
    words: [...unit.words],
});

const appendUnitToStickyUnit = (target: LyricLayoutUnit, unit: LyricLayoutUnit) => {
    target.text += unit.text;
    target.words.push(...unit.words);
    target.endTime = unit.endTime;
    target.isSticky = true;
};

const canAttachToPrevious = (text: string) => TRAILING_WORD_CHAR_REGEX.test(text.trimEnd());

const endsWithApostrophe = (text: string) => TRAILING_APOSTROPHE_REGEX.test(text.trimEnd());

const isApostropheOnlyUnit = (unit: LyricLayoutUnit) => APOSTROPHE_ONLY_REGEX.test(unit.text.trim());

const isContractionSuffixUnit = (unit: LyricLayoutUnit) => CONTRACTION_SUFFIX_REGEX.test(unit.text.trim());

const isDirectContractionUnit = (unit: LyricLayoutUnit) => DIRECT_CONTRACTION_REGEX.test(unit.text.trim());

const isStickyTrailingPunctuationUnit = (unit: LyricLayoutUnit) => STICKY_TRAILING_PUNCTUATION_REGEX.test(unit.text.trim());

const hasAttachedTrailingPunctuation = (unit: LyricLayoutUnit) => {
    if (unit.words.length <= 1) {
        return false;
    }

    const lastWord = unit.words[unit.words.length - 1];
    return Boolean(lastWord && isStickyTrailingPunctuationUnit({
        text: lastWord.text,
        words: [lastWord],
        startTime: lastWord.startTime,
        endTime: lastWord.endTime,
        isSemantic: false,
    }));
};

const hasInlineContraction = (unit: LyricLayoutUnit) => (
    unit.words.length > 1
    && !unit.isSemantic
    && INLINE_CONTRACTION_REGEX.test(unit.text)
);

// Maps Intl.Segmenter output back onto parser words.
// If any segment cannot be aligned exactly, callers fall back to one-word units instead of guessing.
const mapSegmentsToWords = (segments: WordSegment[], words: Word[]): LyricLayoutUnit[] | null => {
    const units: LyricLayoutUnit[] = [];
    let wordIndex = 0;

    for (const segment of segments) {
        const segmentText = segment.segment;
        if (!segmentText || WHITESPACE_REGEX.test(segmentText)) {
            continue;
        }

        const startWordIndex = wordIndex;
        let collectedText = '';

        while (wordIndex < words.length && collectedText.length < segmentText.length) {
            collectedText += words[wordIndex].text;
            wordIndex += 1;

            if (!segmentText.startsWith(collectedText)) {
                return null;
            }
        }

        if (collectedText !== segmentText) {
            return null;
        }

        const segmentWords = words.slice(startWordIndex, wordIndex);
        const firstWord = segmentWords[0];
        const lastWord = segmentWords[segmentWords.length - 1];
        if (!firstWord || !lastWord) {
            return null;
        }

        if (!segment.isWordLike && units.length > 0) {
            appendWordsToUnit(units[units.length - 1], segmentText, segmentWords);
            continue;
        }

        units.push({
            text: segmentText,
            words: segmentWords,
            startTime: firstWord.startTime,
            endTime: lastWord.endTime,
            isSemantic: Boolean(segment.isWordLike && hasCjkText(segmentText) && segmentWords.length > 1),
        });
    }

    if (wordIndex !== words.length || units.length === 0) {
        return null;
    }

    return units;
};

// Legacy-compatible helper: only performs CJK semantic grouping.
// It does not apply sticky punctuation, so existing callers can keep the old behavior.
export const buildCjkSemanticLayoutUnits = (
    line: Pick<Line, 'fullText' | 'words'>
): LyricLayoutUnit[] => {
    if (line.words.length === 0) {
        return [];
    }

    const fallbackUnits = createSingleWordLayoutUnits(line.words);
    if (!hasCjkText(line.fullText)) {
        return fallbackUnits;
    }

    const segments = getWordSegments(line.fullText);
    if (!segments) {
        return fallbackUnits;
    }

    return mapSegmentsToWords(segments, line.words) ?? fallbackUnits;
};

// Attaches punctuation-like layout units to the previous unit before a visualizer splits rows/chunks.
// This prevents source fragments such as `It`, `’`, `s` from being placed in separate visual layers.
export const applyStickyPunctuationLayoutUnits = (units: LyricLayoutUnit[]): LyricLayoutUnit[] => {
    const merged: LyricLayoutUnit[] = [];

    for (let index = 0; index < units.length; index += 1) {
        const current = units[index];
        const previous = merged[merged.length - 1];
        if (!previous) {
            merged.push(cloneUnit(current));
            continue;
        }

        const next = units[index + 1];
        if (
            isApostropheOnlyUnit(current)
            && next
            && canAttachToPrevious(previous.text)
            && isContractionSuffixUnit(next)
        ) {
            appendUnitToStickyUnit(previous, current);
            appendUnitToStickyUnit(previous, next);
            index += 1;
            continue;
        }

        if (isDirectContractionUnit(current) && canAttachToPrevious(previous.text)) {
            appendUnitToStickyUnit(previous, current);
            continue;
        }

        if (isContractionSuffixUnit(current) && endsWithApostrophe(previous.text)) {
            appendUnitToStickyUnit(previous, current);
            continue;
        }

        if (isStickyTrailingPunctuationUnit(current) && canAttachToPrevious(previous.text)) {
            appendUnitToStickyUnit(previous, current);
            continue;
        }

        merged.push(cloneUnit(current));
    }

    return merged.map(unit => (
        hasAttachedTrailingPunctuation(unit) || hasInlineContraction(unit)
            ? { ...unit, isSticky: true }
            : unit
    ));
};

// Main post-parser entry point for visualizer layout preparation.
// Order is intentional: semantic grouping first, sticky punctuation second.
//
// Examples:
//
//   buildPostLyricLayoutUnits(line, { semantic: false, sticky: false })
//   -> one layout unit per parser word
//
//   buildPostLyricLayoutUnits(line, { semantic: true, sticky: false })
//   -> CJK semantic units only
//
//   buildPostLyricLayoutUnits(line, { semantic: true, sticky: true })
//   -> CJK semantic units, then punctuation/contraction attachment
export const buildPostLyricLayoutUnits = (
    line: Pick<Line, 'fullText' | 'words'>,
    options: BuildPostLyricLayoutUnitsOptions = {}
): LyricLayoutUnit[] => {
    const rawUnits = options.semantic
        ? buildCjkSemanticLayoutUnits(line)
        : createSingleWordLayoutUnits(line.words);

    return options.sticky
        ? applyStickyPunctuationLayoutUnits(rawUnits)
        : rawUnits;
};

// Converts layout units into the words a renderer should actually draw.
// Sticky non-semantic units become one rendered Word, e.g. It + ’ + s -> It’s.
// Semantic CJK units return their original words so per-character timing remains available.
export const buildDisplayWordsFromLayoutUnits = (units: LyricLayoutUnit[]): Word[] => units.flatMap(unit => {
    if (!unit.isSticky || unit.isSemantic) {
        return unit.words;
    }

    return [{
        text: unit.text,
        startTime: unit.startTime,
        endTime: unit.endTime,
    }];
});
