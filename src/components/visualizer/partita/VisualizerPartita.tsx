import React, { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PARTITA_TUNING, Line } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { shouldPreheatLine, useVisualizerRuntime } from '../runtime';
import { type VisualizerSharedProps } from '../definition';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { buildGlowWordLayoutVariants, glowWordBodyVariants } from '../glowWordVariants';
import { getGlowWordLineContainerMotion, resolveGlowWordRenderProfile } from '../glowWordTiming';
import {
    EMPTY_PARTITA_LAYOUT,
    PARTITA_PREHEAT_WINDOW,
    type PartitaSequentialLayout,
    getOrBuildPartitaLayout,
    resolvePartitaTuning,
} from './partitaLayout';
import { PartitaChunk } from './PartitaChunk';
import { OVERLAP_FIT_LINE_ATTRIBUTE, useOverlapFit } from '../useOverlapFit';
import { measureGlowWordWidth } from '../glowWordOverlap';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { resolveLyricTextDirection } from '../../../utils/lyrics/textDirection';
import { buildPartitaWordConfigs } from './partitaLayout';
import { getPartitaOverlapSpacing, type PartitaRowSpacing } from './partitaOverlap';

/** Words are measured at this size and divided back down to em. */
const OVERLAP_MEASURE_PX = 100;

// This one is still word-driven, but unlike Classic it needs to pre-build a column/chunk structure first.
// The flow is basically: ask runtime for the active line, optionally preheat the upcoming line,
// split the active line into chunks, place those chunks into columns, then let the words animate inside that structure.
// The important bit is that the layout should feel stable while the words are moving through it.
//
// For a single lyric line, the state handling is:
// waiting -> layout is already there, but the words stay in a light "not entered yet" state.
// active -> this is where the stagger, highlight, and line energy actually happen.
// passed -> words fall back into a softer exit state, and the chunk keeps a little bit of structure for the afterimage.

type VisualizerPartitaProps = VisualizerSharedProps;

/** How the shown line leaves when the text is hidden, rather than replaced by the next line. */
const TEXT_HIDDEN_EXIT = { opacity: 0, transition: { duration: 0.2, ease: 'easeOut' as const } };

const VisualizerPartita: React.FC<VisualizerPartitaProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        audioPower,
        audioBands,
        showText = true,
        partitaTuning = DEFAULT_PARTITA_TUNING,
        lyricsFontScale = 1,
        subtitleFontScale = 1,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        subtitleOverlayLayout,
    } = props;
    const { t } = useTranslation();
    const [windowHeight, setWindowHeight] = useState(800);
    const resolvedPartitaTuning = useMemo(() => resolvePartitaTuning(partitaTuning), [partitaTuning]);
    const layoutCacheRef = useRef<Map<string, PartitaSequentialLayout>>(new Map());

    useEffect(() => {
        setWindowHeight(window.innerHeight);
        const handleResize = () => setWindowHeight(window.innerHeight);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const {
        activeLine,
        upcomingLine,
        recentCompletedLine,
        nextLines,
    } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    const activeLineRenderProfile = activeLine ? resolveGlowWordRenderProfile(activeLine) : null;
    const activeLineContainerMotion = getGlowWordLineContainerMotion(activeLineRenderProfile);

    const sequentialLayout = useMemo(() => {
        if (!activeLine) {
            return EMPTY_PARTITA_LAYOUT;
        }

        return getOrBuildPartitaLayout(layoutCacheRef.current, activeLine, theme, windowHeight, resolvedPartitaTuning);
    }, [activeLine, theme, windowHeight, resolvedPartitaTuning]);

    const nextLineRef = useRef<Line | null>(upcomingLine);
    useEffect(() => {
        nextLineRef.current = upcomingLine;
    }, [upcomingLine]);

    useMotionValueEvent(currentTime, 'change', (latest: number) => {
        const nextLine = nextLineRef.current;
        if (!nextLine) {
            return;
        }

        if (!shouldPreheatLine(nextLine, latest, PARTITA_PREHEAT_WINDOW)) {
            return;
        }

        getOrBuildPartitaLayout(layoutCacheRef.current, nextLine, theme, windowHeight, resolvedPartitaTuning);
    });

    // avoidOverlap: every chunk's gaps, worked out once per line from its words measured in em.
    const overlapSpacing = useMemo<Map<string, PartitaRowSpacing> | null>(() => {
        if (!resolvedPartitaTuning.avoidOverlap) return null;
        const fontStack = resolveThemeFontStack(theme);
        const fontWeight = resolveThemeFontWeight(theme, 700);
        const spacing = new Map<string, PartitaRowSpacing>();
        sequentialLayout.columns.forEach(column => {
            const rows = column.words.map(({ displayWords, config }) => ({
                widthsEm: displayWords.map(w => measureGlowWordWidth(w.text, OVERLAP_MEASURE_PX, fontStack, fontWeight) / OVERLAP_MEASURE_PX),
                wordConfigs: buildPartitaWordConfigs(displayWords, config, theme.animationIntensity),
                config,
                rtl: resolveLyricTextDirection(displayWords.map(w => w.text).join(' ')) === 'rtl',
            }));
            getPartitaOverlapSpacing(rows).forEach((rowSpacing, index) => {
                spacing.set(column.words[index].config.id, rowSpacing);
            });
        });
        return spacing;
    }, [resolvedPartitaTuning.avoidOverlap, sequentialLayout, theme]);

    // With avoidOverlap the spaced-out line may outgrow the lyric area; it then shrinks to fit.
    const lyricAreaRef = useRef<HTMLDivElement>(null);
    const overlapFit = useOverlapFit(
        Boolean(resolvedPartitaTuning.avoidOverlap),
        activeLine?.startTime,
        lyricAreaRef,
        [sequentialLayout, lyricsFontScale, windowHeight, theme],
    );
    const densityScale = (sequentialLayout.totalGraphemes > 40 ? 0.8 : 1) * overlapFit;
    const mainFontSize = `clamp(${(2.5 * densityScale * lyricsFontScale).toFixed(3)}rem, ${(5.5 * densityScale * lyricsFontScale).toFixed(3)}vw, ${(4.5 * densityScale * lyricsFontScale).toFixed(3)}rem)`;
    const emptyFontSize = `clamp(${(1.2 * lyricsFontScale).toFixed(3)}rem, ${(2.8 * lyricsFontScale).toFixed(3)}vw, ${(1.9 * lyricsFontScale).toFixed(3)}rem)`;
    const translationFontSize = `clamp(${(1.05 * lyricsFontScale).toFixed(3)}rem, ${(2.2 * lyricsFontScale).toFixed(3)}vw, ${(1.2 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(1.8 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`;

    const layoutVariants = buildGlowWordLayoutVariants(theme.animationIntensity);
    const bodyVariants = glowWordBodyVariants;

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
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <motion.div
                ref={lyricAreaRef}
                className="relative z-10 w-full h-[70vh] flex items-center justify-center p-8 pointer-events-none will-change-transform"
                animate={lyricContainerFloat.animate}
                transition={lyricContainerFloat.transition}
            >
                {/* A line hidden because the text is (a window over the player) only fades: the next line's
                    exit grows and blurs it, and this layer covers most of the screen. */}
                <AnimatePresence mode="popLayout" custom={!showText}>
                    {showText && activeLine && activeLineRenderProfile && (
                        <motion.div
                            key={activeLine.startTime}
                            initial={activeLineContainerMotion.initial}
                            animate={activeLineContainerMotion.animate}
                            custom={!showText}
                            variants={{ leave: (hidden: boolean) => (hidden ? TEXT_HIDDEN_EXIT : activeLineContainerMotion.exit) }}
                            exit="leave"
                            {...{ [OVERLAP_FIT_LINE_ATTRIBUTE]: activeLine.startTime }}
                            className="flex flex-row-reverse items-stretch justify-center w-full max-w-5xl"
                            style={{
                                perspective: `${sequentialLayout.lineConfig.perspective}px`,
                                gap: sequentialLayout.lineConfig.columnGap,
                                // The fit measures the content: the line is centred either way.
                                minHeight: overlapSpacing ? undefined : '320px',
                            }}
                        >
                            {sequentialLayout.columns.map((column) => {
                                return (
                                    <div
                                        key={column.id}
                                        className={`relative flex ${overlapSpacing ? '' : 'min-h-[24rem] '}min-w-[3.8rem] items-center justify-center px-3`}
                                    >
                                        <div className="relative z-10 flex flex-col items-center justify-start">
                                            {column.words.map(({ chunkWords, displayWords, config, order, rowIndex }) => (
                                                <PartitaChunk
                                                    key={`${config.id}`}
                                                    chunkWords={chunkWords}
                                                    displayWords={displayWords}
                                                    config={config}
                                                    guideIndex={rowIndex}
                                                    currentTime={currentTime}
                                                    theme={theme}
                                                    layoutVariants={layoutVariants}
                                                    bodyVariants={bodyVariants}
                                                    baseColor={theme.primaryColor}
                                                    renderProfile={activeLineRenderProfile}
                                                    isChorus={activeLine.isChorus}
                                                    showGuideLines={resolvedPartitaTuning.showGuideLines}
                                                    overlapSpacing={overlapSpacing?.get(config.id)}
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

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                subtitleTheme={subtitleTheme}
                translationFontSize={translationFontSize}
                upcomingFontSize={upcomingFontSize}
                subtitleOverlayOpacity={subtitleOverlayOpacity}
                subtitleOverlayBackground={subtitleOverlayBackground}
                subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
                subtitleFontScale={subtitleFontScale}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                subtitleOverlayLayout={subtitleOverlayLayout}
            />
        </VisualizerShell>
    );
};

export default VisualizerPartita;
