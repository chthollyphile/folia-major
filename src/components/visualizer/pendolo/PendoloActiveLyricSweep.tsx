import React, { useMemo } from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import { type Line, type Theme } from '../../../types';
import { colorWithAlpha, mixColors } from '../colorMix';
import { buildLineGraphemeTimeline, splitLyricGraphemes } from '../../../utils/lyrics/graphemeTiming';
import { measureMonetGraphemeOffsets } from '../monet/monetLyricsModel';
import { buildPendoloTextLayout, type PendoloWrappedTextLine } from './pendoloTextLayout';
import { prepareWordColorMatchers, buildWordColorRangesFromMatchers, resolveTokenColorMap, type WordColorToken } from '../wordColoring';
import { buildPendoloColorRuns, type PendoloColorRun } from './pendoloColorRuns';

// src/components/visualizer/pendolo/PendoloActiveLyricSweep.tsx

interface PendoloActiveLyricSweepProps {
    line: Line;
    currentTime: MotionValue<number>;
    fontFamily: string;
    fontWeight: number;
    maxWidth: number;
    primaryTextColor: string;
    accentTextColor: string;
    fontPx?: number;
    wordColors?: Theme['wordColors'];
    isChorus?: boolean;
    accentMix?: number;
    chorusGlowMultiplier?: number;
}

interface PendoloSweepLineProps {
    layoutLine: PendoloWrappedTextLine;
    timings: ReturnType<typeof buildLineGraphemeTimeline>;
    currentTime: MotionValue<number>;
    fontPx: number;
    fontSpec: string;
    lineHeight: number;
    lineEndTime: number;
    primaryTextColor: string;
    colorRuns: PendoloColorRun[];
    glowFilter?: string;
    glowPaddingPx: number;
}

const PendoloSweepLine: React.FC<PendoloSweepLineProps> = ({
    layoutLine,
    timings,
    currentTime,
    fontPx,
    fontSpec,
    lineHeight,
    lineEndTime,
    primaryTextColor,
    colorRuns,
    glowFilter,
    glowPaddingPx,
}) => {
    const graphemeOffsets = useMemo(
        () => measureMonetGraphemeOffsets(layoutLine.text, fontPx, fontSpec),
        [fontPx, fontSpec, layoutLine.text],
    );
    const fillWidth = useTransform(currentTime, latest => {
        const fullWidth = graphemeOffsets[graphemeOffsets.length - 1] ?? layoutLine.width;
        if (timings.length === 0) return latest >= lineEndTime ? fullWidth : 0;
        if (latest <= timings[0]!.startTime) return 0;

        for (let index = 0; index < timings.length; index += 1) {
            const timing = timings[index]!;
            const startWidth = graphemeOffsets[index] ?? 0;
            const endWidth = graphemeOffsets[index + 1] ?? startWidth;
            if (latest < timing.startTime) return startWidth;
            if (latest <= timing.endTime) {
                return startWidth + (endWidth - startWidth)
                    * ((latest - timing.startTime) / Math.max(0.001, timing.endTime - timing.startTime));
            }
        }
        return fullWidth;
    });
    const maskImage = useTransform(fillWidth, width => {
        const edgeSoftness = Math.min(Math.max(fontPx * 0.42, 8), 16);
        const paddedFillWidth = glowPaddingPx + width;
        return `linear-gradient(90deg, #000 0px, #000 ${Math.max(paddedFillWidth - edgeSoftness, 0)}px, rgba(0, 0, 0, 0.84) ${paddedFillWidth}px, transparent ${paddedFillWidth + edgeSoftness}px)`;
    });
    const fillOpacity = useTransform(currentTime, latest => (
        latest < (timings[0]?.startTime ?? lineEndTime) ? 0 : 1
    ));

    return (
        <span className="relative block whitespace-pre overflow-visible" style={{ width: `${layoutLine.width}px`, height: `${lineHeight}px` }}>
            <span style={{ color: colorWithAlpha(primaryTextColor, 0.52) }}>
                {colorRuns.map(run => <span key={run.key}>{run.text}</span>)}
            </span>
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 block whitespace-pre overflow-visible"
            >
                <span
                    className="absolute block whitespace-pre overflow-visible"
                    style={{
                        inset: `${-glowPaddingPx}px`,
                        filter: glowFilter,
                    }}
                >
                    <motion.span
                        className="absolute inset-0 block whitespace-pre"
                        style={{
                            boxSizing: 'border-box',
                            padding: `${glowPaddingPx}px`,
                            opacity: fillOpacity,
                            WebkitMaskImage: maskImage,
                            maskImage,
                            WebkitMaskSize: '100% 100%',
                            maskSize: '100% 100%',
                            WebkitMaskRepeat: 'no-repeat',
                            maskRepeat: 'no-repeat',
                        }}
                    >
                        {colorRuns.map(run => <span key={run.key} style={{ color: run.color }}>{run.text}</span>)}
                    </motion.span>
                </span>
            </span>
        </span>
    );
};

/** Draws a wrapped Monet-style timed text sweep without its glow treatment. */
const PendoloActiveLyricSweep: React.FC<PendoloActiveLyricSweepProps> = ({
    line,
    currentTime,
    fontFamily,
    fontWeight,
    maxWidth,
    primaryTextColor,
    accentTextColor,
    fontPx = 28,
    wordColors,
    isChorus = false,
    accentMix = 0.32,
    chorusGlowMultiplier = 0,
}) => {
    const text = line.fullText;
    const fontSpec = `${fontWeight} ${fontPx}px ${fontFamily}`;
    const graphemeTimings = useMemo(() => buildLineGraphemeTimeline(line), [line]);
    const matchers = useMemo(() => prepareWordColorMatchers(wordColors ?? [], true), [wordColors]);
    const wordColorRanges = useMemo(
        () => buildWordColorRangesFromMatchers(text, matchers),
        [text, matchers],
    );
    const charTokens: WordColorToken[] = useMemo(() => {
        let cursor = 0;
        return splitLyricGraphemes(text).map((char, index) => {
            const startOffset = cursor;
            cursor += char.length;
            return {
                key: String(index),
                timed: true,
                startOffset,
                endOffset: cursor,
            };
        });
    }, [text]);
    const tokenColors = useMemo(
        () => resolveTokenColorMap(charTokens, wordColorRanges),
        [charTokens, wordColorRanges],
    );

    const lineHeight = Math.round(fontPx * 1.2);
    const textLayout = useMemo(
        () => buildPendoloTextLayout(text, fontSpec, maxWidth, lineHeight),
        [fontSpec, lineHeight, maxWidth, text],
    );
    const fillColor = mixColors(primaryTextColor, accentTextColor, accentMix);
    const colorRunsByLine = useMemo(
        () => textLayout.lines.map(layoutLine => buildPendoloColorRuns(
            layoutLine.text,
            layoutLine.graphemeStart,
            tokenColors,
            fillColor,
        )),
        [fillColor, textLayout.lines, tokenColors],
    );
    // CSS masks clip text-shadow to the glyph layer; filters run after masking and preserve the glow.
    const glowFilter = isChorus
        ? `drop-shadow(0 0 ${Math.round(fontPx * 0.3 * chorusGlowMultiplier)}px ${colorWithAlpha(fillColor, 0.72)}) drop-shadow(0 0 ${Math.round(fontPx * 0.62 * chorusGlowMultiplier)}px ${colorWithAlpha(accentTextColor, 0.28)})`
        : undefined;
    const glowPaddingPx = isChorus
        ? Math.ceil(fontPx * 0.7 * chorusGlowMultiplier + 10)
        : 0;
    const textLayoutStyle = {
        fontSize: `${fontPx}px`,
        lineHeight: `${lineHeight}px`,
        width: `${maxWidth}px`,
    };

    return (
        <span className="block" style={textLayoutStyle}>
            {textLayout.lines.map((layoutLine, index) => (
                <PendoloSweepLine
                    key={`${layoutLine.graphemeStart}-${layoutLine.graphemeEnd}`}
                    layoutLine={layoutLine}
                    timings={graphemeTimings.slice(layoutLine.graphemeStart, layoutLine.graphemeEnd)}
                    currentTime={currentTime}
                    fontPx={fontPx}
                    fontSpec={fontSpec}
                    lineHeight={textLayout.lineHeight}
                    lineEndTime={line.endTime}
                    primaryTextColor={primaryTextColor}
                    colorRuns={colorRunsByLine[index] ?? []}
                    glowFilter={glowFilter}
                    glowPaddingPx={glowPaddingPx}
                />
            ))}
        </span>
    );
};

export default PendoloActiveLyricSweep;
