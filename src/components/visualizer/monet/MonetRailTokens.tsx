import React, { useMemo } from 'react';
import { motion, motionValue, useTransform, MotionValue } from 'framer-motion';
import { type GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { colorWithAlpha, mixColors } from '../colorMix';
import { resolveMonetFillWidth, resolveMonetGlow } from './monetLyricMotion';
import { buildWordColorRangesFromMatchers, resolveTokenColorMap, type WordColorMatcher } from '../wordColoring';
import { buildMonetDisplayTokens, measureMonetGraphemeOffsets, resolveMonetSweepEdgeSoftness, resolveMonetSweepEnd, resolveMonetWordStatus, type MonetLineStatus } from './monetLyricsModel';
import type { PositionedMonetLineEntry } from './monetRailLayout';

// src/components/visualizer/monet/MonetRailTokens.tsx
// 行内的逐词渲染：按时间着色的 token 与当前行的扫字遮罩 / 填充 / glow。

/** A clock that never moves, for words whose look does not depend on the time. */
const STILL_TIME = motionValue(0);

export const MonetTimedTokenSpan: React.FC<{
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

        // Only a line being sung moves with the clock, and only sung lines can still be glowing.
        // Every other word reads a clock that never ticks: its transforms already ignore the time
        // when the line is not active, so the values are the same, but dozens of words per rail no
        // longer each run four transforms on every frame. useTransform re-subscribes on every
        // render, so a word picks the live clock up on the render that makes its line active.
        const sweepTime = isLineActive ? currentTime : STILL_TIME;
        const glowTime = canRenderGlow ? currentTime : STILL_TIME;

        const wordStatus = useTransform(sweepTime, latest => (
            isLineActive ? resolveMonetWordStatus(latest, startTime, endTime) : lineStatus
        ));

        const wordProgress = useTransform(sweepTime, latest => {
            if (!isLineActive || latest <= startTime) return 0;
            if (latest >= endTime) return 1;
            return (latest - startTime) / Math.max(0.001, endTime - startTime);
        });

        const fillWidth = useTransform(sweepTime, latest => (
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

        // The glow is its own layer under the text: a halo fixed at full strength, faded by opacity.
        // Interpolating the text-shadow itself repainted and re-rasterized every glowing word on every
        // frame (on a 120 Hz Mac, most of this mode's raster and ~70 ms/s of GPU process); opacity on
        // its own compositing layer is applied by the compositor. At full strength it is the old halo
        // exactly; below it the halo keeps the word colour instead of leaning towards the base colour.
        const glowOpacity = useTransform(glowTime, latest => {
            if (!canRenderGlow || latest <= startTime) return 0;
            return Math.max(0, resolveMonetGlow(latest, startTime, endTime, lineRenderEndTime));
        });
        // Composited only while it is lit, so idle words on the rail do not each hold a layer.
        const glowWillChange = useTransform(glowOpacity, opacity => (opacity > 0 ? 'opacity' : 'auto'));
        const glowHalo = useMemo(() => {
            const radiusOne = Math.round(fontPx * (isChorus ? 0.45 : 0.28));
            const radiusTwo = Math.round(fontPx * (isChorus ? 0.90 : 0.65));
            const glowColor = mixColors(baseColor, wordColor, 1, isChorus ? 1.0 : 0.88);
            return `0 0 ${radiusOne}px ${glowColor}, 0 0 ${radiusTwo}px ${glowColor}`;
        }, [baseColor, fontPx, isChorus, wordColor]);

        // Glyphs with deep descenders (g, j, p, y, and many CJK forms) sit below the line box
        // whenever the font's em box is taller than `line-height`, which drives half-leading
        // negative. `background-clip: text` paints no background outside the fill box and the mask
        // clips at the overlay's border box, so the sweep used to stop mid-glyph — more visibly the
        // larger the font. Grow both boxes, then pull the text back so its position is unchanged.
        const sweepOverflowPx = Math.round(fontPx * 0.5);

        return (
            <span className="relative inline-block whitespace-pre-wrap break-words">
                {canRenderGlow ? (
                    <motion.span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 block whitespace-pre-wrap break-words"
                        style={{ color: 'transparent', textShadow: glowHalo, opacity: glowOpacity, willChange: glowWillChange }}
                    >
                        {text}
                    </motion.span>
                ) : null}
                {/* relative so the text paints above the absolutely positioned glow, as it did above its own shadow. */}
                <motion.span className="relative" style={{ color: resolvedBaseColor }}>
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
