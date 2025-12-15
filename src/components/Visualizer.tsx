import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence, MotionValue, Variants, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Line, Theme, Word as WordType, AudioBands } from '../types';
import GeometricBackground from './GeometricBackground';
import FluidBackground from './FluidBackground';


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

// Helper to determine if text contains CJK characters
const isCJK = (text: string) => /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(text);

const Word: React.FC<{
    word: WordType;
    config: WordLayoutConfig;
    currentTime: MotionValue<number>;
    theme: Theme;
    isChaotic: boolean;
    variants: Variants;
    baseColor: string;
    activeColor: string;
    isChorus?: boolean;
}> = ({ word, config, currentTime, theme, isChaotic, variants, baseColor, activeColor, isChorus }) => {
    const [status, setStatus] = useState<"waiting" | "active" | "passed">("waiting");
    const rippleScale = useMemo(() => 1.5 + Math.random() * 2, []);

    useMotionValueEvent(currentTime, "change", (latest: number) => {
        const PRE_LOOKAHEAD = 0.15;
        let newStatus: "waiting" | "active" | "passed" = "waiting";

        if (latest >= word.startTime - PRE_LOOKAHEAD && latest <= word.endTime) {
            newStatus = "active";
        } else if (latest > word.endTime) {
            newStatus = "passed";
        } else {
            newStatus = "waiting";
        }

        if (newStatus !== status) {
            setStatus(newStatus);
        }
    });

    return (
        <motion.span
            key={`${config.id}`}
            custom={{
                config,
                activeColor,
                baseColor
            }}
            variants={variants}
            initial="waiting"
            animate={status}
            className="text-4xl md:text-6xl lg:text-7xl font-bold inline-block origin-center will-change-transform"
            style={{
                marginRight: config.marginRight,
                alignSelf: config.alignSelf,
            }}
        >
            {word.text}
            {/* Chorus Ripple Effect */}
            <AnimatePresence>
                {isChorus && status === 'active' && (
                    <motion.span
                        key="ripple"
                        className="absolute inset-0 rounded-full border-1 pointer-events-none"
                        style={{ borderColor: activeColor }}
                        initial={{ scale: 0.2, opacity: 0.8 }}
                        animate={{ scale: rippleScale, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                )}
            </AnimatePresence>
        </motion.span>
    );
};

const Visualizer: React.FC<VisualizerProps> = ({ currentTime, currentLineIndex, lines, theme, audioPower, audioBands, showText = true, coverUrl, useCoverColorBg = false, seed }) => {
    const { t } = useTranslation();
    const [currentTimeValue, setCurrentTimeValue] = useState(0);

    // Track current time for finding most recent lyric (for translation display)
    useMotionValueEvent(currentTime, "change", (latest: number) => {
        setCurrentTimeValue(latest);
    });

    const activeLine = lines[currentLineIndex];

    // Find the most recent completed lyric (for translation display during breaks)
    let recentCompletedLine = null;
    if (currentLineIndex === -1 && lines.length > 0) {
        for (let i = lines.length - 1; i >= 0; i--) {
            if (currentTimeValue > lines[i].endTime) {
                recentCompletedLine = lines[i];
                break;
            }
        }
    }

    // Find recent previous and next lines for context subtitles
    const nextLines = lines.slice(currentLineIndex + 1, currentLineIndex + 3);

    const fontFamily = theme.fontStyle === 'mono' ? 'font-mono' : theme.fontStyle === 'serif' ? 'font-serif' : 'font-sans';

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

        const lineConfig: LineLayoutConfig = {
            justifyContent: justifyOptions[Math.floor(seed % justifyOptions.length)], // deterministic random
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

            const baseSpread = isChaotic ? 60 : isCalm ? 0 : 20;
            const baseRotate = isChaotic ? 30 : isCalm ? 0 : 5;

            return {
                id: `${w.text}-${i}-${seed}`,
                x: (random(1) - 0.5) * baseSpread * 2,
                y: (random(2) - 0.5) * baseSpread * 2,
                rotate: (random(3) - 0.5) * baseRotate * 2,
                scale: isChaotic ? 0.8 + random(4) * 0.6 : 1,
                marginRight: isChaotic ? `${random(5) * 1.5}rem` : '0.4rem',
                alignSelf: isChaotic && random(6) > 0.7 ? (random(7) > 0.5 ? 'flex-start' : 'flex-end') : 'auto',
                passedRotate: (random(8) - 0.5) * 45
            };
        });

        return { wordConfigs, lineConfig };
    }, [activeLine, theme.animationIntensity]);

    // Animation Variants
    const variants: Variants = {
        waiting: ({ config, baseColor }: any) => ({
            opacity: 0,
            scale: 0.5,
            x: config.x + (Math.sin(config.y) * 100),
            y: config.y + (Math.cos(config.x) * 50),
            rotate: config.rotate + 20,
            filter: "blur(10px)",
            color: baseColor,
            textShadow: "none",
            transition: { duration: 0.4 }
        }),
        active: ({ config, activeColor }: any) => ({
            opacity: 1,
            scale: isNaN(config.scale) ? 1.5 : config.scale * 1.3,
            x: config.x,
            y: config.y,
            rotate: config.rotate,
            filter: "blur(0px)",
            color: activeColor,
            textShadow: `0 0 20px ${activeColor}, 0 0 40px ${activeColor}`,
            transition: {
                type: "spring" as const,
                stiffness: 200,
                damping: 20,
                opacity: { duration: 0.1 },
                color: { duration: 0.2 }
            }
        }),
        passed: ({ config, baseColor }: any) => ({
            opacity: theme.animationIntensity === 'chaotic' ? 0.6 : 0.4,
            scale: config.scale || 1,
            x: config.x,
            y: config.y,
            rotate: config.rotate + config.passedRotate,
            filter: "blur(0px)",
            color: baseColor,
            textShadow: "none",
            transition: {
                duration: 0.5,
                rotate: {
                    duration: 5,
                    ease: "linear"
                }
            }
        })
    };

    return (
        <div
            className={`w-full h-full flex flex-col items-center justify-center overflow-hidden relative ${fontFamily} transition-colors duration-1000`}
            style={{ backgroundColor: 'transparent' }} // Main bg transparent to show fluid
        >
            <AnimatePresence>
                {useCoverColorBg && (
                    <motion.div
                        key="fluid-bg"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1 }}
                        className="absolute inset-0 z-0"
                    >
                        <FluidBackground coverUrl={coverUrl} theme={theme} />
                    </motion.div>
                )}
            </AnimatePresence>

            <div
                className="absolute inset-0 z-0 transition-colors duration-1000"
                style={{ backgroundColor: theme.backgroundColor, opacity: useCoverColorBg ? 0.82 : 1 }}
            />

            <div className="absolute inset-0 z-0">
                <GeometricBackground theme={theme} audioPower={audioPower} audioBands={audioBands} seed={seed} />
            </div>

            {/* Main Container */}
            <div className="relative z-10 w-full h-[70vh] flex items-center justify-center p-8 pointer-events-none">
                <AnimatePresence mode='popLayout'>
                    {showText && activeLine && (
                        <motion.div
                            key={activeLine.startTime}
                            initial={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
                            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                            exit={{ opacity: 0, scale: 1.1, filter: 'blur(20px)', transition: { duration: 0.3 } }}
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
                                        variants={variants}
                                        baseColor={theme.primaryColor}
                                        activeColor={activeColor}
                                        isChorus={activeLine.isChorus}
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
                            style={{ color: theme.secondaryColor }}
                        >
                            {t('ui.waitingForMusic')}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Subtitles (Future lines OR Translation) */}
            <AnimatePresence>
                {showText && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 0.6, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="absolute bottom-28 w-full text-center space-y-2 px-4 z-20 pointer-events-none"
                    >
                        {/* Show translation of active line OR recent completed line */}
                        {(activeLine?.translation || recentCompletedLine?.translation) ? (
                            <motion.div
                                key={`trans-${activeLine?.startTime || recentCompletedLine?.startTime}`}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="text-lg md:text-xl font-medium max-w-4xl mx-auto"
                                style={{ color: theme.secondaryColor }}
                            >
                                {activeLine?.translation || recentCompletedLine?.translation}
                            </motion.div>
                        ) : (
                            /* Show next lines only when there's an active line (not during breaks) */
                            activeLine && nextLines.map((line, i) => (
                                <p key={i} className="text-sm md:text-base truncate max-w-2xl mx-auto transition-all duration-500 blur-[1px]" style={{ color: theme.secondaryColor }}>
                                    {line.fullText}
                                </p>
                            ))
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Visualizer;