import React, { useEffect, useMemo, useRef, useState } from 'react';
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import { AnimatePresence, motion, useTransform, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    DEFAULT_MONET_TUNING,
    type Line,
    type MonetBackgroundImage,
    type MonetTuning,
} from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { type VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import MonetBackground from './MonetBackground';
import AudioOverlay from './AudioOverlay';
import MonetFloatingDecor from './MonetFloatingDecor';

// src/components/visualizer/monet/VisualizerMonet.tsx
// Monet keeps lyrics and translation in one aligned rail so the poster layout reads as a single synchronized group.
type VisualizerMonetProps = VisualizerSharedProps;

interface MonetDisplayToken {
    text: string;
    startTime: number | null;
    endTime: number | null;
    key: string;
}

export interface MonetLyricContext {
    previousLine: Line | null;
    activeLine: Line | null;
    nextLine: Line | null;
}

const ROOT_FONT_PX = 16;
const VIEWPORT_WIDTH_FALLBACK_PX = 1280;
const graphemeSegmenter = typeof Intl !== 'undefined'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const resolveClampFontPx = (minRem: number, preferredVw: number, maxRem: number): number => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : VIEWPORT_WIDTH_FALLBACK_PX;
    return Math.min(maxRem * ROOT_FONT_PX, Math.max(minRem * ROOT_FONT_PX, viewportWidth * (preferredVw / 100)));
};

/** Measures text width with pretext so lyric highlight progress follows the rendered line instead of raw token count. */
const measureTextWidthAtPx = (text: string, fontPx: number, fontSpec: string): number => {
    const prepared = prepareWithSegments(text || ' ', fontSpec);
    const layout = layoutWithLines(prepared, 99999, fontPx * 1.2);
    return layout.lines[0]?.width ?? Math.max(text.length, 1) * fontPx * 0.6;
};

const splitGraphemes = (text: string): string[] => {
    if (!text) {
        return [];
    }
    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
    }
    return Array.from(text);
};

/** Builds cumulative grapheme offsets so the lyric fill edge can sweep through glyphs instead of stepping whole words. */
const measureGraphemeOffsets = (text: string, fontPx: number, fontSpec: string): number[] => {
    const graphemes = splitGraphemes(text);
    const offsets = new Array<number>(graphemes.length + 1).fill(0);
    for (let index = 1; index <= graphemes.length; index += 1) {
        offsets[index] = measureTextWidthAtPx(graphemes.slice(0, index).join(''), fontPx, fontSpec);
    }
    return offsets;
};

interface MonetTimedGraphemeRange {
    startTime: number;
    endTime: number;
    startIndex: number;
    endIndex: number;
}

interface MonetWrappedLyricLine {
    text: string;
    startIndex: number;
    endIndex: number;
    graphemeOffsets: number[];
    width: number;
}

/** Maps timed lyric words onto grapheme indices so highlight progress can advance continuously across wrapped lines. */
const buildTimedGraphemeRanges = (line: Line): MonetTimedGraphemeRange[] => {
    const fullTextGraphemes = splitGraphemes(line.fullText);
    if (line.words.length === 0) {
        return [{
            startTime: line.startTime,
            endTime: getLineRenderEndTime(line),
            startIndex: 0,
            endIndex: fullTextGraphemes.length,
        }];
    }

    const ranges: MonetTimedGraphemeRange[] = [];
    let cursor = 0;

    line.words.forEach(word => {
        const wordGraphemes = splitGraphemes(word.text);
        if (wordGraphemes.length === 0) {
            return;
        }

        let start = Math.max(cursor, 0);
        let found = false;
        for (let index = cursor; index <= fullTextGraphemes.length - wordGraphemes.length; index += 1) {
            let matches = true;
            for (let offset = 0; offset < wordGraphemes.length; offset += 1) {
                if (fullTextGraphemes[index + offset] !== wordGraphemes[offset]) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                start = index;
                found = true;
                break;
            }
        }

        if (!found) {
            start = Math.min(cursor, fullTextGraphemes.length);
        }

        const end = Math.min(start + wordGraphemes.length, fullTextGraphemes.length);
        ranges.push({
            startTime: word.startTime,
            endTime: word.endTime,
            startIndex: start,
            endIndex: end,
        });
        cursor = end;
    });

    if (ranges.length === 0) {
        return [{
            startTime: line.startTime,
            endTime: getLineRenderEndTime(line),
            startIndex: 0,
            endIndex: fullTextGraphemes.length,
        }];
    }

    const lastEnd = ranges[ranges.length - 1]?.endIndex ?? 0;
    if (lastEnd < fullTextGraphemes.length) {
        ranges.push({
            startTime: line.words[line.words.length - 1]?.endTime ?? line.startTime,
            endTime: getLineRenderEndTime(line),
            startIndex: lastEnd,
            endIndex: fullTextGraphemes.length,
        });
    }

    return ranges;
};

const buildWrappedLyricLines = (text: string, fontSpec: string, lineHeightPx: number, maxWidth: number): MonetWrappedLyricLine[] => {
    if (maxWidth <= 0) {
        return [];
    }

    const prepared = prepareWithSegments(text || ' ', fontSpec);
    const layout = layoutWithLines(prepared, maxWidth, lineHeightPx);
    const wrappedLines = layout.lines ?? [];
    const fullTextGraphemes = splitGraphemes(text);
    const result: MonetWrappedLyricLine[] = [];
    let cursor = 0;

    wrappedLines.forEach(layoutLine => {
        const lineText = layoutLine.text ?? '';
        const graphemes = splitGraphemes(lineText);
        const startIndex = cursor;
        const endIndex = Math.min(cursor + graphemes.length, fullTextGraphemes.length);
        const graphemeOffsets = measureGraphemeOffsets(lineText, Math.max(lineHeightPx / 1.08, 1), fontSpec);
        result.push({
            text: lineText,
            startIndex,
            endIndex,
            graphemeOffsets,
            width: graphemeOffsets[graphemeOffsets.length - 1] ?? layoutLine.width ?? 0,
        });
        cursor = endIndex;
    });

    return result;
};

/** Builds a stable display-token list so fullText punctuation and spaces survive around timed lyric words. */
export const buildMonetDisplayTokens = (line: Line): MonetDisplayToken[] => {
    if (line.words.length === 0) {
        return [{
            text: line.fullText,
            startTime: line.startTime,
            endTime: getLineRenderEndTime(line),
            key: `${line.startTime}-full`,
        }];
    }

    const tokens: MonetDisplayToken[] = [];
    let cursor = 0;
    line.words.forEach((word, index) => {
        const matchIndex = line.fullText.indexOf(word.text, cursor);
        if (matchIndex > cursor) {
            tokens.push({
                text: line.fullText.slice(cursor, matchIndex),
                startTime: index > 0 ? line.words[index - 1].endTime : line.startTime,
                endTime: word.startTime,
                key: `${line.startTime}-static-${cursor}`,
            });
        }

        tokens.push({
            text: word.text,
            startTime: word.startTime,
            endTime: word.endTime,
            key: `${line.startTime}-${index}-${word.startTime}`,
        });

        cursor = matchIndex === -1 ? cursor : matchIndex + word.text.length;
    });

    if (cursor < line.fullText.length) {
        tokens.push({
            text: line.fullText.slice(cursor),
            startTime: line.words[line.words.length - 1]?.endTime ?? line.startTime,
            endTime: getLineRenderEndTime(line),
            key: `${line.startTime}-tail`,
        });
    }

    return tokens;
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

const MonetTimedTokenSpan: React.FC<{
    line: Line;
    currentTime: MotionValue<number>;
    isActive: boolean;
    accentColor: string;
    baseColor: string;
    fontPx: number;
    fontWeight: number;
    fontStack: string;
}> = ({ line, currentTime, isActive, accentColor, baseColor, fontPx, fontWeight, fontStack }) => {
    const rootRef = useRef<HTMLSpanElement | null>(null);
    const [availableWidth, setAvailableWidth] = useState(0);
    const [measuredFontPx, setMeasuredFontPx] = useState(fontPx);
    const [measuredLineHeightPx, setMeasuredLineHeightPx] = useState(fontPx * 1.08);
    const fontSpec = useMemo(
        () => `${fontWeight} ${measuredFontPx}px ${fontStack}`,
        [fontStack, fontWeight, measuredFontPx],
    );
    useEffect(() => {
        const node = rootRef.current;
        if (!node) {
            return;
        }

        const updateWidth = () => {
            const nextWidth = Math.max(Math.floor(node.clientWidth), 0);
            setAvailableWidth(current => (current === nextWidth ? current : nextWidth));
            const computedStyle = window.getComputedStyle(node);
            const nextFontPx = Number.parseFloat(computedStyle.fontSize) || fontPx;
            const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
            const nextLineHeightPx = Number.isFinite(parsedLineHeight) ? parsedLineHeight : nextFontPx * 1.08;
            setMeasuredFontPx(current => (Math.abs(current - nextFontPx) < 0.25 ? current : nextFontPx));
            setMeasuredLineHeightPx(current => (Math.abs(current - nextLineHeightPx) < 0.25 ? current : nextLineHeightPx));
        };

        updateWidth();

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(() => {
            updateWidth();
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [fontPx]);
    const timedRanges = useMemo(() => buildTimedGraphemeRanges(line), [line]);
    const wrappedLines = useMemo(
        () => buildWrappedLyricLines(line.fullText, fontSpec, measuredLineHeightPx, availableWidth),
        [availableWidth, fontSpec, line.fullText, measuredLineHeightPx],
    );
    const absoluteProgress = useTransform(currentTime, latest => {
        if (!isActive) {
            return 0;
        }
        const firstRange = timedRanges[0];
        if (!firstRange || latest <= firstRange.startTime) {
            return 0;
        }
        for (const range of timedRanges) {
            if (latest <= range.endTime) {
                if (latest <= range.startTime) {
                    return range.startIndex;
                }
                const rangeLength = Math.max(range.endIndex - range.startIndex, 1);
                const progress = (latest - range.startTime) / Math.max(0.001, range.endTime - range.startTime);
                return range.startIndex + rangeLength * progress;
            }
        }
        const lastRange = timedRanges[timedRanges.length - 1];
        return lastRange?.endIndex ?? 0;
    });
    const fallbackFillWidth = useTransform(absoluteProgress, latest => {
        const graphemeOffsets = measureGraphemeOffsets(line.fullText, measuredFontPx, fontSpec);
        const wholeIndex = Math.floor(latest);
        const fractional = latest - wholeIndex;
        const startWidth = graphemeOffsets[Math.max(0, Math.min(wholeIndex, graphemeOffsets.length - 1))] ?? 0;
        const endWidth = graphemeOffsets[Math.max(0, Math.min(wholeIndex + 1, graphemeOffsets.length - 1))] ?? startWidth;
        return startWidth + (endWidth - startWidth) * fractional;
    });

    return (
        <span ref={rootRef} className="block w-full min-w-0 max-w-full align-top overflow-visible whitespace-pre-wrap break-words">
            {wrappedLines.length > 0 ? (
                wrappedLines.map(wrappedLine => (
                    <MonetMeasuredLyricLine
                        key={`${wrappedLine.startIndex}-${wrappedLine.endIndex}-${wrappedLine.text}`}
                        wrappedLine={wrappedLine}
                        absoluteProgress={absoluteProgress}
                        accentColor={accentColor}
                        baseColor={baseColor}
                        fontPx={measuredFontPx}
                        isActive={isActive}
                    />
                ))
            ) : (
                <span className="relative block whitespace-pre-wrap break-words" style={{ color: baseColor }}>
                    {line.fullText}
                    {isActive ? (
                        <motion.span
                            aria-hidden
                            className="pointer-events-none absolute inset-0 block whitespace-pre-wrap break-words"
                            style={{
                                width: fallbackFillWidth,
                                overflow: 'hidden',
                            }}
                        >
                            <span
                                className="block whitespace-pre-wrap break-words"
                                style={{
                                    color: 'transparent',
                                    backgroundImage: `linear-gradient(90deg, ${accentColor} 0%, ${colorWithAlpha(accentColor, 0.92)} 68%, ${colorWithAlpha(accentColor, 0.72)} 100%)`,
                                    WebkitBackgroundClip: 'text',
                                    backgroundClip: 'text',
                                }}
                            >
                                {line.fullText}
                            </span>
                        </motion.span>
                    ) : null}
                </span>
            )}
        </span>
    );
};

const MonetMeasuredLyricLine: React.FC<{
    wrappedLine: MonetWrappedLyricLine;
    absoluteProgress: MotionValue<number>;
    accentColor: string;
    baseColor: string;
    fontPx: number;
    isActive: boolean;
}> = ({ wrappedLine, absoluteProgress, accentColor, baseColor, fontPx, isActive }) => {
    const localFillWidth = useTransform(absoluteProgress, latest => {
        if (!isActive) {
            return 0;
        }

        if (latest <= wrappedLine.startIndex) {
            return 0;
        }
        if (latest >= wrappedLine.endIndex) {
            return wrappedLine.width;
        }

        const localIndex = latest - wrappedLine.startIndex;
        const wholeIndex = Math.floor(localIndex);
        const fractional = localIndex - wholeIndex;
        const startWidth = wrappedLine.graphemeOffsets[Math.max(0, Math.min(wholeIndex, wrappedLine.graphemeOffsets.length - 1))] ?? 0;
        const endWidth = wrappedLine.graphemeOffsets[Math.max(0, Math.min(wholeIndex + 1, wrappedLine.graphemeOffsets.length - 1))] ?? startWidth;
        return startWidth + (endWidth - startWidth) * fractional;
    });
    const localMaskImage = useTransform(localFillWidth, latest => {
        const edgeSoftness = Math.max(Math.min(fontPx * 0.18, 8), 3);
        const solidEnd = Math.max(latest - edgeSoftness, 0);
        const featherStart = Math.max(latest - edgeSoftness * 0.55, 0);
        const featherEnd = Math.max(latest, 0);
        return `linear-gradient(90deg, rgba(0, 0, 0, 1) 0px, rgba(0, 0, 0, 1) ${solidEnd}px, rgba(0, 0, 0, 0.92) ${featherStart}px, rgba(0, 0, 0, 0) ${featherEnd}px, rgba(0, 0, 0, 0) 100%)`;
    });

    return (
        <span className="relative block whitespace-pre-wrap break-words" style={{ color: baseColor }}>
            {wrappedLine.text}
            {isActive ? (
                <motion.span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 block whitespace-pre-wrap break-words"
                    style={{
                        WebkitMaskImage: localMaskImage,
                        maskImage: localMaskImage,
                        WebkitMaskRepeat: 'no-repeat',
                        maskRepeat: 'no-repeat',
                    }}
                >
                    <span
                        className="block whitespace-pre-wrap break-words"
                        style={{
                            color: 'transparent',
                            backgroundImage: `linear-gradient(90deg, ${accentColor} 0%, ${colorWithAlpha(accentColor, 0.92)} 68%, ${colorWithAlpha(accentColor, 0.72)} 100%)`,
                            WebkitBackgroundClip: 'text',
                            backgroundClip: 'text',
                        }}
                    >
                        {wrappedLine.text}
                    </span>
                </motion.span>
            ) : null}
        </span>
    );
};



const VisualizerMonet: React.FC<VisualizerMonetProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        audioPower,
        audioBands,
        showText = true,
        songTitle,
        songArtist,
        songAlbum,
        coverUrl,
        staticMode = false,
        transparentBackground = false,
        isPreviewMode = false,
        monetTuning = DEFAULT_MONET_TUNING,
        monetBackgroundImage = null,
    } = props;
    const { t } = useTranslation();

    const {
        activeLine,
        recentCompletedLine,
        nextLines,
        upcomingLine,
    } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    // 4-line lyrics: active line (or recently completed) + next line
    const displayActiveLine = activeLine ?? recentCompletedLine;
    const nextLine = activeLine
        ? (lines[currentLineIndex + 1] ?? nextLines[0] ?? upcomingLine ?? null)
        : (nextLines[0] ?? upcomingLine ?? null);

    const lyricFontStack = useMemo(() => resolveThemeFontStack(theme), [theme]);
    const activeSizeMultiplier = 1 + Math.max(monetTuning.lyricsFocusScale - 1, 0) * 0.35;
    const lyricFontPx = resolveClampFontPx(
        1.34 * activeSizeMultiplier,
        2.75 * activeSizeMultiplier,
        2.28 * activeSizeMultiplier,
    );

    const primaryMetaLabel = songArtist?.trim() || songAlbum?.trim() || songTitle?.trim() || 'Monet';
    const secondaryMetaLabel = songAlbum?.trim() || songArtist?.trim() || theme.name || 'Monet';
    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={{
                ...props,
                transparentBackground: true,
                staticMode: true,
            }}
        >
            <MonetBackground
                coverUrl={coverUrl}
                monetBackgroundImage={monetBackgroundImage}
                theme={theme}
                tuning={monetTuning}
                transparentBackground={transparentBackground}
            />

            {/* Floating decorative particles (theme icons or sakura petals) */}
            <MonetFloatingDecor theme={theme} audioPower={audioPower} staticMode={staticMode} />

            <div className="relative z-10 flex h-full w-full flex-row items-center overflow-hidden">
                {/* ── Left panel: metadata + 4-line lyrics ── */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center px-5 py-5 sm:px-8 sm:py-6 lg:px-14 lg:py-8">
                    {/* Artist accent */}
                    <div className="mb-3 space-y-1.5">
                        <div
                            className="text-[clamp(1rem,1.8vw,1.8rem)] italic tracking-[-0.04em]"
                            style={{ color: colorWithAlpha(theme.primaryColor, 0.96) }}
                        >
                            {primaryMetaLabel}
                        </div>
                        <div
                            className="h-14 w-px rounded-full"
                            style={{ background: `linear-gradient(180deg, ${colorWithAlpha(theme.primaryColor, 0.72)}, transparent)` }}
                        />
                    </div>

                    {/* Song title + album tag */}
                    <div className="mb-6 space-y-1">
                        <div
                            className="font-semibold tracking-[-0.05em] leading-[1.06]"
                            style={{
                                color: theme.primaryColor,
                                fontSize: 'clamp(1.45rem, 3.3vw, 2.8rem)',
                                textShadow: `0 14px 36px ${colorWithAlpha(theme.backgroundColor, 0.28)}`,
                            }}
                        >
                            {songTitle || 'Monet'}
                        </div>
                        <div
                            className="text-sm uppercase tracking-[0.26em]"
                            style={{ color: colorWithAlpha(theme.secondaryColor, 0.84) }}
                        >
                            {secondaryMetaLabel}
                        </div>
                    </div>

                    {/* ── 4-line lyrics block ── */}
                    {showText ? (
                        <div className="h-[clamp(220px,32vh,320px)] max-w-[720px] overflow-hidden">
                            {/* Active line group (line 1 + line 2) */}
                            <div className="grid h-full grid-rows-[minmax(0,1.45fr)_minmax(0,0.72fr)] gap-4">
                                <div className="min-h-0 overflow-hidden">
                                    <AnimatePresence mode="wait">
                                        {displayActiveLine ? (
                                            <motion.div
                                                key={`active-${displayActiveLine.startTime}`}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -10 }}
                                                transition={{ duration: 0.32, ease: 'easeOut' }}
                                                className="space-y-1.5"
                                            >
                                                <div
                                                    className="font-semibold tracking-[-0.02em] leading-[1.08] whitespace-pre-wrap break-words overflow-visible"
                                                    style={{
                                                        fontSize: `clamp(${(1.34 * activeSizeMultiplier).toFixed(3)}rem, ${(2.75 * activeSizeMultiplier).toFixed(3)}vw, ${(2.28 * activeSizeMultiplier).toFixed(3)}rem)`,
                                                        textShadow: `0 12px 28px ${colorWithAlpha(theme.backgroundColor, 0.32)}`,
                                                    }}
                                                >
                                                    <MonetTimedTokenSpan
                                                        line={displayActiveLine}
                                                        currentTime={currentTime}
                                                        isActive={!!activeLine}
                                                        accentColor={colorWithAlpha(theme.primaryColor, 0.98)}
                                                        baseColor={colorWithAlpha(theme.primaryColor, 0.34)}
                                                        fontPx={lyricFontPx}
                                                        fontWeight={600}
                                                        fontStack={lyricFontStack}
                                                    />
                                                </div>
                                                {displayActiveLine.translation ? (
                                                    <div
                                                        className="whitespace-pre-wrap break-words leading-[1.25]"
                                                        style={{
                                                            color: colorWithAlpha(theme.primaryColor, 0.68),
                                                            fontSize: 'clamp(0.94rem, 1.28vw, 1.14rem)',
                                                            paddingLeft: '0.12rem',
                                                        }}
                                                    >
                                                        {displayActiveLine.translation}
                                                    </div>
                                                ) : null}
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                key="monet-waiting"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 0.72 }}
                                                exit={{ opacity: 0 }}
                                                transition={{ duration: 0.32 }}
                                            >
                                                <div
                                                    className="font-semibold tracking-[-0.03em]"
                                                    style={{
                                                        color: theme.primaryColor,
                                                        fontSize: 'clamp(1.8rem, 4.2vw, 3.2rem)',
                                                    }}
                                                >
                                                    {t('ui.waitingForMusic') || 'Waiting for music'}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                <div className="min-h-0 overflow-hidden">
                                    <AnimatePresence mode="wait">
                                        {nextLine ? (
                                            <motion.div
                                                key={`next-${nextLine.startTime}`}
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0 }}
                                                transition={{ duration: 0.28, ease: 'easeOut' }}
                                                className="space-y-1"
                                            >
                                                <div
                                                    className="whitespace-pre-wrap break-words leading-[1.12]"
                                                    style={{
                                                        color: colorWithAlpha(theme.primaryColor, 0.42),
                                                        fontSize: 'clamp(1.08rem, 2vw, 1.48rem)',
                                                    }}
                                                >
                                                    {nextLine.fullText}
                                                </div>
                                                {nextLine.translation ? (
                                                    <div
                                                        className="whitespace-pre-wrap break-words leading-[1.25]"
                                                        style={{
                                                            color: colorWithAlpha(theme.primaryColor, 0.3),
                                                            fontSize: 'clamp(0.84rem, 1.1vw, 0.96rem)',
                                                            paddingLeft: '0.08rem',
                                                        }}
                                                    >
                                                        {nextLine.translation}
                                                    </div>
                                                ) : null}
                                            </motion.div>
                                        ) : null}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-[clamp(220px,32vh,320px)]" />
                    )}

                    {/* Bottom meta pill */}
                    <div className="mt-auto pt-4">
                        <div
                            className="inline-flex items-center gap-3 rounded-full border px-4 py-2 backdrop-blur-md"
                            style={{
                                borderColor: colorWithAlpha(theme.primaryColor, 0.16),
                                backgroundColor: colorWithAlpha(theme.backgroundColor, 0.18),
                                color: colorWithAlpha(theme.primaryColor, 0.9),
                            }}
                        >
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: theme.accentColor }} />
                            <span className="text-xs uppercase tracking-[0.28em]">{secondaryMetaLabel}</span>
                        </div>
                    </div>
                </div>

                {/* ── Right panel: cover card ── */}
                <div
                    className="flex min-w-0 items-center justify-center overflow-visible px-3 pr-5 sm:pr-8 lg:justify-end lg:pr-10 xl:pr-12"
                    style={{ flex: '0 0 clamp(220px, 28vw, 430px)' }}
                >
                    <div className="relative w-full max-w-[clamp(210px,26vw,380px)]">
                        {/* Bookmark tab at top-right of card */}
                        <div
                            className="absolute -top-3 right-8 z-20 h-14 w-3 rounded-full shadow-md"
                            style={{
                                backgroundColor: '#111111',
                                boxShadow: `0 8px 18px ${colorWithAlpha('#000000', 0.24)}`,
                            }}
                        />
                        {/* Cover card */}
                        <div
                            className="relative rounded-[2.5rem] border p-1.5 backdrop-blur-sm"
                            style={{
                                borderColor: colorWithAlpha(theme.primaryColor, 0.12),
                                backgroundColor: colorWithAlpha(theme.backgroundColor, 0.08),
                                boxShadow: `0 30px 70px ${colorWithAlpha(theme.backgroundColor, 0.34)}, 0 16px 36px ${colorWithAlpha(theme.accentColor, 0.14)}, 0 0 0 1px ${colorWithAlpha(theme.primaryColor, 0.04)}`,
                            }}
                        >
                            <div
                                className="aspect-[0.74] w-full overflow-hidden rounded-[2rem] bg-cover bg-center"
                                style={{
                                    backgroundImage: coverUrl ? `url(${coverUrl})` : undefined,
                                    backgroundColor: colorWithAlpha(theme.primaryColor, 0.08),
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Bottom-left audio spectrum (absolute) ── */}
            <div
                className="absolute bottom-0 left-0 z-20 h-10 overflow-hidden px-5 sm:px-8 lg:px-14"
                style={{ width: 'min(450px, 55vw)' }}
            >
                <AudioOverlay
                    audioPower={audioPower}
                    audioBands={audioBands}
                    theme={theme}
                    mode={monetTuning.audioStyle}
                    staticMode={staticMode}
                    isPreviewMode={isPreviewMode}
                />
            </div>
        </VisualizerShell>
    );
};

export default VisualizerMonet;
