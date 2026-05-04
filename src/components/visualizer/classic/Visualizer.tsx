import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence, MotionValue, Variants, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Line, Theme, Word as WordType, AudioBands } from '../../../types';
import { getLineRenderEndTime, getLineRenderHints } from '../../../utils/lyrics/renderHints';
import { useVisualizerRuntime } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';

// Visualizer classic
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
    seed?: string | number; // Added seed for geometric bg
    backgroundOpacity?: number;
    lyricsFontScale?: number;
    onBack?: () => void;
}

interface WordLayoutConfig {
    id: string;
    x: number;
    y: number;
    rotate: number;
    scale: number;
    marginRight: string;
    alignSelf: string;
    passedRotate: number;
}

interface LineLayoutConfig {
    justifyContent: string;
    alignItems: string;
    perspective: number;
}

interface ClassicLineRenderProfile {
    renderHints: NonNullable<Line['renderHints']> | null;
    lineRenderEndTime: number;
    lineTransitionMode: 'normal' | 'fast' | 'none';
    wordRevealMode: 'normal' | 'fast' | 'instant';
    wordLookahead: number;
}

// Helper to determine if text contains CJK characters
const isCJK = (text: string) => /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(text);

const resolveClassicLineRenderProfile = (line: Line | null | undefined): ClassicLineRenderProfile | null => {
    if (!line) {
        return null;
    }

    const renderHints = getLineRenderHints(line);
    const wordRevealMode = renderHints?.wordRevealMode ?? 'normal';

    return {
        renderHints,
        lineRenderEndTime: getLineRenderEndTime(line),
        lineTransitionMode: renderHints?.lineTransitionMode ?? 'normal',
        wordRevealMode,
        wordLookahead: wordRevealMode === 'instant' ? 0.03 : wordRevealMode === 'fast' ? 0.08 : 0.15,
    };
};

const getClassicWordActiveEndTime = (word: WordType, renderProfile: ClassicLineRenderProfile) => {
    if (renderProfile.wordRevealMode === 'instant') {
        return renderProfile.lineRenderEndTime;
    }

    if (renderProfile.wordRevealMode === 'fast') {
        return Math.min(renderProfile.lineRenderEndTime, Math.max(word.endTime, word.startTime + 0.12));
    }

    return word.endTime;
};

const getClassicWordDisplayDuration = (word: WordType, renderProfile: ClassicLineRenderProfile) => {
    const activeEndTime = getClassicWordActiveEndTime(word, renderProfile);
    const minDuration = renderProfile.wordRevealMode === 'instant'
        ? 0.08
        : renderProfile.wordRevealMode === 'fast'
            ? 0.12
            : 0.1;

    return Math.max(activeEndTime - word.startTime, minDuration);
};

const getClassicLineContainerMotion = (renderProfile: ClassicLineRenderProfile | null) => {
    if (renderProfile?.lineTransitionMode === 'none') {
        return {
            initial: { opacity: 1, scale: 1, filter: 'blur(0px)' },
            animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } },
            exit: { opacity: 0, scale: 1.02, filter: 'blur(6px)', transition: { duration: 0.12, ease: 'easeOut' as const } },
        };
    }

    if (renderProfile?.lineTransitionMode === 'fast') {
        return {
            initial: { opacity: 0.35, scale: 0.96, filter: 'blur(4px)' },
            animate: {
                opacity: 1,
                scale: 1,
                filter: 'blur(0px)',
                transition: { duration: 0.16, ease: 'easeOut' as const },
                transitionEnd: { filter: 'none' },
            },
            exit: {
                opacity: 0,
                scale: 1.04,
                filter: 'blur(10px)',
                transition: { duration: 0.16, ease: 'easeInOut' as const },
            },
        };
    }

    return {
        initial: { opacity: 0, scale: 0.9, filter: 'blur(10px)' },
        animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } },
        exit: { opacity: 0, scale: 1.1, filter: 'blur(20px)', transition: { duration: 0.3 } },
    };
};

const Word: React.FC<{
    word: WordType;
    config: WordLayoutConfig;
    currentTime: MotionValue<number>;
    theme: Theme;
    isChaotic: boolean;
    layoutVariants: Variants;
    bodyVariants: Variants;
    glowVariants: Variants;
    baseColor: string;
    activeColor: string;
    renderProfile: ClassicLineRenderProfile;
    isChorus?: boolean;
    fontSize: string;
}> = ({ word, config, currentTime, theme, isChaotic, layoutVariants, bodyVariants, glowVariants, baseColor, activeColor, renderProfile, isChorus, fontSize }) => {
    const [status, setStatus] = useState<"waiting" | "active" | "passed">("waiting");
    const rippleScale = useMemo(() => 1.5 + Math.random() * 2, []);
    const duration = getClassicWordDisplayDuration(word, renderProfile);
    const activeEndTime = getClassicWordActiveEndTime(word, renderProfile);

    useMotionValueEvent(currentTime, "change", (latest: number) => {
        let newStatus: "waiting" | "active" | "passed" = "waiting";

        if (latest >= word.startTime - renderProfile.wordLookahead && latest <= activeEndTime) {
            newStatus = "active";
        } else if (latest > activeEndTime) {
            newStatus = "passed";
        } else {
            newStatus = "waiting";
        }

        if (newStatus !== status) {
            setStatus(newStatus);
        }
    });

    return (
        <motion.div
            key={`${config.id}`}
            custom={{
                config,
                activeColor,
                baseColor,
                duration,
                wordRevealMode: renderProfile.wordRevealMode,
            }}
            variants={layoutVariants}
            initial="waiting"
            animate={status}
            // Add `whitespace-nowrap` to prevent unexpected line breaks
            className="font-bold inline-block origin-center relative will-change-transform whitespace-nowrap"
            style={{
                fontSize,
                marginRight: config.marginRight,
                alignSelf: config.alignSelf,
                lineHeight: 1.22,
            }}
        >
            {/* Glow Layer - Handles Text Shadow - Absolute Position */}
            <span
                className="absolute inset-0 select-none pointer-events-none block"
                aria-hidden="true"
            >
                {!isCJK(word.text) && word.text.length > 1 ? (
                    word.text.split('').map((char, index) => (
                        <motion.span
                            key={index}
                            variants={glowVariants}
                            custom={{ config, activeColor, baseColor, duration, index, total: word.text.length, wordRevealMode: renderProfile.wordRevealMode }}
                        >
                            {char}
                        </motion.span>
                    ))
                ) : (
                    <motion.span
                        variants={glowVariants}
                        custom={{ config, activeColor, baseColor, duration, wordRevealMode: renderProfile.wordRevealMode }}
                    >
                        {word.text}
                    </motion.span>
                )}
            </span>

            {/* Body Layer - Handles Color and Blur - Relative Position */}
            <motion.span
                variants={bodyVariants}
                custom={{ config, activeColor, baseColor, duration, wordRevealMode: renderProfile.wordRevealMode }}
                className="relative z-10 block"
            >
                {word.text}
            </motion.span>

            {/* Chorus Ripple Effect */}
            <AnimatePresence>
                {isChorus && status === 'active' && (
                    <motion.span
                        key="ripple"
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[150%] aspect-square rounded-full border-1 pointer-events-none z-0"
                        style={{ borderColor: activeColor, filter: "blur(1px)" }}
                        initial={{ scale: 0.2, opacity: 0.8 }}
                        animate={{ scale: rippleScale, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const Visualizer: React.FC<VisualizerProps & { staticMode?: boolean; }> = ({
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
    onBack
}) => {
    const { t } = useTranslation();
    const {
        activeLine,
        recentCompletedLine,
        nextLines,
    } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    const activeLineRenderProfile = activeLine ? resolveClassicLineRenderProfile(activeLine) : null;
    const activeWordRenderProfile = activeLineRenderProfile ?? (activeLine ? resolveClassicLineRenderProfile(activeLine) : null);
    const activeLineContainerMotion = getClassicLineContainerMotion(activeLineRenderProfile);

    const mainFontSize = `clamp(${(2.25 * lyricsFontScale).toFixed(3)}rem, ${(6 * lyricsFontScale).toFixed(3)}vw, ${(4.5 * lyricsFontScale).toFixed(3)}rem)`;
    const emptyFontSize = `clamp(${(1.5 * lyricsFontScale).toFixed(3)}rem, ${(3.5 * lyricsFontScale).toFixed(3)}vw, ${(2.25 * lyricsFontScale).toFixed(3)}rem)`;
    const translationFontSize = `clamp(${(1.125 * lyricsFontScale).toFixed(3)}rem, ${(2.6 * lyricsFontScale).toFixed(3)}vw, ${(1.25 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(2 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`;

    // Generate a stable random layout configuration for the current line
    const { wordConfigs, lineConfig } = useMemo(() => {
        if (!activeLine) return { wordConfigs: [], lineConfig: { justifyContent: 'center', alignItems: 'center', perspective: 1000 } };

        const seed = activeLine.startTime;
        const intensity = theme.animationIntensity;

        // Config generators based on intensity
        const isChaotic = intensity === 'chaotic';
        const isCalm = intensity === 'calm';

        // Container Layout
        const justifyOptions = isCalm
            ? ['justify-center']
            : ['justify-start', 'justify-center', 'justify-end', 'justify-around', 'justify-between'];
        const alignOptions = isCalm
            ? ['items-center']
            : ['items-start', 'items-center', 'items-end'];

        const isInterlude = activeLine.fullText === "......";

        const lineConfig: LineLayoutConfig = {
            justifyContent: isInterlude ? 'justify-center' : justifyOptions[Math.floor(seed % justifyOptions.length)], // deterministic random
            alignItems: alignOptions[Math.floor((seed * 2) % alignOptions.length)],
            perspective: isChaotic ? 500 + (seed % 500) : 1000,
        };

        // Word Layouts
        const wordConfigs: WordLayoutConfig[] = activeLine.words.map((w, i) => {
            const wordSeed = seed + i;

            // Pseudo-random generator function based on seed
            const random = (offset: number) => {
                const x = Math.sin(wordSeed + offset) * 10000;
                return x - Math.floor(x);
            };

            if (isInterlude) {
                return {
                    id: `${w.text}-${i}-${seed}`,
                    x: 0,
                    y: (random(2) - 0.5) * 15, // Slight vertical randomness
                    rotate: 0,
                    scale: 1.5,
                    marginRight: '3rem',
                    alignSelf: 'center',
                    passedRotate: 0
                };
            }

            const baseSpread = isChaotic ? 60 : isCalm ? 0 : 20;
            const baseRotate = isChaotic ? 30 : isCalm ? 0 : 5;
            // visualizer config
            return {
                id: `${w.text}-${i}-${seed}`,
                x: (random(1) - 0.5) * baseSpread * 2,
                y: (random(2) - 0.5) * baseSpread * 2,
                rotate: (random(3) - 0.5) * baseRotate * 2,
                scale: isChaotic ? 0.8 + random(4) * 0.6 : 1.1 + random(4) * 0.2,
                marginRight: isChaotic ? `${random(5) * 1.5}rem` : '0.8rem',
                alignSelf: isChaotic && random(6) > 0.7 ? (random(7) > 0.5 ? 'flex-start' : 'flex-end') : 'auto',
                passedRotate: (random(8) - 0.5) * 45
            };
        });

        return { wordConfigs, lineConfig };
    }, [activeLine, theme.animationIntensity]);

    // Animation Variants
    // Container: Layout (x, y, rotate, scale) + Opacity
    const layoutVariants: Variants = {
        waiting: ({ config }: any) => ({
            opacity: 0,
            scale: 0.5,
            x: config.x + (Math.sin(config.y) * 100),
            y: config.y + (Math.cos(config.x) * 50),
            rotate: config.rotate + 20,
            transition: { duration: 0.4 }
        }),
        active: ({ config }: any) => ({
            opacity: 1,
            scale: isNaN(config.scale) ? 1.5 : config.scale * 1.4,
            x: config.x,
            y: config.y,
            rotate: config.rotate,
            transition: {
                type: "spring" as const,
                stiffness: 200,
                damping: 20,
                opacity: { duration: 0.1 }
            }
        }),
        passed: ({ config, baseColor }: any) => ({
            opacity: theme.animationIntensity === 'chaotic' ? 0.9 : 0.82,
            scale: config.scale || 1,
            x: config.x,
            y: config.y,
            rotate: config.rotate + config.passedRotate,
            transition: {
                duration: 0.5,
                rotate: {
                    duration: 5,
                    ease: "linear"
                }
            }
        })
    };

    // Body: Color + Filter
    const bodyVariants: Variants = {
        waiting: ({ baseColor }: any) => ({
            color: baseColor,
            filter: "blur(10px)",
            transition: { duration: 0.4 }
        }),
        active: ({ activeColor, duration, wordRevealMode }: any) => ({
            color: activeColor,
            filter: "none",
            transition: {
                color: { duration: duration || 0.2, ease: "linear" },
                filter: { type: "tween", duration: wordRevealMode === 'instant' ? 0.08 : wordRevealMode === 'fast' ? 0.12 : 0.2 }
            },
            transitionEnd: {
                filter: "none"
            }
        }),
        passed: ({ baseColor, wordRevealMode }: any) => ({
            color: baseColor,
            filter: "blur(0px)",
            transition: {
                color: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.24 : 0.8, ease: "easeInOut" },
                filter: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.2 : 0.5 }
            },
            transitionEnd: {
                filter: "none"
            }
        })
    };

    // Glow: Text Shadow only (Transparent text)
    const glowVariants: Variants = {
        waiting: {
            color: "transparent",
            textShadow: "none",
        },
        active: ({ activeColor, duration, index, total, wordRevealMode }: any) => {
            if (wordRevealMode === 'instant') {
                return {
                    color: "transparent",
                    textShadow: [
                        "none",
                        `0 0 14px ${activeColor}, 0 0 24px ${activeColor}`,
                        "none"
                    ],
                    transition: {
                        duration: Math.min(duration || 0.08, 0.12),
                        times: [0, 0.35, 1],
                        ease: "easeOut"
                    }
                };
            }

            if (wordRevealMode === 'fast') {
                return {
                    color: "transparent",
                    textShadow: [
                        "none",
                        `0 0 18px ${activeColor}, 0 0 32px ${activeColor}`,
                        "none"
                    ],
                    transition: {
                        duration: Math.min(Math.max(duration || 0.12, 0.12), 0.2),
                        times: [0, 0.4, 1],
                        ease: "easeInOut"
                    }
                };
            }

            if (total !== undefined && total > 1) {
                const singleDuration = duration / total;
                return {
                    color: "transparent",
                    textShadow: [
                        "none",
                        `0 0 20px ${activeColor}, 0 0 40px ${activeColor}`,
                        "none"
                    ],
                    transition: {
                        duration: singleDuration * 6, // stretch the fade over a few letters
                        times: [0, 0.3, 1], // peak early, then fade
                        delay: singleDuration * index,
                        ease: "easeInOut"
                    }
                };
            }
            return {
                color: "transparent",
                textShadow: [
                    "none",
                    `0 0 20px ${activeColor}, 0 0 40px ${activeColor}`,
                    `0 0 20px ${activeColor}, 0 0 40px ${activeColor}`,
                ],
                transition: {
                    duration: (duration || 0.1), // stretch the fade over the word duration
                    times: [0, 0.9, 1], // peak early, then fade
                    ease: "easeInOut"
                }
            };
        },
        passed: ({ wordRevealMode }: any) => ({
            color: "transparent",
            textShadow: "none",
            transition: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.22 : 0.9, ease: "easeOut" }
        })
    };

    const lyricContainerFloat = useMemo(() => {
        const configByIntensity = {
            calm: { distance: 10, duration: 8.5 },
            normal: { distance: 14, duration: 7 },
            chaotic: { distance: 18, duration: 5.8 }
        } as const;

        const { distance, duration } = configByIntensity[theme.animationIntensity];

        return {
            animate: {
                y: [0, -distance, 0, distance * 0.45, 0],
                scale: [1, 1.01, 1, 0.995, 1]
            },
            transition: {
                duration,
                repeat: Infinity,
                ease: "easeInOut" as const
            }
        };
    }, [theme.animationIntensity]);

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
            {/* Main Container */}
            <motion.div
                className="relative z-10 w-full h-[70vh] flex items-center justify-center p-8 pointer-events-none will-change-transform"
                animate={lyricContainerFloat.animate}
                transition={lyricContainerFloat.transition}
            >
                <AnimatePresence mode='popLayout'>
                    {showText && activeLine && (
                        <motion.div
                            key={activeLine.startTime}
                            initial={activeLineContainerMotion.initial}
                            animate={activeLineContainerMotion.animate}
                            exit={activeLineContainerMotion.exit}
                            className={`flex flex-wrap w-full max-w-6xl content-center ${lineConfig.justifyContent} ${lineConfig.alignItems}`}
                            style={{ perspective: `${lineConfig.perspective}px`, minHeight: '300px' }}
                        >
                            {activeLine.words.map((word, idx) => {
                                const config = wordConfigs[idx] || { id: `fallback-${idx}`, x: 0, y: 0, rotate: 0, scale: 1, marginRight: '0.5rem', alignSelf: 'auto', passedRotate: 0 };

                                let activeColor = theme.accentColor;

                                // Determine Emotional Color
                                if (theme.wordColors && theme.wordColors.length > 0) {
                                    const wordText = word.text;
                                    const cleanCurrent = wordText.trim();
                                    const emotionalEntry = theme.wordColors.find(wc => {
                                        const target = wc.word;
                                        if (isCJK(cleanCurrent)) {
                                            return target.includes(cleanCurrent);
                                        } else {
                                            const targetWords = target.split(/\s+/).map(t => t.toLowerCase().replace(/[^\w]/g, ''));
                                            const currentLower = cleanCurrent.toLowerCase().replace(/[^\w]/g, '');
                                            return targetWords.includes(currentLower);
                                        }
                                    });
                                    if (emotionalEntry) activeColor = emotionalEntry.color;
                                }

                                return (
                                    <Word
                                        key={`${word.text}-${idx}-${activeLine.startTime}`}
                                        word={word}
                                        config={config}
                                        currentTime={currentTime}
                                        theme={theme}
                                        isChaotic={theme.animationIntensity === 'chaotic'}
                                        layoutVariants={layoutVariants}
                                        bodyVariants={bodyVariants}
                                        glowVariants={glowVariants}
                                        baseColor={theme.primaryColor}
                                        activeColor={activeColor}
                                        renderProfile={activeWordRenderProfile!}
                                        isChorus={activeLine.isChorus}
                                        fontSize={mainFontSize}
                                    />
                                );
                            })}
                        </motion.div>
                    )}

                    {showText && !activeLine && (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="text-2xl opacity-50 absolute"
                            style={{
                                color: theme.secondaryColor,
                                fontSize: emptyFontSize,
                            }}
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

export default Visualizer;
