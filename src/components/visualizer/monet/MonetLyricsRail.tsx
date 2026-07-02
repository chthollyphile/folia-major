import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useTransform, MotionValue } from 'framer-motion';
import type { Theme, AudioBands } from '../../../types';
import type { GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { colorWithAlpha, mixColors } from '../colorMix';
import {
    buildWordColorRangesFromMatchers,
    prepareWordColorMatchers,
    resolveWordColor,
    resolveTokenColorMap,
    type WordColorMatcher,
} from '../wordColoring';
import {
    buildMonetDisplayTokens,
    measureMonetGraphemeOffsets,
    measureMonetLineLayout,
    resolveMonetWordStatus,
    type MonetLineStatus,
    type MonetMeasuredLineLayout,
    type MonetVisibleLineEntry,
} from './monetLyricsModel';

// src/components/visualizer/monet/MonetLyricsRail.tsx
// Renders Monet lyrics on fixed transform tracks so scrolling stays smooth without layout reflow jumps.

interface MonetLyricsRailProps {
    entries: MonetVisibleLineEntry[];
    currentTime: MotionValue<number>;
    theme: Theme;
    lyricFontPx: number;
    inactiveFontPx: number;
    translationFontPx: number;
    fontStack: string;
    keywordColoringEnabled: boolean;
    emptyText: string;
    audioPower?: MotionValue<number>;
    audioBands?: AudioBands;
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

const MONET_RAIL_WIDTH_FALLBACK_PX = 680;
const MONET_RAIL_HEIGHT_FALLBACK_PX = 340;
const MONET_ACTIVE_GAP_PX = 18;
const MONET_INACTIVE_GAP_PX = 14;
const MONET_GLOW_RISE_DURATION_SCALE = 1.18;
const MONET_GLOW_PASS_TAIL_SECONDS = 1.05;
const MONET_SCROLL_TRANSITION = {
    y: { type: 'spring', stiffness: 142, damping: 28, mass: 0.82 },
    scale: { type: 'spring', stiffness: 150, damping: 30, mass: 0.78 },
    opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] },
    filter: { duration: 0.32, ease: [0.32, 0.72, 0, 1] },
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

const resolveLineGap = (previous: PositionedMonetLineEntry, next: PositionedMonetLineEntry): number => (
    previous.status === 'active' || next.status === 'active'
        ? MONET_ACTIVE_GAP_PX
        : MONET_INACTIVE_GAP_PX
);

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
    glowBufferPx: number,
): PositionedMonetLineEntry[] => {
    const railWidth = railSize.width || MONET_RAIL_WIDTH_FALLBACK_PX;
    const railHeight = railSize.height || MONET_RAIL_HEIGHT_FALLBACK_PX;
    const inactiveScale = clamp(inactiveFontPx / Math.max(lyricFontPx, 1), 0.72, 0.92);
    const contentWidthPx = Math.max(railWidth - glowBufferPx * 2, 0);

    const measuredEntries: PositionedMonetLineEntry[] = entries.map(entry => {
        const tone = resolveLineTone(entry, theme, inactiveScale);
        const layout = measureMonetLineLayout({
            line: entry.line,
            status: entry.status,
            fontPx: lyricFontPx,
            translationFontPx,
            fontStack,
            maxWidthPx: contentWidthPx - 8,
        });

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
        current.y = previous.y + previous.scaledHeight + resolveLineGap(previous, current);
    }

    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
        const current = measuredEntries[index];
        const next = measuredEntries[index + 1];
        current.y = next.y - current.scaledHeight - resolveLineGap(current, next);
    }

    return measuredEntries;
};

const getLineMask = (isClipped: boolean, fadePx: number) => (
    isClipped
        ? `linear-gradient(180deg, black 0%, black calc(100% - ${fadePx}px), transparent 100%)`
        : undefined
);

const MonetTimedTokenSpan: React.FC<{
    entry: PositionedMonetLineEntry;
    currentTime: MotionValue<number>;
    accentColor: string;
    fontPx: number;
    fontStack: string;
    wordColorMatchers: WordColorMatcher[];
    isChorus?: boolean;
    chorusAccentColor?: string;
    audioPower?: MotionValue<number>;
}> = ({ entry, currentTime, accentColor, fontPx, fontStack, wordColorMatchers, isChorus, chorusAccentColor, audioPower }) => {
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
                token.timed && token.startTime !== null && token.endTime !== null ? (
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
    isChorus,
    audioPower,
}) => {
        const isLineActive = lineStatus === 'active';
        const canRenderGlow = lineStatus === 'active' || lineStatus === 'passed';
        const graphemeOffsets = useMemo(
            () => measureMonetGraphemeOffsets(text, fontPx, fontSpec),
            [text, fontPx, fontSpec],
        );

        const wordStatus = useTransform(currentTime, latest => (
            isLineActive ? resolveMonetWordStatus(latest, startTime, endTime) : lineStatus
        ));

        const wordProgress = useTransform(currentTime, latest => {
            if (!isLineActive || latest <= startTime) return 0;
            if (latest >= endTime) return 1;
            return (latest - startTime) / Math.max(0.001, endTime - startTime);
        });

        const fillWidth = useTransform(currentTime, latest => {
            const fullWidth = graphemeOffsets[graphemeOffsets.length - 1] ?? 0;
            if (!isLineActive || latest <= startTime) return 0;
            if (latest >= endTime) return fullWidth;

            const timingCount = Math.min(graphemeTimings.length, graphemeOffsets.length - 1);
            if (timingCount > 0) {
                for (let index = 0; index < timingCount; index += 1) {
                    const timing = graphemeTimings[index];
                    const timingStart = Math.max(startTime, timing.startTime);
                    const timingEnd = Math.max(timingStart, timing.endTime);
                    const startWidth = graphemeOffsets[index] ?? 0;
                    const endWidth = graphemeOffsets[index + 1] ?? startWidth;

                    if (latest < timingStart) {
                        return startWidth;
                    }

                    if (latest <= timingEnd) {
                        const duration = Math.max(0.001, timingEnd - timingStart);
                        const progress = (latest - timingStart) / duration;
                        return startWidth + (endWidth - startWidth) * progress;
                    }
                }

                return graphemeOffsets[timingCount] ?? fullWidth;
            }

            const progress = (latest - startTime) / Math.max(0.001, endTime - startTime);
            if (progress <= 0) return 0;
            if (progress >= 1) return fullWidth;
            const graphemeCount = graphemeOffsets.length - 1;
            const floatIndex = progress * graphemeCount;
            const wholeIndex = Math.floor(floatIndex);
            const fractional = floatIndex - wholeIndex;
            const startWidth = graphemeOffsets[Math.min(wholeIndex, graphemeOffsets.length - 1)] ?? 0;
            const endWidth = graphemeOffsets[Math.min(wholeIndex + 1, graphemeOffsets.length - 1)] ?? startWidth;
            return startWidth + (endWidth - startWidth) * fractional;
        });

        const maskImage = useTransform(fillWidth, latest => {
            const edgeSoftness = Math.max(Math.min(fontPx * 0.45, 16), 6);
            const solidEnd = Math.max(latest - edgeSoftness, 0);
            const featherStart = Math.max(latest - edgeSoftness * 0.55, 0);
            const featherEnd = Math.max(latest, 0);
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

            const wordDuration = Math.max(0.001, endTime - startTime);
            const glowRiseDuration = wordDuration * MONET_GLOW_RISE_DURATION_SCALE;
            const glowPeakTime = startTime + glowRiseDuration;
            const glowTailEndTime = Math.max(lineRenderEndTime, endTime + MONET_GLOW_PASS_TAIL_SECONDS);
            let intensity: number;
            if (latest <= glowPeakTime) {
                const progress = Math.min(1, Math.max(0, (latest - startTime) / glowRiseDuration));
                // 使用 Smoothstep (ease-in-out) 曲线，让发光开始和到达峰值时都平滑过渡
                intensity = progress * progress * (3 - 2 * progress);
            } else {
                const decayDuration = Math.max(0.18, glowTailEndTime - glowPeakTime);
                const decayProgress = Math.min(1, Math.max(0, (latest - glowPeakTime) / decayDuration));
                const remaining = 1 - decayProgress;
                // 使用 Smoothstep (ease-in-out)，让衰退初期缓慢（有“驻留”感），然后再平滑消失
                intensity = remaining * remaining * (3 - 2 * remaining);
            }

            if (intensity <= 0) return 'none';

            const radiusOne = Math.round(fontPx * (isChorus ? 0.45 : 0.28));
            const radiusTwo = Math.round(fontPx * (isChorus ? 0.90 : 0.65));
            const maxAlpha = isChorus ? 1.0 : 0.88;
            const glowColor = mixColors(baseColor, wordColor, intensity, intensity * maxAlpha);
            return `0 0 ${radiusOne}px ${glowColor}, 0 0 ${radiusTwo}px ${glowColor}`;
        }) as unknown as MotionValue<string>;

        return (
            <span className="relative inline-block whitespace-pre-wrap break-words">
                <motion.span style={{ color: resolvedBaseColor, textShadow: glowShadow }}>
                    {text}
                </motion.span>
                {isLineActive ? (
                    <motion.span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 block whitespace-pre-wrap break-words"
                        style={{
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
    glowBufferPx: number;
    vGlowBufferPx: number;
    wordColorMatchers: WordColorMatcher[];
    audioPower?: MotionValue<number>;
}> = ({ entry, currentTime, theme, lyricFontPx, translationFontPx, fontStack, glowBufferPx, vGlowBufferPx, wordColorMatchers, audioPower }) => {
    const initialOffset = entry.offset >= 0 ? 34 : -34;
    const exitOffset = entry.status === 'passed' || entry.offset < 0 ? -38 : 38;
    const textMask = getLineMask(entry.layout.isTextClipped, Math.max(lyricFontPx * 0.55, 12));
    const translationMask = getLineMask(entry.layout.isTranslationClipped, Math.max(translationFontPx * 0.65, 10));

    return (
        <motion.div
            className="absolute top-0 min-w-0 will-change-transform"
            initial={{
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
            exit={{
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
                className="min-w-0 overflow-hidden"
                style={{
                    marginLeft: `-${glowBufferPx}px`,
                    marginRight: `-${glowBufferPx}px`,
                    paddingLeft: `${glowBufferPx}px`,
                    paddingRight: `${glowBufferPx}px`,
                    marginTop: `-${vGlowBufferPx}px`,
                    marginBottom: `-${vGlowBufferPx}px`,
                    paddingTop: `${entry.layout.textPaddingTopPx + vGlowBufferPx}px`,
                    paddingBottom: `${entry.layout.textPaddingBottomPx + vGlowBufferPx}px`,
                    height: `${entry.layout.textHeightPx + vGlowBufferPx * 2}px`,
                    boxSizing: 'border-box',
                    fontFamily: fontStack,
                    fontSize: lyricFontPx,
                    fontWeight: entry.tone.fontWeight,
                    lineHeight: `${entry.layout.lineHeightPx}px`,
                    letterSpacing: 0,
                    WebkitMaskImage: textMask,
                    maskImage: textMask,
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                    WebkitMaskSize: '100% 100%',
                    maskSize: '100% 100%',
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
                    wordColorMatchers={wordColorMatchers}
                    isChorus={entry.line.isChorus}
                    chorusAccentColor={theme.accentColor}
                    audioPower={audioPower}
                />
            </div>
            {entry.status === 'active' && entry.line.translation ? (
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
                        fontFamily: fontStack,
                        fontSize: translationFontPx,
                        fontWeight: 500,
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
    currentTime,
    theme,
    lyricFontPx,
    inactiveFontPx,
    translationFontPx,
    fontStack,
    keywordColoringEnabled,
    emptyText,
    audioPower,
    audioBands,
}) => {
    const railRef = useRef<HTMLDivElement | null>(null);
    const railSize = useMonetRailSize(railRef);
    const glowBufferPx = Math.round(lyricFontPx * 1.2);
    const vGlowBufferPx = Math.round(lyricFontPx * 1.2);

    const positionedEntries = useMemo(
        () => buildPositionedEntries(
            entries,
            railSize,
            theme,
            lyricFontPx,
            inactiveFontPx,
            translationFontPx,
            fontStack,
            glowBufferPx,
        ),
        [entries, railSize, theme, lyricFontPx, inactiveFontPx, translationFontPx, fontStack, glowBufferPx],
    );
    const wordColorMatchers = useMemo(
        () => prepareWordColorMatchers(theme.wordColors, keywordColoringEnabled),
        [keywordColoringEnabled, theme.wordColors],
    );

    return (
        <div
            ref={railRef}
            className="relative h-[clamp(260px,42vh,400px)] max-w-[720px] overflow-hidden"
            style={{
                marginLeft: `-${glowBufferPx}px`,
                marginRight: `-${glowBufferPx}px`,
                paddingLeft: `${glowBufferPx}px`,
                paddingRight: `${glowBufferPx}px`,
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
                            glowBufferPx={glowBufferPx}
                            vGlowBufferPx={vGlowBufferPx}
                            wordColorMatchers={wordColorMatchers}
                            audioPower={audioPower}
                        />
                    ))}
                </AnimatePresence>
            ) : emptyText ? (
                <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 font-semibold"
                    style={{
                        color: theme.primaryColor,
                        fontSize: 'clamp(1.8rem, 4.2vw, 3.2rem)',
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
