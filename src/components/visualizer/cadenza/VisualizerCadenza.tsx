import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { layoutWithLines, prepareWithSegments, type LayoutLine, type LayoutCursor, type PreparedTextWithSegments } from '@chenglou/pretext';
import { AudioBands, DEFAULT_CADENZA_TUNING, Line, Theme, Word as WordType, type CadenzaTuning } from '../../../types';
import { getLineRenderEndTime, getLineTransitionTiming, type LineTransitionTiming } from '../../../utils/lyrics/renderHints';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { prepareActiveAndUpcoming, useVisualizerRuntime } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';

// This is the heavy layout mode.
// The line does not just show up and animate; we first prebuild the active/upcoming lines,
// run them through pretext, split them into fragments/placements, then mirror those placements into DOM + canvas layers.
// So when something looks weird here, the bug is usually either in the prepare step or in the placement-to-render sync step.
//
// For a single lyric line, the state flow is:
// waiting -> placements are ready, but keep them dim / offset so the line still feels "not entered".
// active -> this is the main event, drive beam, glow, emphasis, and body color here.
// passed -> line already sang, keep some drift and residue so it fades out gracefully instead of snapping away.
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
    cadenzaTuning?: CadenzaTuning;
    lyricsFontScale?: number;
    isPlayerChromeHidden?: boolean;
    paused?: boolean;
    onBack?: () => void;
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
    color: string;
}

interface WordFragment {
    wordIndex: number;
    lineIndex: number;
    word: WordType;
    text: string;
    color: string;
    startX: number;
    endX: number;
    fragmentStartInWord: number;
    fragmentEndInWord: number;
    wordGraphemeCount: number;
    fragmentIndexInWord: number;
    fragmentCountInWord: number;
    isPrimaryFragment: boolean;
    isSplitAcrossLines: boolean;
}

interface WordPlacement {
    id: string;
    wordIndex: number;
    word: WordType;
    text: string;
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotate: number;
    scale: number;
    passedRotate: number;
    passedDriftX: number;
    passedDriftY: number;
    entryOffsetX: number;
    entryOffsetY: number;
    fragmentStartInWord: number;
    fragmentEndInWord: number;
    wordGraphemeCount: number;
    emphasis: number;
    isInterlude: boolean;
}

interface AnimatedPlacementState {
    x: number;
    y: number;
    rotation: number;
    scale: number;
    bodyAlpha: number;
    blur: number;
    activeMix: number;
    glowAlpha: number;
}

interface OverlayWordNodes {
    outer: HTMLDivElement;
    inner: HTMLDivElement;
    body: HTMLSpanElement;
    glow: HTMLSpanElement;
    glyphSpans: HTMLSpanElement[];
    glyphSignature: string;
}

interface PreparedState {
    prepared: PreparedTextWithSegments;
    text: string;
    font: string;
    fontPx: number;
    lineHeight: number;
    maxWidth: number;
    layout: ReturnType<typeof layoutWithLines>;
    segmentMetas: SegmentMeta[];
    graphemes: string[];
    placements: WordPlacement[];
}

interface PreparedStateCacheContext {
    showText: boolean;
    viewport: { width: number; height: number; };
    theme: Theme;
    tuning: Pick<CadenzaTuning, 'fontScale' | 'widthRatio'>;
}

interface ResolvedLineRenderTiming {
    renderHints: NonNullable<Line['renderHints']> | null;
    lineRenderEndTime: number;
    wordRevealMode: 'normal' | 'fast' | 'instant';
    lastWordEndTime: number;
    linePassHold: number;
    transitionTiming: LineTransitionTiming;
}

const createOverlayWordNodes = (): OverlayWordNodes => {
    const outer = document.createElement('div');
    outer.className = 'absolute left-0 top-0';
    outer.setAttribute('aria-hidden', 'true');

    const inner = document.createElement('div');
    inner.className = 'whitespace-nowrap';
    inner.style.lineHeight = '1';
    inner.style.display = 'inline-block';
    inner.style.position = 'relative';

    const body = document.createElement('span');
    body.style.lineHeight = '1';
    body.style.display = 'block';
    body.style.position = 'relative';
    body.style.zIndex = '1';
    body.style.whiteSpace = 'pre';

    const glow = document.createElement('span');
    glow.style.color = 'transparent';
    glow.style.lineHeight = '1';
    glow.style.display = 'block';
    glow.style.position = 'absolute';
    glow.style.inset = '0';
    glow.style.zIndex = '0';
    glow.style.pointerEvents = 'none';
    glow.style.whiteSpace = 'pre';

    inner.appendChild(body);
    inner.appendChild(glow);
    outer.appendChild(inner);

    return {
        outer,
        inner,
        body,
        glow,
        glyphSpans: [],
        glyphSignature: '',
    };
};

const syncOverlayGlyphSpans = (nodes: OverlayWordNodes, texts: string[]) => {
    const glyphSignature = texts.join('\u0001');
    if (nodes.glyphSignature === glyphSignature) {
        return;
    }

    nodes.glow.replaceChildren();
    nodes.glyphSpans = texts.map(text => {
        const span = document.createElement('span');
        span.textContent = text;
        span.style.color = 'transparent';
        span.style.lineHeight = '1';
        nodes.glow.appendChild(span);
        return span;
    });
    nodes.glyphSignature = glyphSignature;
};

const clearOverlayWordNodes = (overlayNodes: Map<string, OverlayWordNodes>) => {
    overlayNodes.forEach(nodes => {
        nodes.outer.remove();
    });
    overlayNodes.clear();
};

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
const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
const easeInOutQuad = (value: number) => {
    const normalized = clamp(value, 0, 1);
    return normalized < 0.5
        ? 2 * normalized * normalized
        : 1 - Math.pow(-2 * normalized + 2, 2) / 2;
};
const ACTIVE_PULSE_FREQUENCY = 10;

const isCJK = (text: string) => /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(text);

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

const getWordStatus = (time: number, lineTiming: ResolvedLineRenderTiming, word: WordType) => {
    const lookahead = lineTiming.wordRevealMode === 'fast'
        ? 0.045
        : lineTiming.wordRevealMode === 'instant'
            ? 0
            : 0.18;
    const activeEndTime = lineTiming.wordRevealMode === 'instant'
        ? lineTiming.lineRenderEndTime
        : word.endTime;

    if (time >= word.startTime - lookahead && time <= activeEndTime) {
        return 'active' as const;
    }
    if (time > activeEndTime) {
        return 'passed' as const;
    }
    return 'waiting' as const;
};

const getWordProgress = (time: number, wordRevealMode: ResolvedLineRenderTiming['wordRevealMode'], word: WordType) => {
    if (wordRevealMode === 'instant') {
        return time < word.startTime ? 0 : 1;
    }

    const minDuration = wordRevealMode === 'fast' ? 0.045 : 0.01;
    const duration = Math.max(word.endTime - word.startTime, minDuration);
    return clamp((time - word.startTime) / duration, 0, 1);
};

const getClassicKeyframedGlow = (progress: number) => {
    if (progress <= 0 || progress >= 1) {
        return 0;
    }

    if (progress < 0.3) {
        return easeOutCubic(progress / 0.3);
    }

    return 1 - clamp((progress - 0.3) / 0.7, 0, 1);
};

const getClassicGlowEnvelope = (time: number, lineTiming: ResolvedLineRenderTiming, word: WordType) => {
    if (lineTiming.wordRevealMode === 'instant') {
        const activeEndTime = lineTiming.lineRenderEndTime;
        if (time < word.startTime || time > activeEndTime) {
            return 0;
        }

        const pulseProgress = clamp((time - word.startTime) / 0.067, 0, 1);
        return getClassicKeyframedGlow(pulseProgress);
    }

    if (lineTiming.wordRevealMode === 'fast') {
        const duration = Math.max(word.endTime - word.startTime, 0.045);

        if (time < word.startTime) {
            return 0;
        }

        if (time <= word.endTime) {
            const progress = clamp((time - word.startTime) / duration, 0, 1);

            if (progress < 0.14) {
                return easeOutCubic(progress / 0.14);
            }

            if (progress < 0.82) {
                return 1;
            }

            return mix(1, 0.92, (progress - 0.82) / 0.18);
        }

        const fadeOut = clamp((time - word.endTime) / 0.14, 0, 1);
        return Math.pow(1 - fadeOut, 2);
    }

    const duration = Math.max(word.endTime - word.startTime, 0.1);

    if (time < word.startTime) {
        return 0;
    }

    if (time <= word.endTime) {
        const progress = clamp((time - word.startTime) / duration, 0, 1);

        if (progress < 0.18) {
            return easeOutCubic(progress / 0.18);
        }

        if (progress < 0.9) {
            return 1;
        }

        return mix(1, 0.9, (progress - 0.9) / 0.1);
    }

    const fadeOut = clamp((time - word.endTime) / 0.9, 0, 1);
    return 0.9 * Math.pow(1 - fadeOut, 2);
};

const getClassicCharGlow = (
    time: number,
    word: WordType,
    glyphIndex: number,
    glyphCount: number,
) => {
    const duration = Math.max(word.endTime - word.startTime, 0.1);
    const singleDuration = duration / Math.max(glyphCount, 1);
    const animationDuration = singleDuration * 6;
    const elapsed = time - word.startTime - singleDuration * glyphIndex;
    const activeGlow = elapsed <= 0 ? 0 : getClassicKeyframedGlow(elapsed / animationDuration);

    if (time <= word.endTime) {
        return activeGlow;
    }

    const fadeOut = Math.pow(1 - clamp((time - word.endTime) / 0.9, 0, 1), 2);
    return activeGlow * fadeOut;
};

const getClassicBodyMix = (time: number, lineTiming: ResolvedLineRenderTiming, word: WordType) => {
    if (lineTiming.wordRevealMode === 'instant') {
        if (time < word.startTime) {
            return 0;
        }

        return time <= lineTiming.lineRenderEndTime ? 1 : 0;
    }

    if (time < word.startTime) {
        return 0;
    }

    if (time <= word.endTime) {
        return getWordProgress(time, lineTiming.wordRevealMode, word);
    }

    const fadeOut = clamp((time - word.endTime) / (lineTiming.wordRevealMode === 'fast' ? 0.12 : 0.8), 0, 1);
    return 1 - fadeOut;
};

const getClassicLineEnvelope = (time: number, line: Line | null, lineTiming: ResolvedLineRenderTiming | null) => {
    if (!line) {
        return {
            opacity: 1,
            scale: 1,
            blur: 0,
        };
    }

    const renderHints = lineTiming?.renderHints ?? null;
    const lineEndTime = lineTiming?.lineRenderEndTime ?? line.endTime;
    const linePassStart = Math.max(lineTiming?.lastWordEndTime ?? line.endTime, line.startTime) + (lineTiming?.linePassHold ?? 0);

    if (renderHints?.lineTransitionMode === 'none') {
        return {
            opacity: 1,
            scale: 1,
            blur: 0,
        };
    }

    if (renderHints?.lineTransitionMode === 'fast') {
        const enterDuration = lineTiming.transitionTiming.enterDuration;
        const exitDuration = lineTiming.transitionTiming.exitDuration;
        const exitStart = Math.max(line.startTime + enterDuration + 0.01, linePassStart, lineEndTime - exitDuration);
        const enterProgress = easeOutCubic(clamp((time - line.startTime) / enterDuration, 0, 1));
        let opacity = mix(0.65, 1, enterProgress);
        let scale = mix(0.97, 1, enterProgress);
        let blur = mix(4, 0, enterProgress);

        const exitProgress = easeOutCubic(clamp((time - exitStart) / exitDuration, 0, 1));
        if (exitProgress > 0) {
            opacity = mix(opacity, 0, exitProgress);
            scale = mix(scale, 1.03, exitProgress);
            blur = Math.max(blur, mix(0, 6, exitProgress));
        }

        return {
            opacity: clamp(opacity, 0, 1),
            scale,
            blur,
        };
    }

    const enterDuration = lineTiming.transitionTiming.enterDuration;
    const exitDuration = lineTiming.transitionTiming.exitDuration;
    const preEnter = Math.min(0.1, enterDuration * 0.35);

    const enterProgress = easeOutCubic(clamp((time - (line.startTime - preEnter)) / (enterDuration + preEnter), 0, 1));
    let opacity = mix(0, 1, enterProgress);
    let scale = mix(0.9, 1, enterProgress);
    let blur = mix(10, 0, enterProgress);

    const exitStart = Math.max(linePassStart, lineEndTime - exitDuration);
    const exitProgress = easeOutCubic(clamp((time - exitStart) / exitDuration, 0, 1));
    if (exitProgress > 0) {
        opacity *= 1 - exitProgress;
        scale = mix(scale, 1.1, exitProgress);
        blur = Math.max(blur, mix(0, 20, exitProgress));
    }

    return {
        opacity: clamp(opacity, 0, 1),
        scale,
        blur,
    };
};

const getClassicPassedDrift = (time: number, word: WordType) => {
    if (time <= word.endTime) {
        return 0;
    }

    return easeInOutQuad(clamp((time - word.endTime) / 5, 0, 1));
};

const resolveLineRenderTiming = (line: Line): ResolvedLineRenderTiming => {
    // Cadenza needs more than just line endTime.
    // It needs to know when the line should stop feeling "active" and how long the pass-hold should last.
    const renderHints = line.renderHints ?? null;
    const wordRevealMode = renderHints?.wordRevealMode ?? 'normal';
    const lastWord = line.words[line.words.length - 1];
    const rawDuration = renderHints?.rawDuration ?? Math.max(line.endTime - line.startTime, 0);
    const transitionTiming = getLineTransitionTiming(
        rawDuration,
        renderHints?.lineTransitionMode ?? 'normal',
        wordRevealMode
    );

    return {
        renderHints,
        lineRenderEndTime: renderHints?.renderEndTime ?? line.endTime,
        wordRevealMode,
        lastWordEndTime: lastWord?.endTime ?? line.endTime,
        linePassHold: transitionTiming.linePassHold,
        transitionTiming,
    };
};

const buildDomTextShadow = (color: string, intensity: number, blurScale = 1) => {
    const glow = clamp(intensity, 0, 1.6);
    if (glow <= 0.01) {
        return 'none';
    }

    return [
        `0 0 40px ${colorWithAlpha(color, Math.min(0.98, glow))}`,
        `0 0 40px ${colorWithAlpha(color, Math.min(0.92, glow * 0.92))}`,
        `0 0 40px ${colorWithAlpha(color, Math.min(0.35, glow * 0.26))}`,
    ].join(', ');
};

const chooseFontPx = (width: number, line: Line) => {
    const graphemeCount = splitGraphemes(line.fullText).length || 1;
    const wordCount = line.words.length || 1;
    const widthBase = clamp(width * 0.086, 34, 94);
    const lengthPenalty = graphemeCount > 12 ? Math.min((graphemeCount - 12) * 1.8, 34) : 0;
    const densityPenalty = wordCount > 7 ? Math.min((wordCount - 7) * 1.5, 18) : 0;
    return clamp(widthBase - lengthPenalty - densityPenalty, 28, 104);
};

const buildCanvasFont = (theme: Theme, fontPx: number) => `700 ${fontPx}px ${resolveThemeFontStack(theme)}`;

const buildPreparedState = (
    line: Line,
    context: PreparedStateCacheContext,
) => {
    const { showText, viewport, theme, tuning } = context;

    if (!showText || viewport.width <= 0 || viewport.height <= 0) {
        return null;
    }

    const fontPx = clamp(chooseFontPx(viewport.width, line) * tuning.fontScale, 24, 132);
    const font = buildCanvasFont(theme, fontPx);
    // This is the expensive part of the mode.
    // Once a line reaches here, we fully measure it, wrap it, split it, and convert it into placement-ready fragments.
    const prepared = prepareWithSegments(line.fullText, font);
    const text = prepared.segments.join('');
    const { segmentMetas, graphemes } = buildSegmentMetas(prepared);
    const lineHeight = Math.round(fontPx * (isCJK(text) ? 1.22 : 1.1));
    const availableWidth = Math.max(viewport.width - 48, 120);
    const minWidth = Math.min(220, availableWidth);
    const wrapCompression = graphemes.length > 12
        ? clamp(0.92 - (graphemes.length - 12) * 0.018, 0.62, 0.92)
        : 0.92;
    const compactWidthRatio = tuning.widthRatio * wrapCompression;
    const maxWidth = clamp(Math.min(viewport.width * compactWidthRatio, 820), minWidth, availableWidth);
    const layout = layoutWithLines(prepared, maxWidth, lineHeight);
    const ranges = findWordRanges(line, graphemes, theme);
    const lineFragments = buildLineFragments(prepared, segmentMetas, graphemes, layout, ranges);
    const placements = buildWordPlacements(
        lineFragments,
        fontPx,
        lineHeight,
        maxWidth,
        theme.animationIntensity,
        line.startTime * 1000,
        line.fullText === '......',
    );

    return {
        prepared,
        text,
        font,
        fontPx,
        lineHeight,
        maxWidth,
        layout,
        segmentMetas,
        graphemes,
        placements,
    };
};

const getActiveColor = (wordText: string, theme: Theme) => {
    if (!theme.wordColors || theme.wordColors.length === 0) {
        return theme.accentColor;
    }

    const cleanCurrent = wordText.trim();
    const matched = theme.wordColors.find(entry => {
        const target = entry.word;
        if (isCJK(cleanCurrent)) {
            return target.includes(cleanCurrent);
        }

        const targetWords = target.split(/\s+/).map(value => value.toLowerCase().replace(/[^\w]/g, ''));
        const normalizedCurrent = cleanCurrent.toLowerCase().replace(/[^\w]/g, '');
        return targetWords.includes(normalizedCurrent);
    });

    return matched?.color ?? theme.accentColor;
};

const buildSegmentMetas = (prepared: PreparedTextWithSegments) => {
    // pretext works in segments, but most animation logic wants global grapheme offsets.
    // This bridge lets us move back and forth between those two coordinate systems.
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

    return { segmentMetas, graphemes };
};

const findWordRanges = (line: Line, graphemes: string[], theme: Theme) => {
    // We have to remap lyric words back onto the grapheme stream after pretext segmentation.
    // If this goes wrong, glow/highlight gets assigned to the wrong text slice.
    const ranges: WordRange[] = [];
    let cursor = 0;

    for (let wordIndex = 0; wordIndex < line.words.length; wordIndex++) {
        const word = line.words[wordIndex]!;
        const target = splitGraphemes(word.text);
        let start = -1;

        for (let i = cursor; i <= graphemes.length - target.length; i++) {
            let isMatch = true;
            for (let j = 0; j < target.length; j++) {
                if (graphemes[i + j] !== target[j]) {
                    isMatch = false;
                    break;
                }
            }
            if (isMatch) {
                start = i;
                break;
            }
        }

        if (start === -1) {
            start = clamp(cursor, 0, graphemes.length);
        }

        const end = clamp(start + target.length, start, graphemes.length);

        ranges.push({
            wordIndex,
            word,
            start,
            end,
            color: getActiveColor(word.text, theme),
        });

        cursor = end;
    }

    return ranges;
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
        for (let i = localStart; i < localEnd; i++) {
            width += breakableWidths[i] ?? 0;
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

    for (let segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex++) {
        const meta = segmentMetas[segmentIndex]!;
        if (endOffset <= meta.graphemeStart) break;
        if (startOffset >= meta.graphemeEnd) continue;

        const sliceStart = Math.max(startOffset, meta.graphemeStart);
        const sliceEnd = Math.min(endOffset, meta.graphemeEnd);
        width += getPartialSegmentWidth(prepared, segmentIndex, meta, sliceStart, sliceEnd);
    }

    return width;
};

const buildLineFragments = (
    prepared: PreparedTextWithSegments,
    segmentMetas: SegmentMeta[],
    graphemes: string[],
    layout: ReturnType<typeof layoutWithLines>,
    ranges: WordRange[],
) => {
    // Wrapped layout lines can cut straight through a lyric word.
    // So first build fragments per wrapped line, then later decide which fragments are still "the same word".
    const lineViews = layout.lines.map(line => {
        const lineStart = cursorToGlobalOffset(line.start, segmentMetas);
        const lineEnd = cursorToGlobalOffset(line.end, segmentMetas);

        const fragments = ranges.flatMap(range => {
            if (range.end <= lineStart || range.start >= lineEnd) {
                return [];
            }

            const fragmentStart = Math.max(range.start, lineStart);
            const fragmentEnd = Math.min(range.end, lineEnd);
            return [{
                wordIndex: range.wordIndex,
                lineIndex: 0,
                word: range.word,
                text: graphemes.slice(fragmentStart, fragmentEnd).join(''),
                color: range.color,
                startX: widthBetweenOffsets(prepared, segmentMetas, lineStart, fragmentStart),
                endX: widthBetweenOffsets(prepared, segmentMetas, lineStart, fragmentEnd),
                fragmentStartInWord: fragmentStart - range.start,
                fragmentEndInWord: fragmentEnd - range.start,
                wordGraphemeCount: Math.max(range.end - range.start, 1),
                fragmentIndexInWord: 0,
                fragmentCountInWord: 1,
                isPrimaryFragment: true,
                isSplitAcrossLines: false,
            }];
        });

        return { line, lineStart, lineEnd, fragments };
    });

    const fragmentCountByWord = new Map<number, number>();
    lineViews.forEach(lineView => {
        lineView.fragments.forEach(fragment => {
            fragmentCountByWord.set(
                fragment.wordIndex,
                (fragmentCountByWord.get(fragment.wordIndex) ?? 0) + 1,
            );
        });
    });

    const seenFragmentsByWord = new Map<number, number>();

    return lineViews.map((lineView, lineIndex) => ({
        ...lineView,
        fragments: lineView.fragments.map(fragment => {
            const fragmentCountInWord = fragmentCountByWord.get(fragment.wordIndex) ?? 1;
            const fragmentIndexInWord = seenFragmentsByWord.get(fragment.wordIndex) ?? 0;
            seenFragmentsByWord.set(fragment.wordIndex, fragmentIndexInWord + 1);

            return {
                ...fragment,
                lineIndex,
                fragmentIndexInWord,
                fragmentCountInWord,
                isPrimaryFragment: fragmentIndexInWord === 0,
                isSplitAcrossLines: fragmentCountInWord > 1,
            };
        }),
    }));
};

const buildEmphasisMap = (
    lineData: Array<{
        line: LayoutLine;
        lineStart: number;
        lineEnd: number;
        fragments: WordFragment[];
    }>,
    isInterlude: boolean,
) => {
    const emphasisMap = new Map<number, number>();

    if (isInterlude) {
        return emphasisMap;
    }

    const primaryFragments = lineData
        .flatMap(lineView => lineView.fragments)
        .filter(fragment => fragment.isPrimaryFragment);

    // A lyric word can be split across wrapped layout lines (for example "no-no" -> "no-" + "no").
    // Those fragments must not all inherit the same centered hero placement, or they stack on top
    // of one another. Only consider intact primary fragments as emphasis candidates.
    const candidates = primaryFragments
        .filter(fragment => !fragment.isSplitAcrossLines && fragment.text.trim().length > 0)
        .map(fragment => {
            const graphemeCount = Math.max(fragment.wordGraphemeCount, splitGraphemes(fragment.word.text).length, 1);
            const semanticWeight = isCJK(fragment.word.text) ? 0.18 : Math.min(graphemeCount * 0.08, 0.36);
            const centerBias = 1 - Math.abs(fragment.wordIndex - (primaryFragments.length - 1) / 2) / Math.max(primaryFragments.length, 1);
            return {
                fragment,
                score: semanticWeight + centerBias * 0.18,
            };
        })
        .sort((a, b) => b.score - a.score);

    const hero = candidates[0];
    if (hero) {
        const scoreBoost = 1 + clamp(hero.score - 0.48, 0, 0.52);
        emphasisMap.set(hero.fragment.wordIndex, 1.46 * scoreBoost);
    }

    return emphasisMap;
};

const buildWordPlacements = (
    lineData: Array<{
        line: LayoutLine;
        lineStart: number;
        lineEnd: number;
        fragments: WordFragment[];
    }>,
    fontPx: number,
    lineHeight: number,
    maxWidth: number,
    animationIntensity: Theme['animationIntensity'],
    seed: number,
    isInterlude: boolean,
) => {
    // This is where fragments stop being text slices and start becoming actual animated visual objects.
    // From this point on, everything is placement geometry and per-state motion data.
    const totalHeight = Math.max(lineData.length, 1) * lineHeight;
    const baseMargin = animationIntensity === 'calm' ? 4 : 6;
    const baseScale = animationIntensity === 'chaotic'
        ? 1.02
        : animationIntensity === 'calm'
            ? 1
            : 1.01;
    const emphasisMap = buildEmphasisMap(lineData, isInterlude);
    const heroWordIndex = [...emphasisMap.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const placements: WordPlacement[] = [];
    const occupiedRects: Array<{ left: number; top: number; right: number; bottom: number; }> = [];
    const occupiedBands = new Map<number, number[]>();
    const occupiedMarks: number[] = [];
    let occupiedQueryStamp = 0;
    const collisionBandSize = Math.max(24, Math.round(lineHeight * 0.9));

    const getBandIndex = (value: number) => Math.floor(value / collisionBandSize);
    const registerOccupiedRect = (rect: { left: number; top: number; right: number; bottom: number; }) => {
        const rectIndex = occupiedRects.length;
        occupiedRects.push(rect);

        const startBand = getBandIndex(rect.top);
        const endBand = getBandIndex(rect.bottom);
        for (let band = startBand; band <= endBand; band++) {
            const bucket = occupiedBands.get(band);
            if (bucket) {
                bucket.push(rectIndex);
            } else {
                occupiedBands.set(band, [rectIndex]);
            }
        }
    };
    const evaluateCollisionRect = (left: number, top: number, right: number, bottom: number) => {
        if (occupiedRects.length === 0) {
            return {
                intersects: false,
                overlapArea: 0,
            };
        }

        occupiedQueryStamp += 1;
        const stamp = occupiedQueryStamp;
        const startBand = getBandIndex(top);
        const endBand = getBandIndex(bottom);
        let intersects = false;
        let overlapArea = 0;

        for (let band = startBand; band <= endBand; band++) {
            const bucket = occupiedBands.get(band);
            if (!bucket) continue;

            for (let bucketIndex = 0; bucketIndex < bucket.length; bucketIndex++) {
                const rectIndex = bucket[bucketIndex]!;
                if (occupiedMarks[rectIndex] === stamp) {
                    continue;
                }
                occupiedMarks[rectIndex] = stamp;

                const rect = occupiedRects[rectIndex]!;
                const overlapWidth = Math.max(0, Math.min(right, rect.right) - Math.max(left, rect.left));
                const overlapHeight = Math.max(0, Math.min(bottom, rect.bottom) - Math.max(top, rect.top));
                if (overlapWidth <= 0 || overlapHeight <= 0) {
                    continue;
                }

                intersects = true;
                overlapArea += overlapWidth * overlapHeight;
            }
        }

        return {
            intersects,
            overlapArea,
        };
    };
    const pushPlacementRect = (left: number, top: number, width: number, height: number, padding: number) => {
        registerOccupiedRect({
            left: left - padding,
            top: top - height - padding,
            right: left + width + padding,
            bottom: top + padding,
        });
    };
    const placementPlans = lineData.flatMap((lineView, lineIndex) => {
        const lineLeft = -lineView.line.width / 2;
        const baselineY = -totalHeight / 2 + fontPx + lineIndex * lineHeight;

        return lineView.fragments.map((fragment, fragmentIndex) => {
            const emphasis = emphasisMap.get(fragment.wordIndex) ?? 1;
            const width = Math.max(fragment.endX - fragment.startX, fontPx * 0.18);
            const scale = emphasis > 1 ? baseScale * emphasis : baseScale;
            const height = fontPx * scale * 0.95;

            return {
                fragment,
                lineIndex,
                fragmentIndex,
                baseX: lineLeft + fragment.startX,
                baseY: baselineY,
                emphasis,
                width,
                height,
                scale,
                collisionWidth: width * scale * (emphasis > 1 ? 1.48 : 1.26),
                collisionHeight: height * (emphasis > 1 ? 1.36 : 1.24),
                padding: baseMargin + (emphasis > 1 ? 10 : 2),
            };
        });
    }).sort((a, b) => {
        const emphasisDelta = b.emphasis - a.emphasis;
        if (Math.abs(emphasisDelta) > 0.001) {
            return emphasisDelta;
        }
        if (a.lineIndex !== b.lineIndex) {
            return a.lineIndex - b.lineIndex;
        }
        return a.fragment.startX - b.fragment.startX;
    });
    const primaryPlanByWordIndex = new Map<number, (typeof placementPlans)[number]>();
    placementPlans.forEach(plan => {
        if (!primaryPlanByWordIndex.has(plan.fragment.wordIndex)) {
            primaryPlanByWordIndex.set(plan.fragment.wordIndex, plan);
        }
    });
    const heroPlan = heroWordIndex === null ? null : primaryPlanByWordIndex.get(heroWordIndex) ?? null;
    const heroMetrics = heroPlan
        ? {
            centerX: (heroPlan.width * heroPlan.scale) / 2,
            centerY: -heroPlan.height * 0.46,
            width: heroPlan.width * heroPlan.scale,
        }
        : null;

    placementPlans.forEach(plan => {
        const { fragment, lineIndex, fragmentIndex, emphasis, width, height, scale, collisionWidth, collisionHeight, padding } = plan;
        const wordSeed = seed + fragment.wordIndex * 17 + lineIndex * 31 + fragmentIndex * 13;
        const random = (offset: number) => {
            const x = Math.sin(wordSeed + offset) * 10000;
            return x - Math.floor(x);
        };
        const rotate = 0;
        const passedRotate = (random(3) - 0.5) * (animationIntensity === 'chaotic' ? 20 : 12);
        const entryOffsetX = 0;
        const entryOffsetY = 0;
        const step = Math.max(10, Math.round(fontPx * 0.14));
        const maxRadius = emphasis > 1
            ? Math.max(20, lineHeight * 0.5)
            : Math.max(lineHeight * 2.2, collisionWidth * 0.75, 56);
        let preferredX = emphasis > 1 ? -width / 2 : plan.baseX;
        let preferredY = emphasis > 1 ? 0 : plan.baseY;

        if (!isInterlude && emphasis <= 1 && heroMetrics) {
            const wordCenterX = preferredX + width / 2;
            const wordCenterY = preferredY - height * 0.46;
            let dx = wordCenterX - heroMetrics.centerX;
            let dy = wordCenterY - heroMetrics.centerY;
            const distance = Math.hypot(dx, dy);
            if (distance < 1) {
                dx = preferredX >= 0 ? 1 : -1;
                dy = lineIndex % 2 === 0 ? -0.65 : 0.65;
            }
            const minHeroSeparation = heroMetrics.width * 0.34 + width * 0.52 + padding * 2;
            if (distance < minHeroSeparation) {
                const normalizedDistance = Math.max(Math.hypot(dx, dy), 1);
                const ux = dx / normalizedDistance;
                const uy = dy / normalizedDistance;
                const push = minHeroSeparation - distance;
                preferredX += ux * push;
                preferredY += uy * push * 0.92;
            }
        }

        const horizontalMin = (-maxWidth / 2) - 72;
        const horizontalMax = (maxWidth / 2) + 72;
        const verticalMin = -Math.max(totalHeight * 0.9, lineHeight * 1.6);
        const verticalMax = Math.max(totalHeight * 0.9, lineHeight * 1.45);
        let chosenX = preferredX;
        let chosenY = preferredY;
        let found = false;
        let bestFallback = {
            x: preferredX,
            y: preferredY,
            score: Number.POSITIVE_INFINITY,
        };
        const baseAngle = heroMetrics && emphasis <= 1
            ? Math.atan2(preferredY, preferredX + width / 2)
            : 0;

        for (let radius = 0; radius <= maxRadius && !found; radius += step) {
            const sampleCount = radius === 0
                ? 1
                : emphasis > 1
                    ? 8
                    : Math.max(12, Math.round((Math.PI * 2 * radius) / Math.max(step * 1.1, 10)));
            const candidates = radius === 0
                ? [[0, 0]]
                : Array.from({ length: sampleCount }, (_, sampleIndex) => {
                    const angle = baseAngle + (sampleIndex / sampleCount) * Math.PI * 2;
                    const ellipseY = radius * (emphasis > 1 ? 0.8 : 0.92);
                    return [
                        Math.cos(angle) * radius,
                        Math.sin(angle) * ellipseY,
                    ] as const;
                });

            for (const [dx, dy] of candidates) {
                const left = preferredX + dx - padding;
                const top = preferredY + dy - collisionHeight - padding;
                const right = left + collisionWidth + padding * 2;
                const bottom = top + collisionHeight + padding * 2;
                const withinBounds = left >= horizontalMin
                    && right <= horizontalMax
                    && top >= verticalMin
                    && bottom <= verticalMax;
                if (!withinBounds) {
                    continue;
                }

                const collision = evaluateCollisionRect(left, top, right, bottom);
                const travel = Math.hypot(dx, dy);
                const score = collision.overlapArea * 2.2 + travel;
                if (score < bestFallback.score) {
                    bestFallback = {
                        x: preferredX + dx,
                        y: preferredY + dy,
                        score,
                    };
                }

                if (!collision.intersects) {
                    chosenX = preferredX + dx;
                    chosenY = preferredY + dy;
                    pushPlacementRect(chosenX, chosenY, collisionWidth, collisionHeight, padding);
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            chosenX = bestFallback.x;
            chosenY = bestFallback.y;
            pushPlacementRect(chosenX, chosenY, collisionWidth, collisionHeight, padding);
        }

        const outwardX = chosenX + width / 2;
        const outwardY = chosenY - height * 0.46;
        const outwardLength = Math.max(Math.hypot(outwardX, outwardY), 1);
        const outwardUnitX = outwardX / outwardLength;
        const outwardUnitY = outwardY / outwardLength;
        const driftAmount = isInterlude
            ? 3 + random(6) * 3
            : emphasis > 1
                ? 4 + random(6) * 4
                : animationIntensity === 'chaotic'
                    ? 8 + random(6) * 9
                    : 5 + random(6) * 6;
        const passedDriftX = outwardUnitX * driftAmount + (random(7) - 0.5) * 2.4;
        const passedDriftY = outwardUnitY * driftAmount * 0.72 + (random(8) - 0.5) * 2;

        placements.push({
            id: `${fragment.word.text}-${fragment.wordIndex}-${lineIndex}-${fragmentIndex}-${fragment.fragmentIndexInWord}`,
            wordIndex: fragment.wordIndex,
            word: fragment.word,
            text: fragment.text,
            color: fragment.color,
            x: chosenX,
            y: chosenY,
            width,
            height,
            rotate,
            scale,
            passedRotate,
            passedDriftX,
            passedDriftY,
            entryOffsetX,
            entryOffsetY,
            fragmentStartInWord: fragment.fragmentStartInWord,
            fragmentEndInWord: fragment.fragmentEndInWord,
            wordGraphemeCount: fragment.wordGraphemeCount,
            emphasis,
            isInterlude,
        });
    });

    return placements;
};

const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
};

const drawActiveBeam = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    energy: number,
    beamIntensity: number,
) => {
    if (beamIntensity <= 0.01) {
        return;
    }

    const intensity = clamp(beamIntensity, 0, 1.2);
    const beamHeight = Math.max(2, height * (0.05 + energy * 0.03) * Math.max(intensity, 0.12));
    const beamY = y + height * 0.78;
    const gradient = ctx.createLinearGradient(x, beamY, x + width, beamY);
    gradient.addColorStop(0, colorWithAlpha(color, 0));
    gradient.addColorStop(0.2, colorWithAlpha(color, (0.16 + energy * 0.06) * intensity));
    gradient.addColorStop(0.8, colorWithAlpha(color, (0.16 + energy * 0.06) * intensity));
    gradient.addColorStop(1, colorWithAlpha(color, 0));
    ctx.fillStyle = gradient;
    drawRoundedRect(ctx, x, beamY, width, beamHeight, beamHeight / 2);
    ctx.fill();

    if (intensity > 0.42) {
        ctx.fillStyle = colorWithAlpha(color, 0.22 * intensity);
        ctx.beginPath();
        ctx.arc(x + 2, beamY + beamHeight / 2, beamHeight / 1.8, 0, Math.PI * 2);
        ctx.arc(x + width - 2, beamY + beamHeight / 2, beamHeight / 1.8, 0, Math.PI * 2);
        ctx.fill();
    }
};

const drawShadowGlowText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
    blur: number,
    intensity: number,
) => {
    if (intensity <= 0 || blur <= 0 || !text) {
        return;
    }

    const glowStrength = clamp(intensity, 0, 2.6);
    const blurScale = Math.max(blur / 20, 0.85);
    const innerBlur = 20 * blurScale;
    const outerBlur = 40 * blurScale;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Approximate classic: text-shadow: 0 0 20px color, 0 0 40px color
    ctx.shadowColor = colorWithAlpha(color, Math.min(0.98, 0.76 + glowStrength * 0.1));
    ctx.shadowBlur = innerBlur;
    ctx.fillStyle = colorWithAlpha(color, 0.11 * glowStrength);
    ctx.fillText(text, x, y);

    ctx.shadowColor = colorWithAlpha(color, Math.min(0.88, 0.42 + glowStrength * 0.1));
    ctx.shadowBlur = outerBlur;
    ctx.fillStyle = colorWithAlpha(color, 0.075 * glowStrength);
    ctx.fillText(text, x, y);

    // A faint outer air layer so the 40px glow does not end abruptly.
    ctx.shadowColor = colorWithAlpha(color, Math.min(0.42, 0.18 + glowStrength * 0.06));
    ctx.shadowBlur = outerBlur * 1.45;
    ctx.fillStyle = colorWithAlpha(color, 0.018 * glowStrength);
    ctx.fillText(text, x, y);
    ctx.restore();
};

const chosenAngleForEntry = (first: number, second: number, seed: number) => (first * 0.015) + (second * 0.008) + seed * 0.13;

const drawGlowTrailText = (
    ctx: CanvasRenderingContext2D,
    placement: WordPlacement,
    x: number,
    y: number,
    progress: number,
    color: string,
    energy: number,
    glowAlpha: number,
    glowIntensity: number,
) => {
    if (glowAlpha <= 0.01 || glowIntensity <= 0.01 || !placement.text) {
        return;
    }

    const graphemes = splitGraphemes(placement.text);
    if (graphemes.length <= 1 || isCJK(placement.text)) {
        const wordGlow = (0.95 + Math.min(progress, 0.4) * 0.35) * glowIntensity;
        drawShadowGlowText(
            ctx,
            placement.text,
            x,
            y,
            color,
            (24 + energy * 16) * Math.max(glowIntensity, 0.45),
            wordGlow,
        );
        return;
    }

    const totalGraphemeCount = Math.max(placement.wordGraphemeCount, graphemes.length);
    const head = clamp(progress, 0, 1) * (totalGraphemeCount + 0.35);
    let cursorX = x;

    graphemes.forEach((grapheme, graphemeIndex) => {
        const absoluteIndex = placement.fragmentStartInWord + graphemeIndex;
        const distanceFromHead = head - absoluteIndex;
        const measure = ctx.measureText(grapheme);

        if (distanceFromHead > -0.75 && distanceFromHead < 5.2) {
            const lead = clamp(1 - Math.abs(distanceFromHead - 0.2) / 0.9, 0, 1);
            const tail = distanceFromHead >= 0 ? clamp(1 - distanceFromHead / 4.4, 0, 1) : 0;
            const shimmer = clamp(0.18 + lead * 0.92 + tail * 0.45, 0, 1.35);
            const blur = (18 + energy * 16) * (0.75 + lead * 0.9 + tail * 0.45) * Math.max(glowIntensity, 0.45);

            drawShadowGlowText(
                ctx,
                grapheme,
                cursorX,
                y,
                color,
                blur,
                shimmer * glowIntensity,
            );
        }

        cursorX += measure.width;
    });
};

const VisualizerCadenza: React.FC<VisualizerProps & { staticMode?: boolean; }> = ({
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
    cadenzaTuning = DEFAULT_CADENZA_TUNING,
    lyricsFontScale = 1,
    isPlayerChromeHidden = false,
    paused = false,
    onBack,
}) => {
    const { t } = useTranslation();
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const lineLayerRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const overlayNodesRef = useRef<Map<string, OverlayWordNodes>>(new Map());
    const textCanvasRef = useRef<HTMLCanvasElement>(null);
    const animatedPlacementRef = useRef<Map<string, AnimatedPlacementState>>(new Map());
    const preparedStateCacheRef = useRef<Map<string, PreparedState>>(new Map());
    const preparedStateCacheContextKeyRef = useRef<string>('');
    const lastFrameTimeRef = useRef<number | null>(null);

    const {
        activeLine,
        recentCompletedLine,
        upcomingLine,
        nextLines,
    } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    const tuning = cadenzaTuning;
    const emptyFontSize = `clamp(${(1.5 * lyricsFontScale).toFixed(3)}rem, ${(3.5 * lyricsFontScale).toFixed(3)}vw, ${(2.25 * lyricsFontScale).toFixed(3)}rem)`;
    const translationFontSize = `clamp(${(1.125 * lyricsFontScale).toFixed(3)}rem, ${(2.6 * lyricsFontScale).toFixed(3)}vw, ${(1.25 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(2 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`;

    const preparedStateContext = useMemo<PreparedStateCacheContext>(() => ({
        showText,
        viewport,
        theme,
        tuning: {
            fontScale: tuning.fontScale,
            widthRatio: tuning.widthRatio,
        },
    }), [showText, theme, tuning.fontScale, tuning.widthRatio, viewport]);

    const preparedStateContextKey = useMemo(() => {
        const wordColorSignature = (theme.wordColors ?? [])
            .map(entry => `${entry.word}:${entry.color}`)
            .join('||');

        // Prepared line state caches per-word highlight colors derived from the active theme.
        // Include accentColor so daylight/default resets invalidate already-seen lyric lines immediately.
        return [
            showText ? '1' : '0',
            viewport.width,
            viewport.height,
            theme.fontStyle,
            theme.fontFamily ?? '',
            theme.animationIntensity,
            theme.accentColor,
            tuning.fontScale,
            tuning.widthRatio,
            wordColorSignature,
        ].join('|');
    }, [
        theme.accentColor,
        showText,
        theme.animationIntensity,
        theme.fontFamily,
        theme.fontStyle,
        theme.wordColors,
        tuning.fontScale,
        tuning.widthRatio,
        viewport.height,
        viewport.width,
    ]);

    if (preparedStateCacheContextKeyRef.current !== preparedStateContextKey) {
        preparedStateCacheRef.current.clear();
        preparedStateCacheContextKeyRef.current = preparedStateContextKey;
    }

    const getPreparedStateCacheKey = (line: Line) => [
        line.startTime,
        line.endTime,
        line.fullText,
        line.words.length,
    ].join('|');

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            setViewport({
                width: entry.contentRect.width,
                height: entry.contentRect.height,
            });
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const preparedState = useMemo<PreparedState | null>(() => {
        const getOrPrepareState = (line: Line | null) => {
            if (!line) {
                return null;
            }

            const cacheKey = getPreparedStateCacheKey(line);
            const cached = preparedStateCacheRef.current.get(cacheKey);
            if (cached) {
                return cached;
            }

            const nextState = buildPreparedState(line, preparedStateContext);
            if (nextState) {
                preparedStateCacheRef.current.set(cacheKey, nextState);
            }
            return nextState;
        };

        if (!showText || viewport.width <= 0 || viewport.height <= 0) {
            getOrPrepareState(upcomingLine);
            return null;
        }

        return prepareActiveAndUpcoming({
            activeLine,
            upcomingLine,
            prepareLine: getOrPrepareState,
        });
    }, [activeLine, preparedStateContext, upcomingLine, showText, viewport.height, viewport.width]);

    useEffect(() => {
        const textCanvas = textCanvasRef.current;
        const lineLayer = lineLayerRef.current;
        const overlay = overlayRef.current;
        if (!textCanvas || !lineLayer || !overlay || viewport.width <= 0 || viewport.height <= 0) return;

        let frameId = 0;
        const textContext = textCanvas.getContext('2d');
        if (!textContext) return;

        const draw = () => {
            const now = performance.now();
            const dt = lastFrameTimeRef.current === null
                ? 1 / 60
                : clamp((now - lastFrameTimeRef.current) / 1000, 1 / 240, 0.05);
            lastFrameTimeRef.current = now;
            const width = Math.max(Math.floor(viewport.width), 1);
            const height = Math.max(Math.floor(viewport.height), 1);
            const dpr = window.devicePixelRatio || 1;

            if (textCanvas.width !== Math.floor(width * dpr) || textCanvas.height !== Math.floor(height * dpr)) {
                textCanvas.width = Math.floor(width * dpr);
                textCanvas.height = Math.floor(height * dpr);
                textCanvas.style.width = `${width}px`;
                textCanvas.style.height = `${height}px`;
            }

            textContext.setTransform(dpr, 0, 0, dpr, 0, 0);
            textContext.clearRect(0, 0, width, height);

            if (!showText || !preparedState || !activeLine) {
                lineLayer.style.opacity = '0';
                lineLayer.style.filter = 'none';
                lineLayer.style.transform = 'scale(1)';
                lineLayer.style.perspective = '1000px';
                clearOverlayWordNodes(overlayNodesRef.current);
                frameId = window.requestAnimationFrame(draw);
                return;
            }

            const time = currentTime.get();
            const lineTiming = resolveLineRenderTiming(activeLine);
            const lineEnvelope = getClassicLineEnvelope(time, activeLine, lineTiming);
            const wordRevealMode = lineTiming.wordRevealMode;
            const isInstantWordReveal = wordRevealMode === 'instant';
            const lineSeed = Math.abs(Math.sin(activeLine.startTime * 997.1));
            const linePerspective = theme.animationIntensity === 'chaotic' ? 500 + Math.round(lineSeed * 500) : 1000;
            const energy = clamp(audioPower.get() / 255, 0, 1);
            const motionEnergy = energy * tuning.motionAmount;
            const verticalLift = Math.sin(time * 2.3) * (3 + motionEnergy * 8);
            const focusY = height * 0.42 + verticalLift;

            lineLayer.style.opacity = lineEnvelope.opacity.toString();
            lineLayer.style.filter = lineEnvelope.blur > 0.05 ? `blur(${lineEnvelope.blur.toFixed(2)}px)` : 'none';
            lineLayer.style.transform = `scale(${lineEnvelope.scale})`;
            lineLayer.style.perspective = `${linePerspective}px`;

            textContext.font = preparedState.font;
            textContext.textBaseline = 'alphabetic';
            textContext.lineJoin = 'round';
            textContext.lineCap = 'round';

            const placements = [...preparedState.placements].sort((a, b) => {
                const order = { waiting: 0, passed: 1, active: 2 } as const;
                return order[getWordStatus(time, lineTiming, a.word)] - order[getWordStatus(time, lineTiming, b.word)];
            });
            const placementIds = new Set(placements.map(placement => placement.id));
            const overlayNodes = overlayNodesRef.current;
            const usedOverlayIds = new Set<string>();

            placements.forEach((placement, placementIndex) => {
                const status = getWordStatus(time, lineTiming, placement.word);
                const progress = getWordProgress(time, wordRevealMode, placement.word);
                const passedAlpha = isInstantWordReveal
                    ? 0
                    : theme.animationIntensity === 'chaotic'
                        ? 0.9
                        : 0.82;
                const pulse = status === 'active'
                    && !isInstantWordReveal
                    ? 1 + Math.sin(time * ACTIVE_PULSE_FREQUENCY + placement.word.startTime * 5) * 0.04 * tuning.motionAmount
                    : 1;
                const passedDriftProgress = isInstantWordReveal ? 0 : getClassicPassedDrift(time, placement.word);
                const targetScale = status === 'waiting'
                    ? isInstantWordReveal
                        ? placement.scale
                        : Math.max(placement.scale * 0.5, 0.5)
                    : status === 'active'
                        ? isInstantWordReveal
                            ? placement.scale
                            : placement.scale * 1.3 * pulse
                        : placement.scale;
                const targetRotation = status === 'waiting'
                    ? isInstantWordReveal
                        ? placement.rotate
                        : placement.rotate + 20
                    : status === 'passed'
                        ? isInstantWordReveal
                            ? placement.rotate
                            : placement.rotate + placement.passedRotate * passedDriftProgress
                        : placement.rotate;
                const localFloatX = Math.sin(time * 1.2 + placementIndex * 0.6) * motionEnergy * 4;
                const localFloatY = Math.cos(time * 1.5 + placementIndex * 0.4) * motionEnergy * 2.5;
                const passedDriftX = status === 'passed' ? placement.passedDriftX * passedDriftProgress : 0;
                const passedDriftY = status === 'passed' ? placement.passedDriftY * passedDriftProgress : 0;
                const targetX = width / 2 + placement.x + localFloatX + passedDriftX + (status === 'waiting' ? placement.entryOffsetX : 0);
                const targetY = focusY + placement.y + localFloatY + passedDriftY + (status === 'waiting' ? placement.entryOffsetY : 0);
                const targetBodyAlpha = status === 'waiting' ? 0 : status === 'active' ? 1 : passedAlpha;
                const targetBlur = status === 'waiting' && !isInstantWordReveal ? 10 : 0;
                const targetActiveMix = getClassicBodyMix(time, lineTiming, placement.word);
                const targetGlowAlpha = getClassicGlowEnvelope(time, lineTiming, placement.word);
                const transformTransitionAmount = 1 - Math.exp(-11 * dt);
                const visualTransitionAmount = 1 - Math.exp(-14 * dt);
                const stateMap = animatedPlacementRef.current;
                const existingState = stateMap.get(placement.id);
                const shouldInitializeAsActive = isInstantWordReveal && time >= placement.word.startTime;
                const animatedState = existingState ?? {
                    x: width / 2 + placement.x + placement.entryOffsetX,
                    y: focusY + placement.y + placement.entryOffsetY,
                    rotation: shouldInitializeAsActive ? targetRotation : targetRotation + 16,
                    scale: shouldInitializeAsActive ? targetScale : Math.max(placement.scale * 0.5, 0.5),
                    bodyAlpha: shouldInitializeAsActive ? targetBodyAlpha : 0,
                    blur: shouldInitializeAsActive ? targetBlur : 10,
                    activeMix: shouldInitializeAsActive ? targetActiveMix : 0,
                    glowAlpha: shouldInitializeAsActive ? targetGlowAlpha : 0,
                };

                animatedState.x = mix(animatedState.x, targetX, transformTransitionAmount);
                animatedState.y = mix(animatedState.y, targetY, transformTransitionAmount);
                animatedState.rotation = mix(animatedState.rotation, targetRotation, transformTransitionAmount);
                animatedState.scale = mix(animatedState.scale, targetScale, transformTransitionAmount);
                animatedState.bodyAlpha = mix(animatedState.bodyAlpha, targetBodyAlpha, visualTransitionAmount);
                animatedState.blur = mix(animatedState.blur, targetBlur, visualTransitionAmount);
                animatedState.activeMix = mix(animatedState.activeMix, targetActiveMix, visualTransitionAmount);
                animatedState.glowAlpha = mix(animatedState.glowAlpha, targetGlowAlpha, 1 - Math.exp(-16 * dt));
                stateMap.set(placement.id, animatedState);

                if (animatedState.bodyAlpha < 0.015 && animatedState.glowAlpha < 0.015) {
                    return;
                }

                const drawX = animatedState.x;
                const drawBaselineY = animatedState.y;
                const visualWidth = placement.width * animatedState.scale;
                const visualHeight = placement.height * animatedState.scale;
                const highlightHeight = visualHeight * (status === 'active' ? 1.08 : 1);
                const scaledLeft = drawX - (visualWidth - placement.width) / 2;
                if (status === 'active' && !placement.isInterlude) {
                    if (activeLine.isChorus) {
                        const rippleRadius = Math.max(visualWidth, highlightHeight) * (0.55 + progress * 0.45);
                        textContext.strokeStyle = colorWithAlpha(placement.color, 0.45 * (1 - progress) * animatedState.bodyAlpha);
                        textContext.lineWidth = 1.2;
                        textContext.beginPath();
                        textContext.arc(
                            scaledLeft + visualWidth / 2,
                            drawBaselineY - visualHeight * 0.42,
                            rippleRadius,
                            0,
                            Math.PI * 2,
                        );
                        textContext.stroke();
                    }
                }

                const textX = -placement.width / 2;
                const textY = placement.height * 0.42;
                const textColor = mixColors(theme.primaryColor, placement.color, animatedState.activeMix);

                const overlayAnchorX = drawX + placement.width / 2;
                const overlayAnchorY = drawBaselineY - placement.height * 0.42;
                const overlayOffsetX = textX;
                const textMetrics = textContext.measureText(placement.text);
                const measuredAscent = textMetrics.actualBoundingBoxAscent || preparedState.fontPx * 0.78;
                const overlayOffsetY = textY - measuredAscent;
                const glyphs = splitGraphemes(placement.text);
                const shouldSplitGlow = wordRevealMode === 'normal' && !isCJK(placement.text) && glyphs.length > 1;
                const blurScale = 1 + energy * 0.22;
                usedOverlayIds.add(placement.id);
                let overlayWord = overlayNodes.get(placement.id);
                if (!overlayWord) {
                    overlayWord = createOverlayWordNodes();
                    overlayNodes.set(placement.id, overlayWord);
                    overlay.appendChild(overlayWord.outer);
                }

                overlayWord.outer.style.transform = `translate3d(${overlayAnchorX}px, ${overlayAnchorY}px, 0) rotate(${animatedState.rotation}deg) scale(${animatedState.scale})`;
                overlayWord.outer.style.transformOrigin = '0 0';
                overlayWord.inner.style.font = preparedState.font;
                overlayWord.inner.style.transform = `translate3d(${overlayOffsetX}px, ${overlayOffsetY}px, 0)`;
                overlayWord.body.textContent = placement.text;
                overlayWord.body.style.color = textColor;
                overlayWord.body.style.opacity = animatedState.bodyAlpha.toString();
                overlayWord.body.style.filter = animatedState.blur > 0.05 ? `blur(${animatedState.blur.toFixed(2)}px)` : 'none';

                const glowTexts = shouldSplitGlow ? glyphs : [placement.text];
                syncOverlayGlyphSpans(overlayWord, glowTexts);

                if (shouldSplitGlow) {
                    overlayWord.glyphSpans.forEach((glyphSpan, glyphIndex) => {
                        const absoluteIndex = placement.fragmentStartInWord + glyphIndex;
                        const intensity = getClassicCharGlow(
                            time,
                            placement.word,
                            absoluteIndex,
                            Math.max(placement.wordGraphemeCount, glyphs.length),
                        ) * clamp(animatedState.glowAlpha, 0, 1) * Math.max(tuning.glowIntensity, 0);

                        glyphSpan.style.textShadow = buildDomTextShadow(placement.color, intensity, blurScale);
                    });
                } else if (overlayWord.glyphSpans[0]) {
                    const intensity = getClassicGlowEnvelope(time, lineTiming, placement.word)
                        * clamp(animatedState.glowAlpha, 0, 1)
                        * Math.max(tuning.glowIntensity, 0);
                    overlayWord.glyphSpans[0].style.textShadow = buildDomTextShadow(placement.color, intensity, blurScale);
                }

            });

            animatedPlacementRef.current.forEach((_value, key) => {
                if (!placementIds.has(key)) {
                    animatedPlacementRef.current.delete(key);
                }
            });

            overlayNodes.forEach((nodes, key) => {
                if (!usedOverlayIds.has(key)) {
                    nodes.outer.remove();
                    overlayNodes.delete(key);
                }
            });

            frameId = window.requestAnimationFrame(draw);
        };

        draw();
        return () => {
            window.cancelAnimationFrame(frameId);
            lastFrameTimeRef.current = null;
            clearOverlayWordNodes(overlayNodesRef.current);
        };
    }, [
        audioPower,
        currentTime,
        activeLine,
        preparedState,
        showText,
        theme,
        tuning.glowIntensity,
        tuning.motionAmount,
        viewport.height,
        viewport.width,
    ]);

    return (
        <VisualizerShell
            ref={containerRef}
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            coverUrl={coverUrl}
            useCoverColorBg={useCoverColorBg}
            seed={seed}
            staticMode={staticMode}
            backgroundOpacity={backgroundOpacity}
            paused={paused}
            onBack={onBack}
        >
            <div
                ref={lineLayerRef}
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                    opacity: 0,
                    filter: 'none',
                    transform: 'scale(1)',
                    transformOrigin: '50% 42%',
                    perspective: '1000px',
                }}
            >
                <div ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none select-none" />
                <canvas ref={textCanvasRef} className="absolute inset-0 w-full h-full" />
            </div>

            <div className="relative z-10 w-full h-[70vh] flex items-center justify-center p-8 pointer-events-none">
                <AnimatePresence mode="wait">
                    {showText && !activeLine && (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="text-2xl opacity-50 absolute"
                            style={{
                                color: theme.secondaryColor,
                                fontSize: emptyFontSize,
                            }}
                        >
                            {t('ui.waitingForMusic')}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                translationFontSize={translationFontSize}
                upcomingFontSize={upcomingFontSize}
                opacity={0.72}
                isPlayerChromeHidden={isPlayerChromeHidden}
            />
        </VisualizerShell>
    );
};

export default VisualizerCadenza;
