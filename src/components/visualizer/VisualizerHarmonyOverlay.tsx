import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, type MotionValue, useMotionValueEvent, useTransform } from 'framer-motion';
import type { Line, LyricBackgroundVocal, SubtitleContentMode, Theme, Word } from '../../types';
import { resolveThemeFontStack, resolveThemeFontWeight, resolveThemeTranslationFontStack } from '../../utils/fontStacks';
import { buildLineGraphemeTimeline } from '../../utils/lyrics/graphemeTiming';
import { measureMonetGraphemeOffsets, resolveClampFontPx } from './monet/monetLyricsModel';
import { colorWithAlpha } from './colorMix';
import { resolveWordColor } from './wordColoring';
import {
    getLyricsBackgroundVocals,
    resolveHarmonyAlternateText,
    resolveHarmonySnapshotFromVocals,
    type HarmonySnapshot,
} from './harmonyRuntime';

// src/components/visualizer/VisualizerHarmonyOverlay.tsx
// Renders TTML background vocals in one shared top safe-area without changing mode-specific main lyrics.

interface VisualizerHarmonyOverlayProps {
    currentTime: MotionValue<number>;
    lines: Line[];
    showText: boolean;
    theme: Theme;
    subtitleTheme?: Theme;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
    showHarmonySubtitle?: boolean;
    harmonySubtitleBackground?: boolean;
    subtitleFontScale?: number;
}

const EMPTY_HARMONY_SNAPSHOT: HarmonySnapshot = { signature: '', lines: [] };

/** How far below the stage's top the harmony line sits, in the stage's pixels. */
export const HARMONY_TOP_PX = 76;

/**
 * Where the harmony line sits instead. A preview that crops the stage's top (VisPlaygroundSampleStage)
 * moves it so the line keeps its distance below the box's top; elsewhere it stays HARMONY_TOP_PX.
 */
export const HarmonyTopContext = createContext(HARMONY_TOP_PX);

interface HarmonyTextPart {
    key: string;
    text: string;
    word?: Word;
}

// Preserves punctuation and whitespace while letting each timed word own its color and sweep.
const buildHarmonyTextParts = (vocal: LyricBackgroundVocal): HarmonyTextPart[] => {
    const parts: HarmonyTextPart[] = [];
    let cursor = 0;

    vocal.words.forEach((word, index) => {
        const matchIndex = vocal.text.indexOf(word.text, cursor);
        if (matchIndex < 0) {
            return;
        }
        if (matchIndex > cursor) {
            parts.push({ key: `static-${cursor}`, text: vocal.text.slice(cursor, matchIndex) });
        }
        parts.push({ key: `word-${index}-${word.startTime}`, text: word.text, word });
        cursor = matchIndex + word.text.length;
    });

    if (cursor < vocal.text.length) {
        parts.push({ key: `static-${cursor}`, text: vocal.text.slice(cursor) });
    }

    return parts.length > 0 ? parts : [{ key: 'full', text: vocal.text }];
};

const createHarmonyLine = (vocal: LyricBackgroundVocal): Line => ({
    fullText: vocal.text,
    startTime: vocal.startTime,
    endTime: vocal.endTime,
    words: vocal.words,
});

const HarmonyGlowText: React.FC<{
    vocal: LyricBackgroundVocal;
    currentTime: MotionValue<number>;
    theme: Theme;
    subtitleFontScale: number;
}> = ({ vocal, currentTime, theme, subtitleFontScale }) => {
    const fontPx = resolveClampFontPx(0.95, 1.8, 1.3) * subtitleFontScale;
    const fontWeight = resolveThemeFontWeight(theme, 500);
    const fontFamily = resolveThemeFontStack(theme);
    const fontSpec = `${fontWeight} ${fontPx}px ${fontFamily}`;
    const parts = useMemo(() => buildHarmonyTextParts(vocal), [vocal]);
    const graphemeTimings = useMemo(() => buildLineGraphemeTimeline(createHarmonyLine(vocal)), [vocal]);
    const graphemeOffsets = useMemo(
        () => measureMonetGraphemeOffsets(vocal.text, fontPx, fontSpec),
        [fontPx, fontSpec, vocal.text],
    );
    const fillWidth = useTransform(currentTime, latest => {
        const fullWidth = graphemeOffsets[graphemeOffsets.length - 1] ?? 0;
        if (latest <= vocal.startTime) return 0;
        if (latest >= vocal.endTime) return fullWidth;

        const timingCount = Math.min(graphemeTimings.length, graphemeOffsets.length - 1);
        for (let index = 0; index < timingCount; index += 1) {
            const timing = graphemeTimings[index];
            const start = Math.max(vocal.startTime, timing.startTime);
            const end = Math.max(start, timing.endTime);
            const startWidth = graphemeOffsets[index] ?? 0;
            const endWidth = graphemeOffsets[index + 1] ?? startWidth;

            if (latest < start) return startWidth;
            if (latest <= end) {
                return startWidth + (endWidth - startWidth)
                    * ((latest - start) / Math.max(0.001, end - start));
            }
        }

        return fullWidth;
    });
    const glowPaddingPx = Math.round(Math.max(fontPx * 0.85, 16));
    const paddedMaskImage = useTransform(fillWidth, latest => {
        const softness = Math.max(Math.min(fontPx * 1.35, 36), 18);
        const edge = latest + glowPaddingPx;
        const solidEnd = Math.max(edge - softness, 0);
        return `linear-gradient(90deg, #000 0px, #000 ${solidEnd}px, rgba(0,0,0,0.86) ${Math.max(solidEnd, edge - softness * 0.5)}px, transparent ${edge}px, transparent 100%)`;
    });
    const renderParts = (active: boolean) => parts.map(part => {
        const color = part.word
            ? resolveWordColor(part.word.text, theme.wordColors, theme.accentColor, { cjkMatchMode: 'exact' })
            : theme.secondaryColor;
        return (
            <span
                key={part.key}
                style={active
                    ? {
                        color,
                        WebkitTextFillColor: color,
                    }
                    : { color: colorWithAlpha(color, 0.56) }}
            >
                {part.text}
            </span>
        );
    });

    return (
        <span
            className="relative inline-block overflow-visible whitespace-pre-wrap break-words"
            style={{ fontFamily, fontSize: `clamp(${(0.95 * subtitleFontScale).toFixed(3)}rem, ${(1.8 * subtitleFontScale).toFixed(3)}vw, ${(1.3 * subtitleFontScale).toFixed(3)}rem)`, fontWeight, lineHeight: 1.3 }}
        >
            {renderParts(false)}
            <motion.span
                aria-hidden
                className="pointer-events-none absolute block whitespace-pre-wrap"
                style={{
                    left: -glowPaddingPx,
                    right: -glowPaddingPx,
                    top: -glowPaddingPx,
                    padding: glowPaddingPx,
                    WebkitMaskImage: paddedMaskImage,
                    maskImage: paddedMaskImage,
                    WebkitMaskSize: '100% 100%',
                    maskSize: '100% 100%',
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                }}
            >
                <span className="block whitespace-pre-wrap break-words">{renderParts(true)}</span>
            </motion.span>
        </span>
    );
};

const VisualizerHarmonyOverlay: React.FC<VisualizerHarmonyOverlayProps> = ({
    currentTime,
    lines,
    showText,
    theme,
    subtitleTheme,
    isPlayerChromeHidden = false,
    hideTranslationSubtitle = false,
    showSubtitleTranslation = true,
    subtitleContentMode,
    showHarmonySubtitle = true,
    harmonySubtitleBackground = true,
    subtitleFontScale = 1,
}) => {
    const backgroundVocals = useMemo(() => getLyricsBackgroundVocals(lines), [lines]);
    const buildSnapshot = useCallback(
        (time: number) => showText && showHarmonySubtitle
            ? resolveHarmonySnapshotFromVocals(backgroundVocals, time)
            : EMPTY_HARMONY_SNAPSHOT,
        [backgroundVocals, showHarmonySubtitle, showText],
    );
    const initialSnapshot = buildSnapshot(currentTime.get());
    const [snapshot, setSnapshot] = useState<HarmonySnapshot>(initialSnapshot);
    const signatureRef = useRef(initialSnapshot.signature);

    const updateSnapshot = useCallback((time: number) => {
        const next = buildSnapshot(time);
        if (signatureRef.current === next.signature) {
            return;
        }
        signatureRef.current = next.signature;
        setSnapshot(next);
    }, [buildSnapshot]);

    useEffect(() => {
        updateSnapshot(currentTime.get());
    }, [currentTime, updateSnapshot]);

    useMotionValueEvent(currentTime, 'change', updateSnapshot);
    const harmonyTopPx = useContext(HarmonyTopContext);

    return (
        <AnimatePresence>
            {snapshot.lines.length > 0 && (
                <motion.div
                    key="visualizer-harmony-overlay"
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{
                        opacity: { duration: 0.2, ease: 'easeOut' },
                        y: { duration: 0.2, ease: 'easeOut' },
                    }}
                    className="pointer-events-none absolute left-0 right-0 z-30 flex flex-col items-center gap-1.5 px-5 text-center"
                    style={{ top: harmonyTopPx }}
                >
                    <div
                        className={`relative isolate flex max-w-full flex-col items-center gap-1.5 ${harmonySubtitleBackground ? 'px-4 py-2' : ''}`}
                    >
                    {harmonySubtitleBackground && (
                        // Keep the glow out of the masked text's negative/filter compositing path on iOS Safari.
                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute -inset-x-10 -inset-y-6 z-0 blur-2xl"
                            style={{
                                background: `radial-gradient(ellipse at center, ${colorWithAlpha(theme.backgroundColor, 0.7)} 0%, ${colorWithAlpha(theme.backgroundColor, 0.42)} 48%, transparent 78%)`,
                                transform: 'translateZ(0)',
                                WebkitTransform: 'translateZ(0)',
                                WebkitBackfaceVisibility: 'hidden',
                            }}
                        />
                    )}
                    {snapshot.lines.map(entry => {
                        const alternateText = hideTranslationSubtitle
                            ? null
                            : resolveHarmonyAlternateText(
                                entry.vocal,
                                subtitleContentMode,
                                showSubtitleTranslation,
                            );

                        return (
                            <motion.div
                            key={entry.key}
                            initial={{ opacity: 0, scale: 0.97 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.97 }}
                            className="relative z-10 max-w-4xl overflow-visible whitespace-pre-wrap break-words"
                        >
                            <HarmonyGlowText vocal={entry.vocal} currentTime={currentTime} theme={subtitleTheme ?? theme} subtitleFontScale={subtitleFontScale} />
                            {alternateText && (
                                <motion.div
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 0.82, y: 0 }}
                                    className="mt-0.5"
                                    style={{
                                        color: (subtitleTheme ?? theme).secondaryColor,
                                        fontFamily: resolveThemeTranslationFontStack(subtitleTheme ?? theme),
                                        fontSize: `clamp(${(0.72 * subtitleFontScale).toFixed(3)}rem, ${(1.2 * subtitleFontScale).toFixed(3)}vw, ${(0.9 * subtitleFontScale).toFixed(3)}rem)`,
                                        fontWeight: resolveThemeFontWeight(subtitleTheme ?? theme, 400),
                                        lineHeight: 1.3,
                                    }}
                                >
                                    {alternateText}
                                </motion.div>
                            )}
                        </motion.div>
                        );
                    })}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default VisualizerHarmonyOverlay;
