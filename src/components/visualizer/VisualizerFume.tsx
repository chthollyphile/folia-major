import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, MotionValue, useMotionValueEvent } from 'framer-motion';
import { layoutWithLines, prepareWithSegments, type PreparedTextWithSegments, type LayoutCursor } from '@chenglou/pretext';
import { AudioBands, Line, Theme, Word as WordType } from '../../types';
import { resolveThemeFontStack } from '../../utils/fontStacks';
import { getLineRenderEndTime } from '../../utils/lyrics/renderHints';
import { useVisualizerRuntime } from './runtime';
import VisualizerShell from './VisualizerShell';
import VisualizerSubtitleOverlay from './VisualizerSubtitleOverlay';

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
}

interface RenderLineSlice {
    id: string;
    text: string;
    start: number;
    end: number;
    graphemes: string[];
    left: number;
    top: number;
    width: number;
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
    renderLines: RenderLineSlice[];
}

interface FumeArticleLayout {
    width: number;
    height: number;
    viewportHeight: number;
    columns: number;
    gap: number;
    blocks: FumeBlock[];
}

interface FumeLayoutAttemptOptions {
    paperWidth: number;
    viewportHeight: number;
    columns: number;
    gap: number;
    densityScale: number;
    seedKey: string;
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

const findWordRanges = (line: Line, graphemes: string[]) => {
    if (line.words.length === 0 || graphemes.length === 0) {
        return [] as WordRange[];
    }

    const validWords = line.words.filter(word => word.endTime > word.startTime);
    if (validWords.length === 0) {
        return [] as WordRange[];
    }

    const totalDuration = validWords.reduce((sum, word) => sum + (word.endTime - word.startTime), 0);
    if (totalDuration <= 0) {
        return [] as WordRange[];
    }

    const ranges: WordRange[] = [];
    let cursor = 0;
    let accumulatedDuration = 0;

    for (let wordIndex = 0; wordIndex < validWords.length; wordIndex += 1) {
        const word = validWords[wordIndex]!;
        const start = cursor;
        accumulatedDuration += (word.endTime - word.startTime);

        const isLastWord = wordIndex === validWords.length - 1;
        const idealEnd = isLastWord
            ? graphemes.length
            : Math.round((accumulatedDuration / totalDuration) * graphemes.length);
        const remainingWords = validWords.length - wordIndex - 1;
        const maxEnd = graphemes.length - remainingWords;
        const end = clamp(Math.max(start + 1, idealEnd), start + 1, Math.max(start + 1, maxEnd));

        ranges.push({
            wordIndex,
            word,
            start,
            end,
        });
        cursor = end;
    }

    if (ranges.length > 0) {
        ranges[ranges.length - 1]!.end = graphemes.length;
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

const chooseBlockVariant = (line: Line, index: number, total: number) => {
    const graphemeCount = splitGraphemes(line.fullText).filter(value => value.trim().length > 0).length;
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

const chooseFontPx = (
    line: Line,
    variant: 'body' | 'hero',
    width: number,
    lyricsFontScale: number,
    densityScale: number,
) => {
    const graphemeCount = Math.max(splitGraphemes(line.fullText).filter(value => value.trim().length > 0).length, 1);
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
) => {
    let low = variant === 'hero' ? 18 : 10;
    let high = variant === 'hero' ? 58 : 30;
    let best: {
        fontPx: number;
        prepared: PreparedTextWithSegments;
        layout: ReturnType<typeof layoutWithLines>;
    } | null = null;

    for (let iteration = 0; iteration < 8; iteration += 1) {
        const candidateFontPx = ((low + high) / 2) * lyricsFontScale * densityScale;
        const prepared = prepareWithSegments(text, `700 ${candidateFontPx}px ${fontFamily}`);
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

    const fallbackFontPx = (variant === 'hero' ? 18 : 10) * lyricsFontScale * densityScale;
    const prepared = prepareWithSegments(text, `700 ${fallbackFontPx}px ${fontFamily}`);
    return {
        fontPx: fallbackFontPx,
        prepared,
        layout: layoutWithLines(prepared, width, Math.round(fallbackFontPx * (variant === 'hero' ? 1.02 : 1.06))),
    };
};

const resolvePrintedGraphemeCount = (
    line: Line,
    variant: 'body' | 'hero',
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

    if (variant === 'hero') {
        const lineDuration = Math.max(getLineRenderEndTime(line) - line.startTime, 0.18);
        const stampDuration = clamp(lineDuration * 0.94, 0.24, lineDuration);
        const progress = clamp((currentTimeValue - line.startTime) / stampDuration, 0, 1);
        return clamp(Math.floor(progress * graphemeCount + (progress > 0 ? 1 : 0)), 0, graphemeCount);
    }

    if (wordRanges.length === 0) {
        const duration = Math.max(getLineRenderEndTime(line) - line.startTime, 0.12);
        const progress = clamp((currentTimeValue - line.startTime) / duration, 0, 1);
        return clamp(Math.floor(progress * graphemeCount + (progress > 0 ? 1 : 0)), 0, graphemeCount);
    }

    let printed = 0;
    for (let index = 0; index < wordRanges.length; index += 1) {
        const range = wordRanges[index]!;
        const duration = Math.max(range.word.endTime - range.word.startTime, 0.08);

        if (currentTimeValue >= range.word.endTime) {
            printed = range.end;
            continue;
        }

        if (currentTimeValue >= range.word.startTime) {
            const progress = clamp((currentTimeValue - range.word.startTime) / duration, 0, 1);
            const length = Math.max(range.end - range.start, 1);
            const partial = clamp(Math.floor(progress * length + 0.2), progress > 0 ? 1 : 0, length);
            return clamp(range.start + partial, 0, graphemeCount);
        }

        return clamp(printed, 0, graphemeCount);
    }

    return clamp(printed, 0, graphemeCount);
};

const buildArticleLayoutAttempt = (
    lines: Line[],
    viewport: ViewportSize,
    theme: Theme,
    lyricsFontScale: number,
    options: FumeLayoutAttemptOptions,
): FumeArticleLayout | null => {
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
    } = options;
    const horizontalMargin = Math.max(viewport.width * 0.86, 280);
    const verticalMargin = Math.max(viewport.height * 0.82, 220);
    const columnWidth = (paperWidth - gap * (columns - 1)) / columns;
    const fontFamily = resolveThemeFontStack(theme);
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

    filteredLines.forEach(({ line, index }, blockIndex) => {
        const variant = chooseBlockVariant(line, blockIndex, filteredLines.length);
        const blockWidth = variant === 'hero' ? paperWidth : columnWidth;
        const paddingX = 0;
        const paddingY = 0;
        const innerWidth = Math.max(blockWidth - paddingX * 2, 120);
        const preparedSingleLine = buildPreparedSingleLine(
            line.fullText,
            fontFamily,
            innerWidth,
            variant,
            lyricsFontScale,
            densityScale,
        );
        const fontPx = preparedSingleLine.fontPx;
        const lineHeight = Math.round(fontPx * (variant === 'hero' ? 1.02 : 1.06));
        const prepared = preparedSingleLine.prepared;
        const { graphemes, segmentMetas } = buildSegmentMetas(prepared);
        const wordRanges = findWordRanges(line, graphemes);
        const layout = preparedSingleLine.layout;
        const renderLines = layout.lines.map((layoutLine, lineIndex) => ({
            id: `${line.startTime}-${lineIndex}`,
            text: layoutLine.text,
            start: cursorToGlobalOffset(layoutLine.start, segmentMetas),
            end: cursorToGlobalOffset(layoutLine.end, segmentMetas),
            graphemes: splitGraphemes(layoutLine.text),
            left: variant === 'hero'
                ? Math.max((blockWidth - layoutLine.width) * 0.08, 0)
                : 0,
            top: paddingY + lineIndex * lineHeight,
            width: layoutLine.width,
        }));
        const blockGap = variant === 'hero'
            ? Math.max(Math.round(lineHeight * 0.2), 6)
            : Math.max(Math.round(lineHeight * 0.08), 2);
        const blockHeight = paddingY * 2 + layout.lines.length * lineHeight;
        let x = 0;
        let y = 0;

        if (variant === 'hero') {
            y = Math.max(...columnHeights);
            x = horizontalMargin;
            for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
                columnHeights[columnIndex] = y + blockHeight + blockGap;
            }
        } else {
            let targetColumn = 0;
            for (let columnIndex = 1; columnIndex < columns; columnIndex += 1) {
                if (columnHeights[columnIndex]! < columnHeights[targetColumn]!) {
                    targetColumn = columnIndex;
                }
            }

            x = horizontalMargin + targetColumn * (columnWidth + gap);
            y = columnHeights[targetColumn]!;
            columnHeights[targetColumn] = y + blockHeight + blockGap;
        }

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
            renderLines,
        });
    });

    const articleHeight = Math.max(0, ...columnHeights, blocks[blocks.length - 1]?.height ?? 0) + verticalMargin;

    return {
        width: paperWidth + horizontalMargin * 2,
        height: articleHeight,
        viewportHeight,
        columns,
        gap,
        blocks,
    };
};

const buildArticleLayout = (
    lines: Line[],
    viewport: ViewportSize,
    theme: Theme,
    lyricsFontScale: number,
): FumeArticleLayout | null => {
    if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) {
        return null;
    }

    const paperWidth = clamp(Math.max(viewport.width * 1.95, viewport.width + 520), 920, 2400);
    const viewportHeight = Math.max(viewport.height, 240);
    const maxColumns = paperWidth >= 1120 ? 4 : paperWidth >= 760 ? 3 : paperWidth >= 500 ? 2 : 1;
    const targetHeight = viewportHeight * 2.45;

    let bestLayout: FumeArticleLayout | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let columns = maxColumns; columns >= 1; columns -= 1) {
        let low = 0.82;
        let high = 1.42;
        const gap = clamp(Math.round(paperWidth * (columns >= 4 ? 0.0065 : columns === 3 ? 0.0085 : 0.0115)), 6, 14);

        for (let iteration = 0; iteration < 8; iteration += 1) {
            const densityScale = (low + high) / 2;
        const layout = buildArticleLayoutAttempt(lines, viewport, theme, lyricsFontScale, {
                paperWidth,
                viewportHeight,
                columns,
                gap,
                densityScale,
                seedKey: `${theme.name}:${columns}:${paperWidth}`,
            });

            if (!layout) {
                continue;
            }

            const coveragePenalty = Math.abs(layout.height - targetHeight);
            const overflowPenalty = layout.height < targetHeight ? 0 : (layout.height - targetHeight) * 0.14;
            const score = coveragePenalty + overflowPenalty;

            if (score < bestScore) {
                bestScore = score;
                bestLayout = layout;
            }

            if (layout.height < targetHeight) {
                low = densityScale;
            } else {
                high = densityScale;
            }
        }
    }

    return bestLayout;
};

const resolveBlockFocusPoint = (
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

const buildCanvasFont = (block: FumeBlock, theme: Theme) => {
    const fontFamily = resolveThemeFontStack(theme);
    const fontWeight = block.variant === 'hero' ? 780 : 640;
    return `${fontWeight} ${block.fontPx}px ${fontFamily}`;
};

const resolveCameraScaleForBlock = (
    block: FumeBlock,
    viewport: ViewportSize,
) => {
    const minViewportSide = Math.max(Math.min(viewport.width, viewport.height), 1);
    const targetLineHeight = clamp(minViewportSide * 0.115, 64, 124);
    return clamp(targetLineHeight / Math.max(block.lineHeight, 1), 0.88, 2.2);
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

    for (let index = article.blocks.length - 1; index >= 0; index -= 1) {
        const block = article.blocks[index]!;
        const printedCount = resolvePrintedGraphemeCount(
            block.line,
            block.variant,
            block.wordRanges,
            block.graphemes.length,
            currentTimeValue,
        );

        if (printedCount > 0) {
            return block;
        }
    }

    return article.blocks[0] ?? null;
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
    onBack,
}) => {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const currentLineIndexRef = useRef(currentLineIndex);
    const cameraInitializedRef = useRef(false);
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
    const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
    const [displayTime, setDisplayTime] = useState(() => currentTime.get());

    useMotionValueEvent(currentTime, 'change', latest => {
        const rounded = Math.round(latest * 18) / 18;
        setDisplayTime(previous => (previous === rounded ? previous : rounded));
    });

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

    const runtime = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    const article = useMemo(
        () => buildArticleLayout(lines, viewport, theme, lyricsFontScale),
        [lines, viewport, theme, lyricsFontScale],
    );
    const hasPrintedContent = useMemo(
        () => lines.some(line => displayTime >= line.startTime),
        [displayTime, lines],
    );

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

        if (!article || !showText) {
            return;
        }

        if (!cameraInitializedRef.current) {
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
        } else {
            cameraRef.current.x = clamp(cameraRef.current.x, 0, article.width);
            cameraRef.current.y = clamp(cameraRef.current.y, 0, article.height);
            cameraRef.current.focusX = clamp(cameraRef.current.focusX, 0, article.width);
            cameraRef.current.focusY = clamp(cameraRef.current.focusY, 0, article.height);
            cameraRef.current.scale = clamp(cameraRef.current.scale, 0.84, 2.24);
            cameraRef.current.focusScale = clamp(cameraRef.current.focusScale, 0.84, 2.24);
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
            const focusBlock = resolveFocusBlock(article, currentLineIndexRef.current, time);
            let targetCameraX = article.width * 0.5;
            let targetCameraY = article.height * 0.5;
            let targetCameraScale = 1.18;

            if (focusBlock) {
                const focusPrintedCount = resolvePrintedGraphemeCount(
                    focusBlock.line,
                    focusBlock.variant,
                    focusBlock.wordRanges,
                    focusBlock.graphemes.length,
                    time,
                );
                const focusPoint = resolveBlockFocusPoint(focusBlock, focusPrintedCount);
                targetCameraX = focusPoint.x;
                targetCameraY = focusPoint.y;
                targetCameraScale = resolveCameraScaleForBlock(focusBlock, viewport);
            }

            const targetCatchUp = 1 - Math.exp(-dt * 8.4);
            cameraRef.current.focusX += (targetCameraX - cameraRef.current.focusX) * targetCatchUp;
            cameraRef.current.focusY += (targetCameraY - cameraRef.current.focusY) * targetCatchUp;
            cameraRef.current.focusScale += (targetCameraScale - cameraRef.current.focusScale) * (1 - Math.exp(-dt * 4.2));

            const springStrength = 152;
            const damping = 20.5;
            const accelX = (cameraRef.current.focusX - cameraRef.current.x) * springStrength - cameraRef.current.velocityX * damping;
            const accelY = (cameraRef.current.focusY - cameraRef.current.y) * springStrength - cameraRef.current.velocityY * damping;
            cameraRef.current.velocityX += accelX * dt;
            cameraRef.current.velocityY += accelY * dt;
            cameraRef.current.velocityX = clamp(cameraRef.current.velocityX, -1320, 1320);
            cameraRef.current.velocityY = clamp(cameraRef.current.velocityY, -1320, 1320);
            cameraRef.current.x += cameraRef.current.velocityX * dt;
            cameraRef.current.y += cameraRef.current.velocityY * dt;

            const scaleSpringStrength = 54;
            const scaleDamping = 13.5;
            const accelScale = (cameraRef.current.focusScale - cameraRef.current.scale) * scaleSpringStrength
                - cameraRef.current.velocityScale * scaleDamping;
            cameraRef.current.velocityScale += accelScale * dt;
            cameraRef.current.velocityScale = clamp(cameraRef.current.velocityScale, -1.6, 1.6);
            cameraRef.current.scale += cameraRef.current.velocityScale * dt;
            cameraRef.current.scale = clamp(cameraRef.current.scale, 0.84, 2.24);

            const viewportCenterX = viewport.width * 0.5;
            const viewportCenterY = viewport.height * 0.5;
            context.save();
            context.translate(viewportCenterX, viewportCenterY);
            context.scale(cameraRef.current.scale, cameraRef.current.scale);
            context.translate(-cameraRef.current.x, -cameraRef.current.y);

            for (const block of article.blocks) {
                const printedCount = resolvePrintedGraphemeCount(
                    block.line,
                    block.variant,
                    block.wordRanges,
                    block.graphemes.length,
                    time,
                );
                const totalGraphemeCount = block.graphemes.length;
                const waitingOpacity = block.variant === 'hero' ? 0.06 : 0.035;
                const printedOpacity = block.variant === 'hero' ? 0.98 : 0.88;
                const baselineOffset = block.lineHeight * (isCJK(block.line.fullText) ? 0.52 : 0.5);

                context.save();
                context.font = buildCanvasFont(block, theme);
                context.textAlign = 'left';
                context.textBaseline = 'middle';

                for (const renderLine of block.renderLines) {
                    const baseX = block.x + renderLine.left;
                    const baseY = block.y + renderLine.top + baselineOffset;

                    for (let graphemeIndex = 0; graphemeIndex < renderLine.graphemes.length; graphemeIndex += 1) {
                        const grapheme = renderLine.graphemes[graphemeIndex]!;
                        const globalOffset = renderLine.start + graphemeIndex;
                        const isPrinted = globalOffset < printedCount;
                        const isFrontier = printedCount > 0
                            && globalOffset === printedCount
                            && printedCount < totalGraphemeCount;
                        const alpha = isPrinted
                            ? printedOpacity
                            : isFrontier
                                ? 0.82
                                : waitingOpacity;

                        if (alpha <= 0.002) {
                            continue;
                        }

                        const glyphX = baseX + widthBetweenOffsets(
                            block.prepared,
                            block.segmentMetas,
                            renderLine.start,
                            globalOffset,
                        );

                        context.fillStyle = colorWithAlpha(theme.primaryColor, alpha);
                        context.fillText(grapheme, glyphX, baseY);
                    }
                }

                context.restore();
            }
            context.restore();

            frameId = window.requestAnimationFrame(draw);
        };

        draw();
        return () => {
            window.cancelAnimationFrame(frameId);
            lastFrameAt = null;
        };
    }, [article, currentTime, showText, theme, viewport.height, viewport.width]);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            coverUrl={coverUrl}
            useCoverColorBg={false}
            seed={seed}
            staticMode={staticMode}
            backgroundOpacity={backgroundOpacity}
            onBack={onBack}
        >
            <div ref={viewportRef} className="relative z-10 h-full w-full pointer-events-none">
                {showText && article && (
                    <motion.div
                        initial={false}
                        animate={{
                            opacity: hasPrintedContent ? 1 : 0,
                            scale: hasPrintedContent ? 1 : 0.985,
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
            </div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={runtime.activeLine}
                recentCompletedLine={runtime.recentCompletedLine}
                nextLines={runtime.nextLines}
                theme={theme}
                translationFontSize="0.98rem"
                upcomingFontSize="0.82rem"
                opacity={0.48}
            />
        </VisualizerShell>
    );
};

export default VisualizerFume;
