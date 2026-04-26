import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionValue, motion, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { AudioBands, Line, Theme, Word } from '../../types';
import { getLineRenderEndTime, getLineRenderHints } from '../../utils/lyrics/renderHints';
import { useVisualizerRuntime } from './runtime';
import VisualizerShell from './VisualizerShell';
import VisualizerSubtitleOverlay from './VisualizerSubtitleOverlay';

interface VisualizerSpatialProps {
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
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

const isCJK = (text: string) => /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(text);

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

const SPATIAL_INTENSITY_PRESETS = {
    calm: {
        sequenceSpreadCurrent: 72,
        sequenceSpreadOther: 60,
        spreadCurrent: 165,
        spreadOther: 122,
        jitterX: 20,
        jitterY: 118,
        edgeYBoost: 32,
        zRange: 170,
        zEdgeBoost: 58,
        nextTargetZ: -620,
        nextInitialZ: -1520,
        nextWordInitialZ: -240,
        waitingWordDepth: -46,
        cameraYaw: 1.05,
        cameraPitch: 0.45,
        roleDurationCurrent: 0.62,
        roleDurationOther: 0.74,
    },
    normal: {
        sequenceSpreadCurrent: 86,
        sequenceSpreadOther: 72,
        spreadCurrent: 220,
        spreadOther: 165,
        jitterX: 34,
        jitterY: 168,
        edgeYBoost: 56,
        zRange: 230,
        zEdgeBoost: 80,
        nextTargetZ: -860,
        nextInitialZ: -1880,
        nextWordInitialZ: -320,
        waitingWordDepth: -68,
        cameraYaw: 1.8,
        cameraPitch: 0.8,
        roleDurationCurrent: 0.52,
        roleDurationOther: 0.66,
    },
    chaotic: {
        sequenceSpreadCurrent: 102,
        sequenceSpreadOther: 86,
        spreadCurrent: 282,
        spreadOther: 215,
        jitterX: 48,
        jitterY: 226,
        edgeYBoost: 84,
        zRange: 310,
        zEdgeBoost: 128,
        nextTargetZ: -1160,
        nextInitialZ: -2320,
        nextWordInitialZ: -430,
        waitingWordDepth: -92,
        cameraYaw: 2.55,
        cameraPitch: 1.2,
        roleDurationCurrent: 0.44,
        roleDurationOther: 0.58,
    },
} as const;

const getWordStatus = (time: number, word: Word, isCurrentLine: boolean) => {
    if (!isCurrentLine) return 'ambient';
    if (time < word.startTime) return 'waiting';
    if (time <= word.endTime) return 'active';
    return 'passed';
};

const getWordRevealMode = (line: Line | null | undefined) => getLineRenderHints(line)?.wordRevealMode ?? 'normal';

const getWordLookahead = (wordRevealMode: 'normal' | 'fast' | 'instant') => {
    if (wordRevealMode === 'instant') return 0.03;
    if (wordRevealMode === 'fast') return 0.08;
    return 0.15;
};

const getWordActiveEndTime = (
    word: Word,
    lineRenderEndTime: number,
    wordRevealMode: 'normal' | 'fast' | 'instant',
) => {
    if (wordRevealMode === 'instant') return lineRenderEndTime;
    if (wordRevealMode === 'fast') return Math.min(lineRenderEndTime, Math.max(word.endTime, word.startTime + 0.12));
    return word.endTime;
};

const getPassedGlowHold = (
    wordRevealMode: 'normal' | 'fast' | 'instant',
    animationIntensity: Theme['animationIntensity'],
) => {
    const base = wordRevealMode === 'instant' ? 0.55 : wordRevealMode === 'fast' ? 0.85 : 1.35;
    const intensityScale = animationIntensity === 'chaotic' ? 1.1 : animationIntensity === 'calm' ? 0.9 : 1;
    return base * intensityScale;
};

const getWordProgress = (
    time: number,
    word: Word,
    lineRenderEndTime: number,
    wordRevealMode: 'normal' | 'fast' | 'instant',
) => {
    const activeEndTime = getWordActiveEndTime(word, lineRenderEndTime, wordRevealMode);
    const minDuration = wordRevealMode === 'instant' ? 0.08 : wordRevealMode === 'fast' ? 0.12 : 0.1;
    const duration = Math.max(activeEndTime - word.startTime, minDuration);
    return clamp((time - word.startTime) / duration, 0, 1);
};

const getSpatialWordStatus = (
    time: number,
    word: Word,
    isCurrentLine: boolean,
    lineRenderEndTime: number,
    wordRevealMode: 'normal' | 'fast' | 'instant',
) => {
    if (!isCurrentLine) return 'ambient' as const;
    const lookahead = getWordLookahead(wordRevealMode);
    const activeEndTime = getWordActiveEndTime(word, lineRenderEndTime, wordRevealMode);
    if (time >= word.startTime - lookahead && time <= activeEndTime) return 'active' as const;
    if (time > activeEndTime) return 'passed' as const;
    return 'waiting' as const;
};

const SpatialWordCloud: React.FC<{
    line: Line;
    role: 'current' | 'previous' | 'next';
    theme: Theme;
    lyricsFontScale: number;
    audioPower: MotionValue<number>;
    now: number;
}> = ({ line, role, theme, lyricsFontScale, audioPower, now }) => {
    const energy = clamp(audioPower.get() / 255, 0, 1);
    const isCurrentLine = role === 'current';
    const intensityPreset = SPATIAL_INTENSITY_PRESETS[theme.animationIntensity];
    const wordRevealMode = getWordRevealMode(line);
    const lineRenderEndTime = getLineRenderEndTime(line);
    const passedGlowHold = getPassedGlowHold(wordRevealMode, theme.animationIntensity);

    const roleEnvelope = useMemo(() => {
        if (role === 'previous') return { z: 520, y: 82, opacity: 0.45, blur: 4 };
        if (role === 'next') return { z: intensityPreset.nextTargetZ, y: -34, opacity: 0.36, blur: 5 };
        return { z: 0, y: 0, opacity: 1, blur: 0 };
    }, [intensityPreset.nextTargetZ, role]);

    const wordLayout = useMemo(() => {
        const seed = line.startTime * 1000;
        const count = Math.max(line.words.length, 1);
        const sequenceSpread = role === 'current'
            ? intensityPreset.sequenceSpreadCurrent
            : intensityPreset.sequenceSpreadOther;
        return line.words.map((word, index) => {
            const random = (offset: number) => {
                const x = Math.sin(seed + index * 17.37 + offset) * 10000;
                return x - Math.floor(x);
            };
            const spreadBase = role === 'current' ? intensityPreset.spreadCurrent : intensityPreset.spreadOther;
            const normalized = count <= 1 ? 0 : (index / (count - 1)) * 2 - 1;
            const lanePush = normalized * spreadBase * 0.95;
            const baseSequenceX = (index - (count - 1) / 2) * sequenceSpread;
            const antiCenterBias = Math.sign(normalized || (index % 2 === 0 ? 1 : -1)) * 34;
            const activeColor = getActiveColor(word.text, theme);
            const graphemes = splitGraphemes(word.text);
            return {
                id: `${line.startTime}-${index}-${word.text}`,
                // Keep strict reading order: monotonic baseSequenceX + limited jitter.
                x: baseSequenceX + lanePush * 0.5 + antiCenterBias + (random(1) - 0.5) * intensityPreset.jitterX,
                y: (random(2) - 0.5) * intensityPreset.jitterY + (Math.abs(normalized) > 0.55 ? (random(6) - 0.5) * intensityPreset.edgeYBoost : 0),
                z: (random(3) - 0.5) * intensityPreset.zRange + Math.abs(normalized) * intensityPreset.zEdgeBoost,
                rotateZ: (random(4) - 0.5) * 10,
                scale: 0.96 + random(5) * 0.28,
                activeColor,
                graphemes,
            };
        });
    }, [intensityPreset, line, role, theme]);

    const mainFontSize = `clamp(${(2.1 * lyricsFontScale).toFixed(3)}rem, ${(5.8 * lyricsFontScale).toFixed(3)}vw, ${(3.95 * lyricsFontScale).toFixed(3)}rem)`;

    return (
        <motion.div
            className="absolute left-1/2 top-1/2 pointer-events-none select-none"
            style={{
                x: '-50%',
                y: '-50%',
                transformStyle: 'preserve-3d',
            }}
            initial={{
                opacity: role === 'next' ? 0 : role === 'previous' ? 0.2 : 0.08,
                z: role === 'next' ? intensityPreset.nextInitialZ : role === 'previous' ? 120 : -320,
                y: role === 'next' ? -36 : role === 'previous' ? 40 : 20,
                filter: role === 'next' ? 'blur(18px)' : role === 'previous' ? 'blur(2px)' : 'blur(10px)',
            }}
            animate={{
                opacity: roleEnvelope.opacity,
                z: roleEnvelope.z,
                y: roleEnvelope.y,
                filter: roleEnvelope.blur > 0 ? `blur(${roleEnvelope.blur}px)` : 'blur(0px)',
            }}
            exit={{
                opacity: 0,
                z: role === 'next' ? 60 : 760,
                y: role === 'next' ? 4 : 94,
                filter: 'blur(8px)',
            }}
            transition={{
                duration: isCurrentLine ? intensityPreset.roleDurationCurrent : intensityPreset.roleDurationOther,
                ease: [0.2, 0.8, 0.22, 1],
            }}
        >
            {line.words.map((word, index) => {
                const layout = wordLayout[index]!;
                const activeEndTime = getWordActiveEndTime(word, lineRenderEndTime, wordRevealMode);
                const status = getSpatialWordStatus(now, word, isCurrentLine, lineRenderEndTime, wordRevealMode);
                const progress = getWordProgress(now, word, lineRenderEndTime, wordRevealMode);
                const activeColor = layout.activeColor;
                const passedElapsed = Math.max(0, now - activeEndTime);
                const passedFade = status === 'passed'
                    ? Math.pow(1 - clamp(passedElapsed / passedGlowHold, 0, 1), 2)
                    : 0;
                const color = status === 'active'
                    ? activeColor
                    : status === 'passed'
                        ? `color-mix(in srgb, ${activeColor} 72%, ${theme.primaryColor} 28%)`
                        : theme.secondaryColor;
                const alpha = status === 'active'
                    ? 1
                    : status === 'passed'
                        ? (0.62 + passedFade * 0.22)
                        : role === 'next'
                            ? 0.5
                            : 0.35;
                const glow = status === 'active'
                    ? 0.45 + (1 - progress) * 0.35 + energy * 0.2
                    : status === 'passed'
                        ? 0.22 + passedFade * (0.34 + energy * 0.12)
                        : 0.06;
                const graphemes = layout.graphemes;
                const glyphCount = Math.max(graphemes.length, 1);

                return (
                    <motion.span
                        key={layout.id}
                        className="absolute left-1/2 top-1/2 whitespace-nowrap font-bold"
                        style={{
                            fontSize: mainFontSize,
                            color,
                            transformStyle: 'preserve-3d',
                            textShadow: `0 0 20px color-mix(in srgb, ${activeColor} ${Math.round(glow * 100)}%, transparent)`,
                        }}
                        initial={{
                            x: layout.x * 1.12,
                            y: layout.y + 26,
                            z: layout.z + (role === 'next' ? intensityPreset.nextWordInitialZ : role === 'previous' ? 140 : -24),
                            rotateZ: layout.rotateZ + 6,
                            scale: role === 'next' ? Math.max(0.58, layout.scale - 0.34) : Math.max(0.75, layout.scale - 0.2),
                            opacity: role === 'next' ? 0.04 : 0,
                        }}
                        animate={{
                            x: layout.x,
                            y: layout.y + (status === 'active' ? -2 : 0),
                            z: layout.z + (status === 'active' ? -36 : status === 'passed' ? 46 : intensityPreset.waitingWordDepth),
                            rotateZ: layout.rotateZ + (status === 'passed' ? 4 : 0),
                            scale: layout.scale * (status === 'active' ? 1.08 + energy * 0.04 : status === 'waiting' ? 0.9 : 1),
                            opacity: role === 'next' ? Math.min(alpha, 0.34) : alpha,
                        }}
                        transition={{
                            duration: status === 'active' ? 0.14 : 0.36,
                            ease: status === 'active' ? 'easeOut' : [0.2, 0.75, 0.25, 1],
                        }}
                    >
                        {glyphCount <= 1 ? (
                            word.text
                        ) : (
                            graphemes.map((grapheme, glyphIndex) => {
                                // Flowing "Luminous" style: each glyph receives the highlight wave in sequence.
                                const headStretch = wordRevealMode === 'instant'
                                    ? 0.8
                                    : wordRevealMode === 'fast'
                                        ? 1
                                        : 1.35;
                                const head = progress * (glyphCount + 0.45) * headStretch;
                                const distanceFromHead = head - glyphIndex;
                                const leadWidth = wordRevealMode === 'instant' ? 0.62 : wordRevealMode === 'fast' ? 0.78 : 0.9;
                                const tailLength = wordRevealMode === 'instant' ? 2.4 : wordRevealMode === 'fast' ? 3.6 : 4.8;
                                const lead = clamp(1 - Math.abs(distanceFromHead - 0.1) / leadWidth, 0, 1);
                                const tail = distanceFromHead >= 0 ? clamp(1 - distanceFromHead / tailLength, 0, 1) : 0;
                                const glyphEnergy = status === 'active'
                                    ? clamp(lead * 0.95 + tail * 0.52, 0, 1.35)
                                    : status === 'passed'
                                        ? (0.08 + passedFade * 0.22) * clamp(1 - glyphIndex / Math.max(glyphCount, 1) * 0.35, 0.35, 1)
                                        : 0;
                                const glyphGlow = Math.max(0, glyphEnergy * (0.85 + energy * 0.2));
                                const glyphTranslateY = status === 'active' ? -glyphEnergy * 4 : 0;
                                const glyphScale = status === 'active' ? 1 + glyphEnergy * 0.045 : 1;

                                return (
                                    <span
                                        key={`${layout.id}-${glyphIndex}`}
                                        className="inline-block"
                                        style={{
                                            transform: `translateY(${glyphTranslateY}px) scale(${glyphScale})`,
                                            color: status === 'active' && glyphEnergy > 0.08 ? activeColor : color,
                                            textShadow: glyphGlow > 0.02
                                                ? `0 0 ${Math.round(16 + glyphGlow * 12)}px color-mix(in srgb, ${activeColor} ${Math.round(clamp(glyphGlow, 0, 1.2) * 100)}%, transparent)`
                                                : 'none',
                                            transition: 'transform 90ms ease-out, color 120ms linear, text-shadow 120ms ease-out',
                                        }}
                                    >
                                        {grapheme}
                                    </span>
                                );
                            })
                        )}
                    </motion.span>
                );
            })}
        </motion.div>
    );
};

const VisualizerSpatial: React.FC<VisualizerSpatialProps & { staticMode?: boolean; }> = ({
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
    const { t } = useTranslation();
    const [now, setNow] = useState(() => currentTime.get());
    const lastNowUpdateRef = useRef(now);
    const intensityPreset = SPATIAL_INTENSITY_PRESETS[theme.animationIntensity];
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    useMotionValueEvent(currentTime, 'change', latest => {
        const delta = latest - lastNowUpdateRef.current;

        // Song switch / seek backward: sync immediately to avoid stale lyric states.
        if (delta < 0) {
            lastNowUpdateRef.current = latest;
            setNow(latest);
            return;
        }

        // Large forward seek should also skip throttling.
        if (delta > 0.32) {
            lastNowUpdateRef.current = latest;
            setNow(latest);
            return;
        }

        // Throttle normal playback updates to reduce React work.
        if (delta < 0.028) {
            return;
        }

        lastNowUpdateRef.current = latest;
        setNow(latest);
    });

    const cameraEnergy = clamp(audioPower.get() / 255, 0, 1);
    const emptyFontSize = `clamp(${(1.4 * lyricsFontScale).toFixed(3)}rem, ${(3.4 * lyricsFontScale).toFixed(3)}vw, ${(2.2 * lyricsFontScale).toFixed(3)}rem)`;
    const translationFontSize = `clamp(${(1.125 * lyricsFontScale).toFixed(3)}rem, ${(2.6 * lyricsFontScale).toFixed(3)}vw, ${(1.25 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(2 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingLine = nextLines[0] ?? null;

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            coverUrl={coverUrl}
            useCoverColorBg={useCoverColorBg}
            seed={seed}
            staticMode={staticMode}
            backgroundOpacity={backgroundOpacity}
            onBack={onBack}
        >
            <motion.div
                className="relative z-10 w-full h-[70vh] overflow-hidden pointer-events-none flex items-center justify-center p-8"
                style={{ perspective: '1450px', perspectiveOrigin: '50% 44%' }}
                animate={{
                    rotateY: cameraEnergy * intensityPreset.cameraYaw - intensityPreset.cameraYaw / 2,
                    rotateX: cameraEnergy * intensityPreset.cameraPitch - intensityPreset.cameraPitch / 2,
                }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
            >
                <div className="relative w-full h-full max-w-6xl" style={{ transformStyle: 'preserve-3d' }}>
                    <AnimatePresence mode="popLayout">
                        {showText && recentCompletedLine && (
                            <SpatialWordCloud
                                key={`previous-${recentCompletedLine.startTime}`}
                                line={recentCompletedLine}
                                role="previous"
                                theme={theme}
                                lyricsFontScale={lyricsFontScale}
                                audioPower={audioPower}
                                now={now}
                            />
                        )}
                        {showText && activeLine && (
                            <SpatialWordCloud
                                key={`current-${activeLine.startTime}`}
                                line={activeLine}
                                role="current"
                                theme={theme}
                                lyricsFontScale={lyricsFontScale}
                                audioPower={audioPower}
                                now={now}
                            />
                        )}
                        {showText && upcomingLine && (
                            <SpatialWordCloud
                                key={`next-${upcomingLine.startTime}`}
                                line={upcomingLine}
                                role="next"
                                theme={theme}
                                lyricsFontScale={lyricsFontScale}
                                audioPower={audioPower}
                                now={now}
                            />
                        )}
                    </AnimatePresence>
                </div>

                <AnimatePresence mode="wait">
                    {showText && !activeLine && (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 flex items-center justify-center"
                            style={{ color: theme.secondaryColor, fontSize: emptyFontSize }}
                        >
                            {t('ui.waitingForMusic')}
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                translationFontSize={translationFontSize}
                upcomingFontSize={upcomingFontSize}
            />
        </VisualizerShell>
    );
};

export default VisualizerSpatial;
