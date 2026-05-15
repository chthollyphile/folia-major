import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, MotionValue } from 'framer-motion';
import { layoutWithLines, prepareWithSegments, type PreparedTextWithSegments, type LayoutCursor } from '@chenglou/pretext';
import { Hourglass } from 'lucide-react';
import { AudioBands, DEFAULT_FUME_TUNING, FumeTuning, Line, Theme, Word as WordType } from '../../../types';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { getLineRenderEndTime, getLineRenderHints, getLineTransitionTiming } from '../../../utils/lyrics/renderHints';
import { buildFumeBackgroundScene, drawFumeBackground, type FumeBackgroundAudioLevels } from '../FumeBackground';
import { getRecentCompletedLine, getUpcomingLines } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';

// This mode is basically "turn the whole lyric into an article, then move a camera through it".
// So the pipeline is much bigger than the others: prebuild the article layout, split it into blocks/render lines/graphemes,
// resolve which block the camera should care about right now, then draw background + paper + typed text + passed text together every frame.
// If this mode breaks, it is usually not one tiny animation bug, it is some step in that whole pipeline drifting out of sync.
//
// For a single lyric line, the state handling is:
// waiting -> line already exists in the article, but the camera may not be on it yet and glyphs can stay unprinted.
// active -> line becomes the main reading target, camera focuses in, and glyphs print with stronger glow/presence.
// passed -> line becomes already-read text, keep some paper trace and fade it out with textHoldRatio instead of removing it instantly.
interface VisualizerProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    coverUrl?: string | null;
    useCoverColorBg?: boolean;
    seed?: string | number;
    backgroundOpacity?: number;
    lyricsFontScale?: number;
    fumeTuning?: FumeTuning;
    isPlayerChromeHidden?: boolean;
    onBack?: () => void;
}

interface ViewportSize {
    width: number;
    height: number;
}

interface SegmentMeta {
    graphemeStart: number;
    graphemeEnd: number;
    graphemeCount: number;
}

interface WordRange {
    wordIndex: number;
    word: WordType;
    start: number;
    end: number;
    colorStart: number;
    colorEnd: number;
}

interface RenderLineSlice {
    id: string;
    text: string;
    start: number;
    end: number;
    graphemes: string[];
    glyphOffsets: number[];
    segments: RenderSegmentSlice[];
    left: number;
    top: number;
    width: number;
}

interface RenderSegmentSlice {
    text: string;
    start: number;
    end: number;
    localStart: number;
    localEnd: number;
    x: number;
    width: number;
    isFullSegment: boolean;
    measuredGlyphOffsets: number[];
}

interface FumeBlock {
    id: string;
    sourceLineIndex: number;
    line: Line;
    variant: 'body' | 'hero';
    x: number;
    y: number;
    width: number;
    height: number;
    innerWidth: number;
    fontPx: number;
    lineHeight: number;
    prepared: PreparedTextWithSegments;
    layout: ReturnType<typeof layoutWithLines>;
    graphemes: string[];
    segmentMetas: SegmentMeta[];
    wordRanges: WordRange[];
    wordRangeIndexByOffset: number[];
    colorRangeIndexByOffset: number[];
    renderLines: RenderLineSlice[];
}

interface FumePaperBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

interface FumeArticleLayout {
    width: number;
    height: number;
    viewportHeight: number;
    columns: number;
    gap: number;
    paperBounds: FumePaperBounds;
    blocks: FumeBlock[];
}

interface FumeArticleLayoutMetrics {
    width: number;
    height: number;
    viewportHeight: number;
    columns: number;
    gap: number;
    paperBounds: FumePaperBounds;
}

interface StaticBlockSnapshot {
    canvas: HTMLCanvasElement;
    padding: number;
}

interface FumeLayoutAttemptOptions {
    paperWidth: number;
    viewportHeight: number;
    columns: number;
    gap: number;
    densityScale: number;
    seedKey: string;
    mode?: 'measure' | 'render';
    timing?: FumeLayoutAttemptTiming;
}

interface FumeLayoutAttemptTiming {
    lines: number;
    prepareLayoutMs: number;
    placementMs: number;
    renderDetailsMs: number;
}

interface CameraTarget {
    x: number;
    y: number;
    velocityX: number;
    velocityY: number;
    focusX: number;
    focusY: number;
    scale: number;
    velocityScale: number;
    focusScale: number;
}

interface CameraRetargetState {
    sourceLineIndex: number;
    startedAt: number;
    duration: number;
    fromX: number;
    fromY: number;
    fromScale: number;
    bridgeMode: 'none' | 'direct' | 'overview';
    bridgeWaypointX: number;
    bridgeWaypointY: number;
    bridgeWaypointScale: number;
    bridgeWaypointPhase: number;
}

interface CameraViewTarget {
    x: number;
    y: number;
    scale: number;
}

const graphemeSegmenter = typeof Intl !== 'undefined'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const splitGraphemes = (text: string) => {
    if (!text) return [] as string[];
    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
    }
    return Array.from(text);
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const quadraticBezier = (from: number, control: number, to: number, amount: number) => {
    const normalized = clamp(amount, 0, 1);
    const inverse = 1 - normalized;
    return inverse * inverse * from + 2 * inverse * normalized * control + normalized * normalized * to;
};
const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
const easeInCubic = (value: number) => Math.pow(clamp(value, 0, 1), 3);
const easeInOutCubic = (value: number) => {
    const normalized = clamp(value, 0, 1);
    return normalized < 0.5
        ? 4 * normalized * normalized * normalized
        : 1 - Math.pow(-2 * normalized + 2, 3) / 2;
};
const resolveDelayedGlowEnvelope = (
    progress: number,
    peakProgress = 0.8,
) => {
    const normalized = clamp(progress, 0, 1);
    const clampedPeak = clamp(peakProgress, 0.05, 0.95);

    if (normalized <= clampedPeak) {
        return easeOutCubic(normalized / clampedPeak);
    }

    return 1 - easeInCubic((normalized - clampedPeak) / (1 - clampedPeak));
};

const nowMs = () => (
    typeof performance !== 'undefined'
        ? performance.now()
        : Date.now()
);

const createFumeLayoutTiming = (): FumeLayoutAttemptTiming => ({
    lines: 0,
    prepareLayoutMs: 0,
    placementMs: 0,
    renderDetailsMs: 0,
});

const roundMs = (value: number) => Number(value.toFixed(2));

let lastFumeLayoutCache: {
    key: string;
    article: FumeArticleLayout | null;
} | null = null;

let lastFumePassedFadeDurationCache: {
    key: string;
    duration: number;
} | null = null;

const isCJK = (text: string) => /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);

const colorWithAlpha = (color: string, alpha: number) => {
    const normalizedAlpha = clamp(alpha, 0, 1);

    if (color.startsWith('#')) {
        const hex = color.slice(1);
        const parse = (value: string) => Number.parseInt(value, 16);

        if (hex.length === 3) {
            const r = parse(hex[0] + hex[0]);
            const g = parse(hex[1] + hex[1]);
            const b = parse(hex[2] + hex[2]);
            return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
        }

        if (hex.length === 6) {
            const r = parse(hex.slice(0, 2));
            const g = parse(hex.slice(2, 4));
            const b = parse(hex.slice(4, 6));
            return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
        }
    }

    const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
        const channels = rgbMatch[1].split(',').slice(0, 3).map(part => part.trim());
        return `rgba(${channels.join(', ')}, ${normalizedAlpha})`;
    }

    return color;
};

const CAMERA_SCALE_MIN = 0.22;
const CAMERA_SCALE_MAX = 2.24;
const OVERVIEW_CAMERA_SOURCE = -2;
const LAYOUT_REBUILD_DEBOUNCE_MS = 96;
const FUME_BACKGROUND_PARALLAX_X = 0.9;
const FUME_BACKGROUND_PARALLAX_Y = 0.74;
const FUME_BACKGROUND_SCALE_FACTOR = 0.94;
const FUME_BACKGROUND_VERTICAL_OFFSET_RATIO = 0.22;
const FUME_CAMERA_TELEPORT_TRIGGER_SCREENS = 2.75;
const resolvePassedTextStyle = (
    variant: 'body' | 'hero',
    textHoldStyle: 'standard' | 'dimmed',
) => (
    textHoldStyle === 'dimmed'
        ? {
            opacity: variant === 'hero' ? 0.11 : 0.075,
            glowMultiplier: 0,
            shadowAlphaBase: 0,
            shadowAlphaTrail: 0,
        }
        : {
            opacity: variant === 'hero' ? 0.74 : 0.58,
            glowMultiplier: 1,
            shadowAlphaBase: 0.1,
            shadowAlphaTrail: 0.16,
        }
);

const resolvePassedDimAmount = (
    currentTimeValue: number,
    passedAt: number,
    fadeDuration: number,
) => {
    if (!Number.isFinite(currentTimeValue) || !Number.isFinite(passedAt) || !Number.isFinite(fadeDuration) || fadeDuration <= 0) {
        return 1;
    }

    const passedAge = Math.max(currentTimeValue - passedAt, 0);
    return easeInCubic(clamp(passedAge / fadeDuration, 0, 1));
};

const resolveFumePassedFadeDuration = (lines: Line[], textHoldRatio: number) => {
    if (textHoldRatio >= 1) {
        return Number.POSITIVE_INFINITY;
    }

    const timedLines = lines
        .map(line => ({
            startTime: line.startTime,
            endTime: getLineRenderEndTime(line),
        }))
        .filter(line => (
            Number.isFinite(line.startTime)
            && Number.isFinite(line.endTime)
            && line.endTime >= line.startTime
        ))
        .sort((left, right) => left.startTime - right.startTime);
    const cacheKey = timedLines
        .map(line => `${line.startTime.toFixed(3)}:${line.endTime.toFixed(3)}`)
        .join('|') + `:${textHoldRatio.toFixed(3)}`;

    if (lastFumePassedFadeDurationCache?.key === cacheKey) {
        return lastFumePassedFadeDurationCache.duration;
    }

    if (timedLines.length <= 1) {
        const duration = clamp(8 * textHoldRatio, 2.4, 130);
        lastFumePassedFadeDurationCache = { key: cacheKey, duration };
        return duration;
    }

    const first = timedLines[0]!;
    const last = timedLines[timedLines.length - 1]!;
    const totalDuration = Math.max(last.endTime - first.startTime, 0);
    const duration = clamp(totalDuration * textHoldRatio, 2.4, 130);
    lastFumePassedFadeDurationCache = { key: cacheKey, duration };
    return duration;
};

const parseColorChannels = (color: string) => {
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        const parse = (value: string) => Number.parseInt(value, 16);

        if (hex.length === 3) {
            return {
                r: parse(hex[0] + hex[0]),
                g: parse(hex[1] + hex[1]),
                b: parse(hex[2] + hex[2]),
            };
        }

        if (hex.length === 6) {
            return {
                r: parse(hex.slice(0, 2)),
                g: parse(hex.slice(2, 4)),
                b: parse(hex.slice(4, 6)),
            };
        }
    }

    const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
        const [r = '255', g = '255', b = '255'] = rgbMatch[1].split(',').slice(0, 3).map(part => part.trim());
        return {
            r: Number.parseFloat(r),
            g: Number.parseFloat(g),
            b: Number.parseFloat(b),
        };
    }

    return null;
};

const mixColors = (from: string, to: string, amount: number, alpha = 1) => {
    const normalizedAmount = clamp(amount, 0, 1);
    const fromChannels = parseColorChannels(from);
    const toChannels = parseColorChannels(to);

    if (!fromChannels || !toChannels) {
        return colorWithAlpha(normalizedAmount >= 0.5 ? to : from, alpha);
    }

    return `rgba(${Math.round(mix(fromChannels.r, toChannels.r, normalizedAmount))}, ${Math.round(mix(fromChannels.g, toChannels.g, normalizedAmount))}, ${Math.round(mix(fromChannels.b, toChannels.b, normalizedAmount))}, ${clamp(alpha, 0, 1)})`;
};

const getActiveColor = (wordText: string, theme: Theme) => {
    if (!theme.wordColors || theme.wordColors.length === 0) {
        return theme.accentColor;
    }

    const cleanCurrent = wordText.trim();
    const matched = theme.wordColors.find(entry => {
        const target = entry.word;
        if (isCJK(cleanCurrent)) {
            return target.includes(cleanCurrent) || cleanCurrent.includes(target);
        }

        const targetWords = target.split(/\s+/).map(value => value.toLowerCase().replace(/[^\w]/g, ''));
        const normalizedCurrent = cleanCurrent.toLowerCase().replace(/[^\w]/g, '');
        return targetWords.includes(normalizedCurrent);
    });

    return matched?.color ?? theme.accentColor;
};

const hashString = (input: string) => {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const seeded = (seed: string) => {
    const hash = hashString(seed);
    return (hash % 10000) / 10000;
};

const buildSegmentMetas = (prepared: PreparedTextWithSegments) => {
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

export const buildWordRangesFromWords = (line: Line, graphemes: string[]) => {
    if (line.words.length === 0 || graphemes.length === 0) {
        return [] as WordRange[];
    }

    const rangedWords = line.words.filter(word => splitGraphemes(word.text).length > 0);
    if (rangedWords.length === 0) {
        return [] as WordRange[];
    }
    const ranges: WordRange[] = [];
    let cursor = 0;

    for (let wordIndex = 0; wordIndex < rangedWords.length; wordIndex += 1) {
        const word = rangedWords[wordIndex]!;
        const wordGraphemes = splitGraphemes(word.text);
        const start = clamp(cursor, 0, graphemes.length);
        let end = clamp(start + wordGraphemes.length, start, graphemes.length);

        // Some lyric payloads omit inter-word spaces from word.text while fullText keeps them.
        // In that case, keep the visual stream contiguous by attaching immediately following
        // whitespace to the current word range instead of shifting every later word left.
        while (end < graphemes.length && /\s/.test(graphemes[end] ?? '')) {
            end += 1;
        }

        ranges.push({
            wordIndex,
            word,
            start,
            end,
            colorStart: start,
            colorEnd: end,
        });
        cursor = end;
    }

    return ranges;
};

const resolveWordRevealProgress = (
    range: WordRange,
    currentTimeValue: number,
) => {
    if (range.word.endTime <= range.word.startTime) {
        return currentTimeValue >= range.word.endTime ? 1 : 0;
    }

    const duration = Math.max(range.word.endTime - range.word.startTime, 0.08);
    return clamp((currentTimeValue - range.word.startTime) / duration, 0, 1);
};

const resolvePrintedGlyphsInRange = (
    range: WordRange,
    currentTimeValue: number,
) => {
    const length = Math.max(range.end - range.start, 0);
    if (length === 0) {
        return 0;
    }

    if (currentTimeValue < range.word.startTime) {
        return 0;
    }

    const progress = resolveWordRevealProgress(range, currentTimeValue);
    if (progress >= 1) {
        return length;
    }

    return clamp(
        Math.floor(progress * length + 0.2),
        progress > 0 ? 1 : 0,
        length,
    );
};

const hasRevealCompletedByLineEnd = (
    line: Line,
    currentTimeValue: number,
) => currentTimeValue >= line.endTime;

export const resolveLinePassCutoffTime = (
    line: Line,
    nextLineStartTime: number | null | undefined,
) => {
    const renderEndTime = getLineRenderEndTime(line);
    if (typeof nextLineStartTime !== 'number' || !Number.isFinite(nextLineStartTime)) {
        return renderEndTime;
    }

    return Math.min(renderEndTime, nextLineStartTime);
};

export const resolveVisualProgressWithCutoff = (
    startedAt: number,
    duration: number,
    currentTimeValue: number,
    cutoffTime: number,
) => {
    const nominalEndTime = startedAt + Math.max(duration, 0.001);
    const effectiveEndTime = Math.max(
        startedAt + 0.001,
        Math.min(nominalEndTime, cutoffTime),
    );

    return clamp(
        (currentTimeValue - startedAt) / Math.max(effectiveEndTime - startedAt, 0.001),
        0,
        1,
    );
};

const cursorToGlobalOffset = (cursor: LayoutCursor, segmentMetas: SegmentMeta[]) => {
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

    const prefixWidths = prepared.breakablePrefixWidths[segmentIndex];
    if (prefixWidths && prefixWidths.length > 0) {
        const endWidth = prefixWidths[localEnd - 1] ?? 0;
        const startWidth = localStart > 0 ? (prefixWidths[localStart - 1] ?? 0) : 0;
        return endWidth - startWidth;
    }

    const breakableWidths = prepared.breakableWidths[segmentIndex];
    if (breakableWidths && breakableWidths.length > 0) {
        let width = 0;
        for (let index = localStart; index < localEnd; index += 1) {
            width += breakableWidths[index] ?? 0;
        }
        return width;
    }

    const fullWidth = prepared.widths[segmentIndex] ?? 0;
    if (segmentMeta.graphemeCount === 0) return fullWidth;
    return fullWidth * ((localEnd - localStart) / segmentMeta.graphemeCount);
};

const widthBetweenOffsets = (
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

const buildGlyphOffsets = (
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

const resolveGlyphAdvance = (
    renderLine: RenderLineSlice,
    graphemeIndex: number,
) => {
    const currentOffset = renderLine.glyphOffsets[graphemeIndex] ?? 0;
    const nextOffset = graphemeIndex < renderLine.graphemes.length - 1
        ? (renderLine.glyphOffsets[graphemeIndex + 1] ?? renderLine.width)
        : renderLine.width;
    return Math.max(nextOffset - currentOffset, 0);
};

const buildRenderSegments = (
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

const buildFontSpec = (
    fontPx: number,
    variant: 'body' | 'hero',
    fontFamily: string,
) => {
    const fontWeight = variant === 'hero' ? 780 : 640;
    return `${fontWeight} ${fontPx}px ${fontFamily}`;
};

let segmentMeasureCanvas: HTMLCanvasElement | null = null;
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
    for (let index = 1; index <= graphemes.length; index += 1) {
        offsets[index] = context.measureText(graphemes.slice(0, index).join('')).width;
    }

    segmentMeasureCache.set(cacheKey, offsets);
    return offsets;
};

const buildWordRangeIndexByOffset = (
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

const countRenderableGraphemes = (text: string) => (
    splitGraphemes(text).filter(value => value.trim().length > 0).length
);

const chooseNaturalBlockVariant = (line: Line, index: number, total: number) => {
    const graphemeCount = countRenderableGraphemes(line.fullText);
    if (graphemeCount === 0) {
        return 'body' as const;
    }

    if (line.isChorus && graphemeCount <= 22) {
        return 'hero' as const;
    }

    const shortEnough = graphemeCount >= 4 && graphemeCount <= 28;
    const centered = Math.abs(index - total / 2) / Math.max(total, 1);
    const random = seeded(`${line.fullText}:${index}`);
    return shortEnough && centered < 0.72 && ((index + 1) % 6 === 0 || random > 0.965)
        ? 'hero'
        : 'body';
};

const chooseFallbackHeroBlockIndex = (
    entries: Array<{ line: Line; index: number; }>,
) => {
    if (entries.length === 0) {
        return -1;
    }

    const hasNaturalHero = entries.some(({ line }, blockIndex) => (
        chooseNaturalBlockVariant(line, blockIndex, entries.length) === 'hero'
    ));
    if (hasNaturalHero) {
        return -1;
    }

    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    entries.forEach(({ line }, blockIndex) => {
        const graphemeCount = countRenderableGraphemes(line.fullText);
        if (graphemeCount === 0) {
            return;
        }

        const isComfortableHeroLength = graphemeCount >= 4 && graphemeCount <= 28;
        const isAcceptableFallbackLength = graphemeCount <= 36;
        if (!isComfortableHeroLength && !isAcceptableFallbackLength) {
            return;
        }

        const centered = Math.abs(blockIndex - entries.length / 2) / Math.max(entries.length, 1);
        const centerScore = 1 - centered;
        const lengthScore = graphemeCount >= 6 && graphemeCount <= 22
            ? 1
            : graphemeCount <= 28
                ? 0.72
                : 0.36;
        const chorusScore = line.isChorus ? 0.28 : 0;
        const stableJitter = seeded(`${line.fullText}:${blockIndex}:fallback-hero`) * 0.04;
        const score = centerScore * 0.62 + lengthScore * 0.34 + chorusScore + stableJitter;

        if (score > bestScore) {
            bestScore = score;
            bestIndex = blockIndex;
        }
    });

    if (bestIndex >= 0) {
        return bestIndex;
    }

    let shortestIndex = -1;
    let shortestCount = Number.POSITIVE_INFINITY;
    entries.forEach(({ line }, blockIndex) => {
        const graphemeCount = countRenderableGraphemes(line.fullText);
        if (graphemeCount > 0 && graphemeCount < shortestCount) {
            shortestCount = graphemeCount;
            shortestIndex = blockIndex;
        }
    });

    return shortestIndex;
};

const chooseBlockVariant = (
    line: Line,
    index: number,
    total: number,
    forcedHeroIndex: number,
) => (
    index === forcedHeroIndex
        ? 'hero'
        : chooseNaturalBlockVariant(line, index, total)
);

const chooseFontPx = (
    line: Line,
    variant: 'body' | 'hero',
    width: number,
    lyricsFontScale: number,
    densityScale: number,
) => {
    const graphemeCount = Math.max(countRenderableGraphemes(line.fullText), 1);
    const density = graphemeCount + line.words.length * 1.4;
    const base = variant === 'hero'
        ? width / Math.max(Math.sqrt(density) * 1.5, 4.5)
        : width / Math.max(Math.sqrt(density) * 2.25, 7);

    const scaled = base * lyricsFontScale * densityScale;
    return variant === 'hero'
        ? clamp(scaled, 24, 54)
        : clamp(scaled, 14, 28);
};

const buildPreparedSingleLine = (
    text: string,
    fontFamily: string,
    width: number,
    variant: 'body' | 'hero',
    lyricsFontScale: number,
    densityScale: number,
    heroScale: number,
) => {
    let low = variant === 'hero' ? 18 : 10;
    let high = variant === 'hero' ? 58 : 30;
    let best: {
        fontPx: number;
        prepared: PreparedTextWithSegments;
        layout: ReturnType<typeof layoutWithLines>;
    } | null = null;

    // Fume really wants most blocks to stay single-line when possible.
    // So do a tiny binary search for a font size that still fits before falling back.
    for (let iteration = 0; iteration < 8; iteration += 1) {
        const candidateFontPx = ((low + high) / 2)
            * lyricsFontScale
            * densityScale
            * (variant === 'hero' ? heroScale : 1);
        const fontSpec = buildFontSpec(candidateFontPx, variant, fontFamily);
        const prepared = prepareWithSegments(text, fontSpec);
        const layout = layoutWithLines(prepared, width, Math.round(candidateFontPx * (variant === 'hero' ? 1.02 : 1.06)));

        if (layout.lineCount <= 1) {
            best = {
                fontPx: candidateFontPx,
                prepared,
                layout,
            };
            low = (low + high) / 2;
        } else {
            high = (low + high) / 2;
        }
    }

    if (best) {
        return best;
    }

    const fallbackFontPx = (variant === 'hero' ? 18 : 10)
        * lyricsFontScale
        * densityScale
        * (variant === 'hero' ? heroScale : 1);
    const fontSpec = buildFontSpec(fallbackFontPx, variant, fontFamily);
    const prepared = prepareWithSegments(text, fontSpec);
    return {
        fontPx: fallbackFontPx,
        prepared,
        layout: layoutWithLines(prepared, width, Math.round(fallbackFontPx * (variant === 'hero' ? 1.02 : 1.06))),
    };
};

const buildLayoutCacheKey = (
    lines: Line[],
    viewport: ViewportSize,
    layoutTheme: Pick<Theme, 'name' | 'fontStyle' | 'fontFamily'>,
    lyricsFontScale: number,
    fumeTuning: FumeTuning,
) => {
    // Layout cache key intentionally ignores short-lived playback state.
    // Only geometry-affecting inputs should invalidate the whole article layout.
    let linesHash = 2166136261;
    for (const line of lines) {
        const lineKey = `${line.startTime}:${line.endTime}:${line.fullText}:${line.words.length}:${line.isChorus ? 1 : 0}`;
        linesHash ^= hashString(lineKey);
        linesHash = Math.imul(linesHash, 16777619);
    }

    return [
        Math.round(viewport.width),
        Math.round(viewport.height),
        layoutTheme.fontStyle,
        layoutTheme.fontFamily ?? '',
        layoutTheme.name,
        lyricsFontScale.toFixed(4),
        fumeTuning.heroScale.toFixed(4),
        lines.length,
        linesHash >>> 0,
    ].join('|');
};

export const resolvePrintedGraphemeCount = (
    line: Line,
    wordRanges: WordRange[],
    graphemeCount: number,
    currentTimeValue: number,
) => {
    if (graphemeCount === 0) {
        return 0;
    }

    if (currentTimeValue < line.startTime) {
        return 0;
    }

    if (hasRevealCompletedByLineEnd(line, currentTimeValue)) {
        return graphemeCount;
    }

    if (wordRanges.length === 0) {
        const duration = Math.max(line.endTime - line.startTime, 0.12);
        const progress = clamp((currentTimeValue - line.startTime) / duration, 0, 1);
        return clamp(Math.floor(progress * graphemeCount + (progress > 0 ? 1 : 0)), 0, graphemeCount);
    }

    let printed = 0;
    for (let index = 0; index < wordRanges.length; index += 1) {
        const range = wordRanges[index]!;
        const partial = resolvePrintedGlyphsInRange(range, currentTimeValue);
        printed = range.start + partial;

        if (partial < range.end - range.start) {
            return clamp(printed, 0, graphemeCount);
        }
    }

    return clamp(printed, 0, graphemeCount);
};

export const resolvePrintedGraphemeProgress = (
    line: Line,
    wordRanges: WordRange[],
    graphemeCount: number,
    currentTimeValue: number,
) => {
    if (graphemeCount === 0) {
        return 0;
    }

    if (currentTimeValue < line.startTime) {
        return 0;
    }

    if (hasRevealCompletedByLineEnd(line, currentTimeValue)) {
        return graphemeCount;
    }

    if (wordRanges.length === 0) {
        const duration = Math.max(line.endTime - line.startTime, 0.12);
        const progress = clamp((currentTimeValue - line.startTime) / duration, 0, 1);
        return clamp(progress * graphemeCount, 0, graphemeCount);
    }

    let printed = 0;
    for (let index = 0; index < wordRanges.length; index += 1) {
        const range = wordRanges[index]!;
        if (currentTimeValue < range.word.startTime) {
            return clamp(printed, 0, graphemeCount);
        }

        const progress = resolveWordRevealProgress(range, currentTimeValue);
        const length = Math.max(range.end - range.start, 0);
        printed = range.start + progress * length;

        if (progress < 1) {
            return clamp(printed, 0, graphemeCount);
        }
    }

    return clamp(printed, 0, graphemeCount);
};

function buildArticleLayoutAttempt(
    lines: Line[],
    viewport: ViewportSize,
    layoutTheme: Pick<Theme, 'name' | 'fontStyle' | 'fontFamily'>,
    lyricsFontScale: number,
    fumeTuning: FumeTuning,
    options: FumeLayoutAttemptOptions & { mode: 'measure' },
): FumeArticleLayoutMetrics | null;
function buildArticleLayoutAttempt(
    lines: Line[],
    viewport: ViewportSize,
    layoutTheme: Pick<Theme, 'name' | 'fontStyle' | 'fontFamily'>,
    lyricsFontScale: number,
    fumeTuning: FumeTuning,
    options: FumeLayoutAttemptOptions & { mode?: 'render' },
): FumeArticleLayout | null;
function buildArticleLayoutAttempt(
    lines: Line[],
    viewport: ViewportSize,
    layoutTheme: Pick<Theme, 'name' | 'fontStyle' | 'fontFamily'>,
    lyricsFontScale: number,
    fumeTuning: FumeTuning,
    options: FumeLayoutAttemptOptions,
): FumeArticleLayout | FumeArticleLayoutMetrics | null {
    if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) {
        return null;
    }

    const {
        paperWidth,
        viewportHeight,
        columns,
        gap,
        densityScale,
        seedKey,
        mode = 'render',
        timing,
    } = options;
    const shouldBuildRenderDetails = mode === 'render';
    const horizontalMargin = Math.max(viewport.width * 0.86, 280);
    const verticalMargin = Math.max(viewport.height * 0.82, 220);
    const columnWidth = (paperWidth - gap * (columns - 1)) / columns;
    const fontFamily = resolveThemeFontStack(layoutTheme);
    // Empty lines do not help the article layout.
    // Also shuffle placement order deterministically so the paper feels composed rather than strictly chronological.
    const filteredLines = lines
        .map((line, index) => ({ line, index }))
        .filter(entry => entry.line.fullText.trim().length > 0)
        .sort((left, right) => {
            const leftSeed = seeded(`${seedKey}:${left.index}:${left.line.fullText}`);
            const rightSeed = seeded(`${seedKey}:${right.index}:${right.line.fullText}`);
            return leftSeed - rightSeed;
        });

    const blocks: FumeBlock[] = [];
    const columnHeights = Array.from({ length: columns }, () => verticalMargin);
    let bodyColumnTieCursor = 0;
    let heroPlacementTieCursor = 0;
    const forcedHeroIndex = chooseFallbackHeroBlockIndex(filteredLines);

    filteredLines.forEach(({ line, index }, blockIndex) => {
        timing && (timing.lines += 1);
        const variant = chooseBlockVariant(line, blockIndex, filteredLines.length, forcedHeroIndex);
        // Hero blocks are allowed to claim more visual territory.
        // Body blocks should stay narrow so the article still reads like columns.
        const heroSpanColumns = variant === 'hero'
            ? Math.min(columns, columns <= 1 ? 1 : 2)
            : 1;
        const heroSpanWidth = heroSpanColumns > 1
            ? columnWidth * heroSpanColumns + gap * (heroSpanColumns - 1)
            : paperWidth;
        const blockWidth = variant === 'hero'
            ? heroSpanColumns === 1
                ? paperWidth
                : columns === 2
                    ? columnWidth * 1.5 + gap * 0.5
                    : heroSpanWidth
            : columnWidth;
        const paddingX = 0;
        const paddingY = 0;
        const innerWidth = Math.max(blockWidth - paddingX * 2, 120);
        const prepareLayoutStart = timing ? nowMs() : 0;
        const preparedSingleLine = buildPreparedSingleLine(
            line.fullText,
            fontFamily,
            innerWidth,
            variant,
            lyricsFontScale,
            densityScale,
            fumeTuning.heroScale,
        );
        if (timing) {
            timing.prepareLayoutMs += nowMs() - prepareLayoutStart;
        }
        const fontPx = preparedSingleLine.fontPx;
        const lineHeight = Math.round(fontPx * (variant === 'hero' ? 1.02 : 1.06));
        const layout = preparedSingleLine.layout;
        const blockGap = variant === 'hero'
            ? Math.max(Math.round(lineHeight * 0.2), 6)
            : Math.max(Math.round(lineHeight * 0.08), 2);
        const blockHeight = paddingY * 2 + layout.lines.length * lineHeight;
        let x = 0;
        let y = 0;
        const placementStart = timing ? nowMs() : 0;

        if (variant === 'hero') {
            // Hero placement tries to find the calmest large slot across multiple columns.
            if (heroSpanColumns === 1) {
                y = Math.max(...columnHeights);
                x = horizontalMargin;
                columnHeights[0] = y + blockHeight + blockGap;
            } else {
                let bestHeight = Number.POSITIVE_INFINITY;
                let candidateStarts: number[] = [];

                for (let startColumn = 0; startColumn <= columns - heroSpanColumns; startColumn += 1) {
                    let coveredHeight = 0;
                    for (let columnIndex = startColumn; columnIndex < startColumn + heroSpanColumns; columnIndex += 1) {
                        coveredHeight = Math.max(coveredHeight, columnHeights[columnIndex] ?? 0);
                    }

                    if (coveredHeight < bestHeight) {
                        bestHeight = coveredHeight;
                        candidateStarts = [startColumn];
                    } else if (coveredHeight === bestHeight) {
                        candidateStarts.push(startColumn);
                    }
                }

                const targetStart = candidateStarts.length > 0
                    ? candidateStarts[heroPlacementTieCursor % candidateStarts.length]!
                    : 0;
                heroPlacementTieCursor += 1;
                y = bestHeight;
                x = horizontalMargin
                    + targetStart * (columnWidth + gap)
                    + Math.max((heroSpanWidth - blockWidth) * 0.5, 0);

                for (let columnIndex = targetStart; columnIndex < targetStart + heroSpanColumns; columnIndex += 1) {
                    columnHeights[columnIndex] = y + blockHeight + blockGap;
                }
            }
        } else {
            // Body placement is simpler: drop into the currently shortest column.
            let targetColumn = 0;
            let minHeight = columnHeights[0] ?? 0;
            const candidateColumns = [0];

            for (let columnIndex = 1; columnIndex < columns; columnIndex += 1) {
                const height = columnHeights[columnIndex] ?? 0;

                if (height < minHeight) {
                    minHeight = height;
                    candidateColumns.length = 0;
                    candidateColumns.push(columnIndex);
                } else if (height === minHeight) {
                    candidateColumns.push(columnIndex);
                }
            }

            targetColumn = candidateColumns[bodyColumnTieCursor % candidateColumns.length] ?? 0;
            bodyColumnTieCursor += 1;
            x = horizontalMargin + targetColumn * (columnWidth + gap);
            y = columnHeights[targetColumn]!;
            columnHeights[targetColumn] = y + blockHeight + blockGap;
        }
        if (timing) {
            timing.placementMs += nowMs() - placementStart;
        }

        if (shouldBuildRenderDetails) {
            // Measure-only passes stop before this point.
            // Render passes continue and build every structure needed for glyph printing and per-line focus.
            const renderDetailsStart = timing ? nowMs() : 0;
            const prepared = preparedSingleLine.prepared;
            const fontSpec = buildFontSpec(fontPx, variant, fontFamily);
            const { graphemes, segmentMetas } = buildSegmentMetas(prepared);
            const wordRanges = buildWordRangesFromWords(line, graphemes);
            const wordRangeIndexByOffset = buildWordRangeIndexByOffset(graphemes.length, wordRanges);
            const colorRangeIndexByOffset = buildWordRangeIndexByOffset(graphemes.length, wordRanges, 'color');
            const renderLines = layout.lines.map((layoutLine, lineIndex) => {
                const start = cursorToGlobalOffset(layoutLine.start, segmentMetas);
                const end = cursorToGlobalOffset(layoutLine.end, segmentMetas);
                const lineGraphemes = splitGraphemes(layoutLine.text);

                return {
                    id: `${line.startTime}-${lineIndex}`,
                    text: layoutLine.text,
                    start,
                    end,
                    graphemes: lineGraphemes,
                    glyphOffsets: buildGlyphOffsets(
                        prepared,
                        segmentMetas,
                        start,
                        lineGraphemes.length,
                    ),
                    segments: buildRenderSegments(
                        prepared,
                        segmentMetas,
                        start,
                        end,
                        fontSpec,
                    ),
                    left: variant === 'hero'
                        ? Math.max((blockWidth - layoutLine.width) * 0.08, 0)
                        : 0,
                    top: paddingY + lineIndex * lineHeight,
                    width: layoutLine.width,
                };
            });

            blocks.push({
                id: `fume-${line.startTime}-${index}`,
                sourceLineIndex: index,
                line,
                variant,
                x,
                y,
                width: blockWidth,
                height: blockHeight,
                innerWidth,
                fontPx,
                lineHeight,
                prepared,
                layout,
                graphemes,
                segmentMetas,
                wordRanges,
                wordRangeIndexByOffset,
                colorRangeIndexByOffset,
                renderLines,
            });
            if (timing) {
                timing.renderDetailsMs += nowMs() - renderDetailsStart;
            }
        }
    });

    const articleHeight = Math.max(0, ...columnHeights) + verticalMargin;

    const metrics = {
        width: paperWidth + horizontalMargin * 2,
        height: articleHeight,
        viewportHeight,
        columns,
        gap,
        paperBounds: {
            left: horizontalMargin,
            top: verticalMargin,
            right: horizontalMargin + paperWidth,
            bottom: Math.max(articleHeight - verticalMargin, verticalMargin),
        },
    };

    if (!shouldBuildRenderDetails) {
        return metrics;
    }

    return {
        ...metrics,
        blocks,
    };
}

const buildArticleLayout = (
    lines: Line[],
    viewport: ViewportSize,
    layoutTheme: Pick<Theme, 'name' | 'fontStyle' | 'fontFamily'>,
    lyricsFontScale: number,
    fumeTuning: FumeTuning,
): FumeArticleLayout | null => {
    if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) {
        return null;
    }

    const paperWidth = clamp(Math.max(viewport.width * 1.95, viewport.width + 520), 920, 2400);
    const viewportHeight = Math.max(viewport.height, 240);
    const maxColumns = paperWidth >= 1120 ? 4 : paperWidth >= 760 ? 3 : paperWidth >= 500 ? 2 : 1;
    const targetHeight = viewportHeight * 2.45;
    const layoutSeedKey = layoutTheme.name;

    let bestOptions: (FumeLayoutAttemptOptions & { mode: 'render' }) | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestHeight = 0;
    const totalStart = nowMs();
    const measureTiming = createFumeLayoutTiming();
    const renderTiming = createFumeLayoutTiming();
    const measureColumnTimings = new Map<number, FumeLayoutAttemptTiming>();
    let measureAttemptCount = 0;

    // Try a few column counts and density scales, then keep the article that lands closest to the target height.
    // This is why the mode feels "composed" instead of hardcoding one layout recipe for every song.
    for (let columns = maxColumns; columns >= 1; columns -= 1) {
        let low = 0.82;
        let high = 1.42;
        const gap = clamp(Math.round(paperWidth * (columns >= 4 ? 0.0065 : columns === 3 ? 0.0085 : 0.0115)), 6, 14);
        const columnTiming = createFumeLayoutTiming();
        measureColumnTimings.set(columns, columnTiming);

        for (let iteration = 0; iteration < 8; iteration += 1) {
            const densityScale = (low + high) / 2;
            measureAttemptCount += 1;
            const attemptOptions: FumeLayoutAttemptOptions & { mode: 'measure' } = {
                paperWidth,
                viewportHeight,
                columns,
                gap,
                densityScale,
                seedKey: `${layoutSeedKey}:${columns}:${paperWidth}`,
                mode: 'measure',
                timing: columnTiming,
            };
            const layout = buildArticleLayoutAttempt(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning, attemptOptions);

            if (!layout) {
                continue;
            }

            const coveragePenalty = Math.abs(layout.height - targetHeight);
            const overflowPenalty = layout.height < targetHeight ? 0 : (layout.height - targetHeight) * 0.14;
            const score = coveragePenalty + overflowPenalty;

            if (score < bestScore) {
                bestScore = score;
                bestHeight = layout.height;
                bestOptions = {
                    paperWidth,
                    viewportHeight,
                    columns,
                    gap,
                    densityScale,
                    seedKey: `${layoutSeedKey}:${columns}:${paperWidth}`,
                    mode: 'render',
                    timing: renderTiming,
                };
            }

            if (layout.height < targetHeight) {
                low = densityScale;
            } else {
                high = densityScale;
            }
        }

        measureTiming.lines += columnTiming.lines;
        measureTiming.prepareLayoutMs += columnTiming.prepareLayoutMs;
        measureTiming.placementMs += columnTiming.placementMs;
        measureTiming.renderDetailsMs += columnTiming.renderDetailsMs;
    }

    const renderStart = nowMs();
    const article = bestOptions
        ? buildArticleLayoutAttempt(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning, bestOptions)
        : null;
    const renderMs = nowMs() - renderStart;
    const totalMs = nowMs() - totalStart;

    if (import.meta.env.DEV) {
        console.info('[VisualizerFume] layout timing', {
            totalMs: roundMs(totalMs),
            measureMs: roundMs(measureTiming.prepareLayoutMs + measureTiming.placementMs),
            renderMs: roundMs(renderMs),
            attempts: measureAttemptCount,
            measuredLines: measureTiming.lines,
            renderedLines: renderTiming.lines,
            inputLines: lines.length,
            blocks: article?.blocks.length ?? 0,
            heroBlocks: article?.blocks.filter(block => block.variant === 'hero').length ?? 0,
            viewport: `${Math.round(viewport.width)}x${Math.round(viewport.height)}`,
            paperWidth: Math.round(paperWidth),
            targetHeight: Math.round(targetHeight),
            bestHeight: Math.round(bestHeight),
            finalHeight: Math.round(article?.height ?? 0),
            heightDelta: Math.round((article?.height ?? 0) - targetHeight),
            bestColumns: bestOptions?.columns ?? null,
            bestDensityScale: bestOptions ? Number(bestOptions.densityScale.toFixed(4)) : null,
            measureBreakdown: {
                prepareLayoutMs: roundMs(measureTiming.prepareLayoutMs),
                placementMs: roundMs(measureTiming.placementMs),
                renderDetailsMs: roundMs(measureTiming.renderDetailsMs),
            },
            renderBreakdown: {
                prepareLayoutMs: roundMs(renderTiming.prepareLayoutMs),
                placementMs: roundMs(renderTiming.placementMs),
                renderDetailsMs: roundMs(renderTiming.renderDetailsMs),
            },
            measureByColumns: Array.from(measureColumnTimings.entries()).map(([columns, timing]) => ({
                columns,
                lines: timing.lines,
                prepareLayoutMs: roundMs(timing.prepareLayoutMs),
                placementMs: roundMs(timing.placementMs),
            })),
        });
    }

    return article;
};

const resolveSteppedBlockFocusPoint = (
    block: FumeBlock,
    printedCount: number,
) => {
    if (block.renderLines.length === 0) {
        return {
            x: block.x + block.width * 0.5,
            y: block.y + block.height * 0.5,
        };
    }

    const effectiveOffset = clamp(printedCount, 0, block.graphemes.length);
    const targetLine = block.renderLines.find(renderLine => effectiveOffset <= renderLine.end)
        ?? block.renderLines[block.renderLines.length - 1]!;
    const localOffset = clamp(effectiveOffset, targetLine.start, targetLine.end);
    const progressWidth = widthBetweenOffsets(
        block.prepared,
        block.segmentMetas,
        targetLine.start,
        localOffset,
    );
    const minX = block.x + targetLine.left;
    const maxX = minX + targetLine.width;

    return {
        x: clamp(minX + progressWidth, minX, maxX),
        y: block.y + targetLine.top + block.lineHeight * 0.5,
    };
};

const resolveSmoothBlockFocusPoint = (
    block: FumeBlock,
    printedProgress: number,
) => {
    if (block.renderLines.length === 0) {
        return {
            x: block.x + block.width * 0.5,
            y: block.y + block.height * 0.5,
        };
    }

    const effectiveOffset = clamp(printedProgress, 0, block.graphemes.length);
    const findRenderLineIndex = (offset: number) => {
        const exactIndex = block.renderLines.findIndex(renderLine => offset <= renderLine.end);
        return exactIndex >= 0 ? exactIndex : block.renderLines.length - 1;
    };

    const resolvePointOnRenderLine = (lineIndex: number, offset: number) => {
        const targetLine = block.renderLines[lineIndex] ?? block.renderLines[block.renderLines.length - 1]!;
        const clampedOffset = clamp(offset, targetLine.start, targetLine.end);
        const baseOffset = Math.floor(clampedOffset);
        const fractionalOffset = clampedOffset - baseOffset;
        const baseWidth = widthBetweenOffsets(
            block.prepared,
            block.segmentMetas,
            targetLine.start,
            baseOffset,
        );
        const localGlyphIndex = baseOffset - targetLine.start;
        const glyphAdvance = localGlyphIndex >= 0 && localGlyphIndex < targetLine.graphemes.length
            ? resolveGlyphAdvance(targetLine, localGlyphIndex)
            : 0;
        const minX = block.x + targetLine.left;
        const maxX = minX + targetLine.width;

        return {
            x: clamp(minX + baseWidth + glyphAdvance * fractionalOffset, minX, maxX),
            y: block.y + targetLine.top + block.lineHeight * 0.5,
        };
    };

    const targetLineIndex = findRenderLineIndex(effectiveOffset);
    let point = resolvePointOnRenderLine(targetLineIndex, effectiveOffset);
    const currentLine = block.renderLines[targetLineIndex]!;
    const crossLineBlendWindow = 0.7;

    if (targetLineIndex > 0 && effectiveOffset < currentLine.start + crossLineBlendWindow) {
        const previousLine = block.renderLines[targetLineIndex - 1]!;
        const blend = easeInOutCubic(clamp(
            1 - ((effectiveOffset - previousLine.end) / crossLineBlendWindow),
            0,
            1,
        ));
        const previousPoint = resolvePointOnRenderLine(targetLineIndex - 1, previousLine.end);
        point = {
            x: mix(point.x, previousPoint.x, blend),
            y: mix(point.y, previousPoint.y, blend),
        };
    } else if (targetLineIndex < block.renderLines.length - 1 && effectiveOffset > currentLine.end - crossLineBlendWindow) {
        const nextLine = block.renderLines[targetLineIndex + 1]!;
        const blend = easeInOutCubic(clamp(
            (effectiveOffset - (currentLine.end - crossLineBlendWindow)) / crossLineBlendWindow,
            0,
            1,
        ));
        const nextPoint = resolvePointOnRenderLine(targetLineIndex + 1, nextLine.start);
        point = {
            x: mix(point.x, nextPoint.x, blend),
            y: mix(point.y, nextPoint.y, blend),
        };
    }

    return point;
};

const resolveBlockEntryFocusPoint = (
    block: FumeBlock,
) => {
    const firstRenderLine = block.renderLines[0];
    if (!firstRenderLine) {
        return {
            x: block.x + block.width * 0.5,
            y: block.y + block.height * 0.5,
        };
    }

    return {
        x: block.x + firstRenderLine.left,
        y: block.y + firstRenderLine.top + block.lineHeight * 0.5,
    };
};

const buildCanvasFont = (block: FumeBlock, theme: Theme) => {
    const fontFamily = resolveThemeFontStack(theme);
    return buildFontSpec(block.fontPx, block.variant, fontFamily);
};

const buildTextStyleKey = (
    fillStyle: string,
    shadowBlur: number,
    shadowColor: string,
) => `${fillStyle}|${shadowColor}|${shadowBlur.toFixed(3)}`;

const resolveRenderLineOffset = (
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

const resolveSegmentGlyphOffset = (
    segment: RenderSegmentSlice,
    globalOffset: number,
) => {
    const localOffset = clamp(globalOffset - segment.start, 0, segment.measuredGlyphOffsets.length - 1);
    return segment.measuredGlyphOffsets[localOffset] ?? 0;
};

const resolveSegmentGlyphAdvance = (
    segment: RenderSegmentSlice,
    globalOffset: number,
) => {
    const localOffset = clamp(globalOffset - segment.start, 0, segment.measuredGlyphOffsets.length - 2);
    const current = segment.measuredGlyphOffsets[localOffset] ?? 0;
    const next = segment.measuredGlyphOffsets[localOffset + 1] ?? current;
    return Math.max(next - current, 0);
};

const drawRenderTextRun = (
    context: CanvasRenderingContext2D,
    renderLine: RenderLineSlice,
    segment: RenderSegmentSlice,
    runStart: number,
    runEnd: number,
    baseX: number,
    baseY: number,
) => {
    if (!segment.text || runEnd <= runStart) {
        return;
    }

    const segmentRunStart = Math.max(runStart - segment.localStart, 0);
    const segmentRunEnd = Math.min(runEnd - segment.localStart, segment.measuredGlyphOffsets.length - 1);
    const clipLeft = segment.measuredGlyphOffsets[segmentRunStart] ?? (resolveRenderLineOffset(renderLine, runStart) - segment.x);
    const clipRight = segment.measuredGlyphOffsets[segmentRunEnd] ?? (resolveRenderLineOffset(renderLine, runEnd) - segment.x);
    const clipWidth = Math.max(clipRight - clipLeft, 0);
    if (clipWidth <= 0) {
        return;
    }

    context.save();
    context.beginPath();
    context.rect(
        baseX + segment.x + clipLeft,
        baseY - Math.max(clipWidth, 1) - 64,
        clipWidth,
        Math.max(128 + clipWidth * 2, 256),
    );
    context.clip();
    context.fillText(segment.text, baseX + segment.x, baseY);
    context.restore();
};

const createStaticBlockSnapshot = (
    block: FumeBlock,
    theme: Theme,
    fillStyle: string,
    shadowBlur = 0,
    shadowColor = 'transparent',
) => {
    if (typeof document === 'undefined') {
        return null;
    }

    const rasterScale = clamp(window.devicePixelRatio || 1, 1, 2);
    const padding = Math.ceil(Math.max(block.fontPx * 0.32, shadowBlur + block.fontPx * 0.08, 4));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((block.width + padding * 2) * rasterScale));
    canvas.height = Math.max(1, Math.ceil((block.height + padding * 2) * rasterScale));

    const context = canvas.getContext('2d');
    if (!context) {
        return null;
    }

    const baselineOffset = block.lineHeight * (isCJK(block.line.fullText) ? 0.52 : 0.5);
    context.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);
    context.font = buildCanvasFont(block, theme);
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = fillStyle;
    context.shadowBlur = shadowBlur;
    context.shadowColor = shadowColor;

    for (const renderLine of block.renderLines) {
        context.fillText(
            renderLine.text,
            renderLine.left + padding,
            renderLine.top + baselineOffset + padding,
        );
    }

    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
    return { canvas, padding };
};

const resolveCameraScaleForBlock = (
    block: FumeBlock,
    viewport: ViewportSize,
) => {
    const minViewportSide = Math.max(Math.min(viewport.width, viewport.height), 1);
    const targetLineHeight = clamp(minViewportSide * 0.115, 64, 124);
    return clamp(targetLineHeight / Math.max(block.lineHeight, 1), 0.88, 2.2);
};

const resolveCameraRetargetDuration = (line: Line) => {
    const hints = getLineRenderHints(line);
    if (!hints) {
        return 0.09;
    }

    const transitionTiming = getLineTransitionTiming(
        hints.rawDuration,
        hints.lineTransitionMode,
        hints.wordRevealMode,
    );

    if (hints.lineTransitionMode === 'none') {
        return clamp(Math.max(hints.rawDuration, 0.08) * 0.34, 0.04, 0.075);
    }

    if (hints.lineTransitionMode === 'fast') {
        return clamp(
            transitionTiming.enterDuration * 0.5 + transitionTiming.exitDuration * 0.12,
            0.055,
            0.095,
        );
    }

    return clamp(
        transitionTiming.enterDuration * 0.44 + transitionTiming.linePassHold * 0.22,
        0.075,
        0.13,
    );
};

const resolveOverviewRetargetDuration = (viewport: ViewportSize) => clamp(
    Math.min(viewport.width, viewport.height) / 1500,
    0.38,
    0.58,
);

const resolveOverviewFlightBridge = ({
    fromX,
    fromY,
    fromScale,
    targetX,
    targetY,
    targetScale,
    overviewCamera,
    viewport,
}: {
    fromX: number;
    fromY: number;
    fromScale: number;
    targetX: number;
    targetY: number;
    targetScale: number;
    overviewCamera: CameraViewTarget | null;
    viewport: ViewportSize;
}) => {
    if (!overviewCamera) {
        return null;
    }

    const safeScale = Math.max(fromScale, targetScale, overviewCamera.scale, 0.001);
    const minViewportSide = Math.max(Math.min(viewport.width, viewport.height), 1);
    const deltaX = fromX - targetX;
    const deltaY = fromY - targetY;
    const worldDistance = Math.hypot(deltaX, deltaY);
    const screenDistance = worldDistance * safeScale;

    if (worldDistance <= 0 || screenDistance < minViewportSide * FUME_CAMERA_TELEPORT_TRIGGER_SCREENS) {
        return null;
    }

    const loftStrength = clamp(
        (screenDistance / minViewportSide - FUME_CAMERA_TELEPORT_TRIGGER_SCREENS) / 3.4,
        0,
        1,
    );
    const midpointX = mix(fromX, targetX, 0.5);
    const midpointY = mix(fromY, targetY, 0.5);
    const waypointCenterBias = mix(0.18, 0.42, loftStrength);
    const waypointX = mix(midpointX, overviewCamera.x, waypointCenterBias);
    const waypointY = mix(midpointY, overviewCamera.y, waypointCenterBias);
    const endpointScale = Math.max(fromScale, targetScale, 0.001);
    const loftedScale = endpointScale * mix(0.62, 0.4, loftStrength);
    const overviewLimitedScale = overviewCamera.scale * mix(1.85, 1.55, loftStrength);
    const waypointScale = clamp(
        Math.max(loftedScale, overviewLimitedScale),
        CAMERA_SCALE_MIN,
        Math.max(endpointScale * 0.92, CAMERA_SCALE_MIN),
    );
    const overviewDistanceFromStart = Math.hypot(waypointX - fromX, waypointY - fromY)
        * Math.max(fromScale, waypointScale, 0.001);
    const overviewDistanceToTarget = Math.hypot(targetX - waypointX, targetY - waypointY)
        * Math.max(targetScale, waypointScale, 0.001);
    const totalLegDistance = overviewDistanceFromStart + overviewDistanceToTarget;
    const waypointPhase = totalLegDistance <= 0
        ? 0.36
        : clamp(overviewDistanceFromStart / totalLegDistance, 0.26, 0.44);
    const duration = clamp(
        0.26 + (screenDistance / (minViewportSide * 5.5)) * 0.28,
        0.3,
        0.68,
    );

    return {
        waypointX,
        waypointY,
        waypointScale,
        waypointPhase,
        duration,
    };
};

const resolveArticleOverviewCamera = (
    article: FumeArticleLayout,
    viewport: ViewportSize,
): CameraViewTarget => {
    if (article.blocks.length === 0) {
        const fitScale = Math.min(
            viewport.width / Math.max(article.width, 1),
            viewport.height / Math.max(article.height, 1),
        );

        return {
            x: article.width * 0.5,
            y: article.height * 0.5,
            scale: clamp(fitScale * 0.92, CAMERA_SCALE_MIN, 0.72),
        };
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const block of article.blocks) {
        minX = Math.min(minX, block.x);
        minY = Math.min(minY, block.y);
        maxX = Math.max(maxX, block.x + block.width);
        maxY = Math.max(maxY, block.y + block.height);
    }

    const paddingX = clamp(viewport.width * 0.2, 120, 280);
    const paddingY = clamp(viewport.height * 0.2, 96, 220);
    const framedWidth = Math.max(maxX - minX + paddingX * 2, 1);
    const framedHeight = Math.max(maxY - minY + paddingY * 2, 1);
    const fitScale = Math.min(
        viewport.width / framedWidth,
        viewport.height / framedHeight,
    );

    return {
        x: (minX + maxX) * 0.5,
        y: (minY + maxY) * 0.5,
        scale: clamp(fitScale, CAMERA_SCALE_MIN, 0.72),
    };
};

const resolveFocusBlock = (
    article: FumeArticleLayout,
    currentLineIndex: number,
    currentTimeValue: number,
) => {
    if (currentLineIndex >= 0) {
        const active = article.blocks.find(block => block.sourceLineIndex === currentLineIndex);
        if (active) {
            return active;
        }
    }

    const chronologicalLastBlock = article.blocks.reduce<FumeBlock | null>((latest, block) => {
        if (!latest || block.sourceLineIndex > latest.sourceLineIndex) {
            return block;
        }
        return latest;
    }, null);

    if (chronologicalLastBlock && currentTimeValue >= getLineRenderEndTime(chronologicalLastBlock.line)) {
        return chronologicalLastBlock;
    }

    const latestPrintedBlock = article.blocks.reduce<FumeBlock | null>((latest, block) => {
        const printedCount = resolvePrintedGraphemeCount(
            block.line,
            block.wordRanges,
            block.graphemes.length,
            currentTimeValue,
        );

        if (printedCount <= 0) {
            return latest;
        }

        if (!latest || block.sourceLineIndex > latest.sourceLineIndex) {
            return block;
        }

        return latest;
    }, null);

    if (latestPrintedBlock) {
        return latestPrintedBlock;
    }

    const chronologicalFirstBlock = article.blocks.reduce<FumeBlock | null>((earliest, block) => {
        if (!earliest || block.sourceLineIndex < earliest.sourceLineIndex) {
            return block;
        }
        return earliest;
    }, null);

    return chronologicalFirstBlock;
};

const VisualizerFume: React.FC<VisualizerProps & { staticMode?: boolean; }> = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText = true,
    coverUrl,
    useCoverColorBg = false,
    seed,
    staticMode = false,
    backgroundOpacity = 0.75,
    lyricsFontScale = 1,
    fumeTuning,
    isPlayerChromeHidden = false,
    onBack,
}) => {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const currentLineIndexRef = useRef(currentLineIndex);
    const cameraInitializedRef = useRef(false);
    const cameraRetargetRef = useRef<CameraRetargetState>({
        sourceLineIndex: -1,
        startedAt: 0,
        duration: 0.18,
        fromX: 0,
        fromY: 0,
        fromScale: 1,
        bridgeMode: 'none',
        bridgeWaypointX: 0,
        bridgeWaypointY: 0,
        bridgeWaypointScale: 1,
        bridgeWaypointPhase: 0.36,
    });
    const cameraRef = useRef<CameraTarget>({
        x: 0,
        y: 0,
        velocityX: 0,
        velocityY: 0,
        focusX: 0,
        focusY: 0,
        scale: 1,
        velocityScale: 0,
        focusScale: 1,
    });
    const staticBlockSnapshotCacheRef = useRef<Map<string, StaticBlockSnapshot>>(new Map());
    const layoutBuildVersionRef = useRef(0);
    const hasResolvedArticleRef = useRef(false);
    const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
    const [article, setArticle] = useState<FumeArticleLayout | null>(null);
    const [isLayoutPending, setIsLayoutPending] = useState(false);
    const [hasPrintedContent, setHasPrintedContent] = useState(false);
    const hasPrintedContentRef = useRef(false);

    useEffect(() => {
        currentLineIndexRef.current = currentLineIndex;
    }, [currentLineIndex]);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) {
            return;
        }

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            const nextWidth = entry.contentRect.width;
            const nextHeight = entry.contentRect.height;
            setViewport(previous => (
                previous.width === nextWidth && previous.height === nextHeight
                    ? previous
                    : { width: nextWidth, height: nextHeight }
            ));
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const runtime = useMemo(() => {
        const activeLine = lines[currentLineIndex] ?? null;
        const timeNow = currentTime.get();
        return {
            activeLine,
            recentCompletedLine: getRecentCompletedLine({
                lines,
                currentLineIndex,
                currentTime: timeNow,
                getLineEndTime: getLineRenderEndTime,
            }),
            nextLines: getUpcomingLines(lines, currentLineIndex, 2),
        };
    }, [currentLineIndex, lines]);
    const resolvedFumeTuning = useMemo<FumeTuning>(() => ({
        hidePrintSymbols: fumeTuning?.hidePrintSymbols ?? DEFAULT_FUME_TUNING.hidePrintSymbols,
        disableGeometricBackground: fumeTuning?.disableGeometricBackground ?? DEFAULT_FUME_TUNING.disableGeometricBackground,
        backgroundObjectOpacity: clamp(
            fumeTuning?.backgroundObjectOpacity ?? DEFAULT_FUME_TUNING.backgroundObjectOpacity,
            0,
            1,
        ),
        textHoldRatio: clamp(fumeTuning?.textHoldRatio ?? DEFAULT_FUME_TUNING.textHoldRatio, 0, 1),
        cameraTrackingMode: fumeTuning?.cameraTrackingMode === 'stepped' || fumeTuning?.cameraTrackingMode === 'smooth'
            ? fumeTuning.cameraTrackingMode
            : DEFAULT_FUME_TUNING.cameraTrackingMode,
        cameraSpeed: clamp(fumeTuning?.cameraSpeed ?? DEFAULT_FUME_TUNING.cameraSpeed, 0.55, 1.85),
        glowIntensity: clamp(fumeTuning?.glowIntensity ?? DEFAULT_FUME_TUNING.glowIntensity, 0, 1.8),
        heroScale: clamp(fumeTuning?.heroScale ?? DEFAULT_FUME_TUNING.heroScale, 0.82, 1.32),
    }), [fumeTuning]);
    const layoutTheme = useMemo(
        () => ({
            name: theme.name,
            fontStyle: theme.fontStyle,
            fontFamily: theme.fontFamily,
        }),
        [theme.fontFamily, theme.fontStyle, theme.name],
    );
    const layoutFumeTuning = useMemo<FumeTuning>(() => ({
        ...DEFAULT_FUME_TUNING,
        heroScale: resolvedFumeTuning.heroScale,
    }), [resolvedFumeTuning.heroScale]);

    useEffect(() => {
        const requestVersion = layoutBuildVersionRef.current + 1;
        layoutBuildVersionRef.current = requestVersion;

        if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) {
            hasResolvedArticleRef.current = false;
            setArticle(null);
            setIsLayoutPending(false);
            return;
        }

        setIsLayoutPending(true);

        let rafId = 0;
        let timeoutId = 0;
        const delay = hasResolvedArticleRef.current ? LAYOUT_REBUILD_DEBOUNCE_MS : 0;

        rafId = window.requestAnimationFrame(() => {
            timeoutId = window.setTimeout(() => {
                if (layoutBuildVersionRef.current !== requestVersion) {
                    return;
                }

                const layoutCacheKey = buildLayoutCacheKey(lines, viewport, layoutTheme, lyricsFontScale, layoutFumeTuning);
                const nextArticle = lastFumeLayoutCache?.key === layoutCacheKey
                    ? lastFumeLayoutCache.article
                    : buildArticleLayout(lines, viewport, layoutTheme, lyricsFontScale, layoutFumeTuning);
                if (layoutBuildVersionRef.current !== requestVersion) {
                    return;
                }

                lastFumeLayoutCache = {
                    key: layoutCacheKey,
                    article: nextArticle,
                };
                hasResolvedArticleRef.current = nextArticle !== null;
                setArticle(nextArticle);
                setIsLayoutPending(false);
            }, delay);
        });

        return () => {
            window.cancelAnimationFrame(rafId);
            window.clearTimeout(timeoutId);
        };
    }, [layoutFumeTuning, layoutTheme, lines, lyricsFontScale, viewport]);
    const lastRenderableLine = useMemo(() => {
        for (let index = lines.length - 1; index >= 0; index -= 1) {
            const line = lines[index];
            if (line?.fullText.trim().length) {
                return line;
            }
        }
        return null;
    }, [lines]);
    const overviewStartTime = useMemo(() => {
        if (!lastRenderableLine) {
            return Number.POSITIVE_INFINITY;
        }

        const lineStartTime = lastRenderableLine.startTime;
        const lineRenderEndTime = getLineRenderEndTime(lastRenderableLine);
        return lineStartTime + Math.max(lineRenderEndTime - lineStartTime, 0) * 0.5;
    }, [lastRenderableLine]);
    const backgroundScene = useMemo(
        () => buildFumeBackgroundScene({
            viewport,
            world: {
                width: article?.width ?? Math.max(viewport.width * 1.8, viewport.width),
                height: article?.height ?? Math.max(viewport.height * 1.8, viewport.height),
            },
            paperBounds: article?.paperBounds,
            seed: `${seed ?? 'fume'}:${theme.name}`,
        }),
        [article?.height, article?.paperBounds, article?.width, seed, theme.name, viewport],
    );
    const overviewCamera = useMemo(
        () => (article ? resolveArticleOverviewCamera(article, viewport) : null),
        [article, viewport],
    );
    const cameraSpeed = resolvedFumeTuning.cameraSpeed;
    const glowIntensity = resolvedFumeTuning.glowIntensity;
    const backgroundObjectOpacity = resolvedFumeTuning.backgroundObjectOpacity;
    const showPrintStamp = !resolvedFumeTuning.hidePrintSymbols;
    const textHoldRatio = resolvedFumeTuning.textHoldRatio;
    const passedFadeDuration = useMemo(
        () => resolveFumePassedFadeDuration(lines, textHoldRatio),
        [lines, textHoldRatio],
    );
    const translationFontSize = `clamp(${(1.05 * lyricsFontScale).toFixed(3)}rem, ${(2.2 * lyricsFontScale).toFixed(3)}vw, ${(1.2 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(1.8 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`;

    useEffect(() => {
        staticBlockSnapshotCacheRef.current.clear();
    }, [article, theme]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }

        const width = Math.max(Math.floor(viewport.width), 1);
        const height = Math.max(Math.floor(viewport.height), 1);
        const dpr = window.devicePixelRatio || 1;

        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);

        if (article && !cameraInitializedRef.current) {
            cameraRef.current = {
                x: article.width * 0.5,
                y: article.height * 0.5,
                velocityX: 0,
                velocityY: 0,
                focusX: article.width * 0.5,
                focusY: article.height * 0.5,
                scale: 1.18,
                velocityScale: 0,
                focusScale: 1.18,
            };
            cameraInitializedRef.current = true;
        } else if (article) {
            cameraRef.current.x = clamp(cameraRef.current.x, 0, article.width);
            cameraRef.current.y = clamp(cameraRef.current.y, 0, article.height);
            cameraRef.current.focusX = clamp(cameraRef.current.focusX, 0, article.width);
            cameraRef.current.focusY = clamp(cameraRef.current.focusY, 0, article.height);
            cameraRef.current.scale = clamp(cameraRef.current.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX);
            cameraRef.current.focusScale = clamp(cameraRef.current.focusScale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX);
        } else {
            cameraInitializedRef.current = false;
        }
        let frameId = 0;
        let lastFrameAt: number | null = null;

        const draw = () => {
            const now = performance.now();
            const dt = lastFrameAt === null
                ? 1 / 60
                : clamp((now - lastFrameAt) / 1000, 1 / 240, 0.05);
            lastFrameAt = now;

            const currentWidth = Math.max(Math.floor(viewport.width), 1);
            const currentHeight = Math.max(Math.floor(viewport.height), 1);
            const currentDpr = window.devicePixelRatio || 1;

            if (canvas.width !== Math.floor(currentWidth * currentDpr) || canvas.height !== Math.floor(currentHeight * currentDpr)) {
                canvas.width = Math.floor(currentWidth * currentDpr);
                canvas.height = Math.floor(currentHeight * currentDpr);
                canvas.style.width = `${currentWidth}px`;
                canvas.style.height = `${currentHeight}px`;
            }

            context.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
            context.clearRect(0, 0, currentWidth, currentHeight);

            const time = currentTime.get();
            const viewportCenterX = viewport.width * 0.5;
            const viewportCenterY = viewport.height * 0.5;
            const fumeBackgroundAudioLevels: FumeBackgroundAudioLevels = {
                power: audioPower.get(),
                bass: audioBands.bass.get(),
                lowMid: audioBands.lowMid.get(),
                mid: audioBands.mid.get(),
                vocal: audioBands.vocal.get(),
                treble: audioBands.treble.get(),
            };

            if (!article) {
                if (!staticMode) {
                    context.save();
                    context.translate(viewportCenterX, viewportCenterY);
                    context.translate(-backgroundScene.width * 0.5, -backgroundScene.height * 0.5);
                    drawFumeBackground({
                        context,
                        scene: backgroundScene,
                        theme,
                        time: time + now * 0.00018,
                        audioLevels: fumeBackgroundAudioLevels,
                        objectOpacityMultiplier: backgroundObjectOpacity * 2,
                    });
                    context.restore();
                }

                frameId = window.requestAnimationFrame(draw);
                return;
            }

            // One-shot detection: once any block starts printing, flip hasPrintedContent
            if (!hasPrintedContentRef.current) {
                const anyPrinted = article.blocks.some(block => time >= block.line.startTime);
                if (anyPrinted) {
                    hasPrintedContentRef.current = true;
                    setHasPrintedContent(true);
                }
            }

            const focusBlock = resolveFocusBlock(article, currentLineIndexRef.current, time);
            const shouldShowOverview = overviewCamera !== null && time >= overviewStartTime;
            let targetCameraX = article.width * 0.5;
            let targetCameraY = article.height * 0.5;
            let targetCameraScale = 1.18;
            let entryFocusPoint: { x: number; y: number; } | null = null;
            let didRetargetThisFrame = false;

            if (shouldShowOverview && overviewCamera) {
                targetCameraX = overviewCamera.x;
                targetCameraY = overviewCamera.y;
                targetCameraScale = overviewCamera.scale;

                if (cameraRetargetRef.current.sourceLineIndex !== OVERVIEW_CAMERA_SOURCE) {
                    cameraRetargetRef.current = {
                        sourceLineIndex: OVERVIEW_CAMERA_SOURCE,
                        startedAt: time,
                        duration: clamp(resolveOverviewRetargetDuration(viewport) / cameraSpeed, 0.12, 1.2),
                        fromX: cameraRef.current.x,
                        fromY: cameraRef.current.y,
                        fromScale: cameraRef.current.scale,
                        bridgeMode: 'none',
                        bridgeWaypointX: 0,
                        bridgeWaypointY: 0,
                        bridgeWaypointScale: 1,
                        bridgeWaypointPhase: 0.36,
                    };
                    didRetargetThisFrame = true;
                }
            } else if (focusBlock) {
                const focusPoint = resolvedFumeTuning.cameraTrackingMode === 'stepped'
                    ? resolveSteppedBlockFocusPoint(
                        focusBlock,
                        resolvePrintedGraphemeCount(
                            focusBlock.line,
                            focusBlock.wordRanges,
                            focusBlock.graphemes.length,
                            time,
                        ),
                    )
                    : resolveSmoothBlockFocusPoint(
                        focusBlock,
                        resolvePrintedGraphemeProgress(
                            focusBlock.line,
                            focusBlock.wordRanges,
                            focusBlock.graphemes.length,
                            time,
                        ),
                    );
                entryFocusPoint = resolveBlockEntryFocusPoint(focusBlock);
                targetCameraX = focusPoint.x;
                targetCameraY = focusPoint.y;
                targetCameraScale = resolveCameraScaleForBlock(focusBlock, viewport);

                if (cameraRetargetRef.current.sourceLineIndex !== focusBlock.sourceLineIndex) {
                    cameraRetargetRef.current = {
                        sourceLineIndex: focusBlock.sourceLineIndex,
                        startedAt: time,
                        duration: clamp(resolveCameraRetargetDuration(focusBlock.line) / cameraSpeed, 0.03, 0.3),
                        fromX: cameraRef.current.x,
                        fromY: cameraRef.current.y,
                        fromScale: cameraRef.current.scale,
                        bridgeMode: 'none',
                        bridgeWaypointX: 0,
                        bridgeWaypointY: 0,
                        bridgeWaypointScale: 1,
                        bridgeWaypointPhase: 0.36,
                    };
                    didRetargetThisFrame = true;
                }
            } else if (cameraRetargetRef.current.sourceLineIndex !== -1) {
                cameraRetargetRef.current = {
                    sourceLineIndex: -1,
                    startedAt: time,
                    duration: clamp(0.18 / cameraSpeed, 0.05, 0.4),
                    fromX: cameraRef.current.x,
                    fromY: cameraRef.current.y,
                    fromScale: cameraRef.current.scale,
                    bridgeMode: 'none',
                    bridgeWaypointX: 0,
                    bridgeWaypointY: 0,
                    bridgeWaypointScale: 1,
                    bridgeWaypointPhase: 0.36,
                };
                didRetargetThisFrame = true;
            }

            const retargetElapsed = Math.max(time - cameraRetargetRef.current.startedAt, 0);
            const overviewTextRestoreProgress = shouldShowOverview && cameraRetargetRef.current.sourceLineIndex === OVERVIEW_CAMERA_SOURCE
                ? easeInOutCubic(clamp(
                    retargetElapsed / Math.max(cameraRetargetRef.current.duration, 0.001),
                    0,
                    1,
                ))
                : 0;
            const retargetPhase = clamp(
                retargetElapsed / Math.max(cameraRetargetRef.current.duration, 0.001),
                0,
                1,
            );
            const retargetBoost = 1 - easeOutCubic(retargetPhase);
            const entryFocusBias = Math.pow(retargetBoost, 0.58);

            if (entryFocusPoint) {
                targetCameraX = mix(targetCameraX, entryFocusPoint.x, entryFocusBias);
                targetCameraY = mix(targetCameraY, entryFocusPoint.y, entryFocusBias);
            }

            if (!staticMode) {
                const floatConfig = theme.animationIntensity === 'chaotic'
                    ? { distance: 24, duration: 5.8, scaleAmplitude: 0.014 }
                    : theme.animationIntensity === 'calm'
                        ? { distance: 14, duration: 8.5, scaleAmplitude: 0.008 }
                        : { distance: 18, duration: 7, scaleAmplitude: 0.011 };
                const floatPhase = (now / 1000 / floatConfig.duration) * Math.PI * 2;
                const overviewAttenuation = shouldShowOverview ? 0.36 : 1;
                const screenFloatX = Math.sin(floatPhase * 0.74 + 0.8) * floatConfig.distance * 0.34;
                const screenFloatY = (
                    Math.sin(floatPhase) * floatConfig.distance
                    + Math.sin(floatPhase * 0.5 + 1.1) * floatConfig.distance * 0.22
                ) * overviewAttenuation;
                const worldFloatDivisor = Math.max(targetCameraScale, 0.001);

                targetCameraX -= screenFloatX / worldFloatDivisor;
                targetCameraY -= screenFloatY / worldFloatDivisor;
                targetCameraScale = clamp(
                    targetCameraScale * (1 + Math.sin(floatPhase + 0.9) * floatConfig.scaleAmplitude * overviewAttenuation),
                    CAMERA_SCALE_MIN,
                    CAMERA_SCALE_MAX,
                );
            }

            if (didRetargetThisFrame) {
                const bridgeScale = Math.max(cameraRef.current.scale, targetCameraScale, 0.001);
                const screenDeltaX = Math.abs(targetCameraX - cameraRetargetRef.current.fromX) * bridgeScale;
                const screenDeltaY = Math.abs(targetCameraY - cameraRetargetRef.current.fromY) * bridgeScale;
                const screenDistance = Math.hypot(screenDeltaX, screenDeltaY);
                cameraRetargetRef.current.bridgeMode = screenDistance >= Math.min(viewport.width, viewport.height) * 0.42
                    ? 'direct'
                    : 'none';
                cameraRetargetRef.current.bridgeWaypointX = targetCameraX;
                cameraRetargetRef.current.bridgeWaypointY = targetCameraY;
                cameraRetargetRef.current.bridgeWaypointScale = targetCameraScale;
                cameraRetargetRef.current.bridgeWaypointPhase = 0.5;

                if (cameraRetargetRef.current.sourceLineIndex >= 0) {
                    const overviewFlightBridge = resolveOverviewFlightBridge({
                        fromX: cameraRetargetRef.current.fromX,
                        fromY: cameraRetargetRef.current.fromY,
                        fromScale: cameraRetargetRef.current.fromScale,
                        targetX: targetCameraX,
                        targetY: targetCameraY,
                        targetScale: targetCameraScale,
                        overviewCamera,
                        viewport,
                    });

                    if (overviewFlightBridge) {
                        cameraRetargetRef.current.bridgeMode = 'overview';
                        cameraRetargetRef.current.bridgeWaypointX = overviewFlightBridge.waypointX;
                        cameraRetargetRef.current.bridgeWaypointY = overviewFlightBridge.waypointY;
                        cameraRetargetRef.current.bridgeWaypointScale = overviewFlightBridge.waypointScale;
                        cameraRetargetRef.current.bridgeWaypointPhase = overviewFlightBridge.waypointPhase;
                        cameraRetargetRef.current.duration = Math.max(
                            cameraRetargetRef.current.duration,
                            clamp(overviewFlightBridge.duration / cameraSpeed, 0.16, 0.9),
                        );
                    }
                }
            }

            const cameraDistance = Math.hypot(
                targetCameraX - cameraRef.current.x,
                targetCameraY - cameraRef.current.y,
            );
            const shouldUseBridge = cameraRetargetRef.current.bridgeMode !== 'none' && retargetPhase < 1;

            if (shouldUseBridge) {
                let bridgedCameraX = targetCameraX;
                let bridgedCameraY = targetCameraY;
                let bridgedCameraScale = targetCameraScale;

                if (cameraRetargetRef.current.bridgeMode === 'overview') {
                    const bridgePhase = easeOutCubic(retargetPhase);
                    bridgedCameraX = quadraticBezier(
                        cameraRetargetRef.current.fromX,
                        cameraRetargetRef.current.bridgeWaypointX,
                        targetCameraX,
                        bridgePhase,
                    );
                    bridgedCameraY = quadraticBezier(
                        cameraRetargetRef.current.fromY,
                        cameraRetargetRef.current.bridgeWaypointY,
                        targetCameraY,
                        bridgePhase,
                    );
                    bridgedCameraScale = quadraticBezier(
                        cameraRetargetRef.current.fromScale,
                        cameraRetargetRef.current.bridgeWaypointScale,
                        targetCameraScale,
                        bridgePhase,
                    );
                } else {
                    const bridgePhase = easeInOutCubic(retargetPhase);
                    bridgedCameraX = mix(cameraRetargetRef.current.fromX, targetCameraX, bridgePhase);
                    bridgedCameraY = mix(cameraRetargetRef.current.fromY, targetCameraY, bridgePhase);
                    bridgedCameraScale = mix(cameraRetargetRef.current.fromScale, targetCameraScale, bridgePhase);
                }

                const bridgeCatchUp = 1 - Math.exp(-dt * (
                    cameraRetargetRef.current.bridgeMode === 'overview'
                        ? mix(12.5, 22, 1 - retargetPhase)
                        : mix(10.5, 17.5, 1 - retargetPhase)
                ));

                cameraRef.current.focusX = bridgedCameraX;
                cameraRef.current.focusY = bridgedCameraY;
                cameraRef.current.focusScale = bridgedCameraScale;
                cameraRef.current.x += (bridgedCameraX - cameraRef.current.x) * bridgeCatchUp;
                cameraRef.current.y += (bridgedCameraY - cameraRef.current.y) * bridgeCatchUp;
                cameraRef.current.scale += (bridgedCameraScale - cameraRef.current.scale) * bridgeCatchUp;
                cameraRef.current.scale = clamp(cameraRef.current.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX);
                cameraRef.current.velocityX *= 0.72;
                cameraRef.current.velocityY *= 0.72;
                cameraRef.current.velocityScale *= 0.68;
            } else {
                const boostedCatchUpRate = clamp(
                    4.8 / Math.max(cameraRetargetRef.current.duration, 0.05),
                    20,
                    54,
                );
                const targetCatchUp = 1 - Math.exp(-dt * mix(11.2, boostedCatchUpRate, retargetBoost));
                cameraRef.current.focusX += (targetCameraX - cameraRef.current.focusX) * targetCatchUp;
                cameraRef.current.focusY += (targetCameraY - cameraRef.current.focusY) * targetCatchUp;
                cameraRef.current.focusScale += (targetCameraScale - cameraRef.current.focusScale)
                    * (1 - Math.exp(-dt * mix(5.4, 12.8, retargetBoost)));

                const springStrength = mix(
                    208,
                    clamp(15.8 / Math.max(cameraRetargetRef.current.duration * cameraRetargetRef.current.duration, 0.0064), 260, 780),
                    retargetBoost,
                );
                const damping = mix(
                    24,
                    clamp(Math.sqrt(springStrength) * 1.36, 24, 40),
                    retargetBoost,
                );
                const accelX = (cameraRef.current.focusX - cameraRef.current.x) * springStrength - cameraRef.current.velocityX * damping;
                const accelY = (cameraRef.current.focusY - cameraRef.current.y) * springStrength - cameraRef.current.velocityY * damping;
                cameraRef.current.velocityX += accelX * dt;
                cameraRef.current.velocityY += accelY * dt;
                const maxVelocity = mix(
                    1320,
                    clamp(cameraDistance / Math.max(cameraRetargetRef.current.duration * 0.28, 0.028), 2600, 8800),
                    retargetBoost,
                );
                cameraRef.current.velocityX = clamp(cameraRef.current.velocityX, -maxVelocity, maxVelocity);
                cameraRef.current.velocityY = clamp(cameraRef.current.velocityY, -maxVelocity, maxVelocity);
                cameraRef.current.x += cameraRef.current.velocityX * dt;
                cameraRef.current.y += cameraRef.current.velocityY * dt;

                const scaleSpringStrength = mix(54, 108, retargetBoost);
                const scaleDamping = mix(13.5, 21, retargetBoost);
                const accelScale = (cameraRef.current.focusScale - cameraRef.current.scale) * scaleSpringStrength
                    - cameraRef.current.velocityScale * scaleDamping;
                cameraRef.current.velocityScale += accelScale * dt;
                cameraRef.current.velocityScale = clamp(cameraRef.current.velocityScale, -1.6, 1.6);
                cameraRef.current.scale += cameraRef.current.velocityScale * dt;
                cameraRef.current.scale = clamp(cameraRef.current.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX);
            }

            const screenScale = cameraRef.current.scale;

            if (!staticMode) {
                const backgroundCenterX = backgroundScene.width * 0.5;
                const backgroundCenterY = backgroundScene.height * 0.5;
                const backgroundVerticalOffset = clamp(
                    viewport.height * FUME_BACKGROUND_VERTICAL_OFFSET_RATIO / Math.max(screenScale, 0.001),
                    48,
                    180,
                );
                const backgroundCameraX = mix(
                    backgroundCenterX,
                    cameraRef.current.x,
                    FUME_BACKGROUND_PARALLAX_X,
                );
                const backgroundCameraY = mix(
                    backgroundCenterY,
                    cameraRef.current.y,
                    FUME_BACKGROUND_PARALLAX_Y,
                ) - backgroundVerticalOffset;
                const backgroundScale = clamp(
                    screenScale * FUME_BACKGROUND_SCALE_FACTOR,
                    CAMERA_SCALE_MIN,
                    CAMERA_SCALE_MAX,
                );

                context.save();
                context.translate(viewportCenterX, viewportCenterY);
                context.scale(backgroundScale, backgroundScale);
                context.translate(-backgroundCameraX, -backgroundCameraY);
                drawFumeBackground({
                    context,
                    scene: backgroundScene,
                    theme,
                    time,
                    audioLevels: fumeBackgroundAudioLevels,
                    objectOpacityMultiplier: backgroundObjectOpacity * 2,
                    parallax: {
                        cameraX: backgroundCameraX,
                        cameraY: backgroundCameraY,
                        originX: backgroundCenterX,
                        originY: backgroundCenterY,
                        strength: 0.72,
                    },
                });
                context.restore();
            }

            context.save();
            context.translate(viewportCenterX, viewportCenterY);
            context.scale(screenScale, screenScale);
            context.translate(-cameraRef.current.x, -cameraRef.current.y);

            const activeGlowBoost = (theme.animationIntensity === 'chaotic'
                ? 1.15
                : theme.animationIntensity === 'calm'
                    ? 0.72
                    : 0.92) * glowIntensity;
            const passedGlowBase = (theme.animationIntensity === 'chaotic'
                ? 0.95
                : theme.animationIntensity === 'calm'
                    ? 0.35
                    : 0.62) * glowIntensity;

            if (showText) {
                for (const block of article.blocks) {
                const screenLeft = viewportCenterX + (block.x - cameraRef.current.x) * screenScale;
                const screenTop = viewportCenterY + (block.y - cameraRef.current.y) * screenScale;
                const screenRight = screenLeft + block.width * screenScale;
                const screenBottom = screenTop + block.height * screenScale;
                const overscan = 180;

                if (screenRight < -overscan || screenLeft > viewport.width + overscan || screenBottom < -overscan || screenTop > viewport.height + overscan) {
                    continue;
                }

                const waitingOpacity = block.variant === 'hero' ? 0.06 : 0.035;
                const activeOpacity = block.variant === 'hero' ? 0.985 : 0.92;
                const effectiveTextHoldStyle = textHoldRatio >= 1 ? 'standard' : 'dimmed';
                const passedStyle = resolvePassedTextStyle(block.variant, effectiveTextHoldStyle);
                const passedOpacity = passedStyle.opacity;
                const transitionPassedStyle = resolvePassedTextStyle(block.variant, 'standard');
                const baselineOffset = block.lineHeight * (isCJK(block.line.fullText) ? 0.52 : 0.5);
                const lineEndTime = getLineRenderEndTime(block.line);
                const nextLineStartTime = lines[block.sourceLineIndex + 1]?.startTime ?? null;
                const linePassCutoffTime = resolveLinePassCutoffTime(block.line, nextLineStartTime);
                const revealCompleteTime = block.line.endTime;
                const hasRevealCompleted = time >= revealCompleteTime;
                const hasPassCutoffReached = time >= linePassCutoffTime;
                const lineDuration = Math.max(lineEndTime - block.line.startTime, 0.18);
                const colorTrailDuration = clamp(
                    lineDuration * (block.variant === 'hero' ? 0.42 : 0.52),
                    0.45,
                    1.45,
                );
                const staticState = time < block.line.startTime
                    ? 'waiting'
                    : time >= lineEndTime + colorTrailDuration
                        ? 'passed'
                        : null;

                if (staticState) {
                    const snapshotScale = clamp(window.devicePixelRatio || 1, 1, 2);
                    const cacheStyleKey = staticState === 'passed' ? effectiveTextHoldStyle : 'base';
                    const cacheKey = `${block.id}:${staticState}:${cacheStyleKey}:${snapshotScale}`;
                    let snapshot = staticBlockSnapshotCacheRef.current.get(cacheKey);

                    if (!snapshot) {
                        snapshot = createStaticBlockSnapshot(
                            block,
                            theme,
                            staticState === 'waiting'
                                ? colorWithAlpha(theme.primaryColor, waitingOpacity)
                                : colorWithAlpha(theme.primaryColor, passedOpacity),
                            staticState === 'waiting'
                                ? 0
                                : (2 + block.fontPx * 0.1) * 0.65 * passedGlowBase * passedStyle.glowMultiplier,
                            staticState === 'waiting'
                                ? 'transparent'
                                : colorWithAlpha(theme.primaryColor, passedStyle.shadowAlphaBase),
                        ) ?? undefined;

                        if (snapshot) {
                            staticBlockSnapshotCacheRef.current.set(cacheKey, snapshot);
                        }
                    }

                    if (snapshot) {
                        if (staticState === 'passed' && effectiveTextHoldStyle === 'dimmed') {
                            const passedAt = lineEndTime + colorTrailDuration;
                            const baseDimAmount = resolvePassedDimAmount(time, passedAt, passedFadeDuration);
                            const dimAmount = baseDimAmount * (1 - overviewTextRestoreProgress);
                            const standardStyle = resolvePassedTextStyle(block.variant, 'standard');
                            const standardCacheKey = `${block.id}:passed:standard:${snapshotScale}`;
                            let standardSnapshot = staticBlockSnapshotCacheRef.current.get(standardCacheKey);

                            if (!standardSnapshot) {
                                standardSnapshot = createStaticBlockSnapshot(
                                    block,
                                    theme,
                                    colorWithAlpha(theme.primaryColor, standardStyle.opacity),
                                    (2 + block.fontPx * 0.1) * 0.65 * passedGlowBase * standardStyle.glowMultiplier,
                                    colorWithAlpha(theme.primaryColor, standardStyle.shadowAlphaBase),
                                ) ?? undefined;

                                if (standardSnapshot) {
                                    staticBlockSnapshotCacheRef.current.set(standardCacheKey, standardSnapshot);
                                }
                            }

                            if (standardSnapshot) {
                                if (dimAmount <= 0) {
                                    context.drawImage(
                                        standardSnapshot.canvas,
                                        block.x - standardSnapshot.padding,
                                        block.y - standardSnapshot.padding,
                                        block.width + standardSnapshot.padding * 2,
                                        block.height + standardSnapshot.padding * 2,
                                    );
                                    continue;
                                }

                                if (dimAmount < 1) {
                                    const previousAlpha = context.globalAlpha;
                                    context.globalAlpha = previousAlpha * (1 - dimAmount);
                                    context.drawImage(
                                        standardSnapshot.canvas,
                                        block.x - standardSnapshot.padding,
                                        block.y - standardSnapshot.padding,
                                        block.width + standardSnapshot.padding * 2,
                                        block.height + standardSnapshot.padding * 2,
                                    );
                                    context.globalAlpha = previousAlpha * dimAmount;
                                    context.drawImage(
                                        snapshot.canvas,
                                        block.x - snapshot.padding,
                                        block.y - snapshot.padding,
                                        block.width + snapshot.padding * 2,
                                        block.height + snapshot.padding * 2,
                                    );
                                    context.globalAlpha = previousAlpha;
                                    continue;
                                }
                            }
                        }

                        context.drawImage(
                            snapshot.canvas,
                            block.x - snapshot.padding,
                            block.y - snapshot.padding,
                            block.width + snapshot.padding * 2,
                            block.height + snapshot.padding * 2,
                        );
                        continue;
                    }
                }

                const printedCount = resolvePrintedGraphemeCount(
                    block.line,
                    block.wordRanges,
                    block.graphemes.length,
                    time,
                );
                const totalGraphemeCount = block.graphemes.length;

                context.save();
                context.font = buildCanvasFont(block, theme);
                context.textAlign = 'left';
                context.textBaseline = 'middle';

                const isLineActive = time >= block.line.startTime && time <= linePassCutoffTime;
                if (isLineActive) {
                    const lineProgress = resolveVisualProgressWithCutoff(
                        block.line.startTime,
                        lineDuration,
                        time,
                        linePassCutoffTime,
                    );
                    const lineGlowEnvelope = resolveDelayedGlowEnvelope(lineProgress, 0.8);
                    const lineGlowAlpha = (
                        (block.variant === 'hero' ? 0.16 : 0.12)
                        + lineGlowEnvelope * (block.variant === 'hero' ? 0.26 : 0.2)
                    ) * glowIntensity;
                    const lineGlowBlur = (
                        (block.variant === 'hero' ? 12 : 8)
                        + lineGlowEnvelope * (block.fontPx * (block.variant === 'hero' ? 0.7 : 0.52))
                    ) * glowIntensity;
                    const lineGlowColor = colorWithAlpha(theme.accentColor, lineGlowAlpha);

                    context.save();
                    context.fillStyle = lineGlowColor;
                    context.shadowBlur = lineGlowBlur;
                    context.shadowColor = colorWithAlpha(theme.accentColor, lineGlowAlpha * 1.35);

                    for (const renderLine of block.renderLines) {
                        const glowBaseX = block.x + renderLine.left;
                        const glowBaseY = block.y + renderLine.top + baselineOffset;

                        for (const segment of renderLine.segments) {
                            if (segment.text.trim().length === 0) {
                                continue;
                            }

                            context.fillText(segment.text, glowBaseX + segment.x, glowBaseY);
                        }
                    }

                    context.restore();
                }

                for (const renderLine of block.renderLines) {
                    const baseX = block.x + renderLine.left;
                    const baseY = block.y + renderLine.top + baselineOffset;

                    for (const segment of renderLine.segments) {
                        let runStart = -1;
                        let runFillStyle = '';
                        let runShadowBlur = 0;
                        let runShadowColor = 'transparent';
                        let runStyleKey = '';

                        const flushRun = (segmentEnd: number) => {
                            if (runStart < 0 || !runStyleKey || segmentEnd <= runStart) {
                                return;
                            }

                            const localStart = runStart - renderLine.start;
                            const localEnd = segmentEnd - renderLine.start;
                            const runText = renderLine.graphemes.slice(localStart, localEnd).join('');
                            if (!runText || runText.trim().length === 0 && runFillStyle === '') {
                                runStart = -1;
                                runStyleKey = '';
                                return;
                            }

                            context.fillStyle = runFillStyle;
                            context.shadowBlur = runShadowBlur;
                            context.shadowColor = runShadowColor;
                            drawRenderTextRun(
                                context,
                                renderLine,
                                segment,
                                localStart,
                                localEnd,
                                baseX,
                                baseY,
                            );
                            context.shadowBlur = 0;
                            context.shadowColor = 'transparent';
                            runStart = -1;
                            runStyleKey = '';
                        };

                        for (let globalOffset = segment.start; globalOffset < segment.end; globalOffset += 1) {
                            const graphemeIndex = globalOffset - renderLine.start;
                            const grapheme = renderLine.graphemes[graphemeIndex]!;
                            const rangeIndex = block.wordRangeIndexByOffset[globalOffset] ?? -1;
                            const range = rangeIndex >= 0 ? block.wordRanges[rangeIndex]! : null;
                            const colorRangeIndex = block.colorRangeIndexByOffset[globalOffset] ?? -1;
                            const colorRange = colorRangeIndex >= 0 ? block.wordRanges[colorRangeIndex]! : range;
                            const isPrinted = hasRevealCompleted || globalOffset < printedCount;
                            const isFrontier = printedCount > 0
                                && globalOffset === printedCount
                                && printedCount < totalGraphemeCount
                                && !hasRevealCompleted
                                && !hasPassCutoffReached;

                            let alpha = isPrinted
                                ? activeOpacity
                                : isFrontier
                                    ? 0.82
                                    : waitingOpacity;
                            let shadowBlur = 0;
                            let shadowColor = 'transparent';
                            let fillStyle = colorWithAlpha(theme.primaryColor, alpha);

                            if (range) {
                                const wordDuration = Math.max(range.word.endTime - range.word.startTime, 0.08);
                                const wordProgress = clamp((time - range.word.startTime) / wordDuration, 0, 1);
                                const glyphCount = Math.max(range.end - range.start, 1);
                                const glyphIndexInRange = globalOffset - range.start;
                                const glyphProgress = clamp(wordProgress * glyphCount - glyphIndexInRange + 0.16, 0, 1);
                                const easedGlyphProgress = easeOutCubic(glyphProgress);
                                const activeColor = getActiveColor((colorRange ?? range).word.text, theme);
                                const glyphTrailStart = range.word.startTime + ((glyphIndexInRange + 0.18) / glyphCount) * wordDuration;
                                const colorTrailPhase = resolveVisualProgressWithCutoff(
                                    glyphTrailStart,
                                    colorTrailDuration,
                                    time,
                                    linePassCutoffTime,
                                );
                                const colorTrailProgress = Math.pow(colorTrailPhase, 1.35);

                                if (hasPassCutoffReached) {
                                    alpha = mix(activeOpacity, transitionPassedStyle.opacity, colorTrailProgress);
                                    fillStyle = mixColors(activeColor, theme.primaryColor, 0.18 + colorTrailProgress * 0.82, alpha);
                                    shadowBlur = (2 + block.fontPx * 0.1) * (1 - colorTrailProgress * 0.35) * passedGlowBase * transitionPassedStyle.glowMultiplier;
                                    shadowColor = colorWithAlpha(
                                        mixColors(activeColor, theme.primaryColor, 0.55 + colorTrailProgress * 0.45),
                                        transitionPassedStyle.shadowAlphaBase + (1 - colorTrailProgress) * transitionPassedStyle.shadowAlphaTrail,
                                    );
                                } else if (time < range.word.startTime) {
                                    alpha = waitingOpacity;
                                    fillStyle = colorWithAlpha(theme.primaryColor, alpha);
                                } else if (time <= glyphTrailStart) {
                                    alpha = mix(waitingOpacity, activeOpacity, easedGlyphProgress);
                                    fillStyle = mixColors(theme.primaryColor, activeColor, 0.22 + easedGlyphProgress * 0.78, alpha);
                                    shadowBlur = (4 + block.fontPx * 0.22) * easedGlyphProgress * activeGlowBoost;
                                    shadowColor = colorWithAlpha(activeColor, 0.4 + easedGlyphProgress * 0.44);
                                } else {
                                    alpha = mix(activeOpacity, transitionPassedStyle.opacity, colorTrailProgress);
                                    fillStyle = mixColors(activeColor, theme.primaryColor, 0.18 + colorTrailProgress * 0.82, alpha);
                                    shadowBlur = (2 + block.fontPx * 0.1) * (1 - colorTrailProgress * 0.35) * passedGlowBase * transitionPassedStyle.glowMultiplier;
                                    shadowColor = colorWithAlpha(
                                        mixColors(activeColor, theme.primaryColor, 0.55 + colorTrailProgress * 0.45),
                                        transitionPassedStyle.shadowAlphaBase + (1 - colorTrailProgress) * transitionPassedStyle.shadowAlphaTrail,
                                    );
                                }

                                if (showPrintStamp && grapheme.trim().length > 0) {
                                    const glyphWindowDuration = Math.max(wordDuration / glyphCount, 0.04);
                                    const activationLeadDuration = clamp(
                                        Math.min(glyphWindowDuration * 0.86, lineDuration * 0.16),
                                        0.055,
                                        block.variant === 'hero' ? 0.2 : 0.16,
                                    );
                                    const activationReleaseDuration = activationLeadDuration * 0.42;
                                    const activationWindowStart = glyphTrailStart - activationLeadDuration;
                                    const activationWindowEnd = glyphTrailStart + activationReleaseDuration;
                                    const glyphAdvance = resolveSegmentGlyphAdvance(segment, globalOffset);
                                    const stampProgress = resolveVisualProgressWithCutoff(
                                        activationWindowStart,
                                        activationWindowEnd - activationWindowStart,
                                        time,
                                        linePassCutoffTime,
                                    );

                                    if (stampProgress > 0 && stampProgress < 1) {
                                        const glyphTrailPhase = resolveVisualProgressWithCutoff(
                                            glyphTrailStart,
                                            Math.max(activationWindowEnd - glyphTrailStart, 0.001),
                                            time,
                                            linePassCutoffTime,
                                        );
                                        const isDropping = glyphTrailPhase <= 0;
                                        const dropProgress = isDropping
                                            ? easeOutCubic(
                                                resolveVisualProgressWithCutoff(
                                                    activationWindowStart,
                                                    Math.max(glyphTrailStart - activationWindowStart, 0.001),
                                                    time,
                                                    linePassCutoffTime,
                                                ),
                                            )
                                            : 1;
                                        const fadeProgress = isDropping
                                            ? 0
                                            : easeInOutCubic(glyphTrailPhase);
                                        const blockPulse = isDropping
                                            ? mix(0.18, 1, Math.pow(dropProgress, 0.78))
                                            : Math.pow(1 - fadeProgress, 1.2);
                                        const glyphVisualWidth = Math.max(
                                            glyphAdvance * 0.88,
                                            isCJK(grapheme) ? block.fontPx * 0.56 : block.fontPx * 0.38,
                                        );
                                        const blockCenterX = baseX + segment.x + resolveSegmentGlyphOffset(segment, globalOffset) + glyphAdvance * 0.5;
                                        const dropDistance = block.lineHeight * (block.variant === 'hero' ? 0.24 : 0.2);
                                        const activationBlockAlpha = blockPulse * (block.variant === 'hero' ? 0.82 : 0.72);
                                        const activationBlockWidth = glyphVisualWidth + block.fontPx * (block.variant === 'hero' ? 0.18 : 0.12);
                                        const activationBlockHeight = block.fontPx * (block.variant === 'hero' ? 0.72 : 0.62);
                                        const activationBlockY = baseY
                                            - block.fontPx * 0.38
                                            - mix(dropDistance, 0, dropProgress);
                                        const activationBlockBlur = (8 + block.fontPx * 0.24) * blockPulse * activeGlowBoost;

                                        if (activationBlockWidth > 0) {
                                            const blockLeft = blockCenterX - activationBlockWidth * 0.5;
                                            context.save();
                                            context.fillStyle = colorWithAlpha(activeColor, activationBlockAlpha);
                                            context.shadowBlur = activationBlockBlur;
                                            context.shadowColor = colorWithAlpha(activeColor, 0.56 * blockPulse);
                                            context.fillRect(
                                                blockLeft,
                                                activationBlockY - activationBlockHeight * 0.5,
                                                activationBlockWidth,
                                                activationBlockHeight,
                                            );
                                            context.restore();
                                        }
                                    }
                                }
                            }

                            if (alpha <= 0.002) {
                                flushRun(globalOffset);
                                continue;
                            }

                            const styleKey = buildTextStyleKey(fillStyle, shadowBlur, shadowColor);
                            if (runStart < 0) {
                                runStart = globalOffset;
                                runFillStyle = fillStyle;
                                runShadowBlur = shadowBlur;
                                runShadowColor = shadowColor;
                                runStyleKey = styleKey;
                                continue;
                            }

                            if (styleKey !== runStyleKey) {
                                flushRun(globalOffset);
                                runStart = globalOffset;
                                runFillStyle = fillStyle;
                                runShadowBlur = shadowBlur;
                                runShadowColor = shadowColor;
                                runStyleKey = styleKey;
                            }
                        }

                        flushRun(segment.end);
                    }
                }

                context.restore();
            }
            }
            context.restore();

            frameId = window.requestAnimationFrame(draw);
        };

        draw();
        return () => {
            window.cancelAnimationFrame(frameId);
            lastFrameAt = null;
        };
    }, [
        article,
        audioBands,
        audioPower,
        backgroundScene,
        backgroundObjectOpacity,
        cameraSpeed,
        currentTime,
        glowIntensity,
        passedFadeDuration,
        showPrintStamp,
        showText,
        staticMode,
        textHoldRatio,
        theme,
        viewport.height,
        viewport.width,
    ]);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            coverUrl={coverUrl}
            useCoverColorBg={useCoverColorBg}
            seed={seed}
            staticMode={staticMode}
            disableGeometricBackground={resolvedFumeTuning.disableGeometricBackground}
            backgroundOpacity={backgroundOpacity}
            onBack={onBack}
        >
            <div ref={viewportRef} className="relative z-10 h-full w-full pointer-events-none">
                {(article || lines.length === 0) && (
                    <motion.div
                        initial={false}
                        animate={{
                            opacity: 1,
                            scale: article && showText ? (hasPrintedContent ? 1 : 0.985) : 1,
                        }}
                        transition={{ duration: 0.45, ease: 'easeOut' }}
                        className="absolute left-1/2 top-0 -translate-x-1/2"
                        style={{
                            width: viewport.width,
                            height: viewport.height,
                        }}
                    >
                        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
                    </motion.div>
                )}

                {isLayoutPending && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        <div
                            className="flex min-w-40 flex-col items-center gap-4 rounded-3xl border px-6 py-5"
                            style={{
                                backgroundColor: theme.backgroundColor,
                                borderColor: colorWithAlpha(theme.secondaryColor, 0.24),
                                boxShadow: `0 18px 60px ${colorWithAlpha(theme.backgroundColor, 0.52)}`,
                            }}
                        >
                            <Hourglass
                                size={24}
                                className="animate-pulse"
                                style={{ color: colorWithAlpha(theme.primaryColor, 0.78) }}
                            />
                            <div className="flex w-28 flex-col gap-2.5">
                                <div
                                    className="h-2 rounded-full animate-pulse"
                                    style={{ backgroundColor: colorWithAlpha(theme.primaryColor, 0.32) }}
                                />
                                <div
                                    className="h-2 rounded-full animate-pulse"
                                    style={{
                                        width: '78%',
                                        backgroundColor: colorWithAlpha(theme.primaryColor, 0.22),
                                    }}
                                />
                                <div
                                    className="h-2 rounded-full animate-pulse"
                                    style={{
                                        width: '56%',
                                        backgroundColor: colorWithAlpha(theme.secondaryColor, 0.2),
                                    }}
                                />
                            </div>
                        </div>
                    </motion.div>
                )}
            </div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={runtime.activeLine}
                recentCompletedLine={runtime.recentCompletedLine}
                nextLines={runtime.nextLines}
                theme={theme}
                translationFontSize={translationFontSize}
                upcomingFontSize={upcomingFontSize}
                opacity={0.48}
                isPlayerChromeHidden={isPlayerChromeHidden}
            />
        </VisualizerShell>
    );
};

export default VisualizerFume;
