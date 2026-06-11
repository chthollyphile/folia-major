import React, { useEffect, useMemo, useRef, useState } from 'react';
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import { AnimatePresence, motion, useTransform, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    DEFAULT_MONET_TUNING,
    type Line,
    type MonetBackgroundImage,
    type MonetTuning,
    type Theme,
} from '../../../types';
import { colorWithAlpha, mixColors } from '../colorMix';
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
const MONET_LINE_MOTION_DURATION = 0.32;

// Translation fade-in
// 补偿翻译行与普通歌词之间的动画差异, 伪造一种同步效果
const MONET_TRANSLATION_FADE_IN_DELAY = 0.1;
const MONET_TRANSLATION_FADE_IN_DURATION = 0.28;
const MONET_TRANSLATION_FADE_OUT_DURATION = 0.1;
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

/** Measures the number of wrapped lines for a text block at a given width using pretext. */
const measureLineCount = (text: string, fontPx: number, fontSpec: string, maxWidthPx: number): number => {
    const prepared = prepareWithSegments(text || ' ', fontSpec);
    const lineHeight = fontPx * 1.2;
    const layout = layoutWithLines(prepared, maxWidthPx, lineHeight);
    return Math.max(layout.lines.length, 1);
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
    const [measuredFontPx, setMeasuredFontPx] = useState(fontPx);
    const [containerWidth, setContainerWidth] = useState(0);
    const fontSpec = useMemo(
        () => `${fontWeight} ${measuredFontPx}px ${fontStack}`,
        [fontStack, fontWeight, measuredFontPx],
    );
    useEffect(() => {
        const node = rootRef.current;
        if (!node) {
            return;
        }

        const updateFont = () => {
            setMeasuredFontPx(current => current === fontPx ? current : fontPx);
        };
        const updateWidth = () => {
            if (node.parentElement) {
                const nextWidth = node.parentElement.clientWidth;
                setContainerWidth(current => current === nextWidth ? current : nextWidth);
            }
        };

        updateFont();
        updateWidth();

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(() => {
            updateFont();
            updateWidth();
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [fontPx]);

    const lineRenderEndTime = useMemo(() => getLineRenderEndTime(line), [line]);
    const tokens = useMemo(() => buildMonetDisplayTokens(line), [line]);

    const lineHeightPx = fontPx * 1.2;
    const fullText = line.fullText || '';
    const lineCount = useMemo(
        () => (containerWidth > 0 ? measureLineCount(fullText, measuredFontPx, fontSpec, containerWidth) : 1),
        [fullText, measuredFontPx, fontSpec, containerWidth],
    );
    const shouldShowEllipsis = !isActive && lineCount > 1;
    const ellipsisWidthPx = Math.max(measuredFontPx * 2.2, 38);
    const contentMaskImage = shouldShowEllipsis
        ? `linear-gradient(90deg, black 0%, black calc(100% - ${ellipsisWidthPx}px), transparent 100%)`
        : undefined;

    return (
        <span ref={rootRef} className="relative block w-full min-w-0 max-w-full align-top whitespace-pre-wrap break-words"
            style={{
                maxHeight: isActive ? `${lineHeightPx * lineCount}px` : `${lineHeightPx}px`,
                overflow: isActive ? 'visible' : 'hidden',
                lineHeight: `${lineHeightPx}px`,
                transition: 'max-height 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
            }}
        >
            <span
                className="block w-full min-w-0 max-w-full whitespace-pre-wrap break-words"
                style={{
                    WebkitMaskImage: contentMaskImage,
                    maskImage: contentMaskImage,
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                    WebkitMaskSize: '100% 100%',
                    maskSize: '100% 100%',
                }}
            >
                {tokens.map(token => {
                    const isTimed = token.startTime !== null
                        && token.endTime !== null
                        && !token.key.includes('-static-')
                        && !token.key.includes('-tail');

                    return isTimed && token.startTime !== null && token.endTime !== null ? (
                        <MonetWordSweep
                            key={token.key}
                            text={token.text}
                            startTime={token.startTime}
                            endTime={token.endTime}
                            lineRenderEndTime={lineRenderEndTime}
                            currentTime={currentTime}
                            isLineActive={isActive}
                            defaultAccentColor={accentColor}
                            baseColor={baseColor}
                            fontPx={measuredFontPx}
                            fontSpec={fontSpec}
                        />
                    ) : (
                        <span key={token.key} style={{ color: baseColor }}>
                            {token.text}
                        </span>
                    );
                })}
            </span>
            {shouldShowEllipsis ? (
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-0 top-0 flex items-baseline justify-end"
                    style={{
                        width: `${ellipsisWidthPx}px`,
                        height: `${lineHeightPx}px`,
                        color: baseColor,
                        fontSize: `${measuredFontPx}px`,
                        fontWeight,
                        lineHeight: `${lineHeightPx}px`,
                    }}
                >
                    ...
                </span>
            ) : null}
        </span>
    );
};

/** Per-word sweep overlay: each word independently sweeps character-by-character in its own resolved color and stays colored after completion. */
const MonetWordSweep: React.FC<{
    text: string;
    startTime: number;
    endTime: number;
    lineRenderEndTime: number;
    currentTime: MotionValue<number>;
    isLineActive: boolean;
    defaultAccentColor: string;
    baseColor: string;
    fontPx: number;
    fontSpec: string;
}> = ({ text, startTime, endTime, lineRenderEndTime, currentTime, isLineActive, defaultAccentColor, baseColor, fontPx, fontSpec }) => {
    const graphemeOffsets = useMemo(
        () => measureGraphemeOffsets(text, fontPx, fontSpec),
        [text, fontPx, fontSpec],
    );

    const wordProgress = useTransform(currentTime, latest => {
        if (!isLineActive || latest <= startTime) return 0;
        if (latest >= endTime) return 1;
        return (latest - startTime) / Math.max(0.001, endTime - startTime);
    });

    const fillWidth = useTransform(wordProgress, progress => {
        if (progress <= 0) return 0;
        if (progress >= 1) return graphemeOffsets[graphemeOffsets.length - 1] ?? 0;
        const graphemeCount = graphemeOffsets.length - 1;
        const floatIndex = progress * graphemeCount;
        const wholeIndex = Math.floor(floatIndex);
        const fractional = floatIndex - wholeIndex;
        const startW = graphemeOffsets[Math.min(wholeIndex, graphemeOffsets.length - 1)] ?? 0;
        const endW = graphemeOffsets[Math.min(wholeIndex + 1, graphemeOffsets.length - 1)] ?? startW;
        return startW + (endW - startW) * fractional;
    });

    const maskImage = useTransform(fillWidth, latest => {
        const edgeSoftness = Math.max(Math.min(fontPx * 0.45, 16), 6);
        const solidEnd = Math.max(latest - edgeSoftness, 0);
        const featherStart = Math.max(latest - edgeSoftness * 0.55, 0);
        const featherEnd = Math.max(latest, 0);
        return `linear-gradient(90deg, rgba(0, 0, 0, 1) 0px, rgba(0, 0, 0, 1) ${solidEnd}px, rgba(0, 0, 0, 0.92) ${featherStart}px, rgba(0, 0, 0, 0) ${featherEnd}px, rgba(0, 0, 0, 0) 100%)`;
    });

    const fillGradient = useTransform(wordProgress, progress => {
        const color = mixColors(baseColor, defaultAccentColor, Math.min(progress, 1));
        return `linear-gradient(90deg, ${color} 0%, ${colorWithAlpha(color, 0.92)} 68%, ${colorWithAlpha(color, 0.72)} 100%)`;
    });

    const isWordComplete = useTransform(wordProgress, p => p >= 1);
    const resolvedBaseColor = useTransform(isWordComplete, complete =>
        isLineActive && complete ? defaultAccentColor : baseColor,
    );

    const glowShadow = useTransform(currentTime, latest => {
        if (latest <= startTime) return 'none';

        const wordDuration = Math.max(0.001, endTime - startTime);
        let intensity: number;
        if (latest <= endTime) {
            intensity = (latest - startTime) / wordDuration;
        } else {
            const decayDuration = Math.max(0.001, lineRenderEndTime - endTime);
            intensity = Math.max(0, 1 - (latest - endTime) / decayDuration);
        }

        if (intensity <= 0) return 'none';

        const r1 = Math.round(fontPx * 0.15);
        const r2 = Math.round(fontPx * 0.35);
        const glowColor = mixColors(baseColor, defaultAccentColor, Math.min(intensity, 1), intensity * 0.88);
        return `0 0 ${r1}px ${glowColor}, 0 0 ${r2}px ${glowColor}`;
    });

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
                        maskImage: maskImage,
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
    const fontScale = monetTuning.fontScale;
    const lyricFontPx = resolveClampFontPx(
        1.34 * activeSizeMultiplier,
        2.75 * activeSizeMultiplier,
        2.28 * activeSizeMultiplier,
    ) * fontScale;
    const nextFontPx = resolveClampFontPx(1.08, 2, 1.48) * fontScale;

    const primaryMetaLabel = songArtist?.trim() || songAlbum?.trim() || songTitle?.trim() || 'Monet';
    const secondaryMetaLabel = songAlbum?.trim() || songArtist?.trim() || theme.name || 'Monet';

    // ── 4-line window: 1 before active, 2 after ──
    const WINDOW_BEFORE = 1;
    const WINDOW_AFTER = 2;

    const visibleLineEntries = useMemo((): { line: Line; offset: number }[] => {
        if (!displayActiveLine) return [];
        // When between sentences (index -1), centre on the last completed line
        const baseIdx = currentLineIndex >= 0
            ? currentLineIndex
            : lines.findIndex(l => l === displayActiveLine);
        if (baseIdx < 0) return [{ line: displayActiveLine, offset: 0 }];
        const result: { line: Line; offset: number }[] = [];
        for (let offset = -WINDOW_BEFORE; offset <= WINDOW_AFTER; offset++) {
            const line = lines[baseIdx + offset];
            if (line) result.push({ line, offset });
        }
        return result;
    }, [lines, currentLineIndex, displayActiveLine]);

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
            <MonetFloatingDecor theme={theme} staticMode={staticMode} />

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

                    {/* ── Lyrics scroll-list ── */}
                    {showText ? (
                        <div
                            className="h-[clamp(260px,42vh,400px)] max-w-[720px] overflow-hidden"
                            style={{
                                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
                                maskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
                            }}
                        >
                            {visibleLineEntries.length > 0 ? (
                                <div className="flex flex-col gap-0">
                                    <AnimatePresence initial={false} mode="popLayout">
                                    {visibleLineEntries.flatMap(({ line, offset }) => {
                                        const isActive = offset === 0;
                                        const isNext = offset === 1;
                                        const blurZone = isActive
                                            ? 0
                                            : isNext
                                                ? 0.4
                                                : Math.max(1, Math.abs(offset) - (offset > 0 ? 1 : 0));
                                        const blurPx = blurZone * 1.8;
                                        const fontScale = isActive
                                            ? 1
                                            : isNext
                                                ? 1
                                                : Math.pow(0.86, blurZone);
                                        const targetFontPx = isActive ? lyricFontPx : nextFontPx * fontScale;
                                        const needsStableLayout = isActive || isNext || offset === -1;
                                        const layoutFontPx = needsStableLayout ? lyricFontPx : targetFontPx;
                                        const fontSizeScale = needsStableLayout ? targetFontPx / lyricFontPx : 1;
                                        const lineHeightEstimate = layoutFontPx * 1.2;
                                        const wastePx = lineHeightEstimate * (1 - fontSizeScale);
                                        const BASE_GAP = 12;
                                        const marginBottom = Math.max(0, BASE_GAP - wastePx);
                                        const lineFilter = `blur(${blurPx}px)`;

                                        const elements: React.ReactNode[] = [];
                                        elements.push(
                                            <motion.div
                                                key={line.startTime}
                                                layout="position"
                                                initial={{ opacity: 0, y: 22, scale: 0.98, filter: 'blur(3px)' }}
                                                animate={{ opacity: 1, y: 0, scale: 1, filter: lineFilter }}
                                                exit={{ opacity: 0, y: -16, scale: 0.97, filter: 'blur(3px)', transition: { duration: 0.16, ease: 'easeIn' } }}
                                                transition={{ duration: MONET_LINE_MOTION_DURATION, ease: 'easeOut' }}
                                                style={{
                                                    filter: lineFilter,
                                                    marginBottom: `${marginBottom}px`,
                                                    transition: 'margin-bottom 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
                                                }}
                                            >
                                                <motion.span
                                                    animate={{ scale: fontSizeScale }}
                                                    className={offset === -1 ? '!leading-[1.1]' : undefined}
                                                    transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                                                    style={{
                                                        display: 'inline-block',
                                                        fontSize: layoutFontPx,
                                                        transformOrigin: 'top left',
                                                    }}
                                                >
                                                    <MonetTimedTokenSpan
                                                        line={line}
                                                        currentTime={currentTime}
                                                        isActive={isActive}
                                                        accentColor={colorWithAlpha(theme.primaryColor, 0.98)}
                                                        baseColor={isActive ? colorWithAlpha(theme.primaryColor, 0.34) : colorWithAlpha(theme.primaryColor, 0.42)}
                                                        fontPx={layoutFontPx}
                                                        fontWeight={isActive ? 600 : 400}
                                                        fontStack={lyricFontStack}
                                                    />
                                                </motion.span>
                                            </motion.div>,
                                        );

                                        if (isActive && line.translation) {
                                            elements.push(
                                                <motion.div
                                                    key={`${line.startTime}-translation`}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{
                                                        opacity: 0,
                                                        transition: {
                                                            duration: MONET_TRANSLATION_FADE_OUT_DURATION,
                                                            ease: 'easeOut',
                                                        },
                                                    }}
                                                    transition={{
                                                        opacity: {
                                                            delay: MONET_TRANSLATION_FADE_IN_DELAY,
                                                            duration: MONET_TRANSLATION_FADE_IN_DURATION,
                                                            ease: 'easeOut',
                                                        },
                                                        y: {
                                                            delay: MONET_TRANSLATION_FADE_IN_DELAY,
                                                            duration: MONET_TRANSLATION_FADE_IN_DURATION,
                                                            ease: 'easeOut',
                                                        },
                                                    }}
                                                    style={{ marginBottom: '12px' }}
                                                >
                                                    <div
                                                        className="whitespace-pre-wrap break-words"
                                                        style={{
                                                            color: colorWithAlpha(theme.primaryColor, 0.68),
                                                            fontSize: resolveClampFontPx(0.94, 1.28, 1.14),
                                                            lineHeight: '1.25',
                                                            paddingLeft: '0.12rem',
                                                        }}
                                                    >
                                                        {line.translation}
                                                    </div>
                                                </motion.div>,
                                            );
                                        }

                                        return elements;
                                    })}
                                    </AnimatePresence>
                                </div>
                            ) : (
                                <div
                                    className="font-semibold tracking-[-0.03em]"
                                    style={{
                                        color: theme.primaryColor,
                                        fontSize: 'clamp(1.8rem, 4.2vw, 3.2rem)',
                                        opacity: 0.72,
                                    }}
                                >
                                    {t('ui.waitingForMusic') || 'Waiting for music'}
                                </div>
                            )}
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
                {showText ? (
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
                ) : null}
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
