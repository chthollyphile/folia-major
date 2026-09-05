import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useTransform, MotionValue } from 'framer-motion';
import type { Theme, AudioBands, Line } from '../../../types';
import { resolveThemeFontWeight } from '../../../utils/fontStacks';
import type { GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { useFontsEpoch } from '../../../hooks/useFontsEpoch';
import { colorWithAlpha, mixColors } from '../colorMix';
import { resolveMonetFillWidth, resolveMonetGlow, MONET_SCROLL_SPRING, MONET_SCALE_SPRING } from './monetLyricMotion';
import {
    buildWordColorRangesFromMatchers,
    prepareWordColorMatchers,
    resolveWordColor,
    resolveTokenColorMap,
    type WordColorMatcher,
} from '../wordColoring';
import {
    MONET_RAIL_BASE_MAX_HEIGHT_PX,
    MONET_RAIL_BASE_MAX_WIDTH_PX,
    buildMonetDisplayTokens,
    clearMonetMeasurementCaches,
    measureMonetGraphemeOffsets,
    measureMonetLineLayout,
    resolveMonetSweepEdgeSoftness,
    resolveMonetSweepEnd,
    resolveMonetWordStatus,
    type MonetLineStatus,
    type MonetMeasuredLineLayout,
    type MonetVisibleLineEntry,
} from './monetLyricsModel';

// src/components/visualizer/monet/MonetLyricsRail.tsx
// Renders Monet lyrics on fixed transform tracks so scrolling stays smooth without layout reflow jumps.

interface MonetLyricsRailProps {
    entries: MonetVisibleLineEntry[];
    lines: Line[];
    currentLineIndex: number;
    currentTime: MotionValue<number>;
    theme: Theme;
    lyricFontPx: number;
    inactiveFontPx: number;
    translationFontPx: number;
    fontStack: string;
    translationFontStack?: string;
    subtitleTheme?: Theme;
    keywordColoringEnabled: boolean;
    emptyText: string;
    showSubtitleTranslation?: boolean;
    audioPower?: MotionValue<number>;
    audioBands?: AudioBands;
    onLyricLineSeek?: (lyricTimeSec: number) => void;
    seekDisabled?: boolean;
    /** Shared large-screen factor. Owned by VisualizerMonet so the column and the font scale together. */
    layoutScale?: number;
}

interface MonetRailSize {
    width: number;
    height: number;
}

interface MonetLineTone {
    opacity: number;
    scale: number;
    blurPx: number;
    baseColor: string;
    fontWeight: number;
    zIndex: number;
}

interface PositionedMonetLineEntry extends MonetVisibleLineEntry {
    y: number;
    tone: MonetLineTone;
    layout: MonetMeasuredLineLayout;
    scaledHeight: number;
}

type MonetLayoutCache = Map<string, MonetMeasuredLineLayout>;

const MONET_RAIL_WIDTH_FALLBACK_PX = 680;
const MONET_RAIL_HEIGHT_FALLBACK_PX = 340;
const MONET_ACTIVE_GAP_PX = 18;
const MONET_INACTIVE_GAP_PX = 14;
// Ratios reproduce the fixed gaps above at the default 36.5px lyric font, so nothing changes at
// normal sizes; past that the gaps grow with the text instead of collapsing into it.
// The height cap must clear the active block at large font scales, where a narrow column pushes
// a normal lyric past four rows. Seven rows stays below the base cap at default sizes, so this
// only ever raises the ceiling for oversized text on a tall display.
const MONET_RAIL_MIN_ROWS = 7;
const MONET_ACTIVE_GAP_RATIO = 0.49;
const MONET_INACTIVE_GAP_RATIO = 0.38;
const MONET_SCROLL_IDLE_RESET_MS = 1800;
const MONET_SCROLL_STEP_PX = 72;
const MONET_TOUCH_STEP_PX = 52;
const MONET_SCROLL_BEFORE = 4;
const MONET_SCROLL_AFTER = 4;
const MONET_LAYOUT_CACHE_LIMIT = 240;
const MONET_RAIL_SCROLL_EVENT_OPTIONS: AddEventListenerOptions = { passive: false };
const MONET_SCROLL_TRANSITION = {
    y: { type: 'spring', ...MONET_SCROLL_SPRING },
    scale: { type: 'spring', ...MONET_SCALE_SPRING },
    opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] },
    filter: { duration: 0.32, ease: [0.32, 0.72, 0, 1] },
} as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampScrollSteps = (steps: number) => Math.max(-1, Math.min(1, steps));
const getScrollDirection = (delta: number) => (delta === 0 ? 0 : delta > 0 ? 1 : -1);

export const resolveMonetWordColor = (
    wordText: string,
    theme: Theme,
    fallbackColor: string,
    keywordColoringEnabled = true,
): string => {
    return resolveWordColor(wordText, theme.wordColors, fallbackColor, {
        keywordColoringEnabled,
        cjkMatchMode: 'exact',
    });
};

const resolveLineTone = (
    entry: MonetVisibleLineEntry,
    theme: Theme,
    inactiveScale: number,
): MonetLineTone => {
    if (entry.status === 'active') {
        return {
            opacity: 1,
            scale: 1,
            blurPx: 0,
            baseColor: colorWithAlpha(theme.primaryColor, 0.34),
            fontWeight: 600,
            zIndex: 4,
        };
    }

    const distance = Math.max(Math.abs(entry.offset), 1);
    const isWaiting = entry.status === 'waiting';
    const scale = clamp(inactiveScale * Math.pow(0.9, distance - 1), 0.68, 0.92);

    return {
        opacity: isWaiting
            ? clamp(0.72 - (distance - 1) * 0.18, 0.36, 0.72)
            : clamp(0.52 - (distance - 1) * 0.12, 0.28, 0.52),
        scale,
        blurPx: isWaiting
            ? distance === 1 ? 0.7 : 1.8 + (distance - 2) * 0.8
            : 1.1 + (distance - 1) * 0.7,
        baseColor: colorWithAlpha(theme.primaryColor, isWaiting ? 0.46 : 0.36),
        fontWeight: 500,
        zIndex: isWaiting ? 3 - distance : 2 - distance,
    };
};

const resolveLineGap = (
    previous: PositionedMonetLineEntry,
    next: PositionedMonetLineEntry,
    lyricFontPx: number,
): number => (
    previous.status === 'active' || next.status === 'active'
        ? Math.max(MONET_ACTIVE_GAP_PX, lyricFontPx * MONET_ACTIVE_GAP_RATIO)
        : Math.max(MONET_INACTIVE_GAP_PX, lyricFontPx * MONET_INACTIVE_GAP_RATIO)
);

const resolveRailLineStatus = (lineIndex: number, activeLineIndex: number): MonetLineStatus => {
    if (lineIndex === activeLineIndex) {
        return 'active';
    }
    if (activeLineIndex >= 0 && lineIndex < activeLineIndex) {
        return 'passed';
    }
    return 'waiting';
};

const buildScrollableRailEntries = (
    lines: Line[],
    anchorIndex: number,
    activeLineIndex: number,
): MonetVisibleLineEntry[] => {
    if (lines.length === 0) {
        return [];
    }

    const safeAnchorIndex = Math.round(clamp(anchorIndex, 0, lines.length - 1));
    const startIndex = Math.max(0, safeAnchorIndex - MONET_SCROLL_BEFORE);
    const endIndex = Math.min(lines.length - 1, safeAnchorIndex + MONET_SCROLL_AFTER);
    const nextEntries: MonetVisibleLineEntry[] = [];

    for (let index = startIndex; index <= endIndex; index += 1) {
        const line = lines[index];
        nextEntries.push({
            key: `${index}-${line.startTime}-${line.fullText}`,
            line,
            index,
            offset: index - safeAnchorIndex,
            status: resolveRailLineStatus(index, activeLineIndex),
        });
    }

    return nextEntries;
};

const trimOldestCacheEntry = <TValue,>(cache: Map<string, TValue>, limit: number) => {
    if (cache.size < limit) {
        return;
    }

    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
        cache.delete(oldestKey);
    }
};

const buildMonetLayoutCacheKey = (
    entry: MonetVisibleLineEntry,
    fontPx: number,
    translationFontPx: number,
    fontStack: string,
    translationFontStack: string,
    fontWeight: number,
    translationFontWeight: number,
    maxWidthPx: number,
    showSubtitleTranslation: boolean,
) => [
    entry.index,
    entry.line.startTime,
    entry.line.endTime,
    entry.line.fullText,
    entry.line.translation ?? '',
    entry.status,
    fontPx,
    translationFontPx,
    fontStack,
    translationFontStack,
    fontWeight,
    translationFontWeight,
    maxWidthPx,
    showSubtitleTranslation ? 1 : 0,
].join('\u0001');

const getOrMeasureMonetLineLayout = (
    cache: MonetLayoutCache,
    entry: MonetVisibleLineEntry,
    fontPx: number,
    translationFontPx: number,
    fontStack: string,
    translationFontStack: string,
    fontWeight: number,
    translationFontWeight: number,
    maxWidthPx: number,
    showSubtitleTranslation: boolean,
) => {
    const cacheKey = buildMonetLayoutCacheKey(entry, fontPx, translationFontPx, fontStack, translationFontStack, fontWeight, translationFontWeight, maxWidthPx, showSubtitleTranslation);
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const layout = measureMonetLineLayout({
        line: entry.line,
        status: entry.status,
        fontPx,
        translationFontPx,
        fontStack,
        translationFontStack,
        fontWeight,
        translationFontWeight,
        maxWidthPx,
        showSubtitleTranslation,
    });
    trimOldestCacheEntry(cache, MONET_LAYOUT_CACHE_LIMIT);
    cache.set(cacheKey, layout);
    return layout;
};

const useMonetRailSize = (ref: React.RefObject<HTMLDivElement | null>): MonetRailSize => {
    const [size, setSize] = useState<MonetRailSize>({ width: 0, height: 0 });

    useEffect(() => {
        const node = ref.current;
        if (!node) {
            return;
        }

        const updateSize = () => {
            const nextWidth = Math.round(node.clientWidth);
            const nextHeight = Math.round(node.clientHeight);
            setSize(current => (
                current.width === nextWidth && current.height === nextHeight
                    ? current
                    : { width: nextWidth, height: nextHeight }
            ));
        };

        updateSize();

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(updateSize);
        observer.observe(node);
        return () => observer.disconnect();
    }, [ref]);

    return size;
};

const buildPositionedEntries = (
    entries: MonetVisibleLineEntry[],
    railSize: MonetRailSize,
    theme: Theme,
    lyricFontPx: number,
    inactiveFontPx: number,
    translationFontPx: number,
    fontStack: string,
    translationFontStack: string,
    fontWeight: number,
    translationFontWeight: number,
    glowBufferPx: number,
    showSubtitleTranslation: boolean,
    layoutCache: MonetLayoutCache,
): PositionedMonetLineEntry[] => {
    const railWidth = railSize.width || MONET_RAIL_WIDTH_FALLBACK_PX;
    const railHeight = railSize.height || MONET_RAIL_HEIGHT_FALLBACK_PX;
    const inactiveScale = clamp(inactiveFontPx / Math.max(lyricFontPx, 1), 0.72, 0.92);
    const contentWidthPx = Math.max(railWidth - glowBufferPx * 2, 0);

    const measuredEntries: PositionedMonetLineEntry[] = entries.map(entry => {
        const tone = {
            ...resolveLineTone(entry, theme, inactiveScale),
            fontWeight,
        };
        const layout = getOrMeasureMonetLineLayout(
            layoutCache,
            entry,
            lyricFontPx,
            translationFontPx,
            fontStack,
            translationFontStack,
            fontWeight,
            translationFontWeight,
            contentWidthPx - 8,
            showSubtitleTranslation,
        );

        return {
            ...entry,
            y: 0,
            tone,
            layout,
            scaledHeight: layout.visualHeightPx * tone.scale,
        };
    });

    if (measuredEntries.length === 0) {
        return [];
    }

    const anchorIndex = Math.max(0, measuredEntries.findIndex(entry => entry.offset === 0));
    const focusCenterY = railHeight * 0.46;
    measuredEntries[anchorIndex].y = focusCenterY - measuredEntries[anchorIndex].scaledHeight / 2;

    for (let index = anchorIndex + 1; index < measuredEntries.length; index += 1) {
        const previous = measuredEntries[index - 1];
        const current = measuredEntries[index];
        current.y = previous.y + previous.scaledHeight + resolveLineGap(previous, current, lyricFontPx);
    }

    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
        const current = measuredEntries[index];
        const next = measuredEntries[index + 1];
        current.y = next.y - current.scaledHeight - resolveLineGap(current, next, lyricFontPx);
    }

    return measuredEntries;
};

const getLineMask = (isClipped: boolean, fadePx: number) => (
    isClipped
        ? `linear-gradient(180deg, black 0%, black calc(100% - ${fadePx}px), transparent 100%)`
        : undefined
);

/**
 * Cuts a truncated context line at its last visible text row rather than at the box edge.
 * `overflow: hidden` clips at the padding box, and that padding carries `vGlowBufferPx`
 * (1.2x the lyric font) of glow headroom — at large font scales that is more than a whole line,
 * so the clipped row stays visible and lands on top of the neighbouring lyric.
 */
const getClippedTextMask = (
    isClipped: boolean,
    contentBottomPx: number,
    fadePx: number,
) => {
    if (!isClipped) {
        return undefined;
    }

    const solidEndPx = Math.max(contentBottomPx - fadePx, 0);
    return `linear-gradient(180deg, black 0px, black ${solidEndPx}px, transparent ${contentBottomPx}px)`;
};

/** Softens the right edge so a token wider than the column fades out instead of being sliced mid-glyph. */
const getEdgeFadeMask = (isOverflowing: boolean, fadePx: number) => (
    isOverflowing
        ? `linear-gradient(90deg, black 0%, black calc(100% - ${fadePx}px), transparent 100%)`
        : undefined
);

/** Intersects the vertical clip fade with the horizontal edge fade, so a line can carry both. */
const composeLineMasks = (...masks: (string | undefined)[]) => {
    const layers = masks.filter((mask): mask is string => Boolean(mask));
    if (layers.length === 0) {
        return undefined;
    }

    return {
        WebkitMaskImage: layers.join(', '),
        maskImage: layers.join(', '),
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
        ...(layers.length > 1
            ? { WebkitMaskComposite: 'source-in', maskComposite: 'intersect' }
            : {}),
    } as const;
};

const MonetTimedTokenSpan: React.FC<{
    entry: PositionedMonetLineEntry;
    currentTime: MotionValue<number>;
    accentColor: string;
    fontPx: number;
    fontStack: string;
    fontsEpoch: number;
    wordColorMatchers: WordColorMatcher[];
    isChorus?: boolean;
    chorusAccentColor?: string;
    audioPower?: MotionValue<number>;
    renderStaticPassed?: boolean;
}> = ({ entry, currentTime, accentColor, fontPx, fontStack, fontsEpoch, wordColorMatchers, isChorus, chorusAccentColor, audioPower, renderStaticPassed = false }) => {
    const lineRenderEndTime = useMemo(() => getLineRenderEndTime(entry.line), [entry.line]);
    const tokens = useMemo(() => buildMonetDisplayTokens(entry.line), [entry.line]);
    const wordColorRanges = useMemo(
        () => buildWordColorRangesFromMatchers(entry.line.fullText, wordColorMatchers),
        [entry.line.fullText, wordColorMatchers],
    );
    const tokenColors = useMemo(
        () => resolveTokenColorMap(tokens, wordColorRanges),
        [tokens, wordColorRanges],
    );
    const fontSpec = useMemo(
        () => `${entry.tone.fontWeight} ${fontPx}px ${fontStack}`,
        [entry.tone.fontWeight, fontPx, fontStack],
    );

    const resolvedAccentColor = isChorus && chorusAccentColor
        ? mixColors(accentColor, chorusAccentColor, 0.48)
        : accentColor;

    return (
        <span className="block w-full min-w-0 max-w-full whitespace-pre-wrap break-words">
            {tokens.map(token => (
                renderStaticPassed ? (
                    <span
                        key={token.key}
                        style={{
                            color: token.timed
                                ? tokenColors.get(token.key) ?? resolvedAccentColor
                                : entry.tone.baseColor,
                        }}
                    >
                        {token.text}
                    </span>
                ) : token.timed && token.startTime !== null && token.endTime !== null ? (
                    <MonetWordSweep
                        key={token.key}
                        text={token.text}
                        startTime={token.startTime}
                        endTime={token.endTime}
                        graphemeTimings={token.graphemeTimings}
                        lineRenderEndTime={lineRenderEndTime}
                        currentTime={currentTime}
                        lineStatus={entry.status}
                        wordColor={tokenColors.get(token.key) ?? resolvedAccentColor}
                        baseColor={entry.tone.baseColor}
                        fontPx={fontPx}
                        fontSpec={fontSpec}
                        fontsEpoch={fontsEpoch}
                        isChorus={isChorus}
                        audioPower={audioPower}
                    />
                ) : (
                    <span key={token.key} style={{ color: entry.tone.baseColor }}>
                        {token.text}
                    </span>
                )
            ))}
        </span>
    );
};

const MonetWordSweep: React.FC<{
    text: string;
    startTime: number;
    endTime: number;
    graphemeTimings: GraphemeTiming[];
    lineRenderEndTime: number;
    currentTime: MotionValue<number>;
    lineStatus: MonetLineStatus;
    wordColor: string;
    baseColor: string;
    fontPx: number;
    fontSpec: string;
    /** Bumped when web fonts load; measured offsets are stale until then. */
    fontsEpoch: number;
    isChorus?: boolean;
    audioPower?: MotionValue<number>;
}> = ({
    text,
    startTime,
    endTime,
    graphemeTimings,
    lineRenderEndTime,
    currentTime,
    lineStatus,
    wordColor,
    baseColor,
    fontPx,
    fontSpec,
    fontsEpoch,
    isChorus,
    audioPower,
}) => {
        const isLineActive = lineStatus === 'active';
        const canRenderGlow = lineStatus === 'active' || lineStatus === 'passed';
        const graphemeOffsets = useMemo(
            () => measureMonetGraphemeOffsets(text, fontPx, fontSpec),
            // eslint-disable-next-line react-hooks/exhaustive-deps -- fontsEpoch re-measures once the real face loads
            [text, fontPx, fontSpec, fontsEpoch],
        );

        const wordStatus = useTransform(currentTime, latest => (
            isLineActive ? resolveMonetWordStatus(latest, startTime, endTime) : lineStatus
        ));

        const wordProgress = useTransform(currentTime, latest => {
            if (!isLineActive || latest <= startTime) return 0;
            if (latest >= endTime) return 1;
            return (latest - startTime) / Math.max(0.001, endTime - startTime);
        });

        const fillWidth = useTransform(currentTime, latest => (
            isLineActive ? resolveMonetFillWidth(latest, startTime, endTime, graphemeOffsets, graphemeTimings) : 0
        ));

        const maskImage = useTransform(fillWidth, latest => {
            const edgeSoftness = resolveMonetSweepEdgeSoftness(fontPx);
            const fullWidth = graphemeOffsets[graphemeOffsets.length - 1] ?? 0;
            const sweepEnd = resolveMonetSweepEnd(latest, fullWidth, edgeSoftness);
            const solidEnd = Math.max(sweepEnd - edgeSoftness, 0);
            const featherStart = Math.max(sweepEnd - edgeSoftness * 0.55, 0);
            const featherEnd = Math.max(sweepEnd, 0);
            return `linear-gradient(90deg, rgba(0, 0, 0, 1) 0px, rgba(0, 0, 0, 1) ${solidEnd}px, rgba(0, 0, 0, 0.92) ${featherStart}px, rgba(0, 0, 0, 0) ${featherEnd}px, rgba(0, 0, 0, 0) 100%)`;
        });

        const fillGradient = useTransform(wordProgress, progress => {
            const color = mixColors(baseColor, wordColor, Math.min(progress, 1));
            return `linear-gradient(90deg, ${color} 0%, ${colorWithAlpha(color, 0.92)} 68%, ${colorWithAlpha(color, 0.72)} 100%)`;
        });

        const resolvedBaseColor = useTransform(wordStatus, status =>
            (isLineActive && status === 'passed') || lineStatus === 'passed' ? wordColor : baseColor,
        );

        const glowShadow = useTransform(currentTime, latest => {
            if (!canRenderGlow || latest <= startTime) return 'none';

            const intensity = resolveMonetGlow(latest, startTime, endTime, lineRenderEndTime);

            if (intensity <= 0) return 'none';

            const radiusOne = Math.round(fontPx * (isChorus ? 0.45 : 0.28));
            const radiusTwo = Math.round(fontPx * (isChorus ? 0.90 : 0.65));
            const maxAlpha = isChorus ? 1.0 : 0.88;
            const glowColor = mixColors(baseColor, wordColor, intensity, intensity * maxAlpha);
            return `0 0 ${radiusOne}px ${glowColor}, 0 0 ${radiusTwo}px ${glowColor}`;
        }) as unknown as MotionValue<string>;

        // Glyphs with deep descenders (g, j, p, y, and many CJK forms) sit below the line box
        // whenever the font's em box is taller than `line-height`, which drives half-leading
        // negative. `background-clip: text` paints no background outside the fill box and the mask
        // clips at the overlay's border box, so the sweep used to stop mid-glyph — more visibly the
        // larger the font. Grow both boxes, then pull the text back so its position is unchanged.
        const sweepOverflowPx = Math.round(fontPx * 0.5);

        return (
            <span className="relative inline-block whitespace-pre-wrap break-words">
                <motion.span style={{ color: resolvedBaseColor, textShadow: glowShadow }}>
                    {text}
                </motion.span>
                {isLineActive ? (
                    <motion.span
                        aria-hidden
                        className="pointer-events-none absolute left-0 right-0 block whitespace-pre-wrap break-words"
                        style={{
                            top: -sweepOverflowPx,
                            bottom: -sweepOverflowPx,
                            paddingTop: sweepOverflowPx,
                            paddingBottom: sweepOverflowPx,
                            boxSizing: 'border-box',
                            WebkitMaskImage: maskImage,
                            maskImage,
                            WebkitMaskSize: '100% 100%',
                            maskSize: '100% 100%',
                            WebkitMaskRepeat: 'no-repeat',
                            maskRepeat: 'no-repeat',
                            textShadow: 'none',
                        }}
                    >
                        <motion.span
                            className="block whitespace-pre-wrap break-words"
                            style={{
                                marginTop: -sweepOverflowPx,
                                paddingTop: sweepOverflowPx,
                                paddingBottom: sweepOverflowPx,
                                color: 'transparent',
                                WebkitTextFillColor: 'transparent',
                                backgroundImage: fillGradient,
                                WebkitBackgroundClip: 'text',
                                backgroundClip: 'text',
                            }}
                        >
                            {text}
                        </motion.span>
                    </motion.span>
                ) : null}
            </span>
        );
    };

const MonetRailLine: React.FC<{
    entry: PositionedMonetLineEntry;
    currentTime: MotionValue<number>;
    theme: Theme;
    lyricFontPx: number;
    translationFontPx: number;
    fontStack: string;
    translationFontStack: string;
    translationFontWeight: number;
    glowBufferPx: number;
    vGlowBufferPx: number;
    fontsEpoch: number;
    wordColorMatchers: WordColorMatcher[];
    showSubtitleTranslation: boolean;
    audioPower?: MotionValue<number>;
    onLineSeek?: (line: Line) => void;
    canSeek?: boolean;
    disableEntryMotion?: boolean;
    renderStaticPassed?: boolean;
}> = ({ entry, currentTime, theme, lyricFontPx, translationFontPx, fontStack, translationFontStack, translationFontWeight, glowBufferPx, vGlowBufferPx, fontsEpoch, wordColorMatchers, showSubtitleTranslation, audioPower, onLineSeek, canSeek = false, disableEntryMotion = false, renderStaticPassed = false }) => {
    const initialOffset = entry.offset >= 0 ? 34 : -34;
    const exitOffset = entry.status === 'passed' || entry.offset < 0 ? -38 : 38;
    // The active lyric must never be truncated, so its box is sized by its own wrapped
    // content instead of the pre-measured height, and it carries no truncation fade.
    // Context lines keep the fixed two-line box that keeps the rail compact.
    const isActiveLine = entry.status === 'active';
    const textMask = isActiveLine
        ? undefined
        : getClippedTextMask(
            entry.layout.isTextClipped,
            vGlowBufferPx + entry.layout.textPaddingTopPx + entry.layout.textContentHeightPx,
            Math.max(lyricFontPx * 0.55, 12),
        );
    const textEdgeMask = getEdgeFadeMask(entry.layout.isTextOverflowingWidth, Math.max(lyricFontPx * 0.9, 24));
    const textMaskStyle = composeLineMasks(textMask, textEdgeMask);
    const translationMask = getLineMask(entry.layout.isTranslationClipped, Math.max(translationFontPx * 0.65, 10));
    const handleSeek = (event: React.MouseEvent | React.KeyboardEvent) => {
        if (!canSeek) {
            return;
        }

        event.stopPropagation();
        onLineSeek?.(entry.line);
    };
    const handleClickSeek = (event: React.MouseEvent<HTMLDivElement>) => {
        handleSeek(event);
        event.currentTarget.blur();
    };

    return (
        <motion.div
            role={canSeek ? 'button' : undefined}
            tabIndex={canSeek ? 0 : undefined}
            onClick={canSeek ? handleClickSeek : undefined}
            onKeyDown={canSeek ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSeek(event);
                }
            } : undefined}
            className={`absolute top-0 min-w-0 will-change-transform ${canSeek ? 'cursor-pointer' : ''}`}
            initial={disableEntryMotion ? false : {
                opacity: 0,
                y: entry.y + initialOffset,
                scale: entry.tone.scale * 0.98,
                filter: 'blur(5px)',
            }}
            animate={{
                opacity: entry.tone.opacity,
                y: entry.y,
                scale: entry.tone.scale,
                filter: `blur(${entry.tone.blurPx}px)`,
            }}
            exit={disableEntryMotion ? undefined : {
                opacity: 0,
                y: entry.y + exitOffset,
                scale: entry.tone.scale * 0.98,
                filter: 'blur(6px)',
                transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
            }}
            transition={MONET_SCROLL_TRANSITION}
            style={{
                left: `${glowBufferPx}px`,
                right: `${glowBufferPx}px`,
                height: entry.layout.visualHeightPx,
                transformOrigin: 'left top',
                zIndex: entry.tone.zIndex,
            }}
        >
            {entry.line.isChorus && (
                <motion.div
                    className="absolute inset-0 pointer-events-none -z-10 rounded-2xl"
                    initial={{ opacity: 0 }}
                    animate={{
                        opacity: entry.status === 'active' ? 1 : 0,
                        scale: entry.status === 'active' ? 1.02 : 0.96,
                    }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    style={{
                        background: `radial-gradient(circle at 50% 45%, ${colorWithAlpha(theme.accentColor, 0.14)} 0%, ${colorWithAlpha(theme.accentColor, 0.04)} 55%, transparent 82%)`,
                        filter: 'blur(10px)',
                    }}
                />
            )}
            <div
                className="min-w-0 overflow-hidden pointer-events-none"
                style={{
                    marginLeft: `-${glowBufferPx}px`,
                    marginRight: `-${glowBufferPx}px`,
                    paddingLeft: `${glowBufferPx}px`,
                    paddingRight: `${glowBufferPx}px`,
                    marginTop: `-${vGlowBufferPx}px`,
                    marginBottom: `-${vGlowBufferPx}px`,
                    paddingTop: `${entry.layout.textPaddingTopPx + vGlowBufferPx}px`,
                    paddingBottom: `${entry.layout.textPaddingBottomPx + vGlowBufferPx}px`,
                    height: isActiveLine
                        ? undefined
                        : `${entry.layout.textHeightPx + vGlowBufferPx * 2}px`,
                    boxSizing: 'border-box',
                    fontFamily: fontStack,
                    fontSize: lyricFontPx,
                    fontWeight: entry.tone.fontWeight,
                    lineHeight: `${entry.layout.lineHeightPx}px`,
                    letterSpacing: 0,
                    ...textMaskStyle,
                    textShadow: entry.status === 'active'
                        ? `0 14px 34px ${colorWithAlpha(theme.backgroundColor, 0.22)}`
                        : 'none',
                }}
            >
                <MonetTimedTokenSpan
                    entry={entry}
                    currentTime={currentTime}
                    accentColor={colorWithAlpha(theme.primaryColor, 0.98)}
                    fontPx={lyricFontPx}
                    fontStack={fontStack}
                    fontsEpoch={fontsEpoch}
                    wordColorMatchers={wordColorMatchers}
                    isChorus={entry.line.isChorus}
                    chorusAccentColor={theme.accentColor}
                    audioPower={audioPower}
                    renderStaticPassed={renderStaticPassed}
                />
            </div>
            {showSubtitleTranslation && entry.status === 'active' && entry.line.translation ? (
                <motion.div
                    className="min-w-0 overflow-hidden whitespace-pre-wrap break-words"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                    style={{
                        marginLeft: `-${glowBufferPx}px`,
                        marginRight: `-${glowBufferPx}px`,
                        paddingLeft: `${glowBufferPx}px`,
                        paddingRight: `${glowBufferPx}px`,
                        height: entry.layout.translationHeightPx,
                        paddingTop: entry.layout.translationPaddingTopPx,
                        paddingBottom: entry.layout.translationPaddingBottomPx,
                        boxSizing: 'border-box',
                        color: colorWithAlpha(theme.primaryColor, 0.68),
                        fontFamily: translationFontStack,
                        fontSize: translationFontPx,
                        fontWeight: translationFontWeight,
                        lineHeight: `${entry.layout.translationLineHeightPx}px`,
                        letterSpacing: 0,
                        WebkitMaskImage: translationMask,
                        maskImage: translationMask,
                        WebkitMaskRepeat: 'no-repeat',
                        maskRepeat: 'no-repeat',
                        WebkitMaskSize: '100% 100%',
                        maskSize: '100% 100%',
                    }}
                >
                    {entry.line.translation}
                </motion.div>
            ) : null}
        </motion.div>
    );
};

const MonetLyricsRail: React.FC<MonetLyricsRailProps> = ({
    entries,
    lines,
    currentLineIndex,
    currentTime,
    theme,
    lyricFontPx,
    inactiveFontPx,
    translationFontPx,
    fontStack,
    translationFontStack = fontStack,
    subtitleTheme,
    keywordColoringEnabled,
    emptyText,
    showSubtitleTranslation = true,
    audioPower,
    audioBands,
    onLyricLineSeek,
    seekDisabled = false,
    layoutScale = 1,
}) => {
    const railRef = useRef<HTMLDivElement | null>(null);
    const layoutCacheRef = useRef<MonetLayoutCache>(new Map());
    const manualScrollResetRef = useRef<number | null>(null);
    const wheelAccumulatorRef = useRef(0);
    const wheelDirectionRef = useRef(0);
    const touchLastYRef = useRef<number | null>(null);
    const touchAccumulatorRef = useRef(0);
    const touchDirectionRef = useRef(0);
    const [manualScrollAnchorIndex, setManualScrollAnchorIndex] = useState<number | null>(null);
    const railSize = useMonetRailSize(railRef);
    const fontsEpoch = useFontsEpoch();
    const handledFontsEpochRef = useRef(0);
    const glowBufferPx = Math.round(lyricFontPx * 1.2);
    const vGlowBufferPx = Math.round(lyricFontPx * 1.2);
    // Grows with the same factor as the font, so the column-to-font ratio — and the wrapping — holds.
    const railMaxWidthPx = Math.round(MONET_RAIL_BASE_MAX_WIDTH_PX * layoutScale);
    const railMaxHeightPx = Math.round(Math.max(
        MONET_RAIL_BASE_MAX_HEIGHT_PX * layoutScale,
        lyricFontPx * 1.18 * MONET_RAIL_MIN_ROWS,
    ));
    const canSeek = Boolean(onLyricLineSeek) && !seekDisabled;
    const lyricFontWeight = resolveThemeFontWeight(theme, 600);
    const translationFontWeight = resolveThemeFontWeight(subtitleTheme ?? theme, 500);

    const visibleEntries = useMemo(
        () => manualScrollAnchorIndex === null
            ? entries
            : buildScrollableRailEntries(lines, manualScrollAnchorIndex, currentLineIndex),
        [currentLineIndex, entries, lines, manualScrollAnchorIndex],
    );
    const isManualScrolling = manualScrollAnchorIndex !== null;

    const positionedEntries = useMemo(
        () => {
            // A line measured against a fallback face wraps differently from what is painted, which
            // under-reserves its height and drops the translation onto the next lyric. Invalidate
            // here rather than in an effect, so the recompute below already sees fresh metrics.
            if (handledFontsEpochRef.current !== fontsEpoch) {
                handledFontsEpochRef.current = fontsEpoch;
                clearMonetMeasurementCaches();
                layoutCacheRef.current.clear();
            }

            return buildPositionedEntries(
                visibleEntries,
                railSize,
                theme,
                lyricFontPx,
                inactiveFontPx,
                translationFontPx,
                fontStack,
                translationFontStack,
                lyricFontWeight,
                translationFontWeight,
                glowBufferPx,
                showSubtitleTranslation,
                layoutCacheRef.current,
            );
        },
        [visibleEntries, railSize, theme, lyricFontPx, inactiveFontPx, translationFontPx, fontStack, translationFontStack, lyricFontWeight, translationFontWeight, glowBufferPx, showSubtitleTranslation, fontsEpoch],
    );
    const wordColorMatchers = useMemo(
        () => prepareWordColorMatchers(theme.wordColors, keywordColoringEnabled),
        [keywordColoringEnabled, theme.wordColors],
    );
    const getFallbackAnchorIndex = useCallback(() => {
        if (manualScrollAnchorIndex !== null) {
            return manualScrollAnchorIndex;
        }
        if (currentLineIndex >= 0) {
            return currentLineIndex;
        }
        return entries.find(entry => entry.offset === 0)?.index ?? 0;
    }, [currentLineIndex, entries, manualScrollAnchorIndex]);

    const scheduleManualScrollReset = useCallback(() => {
        if (manualScrollResetRef.current !== null) {
            window.clearTimeout(manualScrollResetRef.current);
        }
        manualScrollResetRef.current = window.setTimeout(() => {
            setManualScrollAnchorIndex(null);
            wheelAccumulatorRef.current = 0;
            wheelDirectionRef.current = 0;
            touchAccumulatorRef.current = 0;
            touchDirectionRef.current = 0;
            manualScrollResetRef.current = null;
        }, MONET_SCROLL_IDLE_RESET_MS);
    }, []);

    const moveManualScrollAnchor = useCallback((steps: number) => {
        if (lines.length === 0) {
            return;
        }

        setManualScrollAnchorIndex(current => {
            const baseIndex = current ?? getFallbackAnchorIndex();
            return Math.round(clamp(baseIndex + steps, 0, lines.length - 1));
        });
        scheduleManualScrollReset();
    }, [getFallbackAnchorIndex, lines.length, scheduleManualScrollReset]);

    const handleRailWheel = useCallback((event: WheelEvent) => {
        if (lines.length === 0) {
            return;
        }

        if (event.cancelable) {
            event.preventDefault();
        }
        event.stopPropagation();
        const direction = getScrollDirection(event.deltaY);
        if (direction !== 0 && wheelDirectionRef.current !== 0 && direction !== wheelDirectionRef.current) {
            wheelAccumulatorRef.current = 0;
        }
        wheelDirectionRef.current = direction || wheelDirectionRef.current;
        wheelAccumulatorRef.current += event.deltaY;
        const steps = clampScrollSteps(Math.trunc(wheelAccumulatorRef.current / MONET_SCROLL_STEP_PX));
        if (steps !== 0) {
            wheelAccumulatorRef.current = 0;
            moveManualScrollAnchor(steps);
        } else {
            scheduleManualScrollReset();
        }
    }, [lines.length, moveManualScrollAnchor, scheduleManualScrollReset]);

    const handleRailTouchStart = useCallback((event: TouchEvent) => {
        if (lines.length === 0) {
            return;
        }

        event.stopPropagation();
        touchLastYRef.current = event.touches[0]?.clientY ?? null;
        touchAccumulatorRef.current = 0;
        touchDirectionRef.current = 0;
        setManualScrollAnchorIndex(getFallbackAnchorIndex());
        scheduleManualScrollReset();
    }, [getFallbackAnchorIndex, lines.length, scheduleManualScrollReset]);

    const handleRailTouchMove = useCallback((event: TouchEvent) => {
        if (lines.length === 0 || touchLastYRef.current === null) {
            return;
        }

        event.stopPropagation();
        const nextY = event.touches[0]?.clientY;
        if (typeof nextY !== 'number') {
            return;
        }

        const deltaY = touchLastYRef.current - nextY;
        touchLastYRef.current = nextY;
        const direction = getScrollDirection(deltaY);
        if (direction !== 0 && touchDirectionRef.current !== 0 && direction !== touchDirectionRef.current) {
            touchAccumulatorRef.current = 0;
        }
        touchDirectionRef.current = direction || touchDirectionRef.current;
        touchAccumulatorRef.current += deltaY;
        const steps = clampScrollSteps(Math.trunc(touchAccumulatorRef.current / MONET_TOUCH_STEP_PX));
        if (steps !== 0) {
            touchAccumulatorRef.current = 0;
            moveManualScrollAnchor(steps);
        } else {
            scheduleManualScrollReset();
        }
    }, [lines.length, moveManualScrollAnchor, scheduleManualScrollReset]);

    const handleRailTouchEnd = useCallback(() => {
        touchLastYRef.current = null;
        touchDirectionRef.current = 0;
        touchAccumulatorRef.current = 0;
        scheduleManualScrollReset();
    }, [scheduleManualScrollReset]);

    useEffect(() => {
        const rail = railRef.current;
        if (!rail) {
            return undefined;
        }

        rail.addEventListener('wheel', handleRailWheel, MONET_RAIL_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchstart', handleRailTouchStart, MONET_RAIL_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchmove', handleRailTouchMove, MONET_RAIL_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchend', handleRailTouchEnd, MONET_RAIL_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchcancel', handleRailTouchEnd, MONET_RAIL_SCROLL_EVENT_OPTIONS);

        return () => {
            rail.removeEventListener('wheel', handleRailWheel, MONET_RAIL_SCROLL_EVENT_OPTIONS);
            rail.removeEventListener('touchstart', handleRailTouchStart, MONET_RAIL_SCROLL_EVENT_OPTIONS);
            rail.removeEventListener('touchmove', handleRailTouchMove, MONET_RAIL_SCROLL_EVENT_OPTIONS);
            rail.removeEventListener('touchend', handleRailTouchEnd, MONET_RAIL_SCROLL_EVENT_OPTIONS);
            rail.removeEventListener('touchcancel', handleRailTouchEnd, MONET_RAIL_SCROLL_EVENT_OPTIONS);
        };
    }, [handleRailTouchEnd, handleRailTouchMove, handleRailTouchStart, handleRailWheel]);

    const handleLineSeek = useCallback((line: Line) => {
        if (!canSeek) {
            return;
        }

        onLyricLineSeek?.(line.startTime);
        setManualScrollAnchorIndex(null);
    }, [canSeek, onLyricLineSeek]);

    useEffect(() => {
        return () => {
            if (manualScrollResetRef.current !== null) {
                window.clearTimeout(manualScrollResetRef.current);
            }
        };
    }, []);

    return (
        <div
            ref={railRef}
            className="relative select-none overflow-hidden"
            style={{
                height: `clamp(280px, 52vh, ${railMaxHeightPx}px)`,
                maxWidth: `${railMaxWidthPx}px`,
                marginLeft: `-${glowBufferPx}px`,
                marginRight: `-${glowBufferPx}px`,
                paddingLeft: `${glowBufferPx}px`,
                paddingRight: `${glowBufferPx}px`,
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 11%, black 88%, transparent 100%)',
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 11%, black 88%, transparent 100%)',
            }}
        >
            {positionedEntries.length > 0 ? (
                <AnimatePresence initial={false}>
                    {positionedEntries.map(entry => (
                        <MonetRailLine
                            key={entry.key}
                            entry={entry}
                            currentTime={currentTime}
                            theme={theme}
                            lyricFontPx={lyricFontPx}
                            translationFontPx={translationFontPx}
                            fontStack={fontStack}
                            translationFontStack={translationFontStack}
                            translationFontWeight={translationFontWeight}
                            glowBufferPx={glowBufferPx}
                            vGlowBufferPx={vGlowBufferPx}
                            fontsEpoch={fontsEpoch}
                            wordColorMatchers={wordColorMatchers}
                            showSubtitleTranslation={showSubtitleTranslation}
                            audioPower={audioPower}
                            onLineSeek={handleLineSeek}
                            canSeek={canSeek}
                            disableEntryMotion={isManualScrolling}
                            renderStaticPassed={isManualScrolling && entry.index !== currentLineIndex}
                        />
                    ))}
                </AnimatePresence>
            ) : emptyText ? (
                <div
                    className="absolute left-0 top-1/2 -translate-y-1/2"
                    style={{
                        color: theme.primaryColor,
                        fontSize: 'clamp(1.8rem, 4.2vw, 3.2rem)',
                        fontWeight: lyricFontWeight,
                        letterSpacing: 0,
                        opacity: 0.72,
                    }}
                >
                    {emptyText}
                </div>
            ) : null}
        </div>
    );
};

export default MonetLyricsRail;
