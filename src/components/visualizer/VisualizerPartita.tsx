import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence, MotionValue, Variants, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { DEFAULT_PARTITA_TUNING, Line, Theme, Word as WordType, AudioBands, type PartitaTuning } from '../../types';
import { getLineRenderEndTime, getLineRenderHints } from '../../utils/lyrics/renderHints';
import { resolveThemeFontStack } from '../../utils/fontStacks';
import GeometricBackground from './GeometricBackground';
import FluidBackground from './FluidBackground';

// Visualizer Partita

interface VisualizerPartitaProps {
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
    partitaTuning?: PartitaTuning;
    lyricsFontScale?: number;
    onBack?: () => void;
    desktopMode?: boolean;
}

interface WordLayoutConfig {
    id: string;
    x: number;
    y: number;
    rotate: number;
    scale: number;
    marginBottom: string;
    alignSelf: string;
    passedRotate: number;
}

interface LineLayoutConfig {
    perspective: number;
    justifyContent: string;
    alignItems: string;
    columnGap: string;
}

interface PartitaLineRenderProfile {
    renderHints: NonNullable<Line['renderHints']> | null;
    lineRenderEndTime: number;
    lineTransitionMode: 'normal' | 'fast' | 'none';
    wordRevealMode: 'normal' | 'fast' | 'instant';
    wordLookahead: number;
}

interface PartitaColumn {
    id: string;
    words: Array<{
        chunkWords: WordType[];
        config: WordLayoutConfig;
        order: number;
        rowIndex: number;
    }>;
}

const isCJK = (text: string) => /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(text);
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
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clampPartitaStagger = (value: number, fallback: number) => Number.isFinite(value)
    ? clamp(value, 0, 180)
    : fallback;

const resolvePartitaTuning = (tuning?: PartitaTuning): PartitaTuning => {
    const rawMin = clampPartitaStagger(tuning?.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin, DEFAULT_PARTITA_TUNING.staggerMin);
    const rawMax = clampPartitaStagger(tuning?.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax, DEFAULT_PARTITA_TUNING.staggerMax);

    return {
        showGuideLines: tuning?.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
        staggerMin: Math.min(rawMin, rawMax),
        staggerMax: Math.max(rawMin, rawMax),
    };
};

const resolvePartitaLineRenderProfile = (line: Line | null | undefined): PartitaLineRenderProfile | null => {
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

const getPartitaWordActiveEndTime = (word: WordType, renderProfile: PartitaLineRenderProfile) => {
    if (renderProfile.wordRevealMode === 'instant') {
        return renderProfile.lineRenderEndTime;
    }

    if (renderProfile.wordRevealMode === 'fast') {
        return Math.min(renderProfile.lineRenderEndTime, Math.max(word.endTime, word.startTime + 0.12));
    }

    return word.endTime;
};

const getPartitaWordDisplayDuration = (word: WordType, renderProfile: PartitaLineRenderProfile) => {
    const activeEndTime = getPartitaWordActiveEndTime(word, renderProfile);
    const minDuration = renderProfile.wordRevealMode === 'instant'
        ? 0.08
        : renderProfile.wordRevealMode === 'fast'
            ? 0.12
            : 0.1;

    return Math.max(activeEndTime - word.startTime, minDuration);
};

const getPartitaLineContainerMotion = (renderProfile: PartitaLineRenderProfile | null) => {
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

const getTargetColumnCount = (totalGraphemes: number, wordCount: number) => {
    if (wordCount <= 2 || totalGraphemes <= 5) return 1;
    if (totalGraphemes <= 10) return 2;
    if (totalGraphemes <= 16) return 3;
    if (totalGraphemes <= 24) return 4;
    return 5;
};

const buildSequentialColumns = (line: Line, theme: Theme, windowHeight: number, tuning: PartitaTuning) => {
    const intensity = theme.animationIntensity;
    const isChaotic = intensity === 'chaotic';
    const isCalm = intensity === 'calm';
    const totalGraphemes = Math.max(splitGraphemes(line.fullText.replace(/\s+/g, '')).length, line.words.length, 1);

    const columns: PartitaColumn[] = [];
    let currentWords: PartitaColumn['words'] = [];

    const baseRowHeight = 100;
    const availableHeight = windowHeight * 0.65;
    const targetRowCount = Math.max(1, Math.floor(availableHeight / baseRowHeight));
    const actualRowCount = Math.min(line.words.length, targetRowCount);

    let seed = line.startTime;
    const random = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    };

    const chunks: WordType[][] = [];
    let remainingWords = line.words.length;
    let remainingChunks = actualRowCount;
    let wordIndex = 0;

    for (let c = 0; c < actualRowCount; c++) {
        const isLastChunk = c === actualRowCount - 1;
        const avg = remainingWords / remainingChunks;

        let chunkLength = 1;
        if (isLastChunk) {
            chunkLength = remainingWords;
        } else {
            const max = Math.ceil(avg * 1.5);
            const min = 1;
            const randVal = random();
            chunkLength = Math.max(min, Math.min(max, Math.round(avg + (randVal - 0.5) * avg)));
        }

        chunkLength = Math.max(1, Math.min(chunkLength, remainingWords - (remainingChunks - 1)));

        chunks.push(line.words.slice(wordIndex, wordIndex + chunkLength));
        wordIndex += chunkLength;
        remainingWords -= chunkLength;
        remainingChunks--;
    }

    chunks.forEach((chunkWords, rowIndex) => {
        if (chunkWords.length === 0) return;

        const mergedTextForConfig = chunkWords.map(w => w.text.trim()).join('');
        const graphemeCount = splitGraphemes(mergedTextForConfig.replace(/\s+/g, '')).length;
        const rowBias = rowIndex - (actualRowCount - 1) / 2;

        const isStaggeredLeft = rowIndex % 2 === 0;

        const staggerMagnitude = isCalm
            ? 0
            : tuning.staggerMin + random() * Math.max(tuning.staggerMax - tuning.staggerMin, 0);
        const staggerX = isStaggeredLeft ? -staggerMagnitude : staggerMagnitude;

        const staggerScale = isCalm ? 1 : 0.8 + random() * 0.9;

        currentWords.push({
            chunkWords,
            order: rowIndex,
            rowIndex,
            config: {
                id: `${rowIndex}-${chunkWords[0].startTime}`,
                x: staggerX,
                y: isCalm ? 0 : rowBias * 2.5,
                rotate: isChaotic ? (isStaggeredLeft ? -3 : 3) : 0,
                scale: (isChaotic ? 1 + Math.min(graphemeCount * 0.01, 0.05) : 1) * staggerScale,
                marginBottom: isChaotic ? '0.4rem' : '0.6rem',
                alignSelf: 'center',
                passedRotate: (rowIndex % 2 === 0 ? 1 : -1) * (isChaotic ? 6 : 3),
            },
        });
    });

    if (currentWords.length > 0) {
        columns.push({
            id: `column-${line.startTime}-0`,
            words: currentWords,
        });
    }

    return {
        columns,
        totalGraphemes,
        lineConfig: {
            perspective: theme.animationIntensity === 'chaotic' ? 720 : 1000,
            alignItems: 'items-center',
            justifyContent: 'justify-center',
            columnGap: '2rem',
        },
    };
};

// Word component — exact clone of Classic's Word with full independent animation per word
const PartitaWord: React.FC<{
    word: WordType;
    config: WordLayoutConfig;
    currentTime: MotionValue<number>;
    theme: Theme;
    layoutVariants: Variants;
    bodyVariants: Variants;
    glowVariants: Variants;
    baseColor: string;
    activeColor: string;
    renderProfile: PartitaLineRenderProfile;
    isChorus?: boolean;
    fontSize: string;
}> = ({ word, config, currentTime, theme, layoutVariants, bodyVariants, glowVariants, baseColor, activeColor, renderProfile, isChorus, fontSize }) => {
    const [status, setStatus] = useState<'waiting' | 'active' | 'passed'>('waiting');
    const rippleScale = useMemo(() => 1.5 + Math.random() * 2, []);
    const duration = getPartitaWordDisplayDuration(word, renderProfile);
    const activeEndTime = getPartitaWordActiveEndTime(word, renderProfile);

    useMotionValueEvent(currentTime, 'change', (latest: number) => {
        let newStatus: 'waiting' | 'active' | 'passed' = 'waiting';
        if (latest >= word.startTime - renderProfile.wordLookahead && latest <= activeEndTime) {
            newStatus = 'active';
        } else if (latest > activeEndTime) {
            newStatus = 'passed';
        }
        if (newStatus !== status) setStatus(newStatus);
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
            className="font-bold inline-block origin-center relative will-change-transform whitespace-nowrap"
            style={{
                fontSize,
                lineHeight: 1.22,
                marginRight: '0.8rem',
            }}
        >
            {/* Glow Layer */}
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

            {/* Body Layer */}
            <motion.span
                variants={bodyVariants}
                custom={{ config, activeColor, baseColor, duration, wordRevealMode: renderProfile.wordRevealMode }}
                className="relative z-10 block"
            >
                {word.text}
            </motion.span>

            {/* Chorus Ripple */}
            <AnimatePresence>
                {isChorus && status === 'active' && (
                    <motion.span
                        key="ripple"
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[150%] aspect-square rounded-full border-1 pointer-events-none z-0"
                        style={{ borderColor: activeColor, filter: 'blur(1px)' }}
                        initial={{ scale: 0.2, opacity: 0.8 }}
                        animate={{ scale: rippleScale, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
};

// Chunk — pure layout container, no animation. Only tracks status for guide line colors.
const PartitaChunk: React.FC<{
    chunkWords: WordType[];
    config: WordLayoutConfig;
    guideIndex: number;
    currentTime: MotionValue<number>;
    theme: Theme;
    layoutVariants: Variants;
    bodyVariants: Variants;
    glowVariants: Variants;
    baseColor: string;
    renderProfile: PartitaLineRenderProfile;
    isChorus?: boolean;
    showGuideLines: boolean;
    fontSize: string;
}> = ({ chunkWords, config, guideIndex, currentTime, theme, layoutVariants, bodyVariants, glowVariants, baseColor, renderProfile, isChorus, showGuideLines, fontSize }) => {
    const [chunkStatus, setChunkStatus] = useState<'waiting' | 'active' | 'passed'>('waiting');

    const chunkStartTime = chunkWords[0].startTime;
    const chunkEndTime = getPartitaWordActiveEndTime(chunkWords[chunkWords.length - 1], renderProfile);

    useMotionValueEvent(currentTime, 'change', (latest: number) => {
        let newStatus: 'waiting' | 'active' | 'passed' = 'waiting';
        if (latest >= chunkStartTime - renderProfile.wordLookahead && latest <= chunkEndTime) {
            newStatus = 'active';
        } else if (latest > chunkEndTime) {
            newStatus = 'passed';
        }
        if (newStatus !== chunkStatus) setChunkStatus(newStatus);
    });

    const activeColor = getActiveColor(chunkWords.map(w => w.text).join(' '), theme);
    const guidePosition = guideIndex % 2 === 0 ? 'left' : 'right';

    return (
        <motion.div
            className="inline-flex origin-center relative whitespace-nowrap items-center justify-center flex-row"
            style={{
                marginBottom: config.marginBottom,
                alignSelf: config.alignSelf,
                lineHeight: 1,
                minWidth: 'auto',
                minHeight: 'auto',
                padding: '0.2rem 0.5rem',
            }}
            animate={{
                opacity: chunkStatus === 'waiting' ? 0 : 1,
                scale: chunkStatus === 'waiting' ? 0.85 : 1,
                x: chunkStatus === 'waiting'
                    ? config.x + (guidePosition === 'left' ? -40 : 40)
                    : config.x,
                y: config.y,
                rotate: config.rotate,
            }}
            transition={chunkStatus === 'active' ? {
                type: 'spring' as const,
                stiffness: 200,
                damping: 20,
                opacity: { duration: 0.1 },
            } : {
                duration: 0.4,
                ease: 'easeOut' as const,
            }}
        >
            {showGuideLines && guidePosition === 'left' && (
                <>
                    <motion.span
                        className="absolute w-px pointer-events-none"
                        style={{
                            left: '-8px',
                            bottom: '-16px',
                            height: '32px',
                            transformOrigin: 'bottom',
                            backgroundColor: chunkStatus === 'active' ? activeColor : chunkStatus === 'passed' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)',
                            boxShadow: chunkStatus === 'active' ? `0 0 10px ${activeColor}45` : 'none',
                        }}
                        animate={{
                            scaleY: chunkStatus === 'waiting' ? 0 : 1,
                            opacity: chunkStatus === 'waiting' ? 0 : 1,
                        }}
                        transition={{
                            duration: 0.4,
                            ease: 'easeOut' as const,
                        }}
                        aria-hidden="true"
                    />
                    <motion.span
                        className="absolute h-px pointer-events-none"
                        style={{
                            left: '-16px',
                            bottom: '-8px',
                            width: 'calc(100% + 36px)',
                            transformOrigin: 'left',
                            backgroundColor: chunkStatus === 'active' ? activeColor : chunkStatus === 'passed' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)',
                            boxShadow: chunkStatus === 'active' ? `0 0 10px ${activeColor}35` : 'none',
                        }}
                        animate={{
                            scaleX: chunkStatus === 'waiting' ? 0 : 1,
                            opacity: chunkStatus === 'waiting' ? 0 : 1,
                        }}
                        transition={{
                            duration: 0.4,
                            ease: 'easeOut' as const,
                        }}
                        aria-hidden="true"
                    />
                </>
            )}
            {showGuideLines && guidePosition === 'right' && (
                <>
                    <motion.span
                        className="absolute w-px pointer-events-none"
                        style={{
                            right: '-8px',
                            bottom: '-16px',
                            height: '32px',
                            transformOrigin: 'bottom',
                            backgroundColor: chunkStatus === 'active' ? activeColor : chunkStatus === 'passed' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)',
                            boxShadow: chunkStatus === 'active' ? `0 0 10px ${activeColor}45` : 'none',
                        }}
                        animate={{
                            scaleY: chunkStatus === 'waiting' ? 0 : 1,
                            opacity: chunkStatus === 'waiting' ? 0 : 1,
                        }}
                        transition={{
                            duration: 0.4,
                            ease: 'easeOut' as const,
                        }}
                        aria-hidden="true"
                    />
                    <motion.span
                        className="absolute h-px pointer-events-none"
                        style={{
                            right: '-16px',
                            bottom: '-8px',
                            width: 'calc(100% + 36px)',
                            transformOrigin: 'right',
                            backgroundColor: chunkStatus === 'active' ? activeColor : chunkStatus === 'passed' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)',
                            boxShadow: chunkStatus === 'active' ? `0 0 10px ${activeColor}35` : 'none',
                        }}
                        animate={{
                            scaleX: chunkStatus === 'waiting' ? 0 : 1,
                            opacity: chunkStatus === 'waiting' ? 0 : 1,
                        }}
                        transition={{
                            duration: 0.4,
                            ease: 'easeOut' as const,
                        }}
                        aria-hidden="true"
                    />
                </>
            )}

            {chunkWords.map((w, idx) => {
                // Per-word random offset only (chunk position is on the container)
                const wordSeed = chunkWords[0].startTime + idx * 7.13;
                const random = (offset: number) => {
                    const x = Math.sin(wordSeed + offset) * 10000;
                    return x - Math.floor(x);
                };

                const intensity = theme.animationIntensity;
                const isCalm = intensity === 'calm';
                const isChaotic = intensity === 'chaotic';
                const baseSpread = isChaotic ? 15 : isCalm ? 0 : 6;
                const baseRotate = isChaotic ? 8 : isCalm ? 0 : 3;

                const wordConfig: WordLayoutConfig = {
                    id: `${config.id}-w${idx}`,
                    x: (random(1) - 0.5) * baseSpread * 2,
                    y: (random(2) - 0.5) * baseSpread * 2,
                    rotate: (random(3) - 0.5) * baseRotate * 2,
                    scale: config.scale,
                    marginBottom: '0',
                    alignSelf: 'auto',
                    passedRotate: (random(8) - 0.5) * 20,
                };

                return (
                    <PartitaWord
                        key={`${w.text}-${idx}`}
                        word={w}
                        config={wordConfig}
                        currentTime={currentTime}
                        theme={theme}
                        layoutVariants={layoutVariants}
                        bodyVariants={bodyVariants}
                        glowVariants={glowVariants}
                        baseColor={baseColor}
                        activeColor={getActiveColor(w.text, theme)}
                        renderProfile={renderProfile}
                        isChorus={isChorus}
                        fontSize={fontSize}
                    />
                );
            })}
        </motion.div>
    );
};

const VisualizerPartita: React.FC<VisualizerPartitaProps & { staticMode?: boolean; }> = ({
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
    partitaTuning = DEFAULT_PARTITA_TUNING,
    lyricsFontScale = 1,
    onBack,
    desktopMode = false,
}) => {
    const { t } = useTranslation();
    const [showBackButton, setShowBackButton] = useState(false);
    const [windowHeight, setWindowHeight] = useState(800);
    const resolvedPartitaTuning = useMemo(() => resolvePartitaTuning(partitaTuning), [partitaTuning]);

    useEffect(() => {
        setWindowHeight(window.innerHeight);
        const handleResize = () => setWindowHeight(window.innerHeight);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const currentTimeValue = currentTime.get();
    const activeLine = lines[currentLineIndex];
    const activeLineRenderProfile = activeLine ? resolvePartitaLineRenderProfile(activeLine) : null;
    const activeLineContainerMotion = getPartitaLineContainerMotion(activeLineRenderProfile);

    let recentCompletedLine = null;
    if (currentLineIndex === -1 && lines.length > 0) {
        for (let i = lines.length - 1; i >= 0; i--) {
            if (currentTimeValue > getLineRenderEndTime(lines[i])) {
                recentCompletedLine = lines[i];
                break;
            }
        }
    }

    const nextLines = lines.slice(currentLineIndex + 1, currentLineIndex + 3);
    const fontClassName = theme.fontStyle === 'mono' ? 'font-mono' : theme.fontStyle === 'serif' ? 'font-serif' : 'font-sans';
    const resolvedFontFamily = resolveThemeFontStack(theme);

    const sequentialLayout = useMemo(() => {
        if (!activeLine) {
            return {
                columns: [] as PartitaColumn[],
                totalGraphemes: 0,
                lineConfig: {
                    perspective: 1000,
                    justifyContent: 'justify-center',
                    alignItems: 'items-center',
                    columnGap: '1.6rem',
                },
            };
        }

        return buildSequentialColumns(activeLine, theme, windowHeight, resolvedPartitaTuning);
    }, [activeLine, theme, windowHeight, resolvedPartitaTuning]);

    const densityScale = sequentialLayout.totalGraphemes > 40 ? 0.8 : 1;
    const mainFontSize = `clamp(${(2.5 * densityScale * lyricsFontScale).toFixed(3)}rem, ${(5.5 * densityScale * lyricsFontScale).toFixed(3)}vw, ${(4.5 * densityScale * lyricsFontScale).toFixed(3)}rem)`;
    const emptyFontSize = `clamp(${(1.2 * lyricsFontScale).toFixed(3)}rem, ${(2.8 * lyricsFontScale).toFixed(3)}vw, ${(1.9 * lyricsFontScale).toFixed(3)}rem)`;
    const translationFontSize = `clamp(${(1.05 * lyricsFontScale).toFixed(3)}rem, ${(2.2 * lyricsFontScale).toFixed(3)}vw, ${(1.2 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(1.8 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`;

    const layoutVariants: Variants = {
        waiting: ({ config }: any) => ({
            opacity: 0,
            scale: 0.5,
            x: config.x + (Math.sin(config.y) * 100),
            y: config.y + (Math.cos(config.x) * 50),
            rotate: config.rotate + 20,
            transition: { duration: 0.4 },
        }),
        active: ({ config }: any) => ({
            opacity: 1,
            scale: isNaN(config.scale) ? 1.5 : config.scale * 1.4,
            x: config.x,
            y: config.y,
            rotate: config.rotate,
            transition: {
                type: 'spring' as const,
                stiffness: 200,
                damping: 20,
                opacity: { duration: 0.1 },
            },
        }),
        passed: ({ config }: any) => ({
            opacity: theme.animationIntensity === 'chaotic' ? 0.9 : 0.82,
            scale: config.scale || 1,
            x: config.x,
            y: config.y,
            rotate: config.rotate + config.passedRotate,
            transition: {
                duration: 0.5,
                rotate: {
                    duration: 5,
                    ease: 'linear',
                },
            },
        }),
    };

    const bodyVariants: Variants = {
        waiting: ({ baseColor }: any) => ({
            color: baseColor,
            filter: 'blur(10px)',
            transition: { duration: 0.4 },
        }),
        active: ({ activeColor, duration, wordRevealMode }: any) => ({
            color: activeColor,
            filter: 'none',
            transition: {
                color: { duration: duration || 0.2, ease: 'linear' },
                filter: { type: 'tween', duration: wordRevealMode === 'instant' ? 0.08 : wordRevealMode === 'fast' ? 0.12 : 0.2 },
            },
            transitionEnd: {
                filter: 'none',
            },
        }),
        passed: ({ baseColor, wordRevealMode }: any) => ({
            color: baseColor,
            filter: 'blur(0px)',
            transition: {
                color: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.24 : 0.8, ease: 'easeInOut' },
                filter: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.2 : 0.5 },
            },
            transitionEnd: {
                filter: 'none',
            },
        }),
    };

    const glowVariants: Variants = {
        waiting: {
            color: 'transparent',
            textShadow: 'none',
        },
        active: ({ activeColor, duration, index, total, wordRevealMode }: any) => {
            if (wordRevealMode === 'instant') {
                return {
                    color: 'transparent',
                    textShadow: [
                        'none',
                        `0 0 14px ${activeColor}, 0 0 24px ${activeColor}`,
                        'none',
                    ],
                    transition: {
                        duration: Math.min(duration || 0.08, 0.12),
                        times: [0, 0.35, 1],
                        ease: 'easeOut',
                    },
                };
            }

            if (wordRevealMode === 'fast') {
                return {
                    color: 'transparent',
                    textShadow: [
                        'none',
                        `0 0 18px ${activeColor}, 0 0 32px ${activeColor}`,
                        'none',
                    ],
                    transition: {
                        duration: Math.min(Math.max(duration || 0.12, 0.12), 0.2),
                        times: [0, 0.4, 1],
                        ease: 'easeInOut',
                    },
                };
            }

            // Letter-level sweep glow (Classic style)
            if (total !== undefined && total > 1) {
                const singleDuration = duration / total;
                return {
                    color: 'transparent',
                    textShadow: [
                        'none',
                        `0 0 20px ${activeColor}, 0 0 40px ${activeColor}`,
                        'none',
                    ],
                    transition: {
                        duration: singleDuration * 6,
                        times: [0, 0.3, 1],
                        delay: singleDuration * index,
                        ease: 'easeInOut',
                    },
                };
            }

            // Single char / CJK: sustained glow (Classic style)
            return {
                color: 'transparent',
                textShadow: [
                    'none',
                    `0 0 20px ${activeColor}, 0 0 40px ${activeColor}`,
                    `0 0 20px ${activeColor}, 0 0 40px ${activeColor}`,
                ],
                transition: {
                    duration: (duration || 0.1),
                    times: [0, 0.9, 1],
                    ease: 'easeInOut',
                },
            };
        },
        passed: ({ wordRevealMode }: any) => ({
            color: 'transparent',
            textShadow: 'none',
            transition: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.22 : 0.9, ease: 'easeOut' },
        }),
    };

    const lyricContainerFloat = useMemo(() => {
        const configByIntensity = {
            calm: { distance: 10, duration: 8.5 },
            normal: { distance: 14, duration: 7 },
            chaotic: { distance: 18, duration: 5.8 },
        } as const;

        const { distance, duration } = configByIntensity[theme.animationIntensity];

        return {
            animate: {
                y: [0, -distance, 0, distance * 0.45, 0],
                scale: [1, 1.01, 1, 0.995, 1],
            },
            transition: {
                duration,
                repeat: Infinity,
                ease: 'easeInOut' as const,
            },
        };
    }, [theme.animationIntensity]);

    return (
        <div
            className={`w-full h-full flex flex-col items-center justify-center overflow-hidden relative ${fontClassName} transition-colors duration-1000`}
            style={{
                backgroundColor: 'transparent',
                fontFamily: resolvedFontFamily,
            }}
            onMouseMove={(event) => {
                const nearBackArea = event.clientX <= 120 && event.clientY <= 120;
                if (nearBackArea !== showBackButton) {
                    setShowBackButton(nearBackArea);
                }
            }}
            onMouseLeave={() => {
                if (showBackButton) {
                    setShowBackButton(false);
                }
            }}
        >
            {onBack && (
                <motion.button
                    type="button"
                    aria-label={t('ui.backToHome')}
                    initial={false}
                    animate={{
                        opacity: showBackButton ? 1 : 0,
                        scale: showBackButton ? 1 : 0.92,
                        x: showBackButton ? 0 : -6,
                    }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onBack();
                    }}
                    className="absolute top-6 left-6 z-30 h-10 w-10 rounded-full flex items-center justify-center transition-colors backdrop-blur-md bg-black/20 hover:bg-white/10 text-white/60 pointer-events-auto"
                    style={{ pointerEvents: showBackButton ? 'auto' : 'none' }}
                >
                    <ChevronLeft size={20} />
                </motion.button>
            )}

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
                className="absolute inset-0 z-0 transition-all duration-1000"
                style={{ backgroundColor: theme.backgroundColor, opacity: useCoverColorBg ? backgroundOpacity : 1 }}
            />

            {!staticMode && (
                <div className="absolute inset-0 z-0">
                    <GeometricBackground
                        theme={theme}
                        audioPower={audioPower}
                        audioBands={audioBands}
                        seed={seed}
                        showVignette={!desktopMode}
                    />
                </div>
            )}

            <motion.div
                className="relative z-10 w-full h-[70vh] flex items-center justify-center p-8 pointer-events-none will-change-transform"
                animate={lyricContainerFloat.animate}
                transition={lyricContainerFloat.transition}
            >
                <AnimatePresence mode="popLayout">
                    {showText && activeLine && activeLineRenderProfile && (
                        <motion.div
                            key={activeLine.startTime}
                            initial={activeLineContainerMotion.initial}
                            animate={activeLineContainerMotion.animate}
                            exit={activeLineContainerMotion.exit}
                            className="flex flex-row-reverse items-stretch justify-center w-full max-w-5xl"
                            style={{
                                perspective: `${sequentialLayout.lineConfig.perspective}px`,
                                gap: sequentialLayout.lineConfig.columnGap,
                                minHeight: '320px',
                            }}
                        >
                            {sequentialLayout.columns.map((column) => {
                                return (
                                    <div
                                        key={column.id}
                                        className="relative flex min-h-[24rem] min-w-[3.8rem] items-center justify-center px-3"
                                    >
                                        <div className="relative z-10 flex flex-col items-center justify-start">
                                            {column.words.map(({ chunkWords, config, order, rowIndex }) => (
                                                <PartitaChunk
                                                    key={`${config.id}`}
                                                    chunkWords={chunkWords}
                                                    config={config}
                                                    guideIndex={rowIndex}
                                                    currentTime={currentTime}
                                                    theme={theme}
                                                    layoutVariants={layoutVariants}
                                                    bodyVariants={bodyVariants}
                                                    glowVariants={glowVariants}
                                                    baseColor={theme.primaryColor}
                                                    renderProfile={activeLineRenderProfile}
                                                    isChorus={activeLine.isChorus}
                                                    showGuideLines={resolvedPartitaTuning.showGuideLines}
                                                    fontSize={mainFontSize}
                                                />
                                            ))}
                                        </div>
                                    </div>
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

            <AnimatePresence>
                {showText && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 0.6, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="absolute bottom-28 w-full text-center space-y-2 px-4 z-20 pointer-events-none"
                    >
                        {(activeLine?.translation || recentCompletedLine?.translation) ? (
                            <motion.div
                                key={`trans-${activeLine?.startTime || recentCompletedLine?.startTime}`}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="font-medium max-w-4xl mx-auto"
                                style={{
                                    color: theme.secondaryColor,
                                    fontSize: translationFontSize,
                                }}
                            >
                                {activeLine?.translation || recentCompletedLine?.translation}
                            </motion.div>
                        ) : (
                            activeLine && nextLines.map((line, index) => (
                                <p
                                    key={index}
                                    className="truncate max-w-2xl mx-auto transition-all duration-500 blur-[1px]"
                                    style={{
                                        color: theme.secondaryColor,
                                        fontSize: upcomingFontSize,
                                    }}
                                >
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

export default VisualizerPartita;
