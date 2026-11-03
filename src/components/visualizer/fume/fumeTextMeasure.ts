import { measureNaturalWidth, prepareWithSegments, walkLineRanges, type PreparedTextWithSegments, type LayoutCursor, type PrepareOptions } from '@chenglou/pretext';
import { Theme } from '../../../types';
import { resolveThemeFontWeight } from '../../../utils/fontStacks';
import type { RenderLineSlice, RenderSegmentSlice, SegmentMeta, WordRange } from './fumeTypes';
import { clamp, splitGraphemes } from './fumeMath';
import { measurePrefixOffsets, rememberBounded } from '../textMeasureCache';

// src/components/visualizer/fume/fumeTextMeasure.ts
// Text measurement for fume: pretext segments, glyph offsets and advances inside render lines.

const FUME_PRETEXT_OPTIONS = { whiteSpace: 'pre-wrap' } satisfies PrepareOptions;

export const buildSegmentMetas = (prepared: PreparedTextWithSegments) => {
    const segmentMetas: SegmentMeta[] = [];
    const graphemes: string[] = [];
    let graphemeCursor = 0;

    for (const segment of prepared.segments) {
        const segmentGraphemes = splitGraphemes(segment);
        segmentMetas.push({
            graphemeStart: graphemeCursor,
            graphemeEnd: graphemeCursor + segmentGraphemes.length,
            graphemeCount: segmentGraphemes.length,
        });
        graphemes.push(...segmentGraphemes);
        graphemeCursor += segmentGraphemes.length;
    }

    return { graphemes, segmentMetas };
};

export const cursorToGlobalOffset = (cursor: LayoutCursor, segmentMetas: SegmentMeta[]) => {
    if (segmentMetas.length === 0) return 0;
    const segment = segmentMetas[cursor.segmentIndex];

    if (!segment) {
        return segmentMetas[segmentMetas.length - 1]!.graphemeEnd;
    }

    return clamp(segment.graphemeStart + cursor.graphemeIndex, segment.graphemeStart, segment.graphemeEnd);
};

const getPartialSegmentWidth = (
    prepared: PreparedTextWithSegments,
    segmentIndex: number,
    segmentMeta: SegmentMeta,
    startOffset: number,
    endOffset: number,
) => {
    const localStart = clamp(startOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount);
    const localEnd = clamp(endOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount);

    if (localEnd <= localStart) return 0;
    if (localStart === 0 && localEnd === segmentMeta.graphemeCount) {
        return prepared.widths[segmentIndex] ?? 0;
    }

    const breakableFitAdvances = prepared.breakableFitAdvances[segmentIndex];
    if (breakableFitAdvances && breakableFitAdvances.length > 0) {
        let width = 0;
        for (let index = localStart; index < localEnd; index += 1) {
            width += breakableFitAdvances[index] ?? 0;
        }
        return width;
    }

    const fullWidth = prepared.widths[segmentIndex] ?? 0;
    if (segmentMeta.graphemeCount === 0) return fullWidth;
    return fullWidth * ((localEnd - localStart) / segmentMeta.graphemeCount);
};

export const widthBetweenOffsets = (
    prepared: PreparedTextWithSegments,
    segmentMetas: SegmentMeta[],
    startOffset: number,
    endOffset: number,
) => {
    if (endOffset <= startOffset) return 0;

    let width = 0;

    for (let segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex += 1) {
        const meta = segmentMetas[segmentIndex]!;
        if (endOffset <= meta.graphemeStart) break;
        if (startOffset >= meta.graphemeEnd) continue;

        const sliceStart = Math.max(startOffset, meta.graphemeStart);
        const sliceEnd = Math.min(endOffset, meta.graphemeEnd);
        width += getPartialSegmentWidth(prepared, segmentIndex, meta, sliceStart, sliceEnd);
    }

    return width;
};

export const buildGlyphOffsets = (
    prepared: PreparedTextWithSegments,
    segmentMetas: SegmentMeta[],
    startOffset: number,
    graphemeCount: number,
) => {
    const offsets = new Array<number>(graphemeCount);
    for (let index = 0; index < graphemeCount; index += 1) {
        offsets[index] = widthBetweenOffsets(
            prepared,
            segmentMetas,
            startOffset,
            startOffset + index,
        );
    }
    return offsets;
};

export const resolveGlyphAdvance = (
    renderLine: RenderLineSlice,
    graphemeIndex: number,
) => {
    const currentOffset = renderLine.glyphOffsets[graphemeIndex] ?? 0;
    const nextOffset = graphemeIndex < renderLine.graphemes.length - 1
        ? (renderLine.glyphOffsets[graphemeIndex + 1] ?? renderLine.width)
        : renderLine.width;
    return Math.max(nextOffset - currentOffset, 0);
};

export const buildRenderSegments = (
    prepared: PreparedTextWithSegments,
    segmentMetas: SegmentMeta[],
    lineStart: number,
    lineEnd: number,
    fontSpec: string,
) => {
    const segments: RenderSegmentSlice[] = [];

    for (let segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex += 1) {
        const meta = segmentMetas[segmentIndex]!;
        if (lineEnd <= meta.graphemeStart) {
            break;
        }
        if (lineStart >= meta.graphemeEnd) {
            continue;
        }

        const start = Math.max(lineStart, meta.graphemeStart);
        const end = Math.min(lineEnd, meta.graphemeEnd);
        if (end <= start) {
            continue;
        }

        const localStart = start - lineStart;
        const localEnd = end - lineStart;
        const segmentText = prepared.segments[segmentIndex] ?? '';
        const segmentGraphemes = splitGraphemes(segmentText);
        const text = start === meta.graphemeStart && end === meta.graphemeEnd
            ? segmentText
            : segmentGraphemes.slice(start - meta.graphemeStart, end - meta.graphemeStart).join('');
        const measuredGlyphOffsets = measureSegmentGlyphOffsets(text, fontSpec);

        segments.push({
            text,
            start,
            end,
            localStart,
            localEnd,
            x: widthBetweenOffsets(prepared, segmentMetas, lineStart, start),
            width: widthBetweenOffsets(prepared, segmentMetas, start, end),
            isFullSegment: start === meta.graphemeStart && end === meta.graphemeEnd,
            measuredGlyphOffsets,
        });
    }

    return segments;
};

export const buildFontSpec = (
    fontPx: number,
    variant: 'body' | 'hero',
    fontFamily: string,
    theme: Pick<Theme, 'fontWeight'>,
) => {
    const fontWeight = resolveThemeFontWeight(theme, variant === 'hero' ? 780 : 640);
    return `${fontWeight} ${fontPx}px ${fontFamily}`;
};

let segmentMeasureCanvas: HTMLCanvasElement | null = null;
// Bounded so a long session across many songs cannot grow it forever; far above one song's working set.
const SEGMENT_MEASURE_CACHE_LIMIT = 2048;
const segmentMeasureCache = new Map<string, number[]>();

const measureSegmentGlyphOffsets = (
    text: string,
    fontSpec: string,
) => {
    const cacheKey = `${fontSpec}__${text}`;
    const cached = segmentMeasureCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const graphemes = splitGraphemes(text);
    const offsets = new Array<number>(graphemes.length + 1).fill(0);
    if (typeof document === 'undefined') {
        return offsets;
    }

    if (!segmentMeasureCanvas) {
        segmentMeasureCanvas = document.createElement('canvas');
    }

    const context = segmentMeasureCanvas.getContext('2d');
    if (!context) {
        return offsets;
    }

    context.font = fontSpec;
    const measured = measurePrefixOffsets(graphemes, prefix => context.measureText(prefix).width);

    return rememberBounded(segmentMeasureCache, cacheKey, measured, SEGMENT_MEASURE_CACHE_LIMIT);
};

export const buildWordRangeIndexByOffset = (
    graphemeCount: number,
    wordRanges: WordRange[],
    rangeKind: 'timing' | 'color' = 'timing',
) => {
    const indices = new Array<number>(graphemeCount).fill(-1);
    for (let rangeIndex = 0; rangeIndex < wordRanges.length; rangeIndex += 1) {
        const range = wordRanges[rangeIndex]!;
        const start = rangeKind === 'color' ? range.colorStart : range.start;
        const end = rangeKind === 'color' ? range.colorEnd : range.end;
        for (let offset = start; offset < end && offset < graphemeCount; offset += 1) {
            indices[offset] = rangeIndex;
        }
    }
    return indices;
};

export const countRenderableGraphemes = (text: string) => (
    splitGraphemes(text).filter(value => value.trim().length > 0).length
);

/**
 * What one article layout has measured of one text in one variant (the variants differ in weight).
 * The layout tries every line at dozens of font sizes and widths, and measuring the text at a new
 * size is what costs: canvas measureText for every segment, slower still the first time a size is
 * used. Where a text that fits on one line at a size also fits at every smaller one (see
 * sizeRegime), a try at a size between two measured ones is answered by them without measuring,
 * and the answer is the one measuring would give.
 */
export interface FumeLineMeasures {
    text: string;
    variant: 'body' | 'hero';
    fontFamily: string;
    theme: Pick<Theme, 'fontWeight'>;
    preparedByFontPx: Map<number, PreparedTextWithSegments>;
    /** By regime and width. */
    fits: Map<string, FumeLineFit>;
    /** The size measured last at 24 px or more, and how wide the text is there on one line. */
    lastMeasured: { fontPx: number; naturalWidth: number } | null;
}

/** In one regime, at one width: the largest size measured to fit on one line, its line count, the smallest size measured not to fit. */
interface FumeLineFit {
    regime: string;
    width: number;
    fits: number;
    lineCount: number;
    overflows: number;
    guessed: boolean;
}

/**
 * How far either side of the size guessed to just fit a width it is measured. Widths grow with the
 * size to within 0.06% from 24 px; where they do not, the two sizes miss and the tries are
 * measured where they fall.
 */
const FIT_GUESS_MARGIN = 0.001;

/**
 * From this size up, every font measured grows wider with the size, without exception. Below it
 * some do not: a CJK font with bitmaps for small sizes (Windows has them up to 22 px), drawn bold
 * for a weight it lacks, is narrower just past each half pixel and at some whole pixels (seen up
 * to 23 px, by up to 2.3%). Measured in the app with the five built-in font stacks at 640 and 780,
 * from 9 to 26 px; above that it is taken to hold, as the bitmaps it comes from stop at 22 px.
 */
const LINEAR_FROM_PX = 24;
/**
 * Below LINEAR_FROM_PX, how near a half or whole pixel a size is measured whatever was measured
 * around it. Wider than the 0.01 px the browser's font cache rounds sizes to (two sizes that close
 * share one font, the first one asked for).
 */
const PIXEL_EDGE_PX = 0.02;

/**
 * The sizes a measured size answers tries for: every size from LINEAR_FROM_PX up; below it, the
 * sizes in the same half pixel, away from its edges, where widths were seen to grow with the size
 * in every font. Null: a size near an edge, answered only by measuring it.
 */
const sizeRegime = (fontPx: number): string | null => {
    if (fontPx >= LINEAR_FROM_PX) return 'linear';
    const halves = fontPx * 2;
    return Math.abs(halves - Math.round(halves)) < PIXEL_EDGE_PX * 2 ? null : `half ${Math.floor(halves)}`;
};

/** The measures of `text` in `variant` for one layout, made the first time they are asked for. */
export const lineMeasuresFor = (
    all: Map<string, FumeLineMeasures>,
    text: string,
    variant: 'body' | 'hero',
    fontFamily: string,
    theme: Pick<Theme, 'fontWeight'>,
) => {
    const key = `${variant}:${text}`;
    let measures = all.get(key);
    if (!measures) {
        measures = { text, variant, fontFamily, theme, preparedByFontPx: new Map(), fits: new Map(), lastMeasured: null };
        all.set(key, measures);
    }
    return measures;
};

const countLines = (prepared: PreparedTextWithSegments, width: number) => walkLineRanges(prepared, width, () => {});

const noteFit = (fit: FumeLineFit, fontPx: number, prepared: PreparedTextWithSegments) => {
    const lineCount = countLines(prepared, fit.width);
    if (lineCount <= 1) {
        if (fontPx > fit.fits) {
            fit.fits = fontPx;
            fit.lineCount = lineCount;
        }
    } else if (fontPx < fit.overflows) {
        fit.overflows = fontPx;
    }
};

/** The text prepared at `fontPx`, measured once per layout. */
export const prepareLineAt = (measures: FumeLineMeasures, fontPx: number) => {
    let prepared = measures.preparedByFontPx.get(fontPx);
    if (!prepared) {
        const fontSpec = buildFontSpec(fontPx, measures.variant, measures.fontFamily, measures.theme);
        prepared = prepareWithSegments(measures.text, fontSpec, FUME_PRETEXT_OPTIONS);
        measures.preparedByFontPx.set(fontPx, prepared);
        const regime = sizeRegime(fontPx);
        if (regime === 'linear') measures.lastMeasured = { fontPx, naturalWidth: measureNaturalWidth(prepared) };
        for (const fit of measures.fits.values()) {
            if (fit.regime === regime) noteFit(fit, fontPx, prepared);
        }
    }
    return prepared;
};

const fitIn = (measures: FumeLineMeasures, regime: string, width: number) => {
    const key = `${regime}|${width}`;
    let fit = measures.fits.get(key);
    if (!fit) {
        fit = { regime, width, fits: Number.NEGATIVE_INFINITY, lineCount: 1, overflows: Number.POSITIVE_INFINITY, guessed: false };
        for (const [measuredPx, prepared] of measures.preparedByFontPx) {
            if (sizeRegime(measuredPx) === regime) noteFit(fit, measuredPx, prepared);
        }
        measures.fits.set(key, fit);
    }
    return fit;
};

const fitsOnOneLine = (measures: FumeLineMeasures, fontPx: number, width: number) => {
    const regime = sizeRegime(fontPx);
    if (regime === null) return countLines(prepareLineAt(measures, fontPx), width) <= 1;
    const fit = fitIn(measures, regime, width);
    if (fontPx <= fit.fits) return true;
    if (fontPx >= fit.overflows) return false;
    // The first try from 24 px up at this width that cannot be answered: measure just below and
    // just above the size where the text should stop fitting (widths grow with the size), so that
    // the tries of the later attempts at this width fall outside the two and need no measuring.
    const last = measures.lastMeasured;
    if (regime === 'linear' && !fit.guessed && last && last.naturalWidth > 0) {
        fit.guessed = true;
        const guess = last.fontPx * width / last.naturalWidth;
        for (const at of [guess * (1 - FIT_GUESS_MARGIN), guess * (1 + FIT_GUESS_MARGIN)]) {
            if (at > fit.fits && at < fit.overflows && at >= LINEAR_FROM_PX) prepareLineAt(measures, at);
        }
        if (fontPx <= fit.fits) return true;
        if (fontPx >= fit.overflows) return false;
    }
    prepareLineAt(measures, fontPx);
    return fontPx <= fit.fits;
};

/**
 * The font size a block's text is set in, and how many lines it takes at `width`. Text that fits
 * takes the same number of lines at every size it fits, so a size answered without measuring
 * takes the count of the size that answered it.
 */
export const chooseSingleLineFontPx = (
    measures: FumeLineMeasures,
    width: number,
    lyricsFontScale: number,
    densityScale: number,
    heroScale: number,
) => {
    const { variant } = measures;
    let low = variant === 'hero' ? 18 : 10;
    let high = variant === 'hero' ? 58 : 30;
    let best: number | null = null;

    // Fume really wants most blocks to stay single-line when possible.
    // So do a tiny binary search for a font size that still fits before falling back.
    for (let iteration = 0; iteration < 8; iteration += 1) {
        const candidateFontPx = ((low + high) / 2)
            * lyricsFontScale
            * densityScale
            * (variant === 'hero' ? heroScale : 1);

        if (fitsOnOneLine(measures, candidateFontPx, width)) {
            best = candidateFontPx;
            low = (low + high) / 2;
        } else {
            high = (low + high) / 2;
        }
    }

    if (best !== null) {
        const prepared = measures.preparedByFontPx.get(best);
        return { fontPx: best, lineCount: prepared ? countLines(prepared, width) : fitIn(measures, sizeRegime(best)!, width).lineCount };
    }

    const fallbackFontPx = (variant === 'hero' ? 18 : 10)
        * lyricsFontScale
        * densityScale
        * (variant === 'hero' ? heroScale : 1);
    return { fontPx: fallbackFontPx, lineCount: countLines(prepareLineAt(measures, fallbackFontPx), width) };
};

export const resolveRenderLineOffset = (
    renderLine: RenderLineSlice,
    localOffset: number,
) => {
    if (localOffset <= 0) {
        return 0;
    }
    if (localOffset >= renderLine.graphemes.length) {
        return renderLine.width;
    }
    return renderLine.glyphOffsets[localOffset] ?? renderLine.width;
};

export const resolveSegmentGlyphOffset = (
    segment: RenderSegmentSlice,
    globalOffset: number,
) => {
    const localOffset = clamp(globalOffset - segment.start, 0, segment.measuredGlyphOffsets.length - 1);
    return segment.measuredGlyphOffsets[localOffset] ?? 0;
};

export const resolveSegmentGlyphAdvance = (
    segment: RenderSegmentSlice,
    globalOffset: number,
) => {
    const localOffset = clamp(globalOffset - segment.start, 0, segment.measuredGlyphOffsets.length - 2);
    const current = segment.measuredGlyphOffsets[localOffset] ?? 0;
    const next = segment.measuredGlyphOffsets[localOffset + 1] ?? current;
    return Math.max(next - current, 0);
};
