import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import type { Line } from '../../../types';
import { buildLineGraphemeTimeline, buildWordGraphemeTimings, type GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';

// src/components/visualizer/monet/monetLyricsModel.ts
// Builds the measured, discrete lyric rail state for Monet before Framer Motion animates it.

export type MonetLineStatus = 'waiting' | 'active' | 'passed';

export interface MonetDisplayToken {
    text: string;
    startTime: number | null;
    endTime: number | null;
    key: string;
    timed: boolean;
    startOffset: number;
    endOffset: number;
    graphemeTimings: GraphemeTiming[];
}

export interface MonetLyricContext {
    previousLine: Line | null;
    activeLine: Line | null;
    nextLine: Line | null;
}

export interface MonetVisibleLineEntry {
    key: string;
    line: Line;
    index: number;
    offset: number;
    status: MonetLineStatus;
}

export interface MonetMeasuredLineLayout {
    textLineCount: number;
    visibleTextLineCount: number;
    textHeightPx: number;
    textContentHeightPx: number;
    textPaddingTopPx: number;
    textPaddingBottomPx: number;
    translationLineCount: number;
    translationHeightPx: number;
    translationContentHeightPx: number;
    translationPaddingTopPx: number;
    translationPaddingBottomPx: number;
    visualHeightPx: number;
    lineHeightPx: number;
    translationLineHeightPx: number;
    isTextClipped: boolean;
    isTranslationClipped: boolean;
}

interface BuildMonetVisibleLineEntriesOptions {
    lines: Line[];
    currentLineIndex: number;
    activeLine: Line | null;
    recentCompletedLine: Line | null;
    upcomingLine: Line | null;
    currentTime: number;
    before?: number;
    after?: number;
}

interface MeasureMonetLineLayoutOptions {
    line: Line;
    status: MonetLineStatus;
    fontPx: number;
    translationFontPx: number;
    fontStack: string;
    maxWidthPx: number;
    showSubtitleTranslation?: boolean;
}

const ROOT_FONT_PX = 16;
const VIEWPORT_WIDTH_FALLBACK_PX = 1280;
const MONET_ACTIVE_TEXT_LINE_LIMIT = 3;
const MONET_INACTIVE_TEXT_LINE_LIMIT = 2;
const MONET_TRANSLATION_LINE_LIMIT = 2;
const MONET_MIN_MEASURE_WIDTH_PX = 180;
const MONET_GRAPHEME_OFFSETS_CACHE_LIMIT = 420;

const monetGraphemeOffsetsCache = new Map<string, number[]>();

const graphemeSegmenter = typeof Intl !== 'undefined'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export {
    buildWordColorRanges as buildMonetWordColorRanges,
    buildWordColorRangesFromMatchers as buildMonetWordColorRangesFromMatchers,
    prepareWordColorMatchers as prepareMonetWordColorMatchers,
    resolveTokenColorMap as resolveMonetTokenColorMap,
    type WordColorMatcher as MonetWordColorMatcher,
    type WordColorRange as MonetWordColorRange,
} from '../wordColoring';

export const resolveClampFontPx = (minRem: number, preferredVw: number, maxRem: number): number => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : VIEWPORT_WIDTH_FALLBACK_PX;
    return Math.min(maxRem * ROOT_FONT_PX, Math.max(minRem * ROOT_FONT_PX, viewportWidth * (preferredVw / 100)));
};

export const splitMonetGraphemes = (text: string): string[] => {
    if (!text) {
        return [];
    }
    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
    }
    return Array.from(text);
};

const measureTextLineCount = (text: string, fontSpec: string, maxWidthPx: number, lineHeightPx: number): number => {
    const prepared = prepareWithSegments(text || ' ', fontSpec);
    const layout = layoutWithLines(prepared, Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX), lineHeightPx);
    return Math.max(layout.lines.length, 1);
};

const measureTextWidthAtPx = (text: string, fontPx: number, fontSpec: string): number => {
    const prepared = prepareWithSegments(text || ' ', fontSpec);
    const layout = layoutWithLines(prepared, 99999, fontPx * 1.2);
    return layout.lines[0]?.width ?? Math.max(text.length, 1) * fontPx * 0.6;
};

const buildGraphemeOffsetsCacheKey = (text: string, fontPx: number, fontSpec: string) => (
    `${fontPx}|${fontSpec}|${text}`
);

const rememberGraphemeOffsets = (key: string, offsets: number[]) => {
    if (monetGraphemeOffsetsCache.size >= MONET_GRAPHEME_OFFSETS_CACHE_LIMIT) {
        const oldestKey = monetGraphemeOffsetsCache.keys().next().value;
        if (oldestKey) {
            monetGraphemeOffsetsCache.delete(oldestKey);
        }
    }
    monetGraphemeOffsetsCache.set(key, offsets);
    return offsets;
};

/** Builds cumulative grapheme offsets so the lyric fill edge can sweep through glyphs instead of stepping whole words. */
export const measureMonetGraphemeOffsets = (text: string, fontPx: number, fontSpec: string): number[] => {
    const cacheKey = buildGraphemeOffsetsCacheKey(text, fontPx, fontSpec);
    const cached = monetGraphemeOffsetsCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const graphemes = splitMonetGraphemes(text);
    const offsets = new Array<number>(graphemes.length + 1).fill(0);
    for (let index = 1; index <= graphemes.length; index += 1) {
        offsets[index] = measureTextWidthAtPx(graphemes.slice(0, index).join(''), fontPx, fontSpec);
    }
    return rememberGraphemeOffsets(cacheKey, offsets);
};

export const resolveMonetLineStatus = (
    line: Line,
    index: number,
    activeIndex: number,
    currentTime: number,
): MonetLineStatus => {
    if (index === activeIndex || (activeIndex < 0 && currentTime >= line.startTime && currentTime <= line.endTime)) {
        return 'active';
    }
    if (currentTime > line.endTime || (activeIndex >= 0 && index < activeIndex)) {
        return 'passed';
    }
    return 'waiting';
};

export const resolveMonetWordStatus = (
    currentTime: number,
    startTime: number,
    endTime: number,
): MonetLineStatus => {
    if (currentTime < startTime) {
        return 'waiting';
    }
    if (currentTime <= endTime) {
        return 'active';
    }
    return 'passed';
};

/** Builds a stable display-token list so fullText punctuation and spaces survive around timed lyric words. */
export const buildMonetDisplayTokens = (line: Line): MonetDisplayToken[] => {
    if (line.words.length === 0) {
        return [{
            text: line.fullText,
            startTime: line.startTime,
            endTime: getLineRenderEndTime(line),
            key: `${line.startTime}-full`,
            timed: true,
            startOffset: 0,
            endOffset: line.fullText.length,
            graphemeTimings: buildLineGraphemeTimeline(line),
        }];
    }

    const tokens: MonetDisplayToken[] = [];
    let cursor = 0;
    line.words.forEach((word, index) => {
        const matchIndex = line.fullText.indexOf(word.text, cursor);
        if (matchIndex < 0) {
            return;
        }

        if (matchIndex > cursor) {
            tokens.push({
                text: line.fullText.slice(cursor, matchIndex),
                startTime: null,
                endTime: null,
                key: `${line.startTime}-static-${cursor}`,
                timed: false,
                startOffset: cursor,
                endOffset: matchIndex,
                graphemeTimings: [],
            });
        }

        const endOffset = matchIndex + word.text.length;
        tokens.push({
            text: word.text,
            startTime: word.startTime,
            endTime: word.endTime,
            key: `${line.startTime}-${index}-${word.startTime}`,
            timed: true,
            startOffset: matchIndex,
            endOffset,
            graphemeTimings: buildWordGraphemeTimings(word),
        });

        cursor = endOffset;
    });

    if (cursor < line.fullText.length) {
        tokens.push({
            text: line.fullText.slice(cursor),
            startTime: null,
            endTime: null,
            key: `${line.startTime}-tail-${cursor}`,
            timed: false,
            startOffset: cursor,
            endOffset: line.fullText.length,
            graphemeTimings: [],
        });
    }

    return tokens.length > 0
        ? tokens
        : [{
            text: line.fullText,
            startTime: line.startTime,
            endTime: getLineRenderEndTime(line),
            key: `${line.startTime}-fallback-full`,
            timed: true,
            startOffset: 0,
            endOffset: line.fullText.length,
            graphemeTimings: buildLineGraphemeTimeline(line),
        }];
};

export const resolveMonetLyricContext = (
    lines: Line[],
    currentLineIndex: number,
    activeLine: Line | null,
    recentCompletedLine: Line | null,
    nextLine: Line | null,
): MonetLyricContext => {
    if (!activeLine) {
        return {
            previousLine: recentCompletedLine,
            activeLine: null,
            nextLine,
        };
    }

    return {
        previousLine: currentLineIndex > 0 ? lines[currentLineIndex - 1] ?? null : null,
        activeLine,
        nextLine: lines[currentLineIndex + 1] ?? nextLine,
    };
};

const findLineIndex = (lines: Line[], target: Line | null): number => {
    if (!target) {
        return -1;
    }
    const directIndex = lines.indexOf(target);
    if (directIndex >= 0) {
        return directIndex;
    }
    return lines.findIndex(line => line.startTime === target.startTime && line.fullText === target.fullText);
};

/** Selects a small lyric window and assigns the explicit waiting/active/passed state for each rail item. */
export const buildMonetVisibleLineEntries = ({
    lines,
    currentLineIndex,
    activeLine,
    recentCompletedLine,
    upcomingLine,
    currentTime,
    before = 2,
    after = 2,
}: BuildMonetVisibleLineEntriesOptions): MonetVisibleLineEntry[] => {
    if (lines.length === 0) {
        return [];
    }

    const activeIndex = activeLine
        ? (currentLineIndex >= 0 ? currentLineIndex : findLineIndex(lines, activeLine))
        : -1;
    const upcomingIndex = findLineIndex(lines, upcomingLine);
    const recentIndex = findLineIndex(lines, recentCompletedLine);
    const anchorIndex = activeIndex >= 0
        ? activeIndex
        : upcomingIndex >= 0
            ? upcomingIndex
            : recentIndex;

    if (anchorIndex < 0) {
        return [];
    }

    const startIndex = Math.max(0, anchorIndex - before);
    const endIndex = Math.min(lines.length - 1, anchorIndex + after);
    const entries: MonetVisibleLineEntry[] = [];

    for (let index = startIndex; index <= endIndex; index += 1) {
        const line = lines[index];
        entries.push({
            key: `${index}-${line.startTime}-${line.fullText}`,
            line,
            index,
            offset: index - anchorIndex,
            status: resolveMonetLineStatus(line, index, activeIndex, currentTime),
        });
    }

    return entries;
};

/** Measures the text box Monet will reserve before animating the rail, keeping layout off the hot path. */
export const measureMonetLineLayout = ({
    line,
    status,
    fontPx,
    translationFontPx,
    fontStack,
    maxWidthPx,
    showSubtitleTranslation = true,
}: MeasureMonetLineLayoutOptions): MonetMeasuredLineLayout => {
    const lineHeightPx = fontPx * 1.18;
    const translationLineHeightPx = translationFontPx * 1.28;
    const textPaddingTopPx = Math.max(fontPx * 0.16, 8);
    const textPaddingBottomPx = Math.max(fontPx * 0.34, 14);
    const translationPaddingTopPx = Math.max(translationFontPx * 0.45, 7);
    const translationPaddingBottomPx = Math.max(translationFontPx * 0.18, 5);
    const fontSpec = `600 ${fontPx}px ${fontStack}`;
    const translationFontSpec = `500 ${translationFontPx}px ${fontStack}`;
    const textLineCount = measureTextLineCount(line.fullText, fontSpec, maxWidthPx, lineHeightPx);
    const textLimit = status === 'active' ? MONET_ACTIVE_TEXT_LINE_LIMIT : MONET_INACTIVE_TEXT_LINE_LIMIT;
    const visibleTextLineCount = Math.min(textLineCount, textLimit);
    const hasActiveTranslation = showSubtitleTranslation && status === 'active' && Boolean(line.translation?.trim());
    const rawTranslationLineCount = hasActiveTranslation
        ? measureTextLineCount(line.translation ?? '', translationFontSpec, maxWidthPx, translationLineHeightPx)
        : 0;
    const translationLineCount = Math.min(rawTranslationLineCount, MONET_TRANSLATION_LINE_LIMIT);
    const textContentHeightPx = visibleTextLineCount * lineHeightPx;
    const textHeightPx = textContentHeightPx + textPaddingTopPx + textPaddingBottomPx;
    const translationContentHeightPx = translationLineCount * translationLineHeightPx;
    const translationHeightPx = translationLineCount > 0
        ? translationContentHeightPx + translationPaddingTopPx + translationPaddingBottomPx
        : 0;

    return {
        textLineCount,
        visibleTextLineCount,
        textHeightPx,
        textContentHeightPx,
        textPaddingTopPx,
        textPaddingBottomPx,
        translationLineCount,
        translationHeightPx,
        translationContentHeightPx,
        translationPaddingTopPx,
        translationPaddingBottomPx,
        visualHeightPx: textHeightPx + translationHeightPx,
        lineHeightPx,
        translationLineHeightPx,
        isTextClipped: textLineCount > visibleTextLineCount,
        isTranslationClipped: rawTranslationLineCount > translationLineCount,
    };
};
