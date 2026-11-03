import { layoutWithLines } from '@chenglou/pretext';
import { FumeTuning, Line, Theme } from '../../../types';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { FumeArticleLayout, FumeArticleLayoutMetrics, FumeBlock, FumeLayoutAttemptOptions, FumeLayoutAttemptTiming, ViewportSize } from './fumeTypes';
import { clamp, hashString, seeded, splitGraphemes } from './fumeMath';
import { buildWordRangesFromWords } from './fumeReveal';
import { buildFontSpec, buildGlyphOffsets, buildRenderSegments, buildSegmentMetas, buildWordRangeIndexByOffset, chooseSingleLineFontPx, countRenderableGraphemes, cursorToGlobalOffset, lineMeasuresFor, prepareLineAt, type FumeLineMeasures } from './fumeTextMeasure';

// src/components/visualizer/fume/fumeArticleLayout.ts
// Builds the fume article: picks block variants and font sizes and lays every lyric line out on the page.

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

/** Longest a slice of the layout holds the main thread: half a frame at 60 Hz. */
const LAYOUT_SLICE_MS = 8;

/**
 * Runs a layout a slice at a time, each slice a task of its own, so the page keeps drawing frames
 * while a song is laid out (most of a second of work on a slow machine). `done` gets the article;
 * the returned function stops the run.
 */
export const runLayoutInSlices = (
    steps: Generator<void, FumeArticleLayout | null>,
    done: (article: FumeArticleLayout | null) => void,
) => {
    // The next slice is a message to itself: a task of its own, without setTimeout's 4 ms floor.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
        const deadline = nowMs() + LAYOUT_SLICE_MS;
        for (;;) {
            const step = steps.next();
            if (step.done) {
                channel.port1.close();
                done(step.value);
                return;
            }
            if (nowMs() >= deadline) break;
        }
        channel.port2.postMessage(null);
    };
    channel.port2.postMessage(null);
    return () => channel.port1.close();
};

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

export const buildLayoutCacheKey = (
    lines: Line[],
    viewport: ViewportSize,
    layoutTheme: Pick<Theme, 'name' | 'fontStyle' | 'fontFamily' | 'fontFamilyStack' | 'fontWeight'>,
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
        layoutTheme.fontFamilyStack?.join(',') ?? '',
        layoutTheme.fontWeight ?? 'auto',
        layoutTheme.name,
        lyricsFontScale.toFixed(4),
        fumeTuning.heroScale.toFixed(4),
        lines.length,
        linesHash >>> 0,
    ].join('|');
};

// An attempt yields after each block, so the whole layout can be run a slice at a time.
function buildArticleLayoutAttempt(
    lines: Line[],
    viewport: ViewportSize,
    layoutTheme: Pick<Theme, 'name' | 'fontStyle' | 'fontFamily' | 'fontFamilyStack' | 'fontWeight'>,
    lyricsFontScale: number,
    fumeTuning: FumeTuning,
    options: FumeLayoutAttemptOptions & { mode: 'measure' },
    lineMeasures: Map<string, FumeLineMeasures>,
): Generator<void, FumeArticleLayoutMetrics | null>;
function buildArticleLayoutAttempt(
    lines: Line[],
    viewport: ViewportSize,
    layoutTheme: Pick<Theme, 'name' | 'fontStyle' | 'fontFamily' | 'fontFamilyStack' | 'fontWeight'>,
    lyricsFontScale: number,
    fumeTuning: FumeTuning,
    options: FumeLayoutAttemptOptions & { mode?: 'render' },
    lineMeasures: Map<string, FumeLineMeasures>,
): Generator<void, FumeArticleLayout | null>;
function* buildArticleLayoutAttempt(
    lines: Line[],
    viewport: ViewportSize,
    layoutTheme: Pick<Theme, 'name' | 'fontStyle' | 'fontFamily' | 'fontFamilyStack' | 'fontWeight'>,
    lyricsFontScale: number,
    fumeTuning: FumeTuning,
    options: FumeLayoutAttemptOptions,
    lineMeasures: Map<string, FumeLineMeasures>,
): Generator<void, FumeArticleLayout | FumeArticleLayoutMetrics | null> {
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

    for (const [blockIndex, { line, index }] of filteredLines.entries()) {
        if (blockIndex > 0) yield;
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
        const measures = lineMeasuresFor(lineMeasures, line.fullText, variant, fontFamily, layoutTheme);
        const { fontPx, lineCount } = chooseSingleLineFontPx(
            measures,
            innerWidth,
            lyricsFontScale,
            densityScale,
            fumeTuning.heroScale,
        );
        if (timing) {
            timing.prepareLayoutMs += nowMs() - prepareLayoutStart;
        }
        const lineHeight = Math.round(fontPx * (variant === 'hero' ? 1.02 : 1.06));
        const blockGap = variant === 'hero'
            ? Math.max(Math.round(lineHeight * 0.2), 6)
            : Math.max(Math.round(lineHeight * 0.08), 2);
        const blockHeight = paddingY * 2 + lineCount * lineHeight;
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
            const prepared = prepareLineAt(measures, fontPx);
            const layout = layoutWithLines(prepared, innerWidth, lineHeight);
            const fontSpec = buildFontSpec(fontPx, variant, fontFamily, layoutTheme);
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
    }

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

    const chronologicalBlocks = [...blocks].sort((left, right) => left.sourceLineIndex - right.sourceLineIndex);
    const blockBySourceLineIndex = new Map<number, FumeBlock>();
    for (const block of chronologicalBlocks) {
        blockBySourceLineIndex.set(block.sourceLineIndex, block);
    }
    const firstRenderableStartTime = chronologicalBlocks[0]?.line.startTime ?? Number.POSITIVE_INFINITY;
    const lastChronologicalRenderEndTime = chronologicalBlocks.length > 0
        ? getLineRenderEndTime(chronologicalBlocks[chronologicalBlocks.length - 1]!.line)
        : Number.NEGATIVE_INFINITY;

    return {
        ...metrics,
        blocks,
        blockBySourceLineIndex,
        chronologicalBlocks,
        firstRenderableStartTime,
        lastChronologicalRenderEndTime,
    };
}

/**
 * Lays the whole article out. A generator: it yields after each block of each attempt (dozens of
 * attempts, each over every line), so a caller can run it a slice at a time; the article is its
 * return value.
 */
export function* buildArticleLayout(
    lines: Line[],
    viewport: ViewportSize,
    layoutTheme: Pick<Theme, 'name' | 'fontStyle' | 'fontFamily' | 'fontFamilyStack' | 'fontWeight'>,
    lyricsFontScale: number,
    fumeTuning: FumeTuning,
): Generator<void, FumeArticleLayout | null> {
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
    // Each line's text as measured so far, shared by every attempt and by repeated lines.
    const lineMeasures = new Map<string, FumeLineMeasures>();

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
            const layout = yield* buildArticleLayoutAttempt(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning, attemptOptions, lineMeasures);

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
        ? yield* buildArticleLayoutAttempt(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning, bestOptions, lineMeasures)
        : null;
    // Wall-clock: with the layout run in slices, these two include the frames between the slices.
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
}
