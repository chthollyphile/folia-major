import { clearCache, layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import { measureRichInlineStats, prepareRichInline, type RichInlineItem } from '@chenglou/pretext/rich-inline';
import type { Line, SubtitleContentMode, Word } from '../../../types';
import { resolveLyricSubtitleTracks, resolveSubtitleContentMode, type SubtitleTrack, type SubtitleTrackRole } from '../../../utils/lyrics/alternateText';
import {
    SECONDARY_TRACK_FONT_WEIGHT_FALLBACK,
    SECONDARY_TRACK_GAP_EM,
    SECONDARY_TRACK_SIZE_FACTOR,
} from '../../../utils/lyrics/subtitleTrackStyle';
import { buildLineGraphemeTimeline, buildWordGraphemeTimings, type GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { buildTimedWords } from '../../../utils/lyrics/estimatedLineTiming';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { measurePrefixOffsets, rememberBounded } from '../textMeasureCache';

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

/** Measured box of one subtitle row (romanization or translation) under the active lyric. */
export interface MonetSubtitleTrackLayout {
    role: SubtitleTrackRole;
    text: string;
    fontPx: number;
    fontWeight: number;
    /** Visible rows after the per-track cap. */
    lineCount: number;
    lineHeightPx: number;
    contentHeightPx: number;
    paddingTopPx: number;
    paddingBottomPx: number;
    /** Reserved box height: content plus both paddings. */
    heightPx: number;
    isClipped: boolean;
}

export interface MonetMeasuredLineLayout {
    textLineCount: number;
    visibleTextLineCount: number;
    textHeightPx: number;
    textContentHeightPx: number;
    textPaddingTopPx: number;
    textPaddingBottomPx: number;
    /** Per-row subtitle boxes in display order; empty unless the line is active and has readable subtitle text. */
    subtitleTracks: MonetSubtitleTrackLayout[];
    // The `translation*` fields below aggregate every subtitle track. With a single track (every mode
    // except 'both' with two rows) they equal that track's own values, exactly as before dual rows existed.
    translationLineCount: number;
    /** Total reserved subtitle height: the sum of every track box, including the gap above the second row. */
    translationHeightPx: number;
    translationContentHeightPx: number;
    /** Top padding of the first track. */
    translationPaddingTopPx: number;
    /** Bottom padding of the last track. */
    translationPaddingBottomPx: number;
    visualHeightPx: number;
    lineHeightPx: number;
    /** Line height of the first track. */
    translationLineHeightPx: number;
    isTextClipped: boolean;
    isTextOverflowingWidth: boolean;
    /** True when any track was cut at the row cap. */
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
    translationFontStack?: string;
    fontWeight?: number;
    translationFontWeight?: number;
    /** Weight of the second subtitle row; the rail resolves it from the theme so a user weight overrides the 400 design value. */
    secondaryTranslationFontWeight?: number;
    maxWidthPx: number;
    /** Legacy switch, only consulted when `subtitleContentMode` is not given. */
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
}

/** The inputs that decide a line's measured box; shared by the measurement and the layout cache key. */
export interface MonetLineLayoutInputs {
    fontPx: number;
    translationFontPx: number;
    fontStack: string;
    translationFontStack: string;
    fontWeight: number;
    translationFontWeight: number;
    secondaryTranslationFontWeight: number;
    maxWidthPx: number;
    subtitleContentMode: SubtitleContentMode;
}

const ROOT_FONT_PX = 16;
const VIEWPORT_WIDTH_FALLBACK_PX = 1280;
// The active lyric is never truncated: its box is content-driven at render time.
// This cap only bounds the vertical track height the rail reserves for positioning,
// so a mis-parsed multi-hundred-character line cannot blow up the whole rail geometry.
// Reserving too few rows makes the active block overlap its neighbours, and large font scales
// on a narrow column reach high row counts legitimately, so keep the guard well clear of them.
const MONET_ACTIVE_TEXT_LINE_LIMIT = 14;
const MONET_INACTIVE_TEXT_LINE_LIMIT = 2;
const MONET_TRANSLATION_LINE_LIMIT = 2;
const MONET_MIN_MEASURE_WIDTH_PX = 180;
const MONET_GRAPHEME_OFFSETS_CACHE_LIMIT = 420;
const MONET_VERTICAL_METRICS_CACHE_LIMIT = 420;
const MONET_GLYPH_VERTICAL_SAFETY_PX = 2;
// Below 2xl nothing scales, so every existing viewport keeps its current layout exactly.
const MONET_LARGE_SCREEN_MIN_PX = 1536;
const MONET_LARGE_SCREEN_FULL_PX = 2200;
const MONET_LARGE_SCREEN_MAX_SCALE = 1.16;
export const MONET_RAIL_BASE_MAX_WIDTH_PX = 780;
export const MONET_RAIL_BASE_MAX_HEIGHT_PX = 520;
export const MONET_ROW_BASE_MAX_WIDTH_PX = 1520;
export const MONET_PORTRAIT_BASE_MAX_PX = 430;
export const MONET_PORTRAIT_INNER_BASE_MAX_PX = 380;

const monetGraphemeOffsetsCache = new Map<string, number[]>();
const monetVerticalMetricsCache = new Map<string, number>();
let monetVerticalMeasureContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

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

/**
 * Every Monet clamp tops out between a ~1200px and ~1600px viewport, so anything wider leaves the
 * whole composition stranded as a small island in the middle of the screen. Past 2xl the layout
 * scales up as one piece instead of sitting at its cap.
 *
 * Font sizes and the lyric column share this factor, so the column-width to font-size ratio — and
 * therefore how much text fits on a line — stays constant. Scaling up must not change wrapping.
 */
export const resolveMonetLargeScreenScale = (containerWidthPx?: number): number => {
    // Prefer the renderer's own width: an embedded preview on a large display must not scale itself
    // up as if it owned the screen. Falls back to the viewport before the first measurement lands.
    const referenceWidth = containerWidthPx && containerWidthPx > 0
        ? containerWidthPx
        : typeof window !== 'undefined' ? window.innerWidth : VIEWPORT_WIDTH_FALLBACK_PX;
    if (referenceWidth <= MONET_LARGE_SCREEN_MIN_PX) {
        return 1;
    }

    const progress = Math.min(
        1,
        (referenceWidth - MONET_LARGE_SCREEN_MIN_PX) / (MONET_LARGE_SCREEN_FULL_PX - MONET_LARGE_SCREEN_MIN_PX),
    );
    return 1 + (MONET_LARGE_SCREEN_MAX_SCALE - 1) * progress;
};

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

/**
 * Measures the wrapped line count and widest line the rail will actually render for a lyric line.
 * Timed words render as `inline-block` spans (see MonetWordSweep), so the browser may only break
 * between tokens, never inside one. Measuring `fullText` as a plain string breaks anywhere and
 * disagrees with the DOM — most visibly on CJK lyrics, whose phrase tokens carry no spaces.
 * `break: 'never'` reproduces those atomic boxes, so the reserved height matches what is painted.
 */
const measureLyricLineStats = (line: Line, fontSpec: string, maxWidthPx: number): { lineCount: number; maxLineWidthPx: number; } => {
    const tokens = buildMonetDisplayTokens(line);
    if (tokens.length === 0) {
        return { lineCount: 1, maxLineWidthPx: 0 };
    }

    const items: RichInlineItem[] = tokens.map(token => ({
        text: token.text,
        font: fontSpec,
        break: token.timed ? 'never' : 'normal',
    }));
    const { lineCount, maxLineWidth } = measureRichInlineStats(
        prepareRichInline(items),
        Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX),
    );
    return { lineCount: Math.max(lineCount, 1), maxLineWidthPx: maxLineWidth };
};

const measureTextLineCount = (text: string, fontSpec: string, maxWidthPx: number, lineHeightPx: number): number => {
    const prepared = prepareWithSegments(text || ' ', fontSpec, { whiteSpace: 'pre-wrap' });
    const layout = layoutWithLines(prepared, Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX), lineHeightPx);
    return Math.max(layout.lines.length, 1);
};

const getMonetVerticalMeasureContext = () => {
    if (monetVerticalMeasureContext) {
        return monetVerticalMeasureContext;
    }
    if (typeof OffscreenCanvas !== 'undefined') {
        monetVerticalMeasureContext = new OffscreenCanvas(1, 1).getContext('2d');
        return monetVerticalMeasureContext;
    }
    if (typeof document !== 'undefined') {
        monetVerticalMeasureContext = document.createElement('canvas').getContext('2d');
    }
    return monetVerticalMeasureContext;
};

/** Measures the tallest painted glyph bounds so descenders remain inside Monet's clipped line box. */
const measureMonetLineHeight = (text: string, fontSpec: string, fontPx: number, defaultLineHeightPx: number): number => {
    const cacheKey = `${fontSpec}|${text}`;
    const cached = monetVerticalMetricsCache.get(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    const context = getMonetVerticalMeasureContext();
    if (!context) {
        return defaultLineHeightPx;
    }

    context.font = fontSpec;
    const metrics = context.measureText(text || 'Hg');
    const glyphHeightPx = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const measuredLineHeightPx = glyphHeightPx > 0
        ? Math.max(defaultLineHeightPx, Math.ceil(glyphHeightPx + MONET_GLYPH_VERTICAL_SAFETY_PX))
        : defaultLineHeightPx;

    return rememberBounded(monetVerticalMetricsCache, cacheKey, measuredLineHeightPx, MONET_VERTICAL_METRICS_CACHE_LIMIT);
};

/**
 * Drops every cached text measurement.
 *
 * Metrics measured while a web font was still loading came from a fallback face, and the cache keys
 * (the font shorthand string) are identical before and after the load, so they never expire on their
 * own. Call this when `useFontsEpoch` advances.
 */
export const clearMonetMeasurementCaches = () => {
    monetVerticalMetricsCache.clear();
    monetGraphemeOffsetsCache.clear();
    clearCache();
};

const measureTextWidthAtPx = (text: string, fontPx: number, fontSpec: string): number => {
    const prepared = prepareWithSegments(text || ' ', fontSpec);
    const layout = layoutWithLines(prepared, 99999, fontPx * 1.2);
    return layout.lines[0]?.width ?? Math.max(text.length, 1) * fontPx * 0.6;
};

const buildGraphemeOffsetsCacheKey = (text: string, fontPx: number, fontSpec: string) => (
    `${fontPx}|${fontSpec}|${text}`
);

/** Builds cumulative grapheme offsets so the lyric fill edge can sweep through glyphs instead of stepping whole words. */
export const measureMonetGraphemeOffsets = (text: string, fontPx: number, fontSpec: string): number[] => {
    const cacheKey = buildGraphemeOffsetsCacheKey(text, fontPx, fontSpec);
    const cached = monetGraphemeOffsetsCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const offsets = measurePrefixOffsets(
        splitMonetGraphemes(text),
        prefix => measureTextWidthAtPx(prefix, fontPx, fontSpec),
    );
    return rememberBounded(monetGraphemeOffsetsCache, cacheKey, offsets, MONET_GRAPHEME_OFFSETS_CACHE_LIMIT);
};

/** Keeps the sweep narrow enough for short CJK lyric tokens to hand off continuously. */
export const resolveMonetSweepEdgeSoftness = (fontPx: number): number => (
    Math.max(Math.min(fontPx * 0.45, 16), 6)
);

/** Extends the mask front so its soft trailing edge has fully cleared the word at its end time. */
export const resolveMonetSweepEnd = (filledWidthPx: number, fullWidthPx: number, edgeSoftnessPx: number): number => {
    if (fullWidthPx <= 0) {
        return 0;
    }
    const progress = Math.min(1, Math.max(0, filledWidthPx / fullWidthPx));
    return filledWidthPx + edgeSoftnessPx * progress;
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

/**
 * The words Monet sweeps. A line-level line would be one atomic timed box: the browser wraps inside it
 * while the sweep mask runs across the whole box, lighting every visual row at once (#1066). Such a line
 * comes with no words, or with one word spanning the whole text (PlayerCap and mod lyrics without word
 * timing); both get estimated words, the single word's within its own span.
 */
const resolveMonetSweepWords = (line: Line): Word[] => {
    if (line.words.length === 0) {
        return buildTimedWords(line.fullText, line.startTime, getLineRenderEndTime(line));
    }

    const [onlyWord] = line.words;
    if (line.words.length === 1 && !onlyWord.syllables?.length && onlyWord.text.trim() === line.fullText.trim()) {
        const estimated = buildTimedWords(onlyWord.text, onlyWord.startTime, onlyWord.endTime);
        // Stretched back onto the word's own span: its end is a real timestamp, so the sweep still finishes there.
        const estimatedSpan = (estimated.at(-1)?.endTime ?? onlyWord.startTime) - onlyWord.startTime;
        if (estimated.length > 1 && estimatedSpan > 0) {
            const scale = (onlyWord.endTime - onlyWord.startTime) / estimatedSpan;
            return estimated.map(word => ({
                text: word.text,
                startTime: onlyWord.startTime + (word.startTime - onlyWord.startTime) * scale,
                endTime: onlyWord.startTime + (word.endTime - onlyWord.startTime) * scale,
            }));
        }
    }

    return line.words;
};

/** Builds a stable display-token list so fullText punctuation and spaces survive around timed lyric words. */
export const buildMonetDisplayTokens = (line: Line): MonetDisplayToken[] => {
    const words = resolveMonetSweepWords(line);

    const tokens: MonetDisplayToken[] = [];
    let cursor = 0;
    words.forEach((word, index) => {
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

// Pure marker/separator strings ("//", "●●●", dashes) are timing placeholders, never display text; a row
// is only shown if it holds at least one letter or digit in any script. Mirrors the shared subtitle overlay.
const isReadableSubtitleText = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

/** Ordered subtitle rows Monet shows under the active lyric: romanization first, translation second, placeholders dropped. */
export const resolveMonetSubtitleTracks = (line: Line, mode: SubtitleContentMode): SubtitleTrack[] => (
    resolveLyricSubtitleTracks(line, mode, isReadableSubtitleText)
);

/**
 * Measures one subtitle row. The first row keeps the single-subtitle look and spacing; the second
 * steps down in size and starts GAP_EM (of its own font size) below the first. Each row is capped
 * at MONET_TRANSLATION_LINE_LIMIT rows and reports whether the cap cut it.
 */
const measureMonetSubtitleTrack = (
    track: SubtitleTrack,
    isSecondary: boolean,
    inputs: MonetLineLayoutInputs,
): MonetSubtitleTrackLayout => {
    const fontPx = isSecondary ? inputs.translationFontPx * SECONDARY_TRACK_SIZE_FACTOR : inputs.translationFontPx;
    const fontWeight = isSecondary ? inputs.secondaryTranslationFontWeight : inputs.translationFontWeight;
    const fontSpec = `${fontWeight} ${fontPx}px ${inputs.translationFontStack}`;
    const lineHeightPx = measureMonetLineHeight(track.text, fontSpec, fontPx, fontPx * 1.28);
    const paddingTopPx = isSecondary ? fontPx * SECONDARY_TRACK_GAP_EM : Math.max(fontPx * 0.45, 7);
    const paddingBottomPx = Math.max(fontPx * 0.18, 5);
    const rawLineCount = measureTextLineCount(track.text, fontSpec, inputs.maxWidthPx, lineHeightPx);
    const lineCount = Math.min(rawLineCount, MONET_TRANSLATION_LINE_LIMIT);
    const contentHeightPx = lineCount * lineHeightPx;

    return {
        role: track.role,
        text: track.text,
        fontPx,
        fontWeight,
        lineCount,
        lineHeightPx,
        contentHeightPx,
        paddingTopPx,
        paddingBottomPx,
        heightPx: contentHeightPx + paddingTopPx + paddingBottomPx,
        isClipped: rawLineCount > lineCount,
    };
};

/**
 * Cache key for a measured line. Besides geometry it carries the subtitle mode and the resolved row
 * texts, so switching romanization / translation / both never reuses a box measured for another mode.
 */
export const buildMonetLayoutCacheKey = (
    entry: Pick<MonetVisibleLineEntry, 'index' | 'line' | 'status'>,
    inputs: MonetLineLayoutInputs,
): string => [
    entry.index,
    entry.line.startTime,
    entry.line.endTime,
    entry.line.fullText,
    inputs.subtitleContentMode,
    // Only an active line measures subtitle rows, so other lines don't churn when the subtitle text changes.
    entry.status === 'active'
        ? resolveMonetSubtitleTracks(entry.line, inputs.subtitleContentMode).map(track => `${track.role}:${track.text}`).join('\u0002')
        : '',
    entry.status,
    inputs.fontPx,
    inputs.translationFontPx,
    inputs.fontStack,
    inputs.translationFontStack,
    inputs.fontWeight,
    inputs.translationFontWeight,
    inputs.secondaryTranslationFontWeight,
    inputs.maxWidthPx,
].join('\u0001');

/** Measures the text box Monet will reserve before animating the rail, keeping layout off the hot path. */
export const measureMonetLineLayout = ({
    line,
    status,
    fontPx,
    translationFontPx,
    fontStack,
    translationFontStack,
    fontWeight = 600,
    translationFontWeight = 500,
    secondaryTranslationFontWeight = SECONDARY_TRACK_FONT_WEIGHT_FALLBACK,
    maxWidthPx,
    showSubtitleTranslation = true,
    subtitleContentMode,
}: MeasureMonetLineLayoutOptions): MonetMeasuredLineLayout => {
    const fontSpec = `${fontWeight} ${fontPx}px ${fontStack}`;
    const resolvedTranslationFontStack = translationFontStack ?? fontStack;
    const lineHeightPx = measureMonetLineHeight(line.fullText, fontSpec, fontPx, fontPx * 1.18);
    const textPaddingTopPx = Math.max(fontPx * 0.16, 8);
    const textPaddingBottomPx = Math.max(fontPx * 0.34, 14);
    const { lineCount: textLineCount, maxLineWidthPx } = measureLyricLineStats(line, fontSpec, maxWidthPx);
    const textLimit = status === 'active' ? MONET_ACTIVE_TEXT_LINE_LIMIT : MONET_INACTIVE_TEXT_LINE_LIMIT;
    const visibleTextLineCount = Math.min(textLineCount, textLimit);
    const textContentHeightPx = visibleTextLineCount * lineHeightPx;
    const textHeightPx = textContentHeightPx + textPaddingTopPx + textPaddingBottomPx;

    const trackInputs: MonetLineLayoutInputs = {
        fontPx,
        translationFontPx,
        fontStack,
        translationFontStack: resolvedTranslationFontStack,
        fontWeight,
        translationFontWeight,
        secondaryTranslationFontWeight,
        maxWidthPx,
        subtitleContentMode: resolveSubtitleContentMode(subtitleContentMode, showSubtitleTranslation),
    };
    const subtitleTracks = status === 'active'
        ? resolveMonetSubtitleTracks(line, trackInputs.subtitleContentMode)
            .map((track, index) => measureMonetSubtitleTrack(track, index > 0, trackInputs))
        : [];
    const firstTrack = subtitleTracks[0];
    const lastTrack = subtitleTracks[subtitleTracks.length - 1];
    const translationHeightPx = subtitleTracks.reduce((total, track) => total + track.heightPx, 0);

    return {
        textLineCount,
        visibleTextLineCount,
        textHeightPx,
        textContentHeightPx,
        textPaddingTopPx,
        textPaddingBottomPx,
        subtitleTracks,
        translationLineCount: subtitleTracks.reduce((total, track) => total + track.lineCount, 0),
        translationHeightPx,
        translationContentHeightPx: subtitleTracks.reduce((total, track) => total + track.contentHeightPx, 0),
        translationPaddingTopPx: firstTrack?.paddingTopPx ?? Math.max(translationFontPx * 0.45, 7),
        translationPaddingBottomPx: lastTrack?.paddingBottomPx ?? Math.max(translationFontPx * 0.18, 5),
        visualHeightPx: textHeightPx + translationHeightPx,
        lineHeightPx,
        translationLineHeightPx: firstTrack?.lineHeightPx
            ?? measureMonetLineHeight('', `${translationFontWeight} ${translationFontPx}px ${resolvedTranslationFontStack}`, translationFontPx, translationFontPx * 1.28),
        isTextClipped: textLineCount > visibleTextLineCount,
        // A token wider than the column (a long compound word) overruns the text box and would be
        // sliced mid-glyph by `overflow: hidden`. The rail fades that edge out instead.
        isTextOverflowingWidth: maxLineWidthPx > maxWidthPx,
        isTranslationClipped: subtitleTracks.some(track => track.isClipped),
    };
};
