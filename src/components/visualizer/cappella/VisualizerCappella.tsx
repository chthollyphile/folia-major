import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DEFAULT_CAPPELLA_TUNING, type CappellaTuning } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { shouldPreheatLine, useVisualizerRuntime } from '../runtime';
import { type VisualizerSharedProps } from '../definition';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { builtinEmoImages } from './emoImages';
import type { PreparedBubbleMetrics } from './cappellaTypes';
import { CAPPELLA_PREHEAT_WINDOW } from './cappellaConstants';
import { getCappellaIntensityConfig } from './cappellaIntensity';
import { buildCappellaMessages } from './cappellaMessages';
import { getVisibleLineIndexAtTime, getVisibleMessages } from './cappellaMessageLayout';
import { getOrBuildBubbleMetrics } from './cappellaBubbleMetrics';
import { CappellaMessageRow } from './CappellaMessageRow';

// src/components/visualizer/cappella/VisualizerCappella.tsx
// Renders parsercore-timed lyrics as a chat-style cappella conversation.
type VisualizerCappellaProps = VisualizerSharedProps;

const VisualizerCappella: React.FC<VisualizerCappellaProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        audioPower,
        audioBands,
        showText = true,
        songTitle,
        coverUrl,
        seed,
        lyricsFontScale = 1,
        subtitleFontScale = 1,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        showSubtitleTranslation = true,
        subtitleContentMode,
        cappellaTuning = DEFAULT_CAPPELLA_TUNING,
        cappellaCustomEmojiImages = [],
        cappellaCustomAvatarImages = [],
        isPreviewMode = false,
    } = props;
    const { t } = useTranslation();
    const [viewportSize, setViewportSize] = useState(() => (
        typeof window === 'undefined'
            ? { width: 1280, height: 900 }
            : { width: window.innerWidth, height: window.innerHeight }
    ));
    const bubbleMetricsCacheRef = useRef(new Map<string, PreparedBubbleMetrics>());
    const [visibleLineIndex, setVisibleLineIndex] = useState(() => getVisibleLineIndexAtTime(lines, currentTime.get()));
    const visibleLineIndexRef = useRef(visibleLineIndex);
    const titleText = songTitle?.trim() || t('ui.noTrack');
    const avatarSeed = seed ?? titleText;
    const intensityConfig = useMemo(() => getCappellaIntensityConfig(theme.animationIntensity), [theme.animationIntensity]);
    const resolvedCappellaTuning = useMemo<CappellaTuning>(() => ({
        showEmoMessages: cappellaTuning.showEmoMessages ?? DEFAULT_CAPPELLA_TUNING.showEmoMessages,
        emojiPackSource: (
            cappellaTuning.emojiPackSource === 'custom' && cappellaCustomEmojiImages.length > 0
                ? 'custom'
                : DEFAULT_CAPPELLA_TUNING.emojiPackSource
        ),
        avatarSource: (
            cappellaTuning.avatarSource === 'builtin' || cappellaTuning.avatarSource === 'color' || cappellaTuning.avatarSource === 'cover' || (cappellaTuning.avatarSource === 'custom' && cappellaCustomAvatarImages.length > 0)
                ? cappellaTuning.avatarSource
                : DEFAULT_CAPPELLA_TUNING.avatarSource
        ),
    }), [cappellaCustomEmojiImages.length, cappellaCustomAvatarImages.length, cappellaTuning.avatarSource, cappellaTuning.emojiPackSource, cappellaTuning.showEmoMessages]);
    const activeEmoImages = useMemo(
        () => resolvedCappellaTuning.emojiPackSource === 'custom' && cappellaCustomEmojiImages.length > 0
            ? cappellaCustomEmojiImages
            : builtinEmoImages,
        [cappellaCustomEmojiImages, resolvedCappellaTuning.emojiPackSource]
    );
    const customAvatarImages = useMemo(
        () => resolvedCappellaTuning.avatarSource === 'custom' ? cappellaCustomAvatarImages : [],
        [cappellaCustomAvatarImages, resolvedCappellaTuning.avatarSource]
    );
    const messages = useMemo(
        () => buildCappellaMessages(lines, titleText, intensityConfig, resolvedCappellaTuning, activeEmoImages, isPreviewMode),
        [activeEmoImages, intensityConfig, isPreviewMode, lines, resolvedCappellaTuning, titleText]
    );
    const baseFontSize = Math.max(15, Math.min(26, 18 * lyricsFontScale));
    const maxPanelWidth = Math.min(Math.max(viewportSize.width - 32, 1), 896);
    const bubbleGroupRatio = viewportSize.width >= 640 ? 0.68 : 0.78;
    const maxTextWidth = Math.max(96, Math.floor(maxPanelWidth * bubbleGroupRatio - 56));
    const visibleMessages = useMemo(
        () => getVisibleMessages(
            messages,
            visibleLineIndex,
            viewportSize.height,
            currentLineIndex,
            currentTime.get(),
            intensityConfig.motion,
            theme,
            baseFontSize,
            maxTextWidth
        ),
        [
            baseFontSize,
            currentLineIndex,
            currentTime,
            intensityConfig.motion,
            maxTextWidth,
            messages,
            theme,
            viewportSize.height,
            visibleLineIndex,
        ]
    );
    const { activeLine, recentCompletedLine, upcomingLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    useEffect(() => {
        const handleResize = () => {
            setViewportSize({
                width: window.innerWidth,
                height: window.innerHeight,
            });
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const nextVisibleLineIndex = getVisibleLineIndexAtTime(lines, currentTime.get());

        visibleLineIndexRef.current = nextVisibleLineIndex;
        setVisibleLineIndex(nextVisibleLineIndex);
    }, [currentTime, lines]);

    useMotionValueEvent(currentTime, 'change', latest => {
        const nextVisibleLineIndex = getVisibleLineIndexAtTime(lines, latest);

        if (nextVisibleLineIndex !== visibleLineIndexRef.current) {
            visibleLineIndexRef.current = nextVisibleLineIndex;
            setVisibleLineIndex(nextVisibleLineIndex);
        }

        if (!upcomingLine || !shouldPreheatLine(upcomingLine, latest, CAPPELLA_PREHEAT_WINDOW)) {
            return;
        }

        getOrBuildBubbleMetrics(bubbleMetricsCacheRef.current, {
            line: upcomingLine,
            theme,
            fontSize: baseFontSize * intensityConfig.motion.activeFontMultiplier,
            lineHeightPx: baseFontSize * intensityConfig.motion.activeFontMultiplier * 1.45,
            maxTextWidth,
            paddingX: intensityConfig.motion.activePaddingX,
            paddingY: intensityConfig.motion.activePaddingY,
        });
    });

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            {showText && (
                <div className="relative z-10 flex h-full w-full items-start justify-center overflow-visible px-4 pb-36 pt-12 sm:px-8 sm:pb-40 sm:pt-16 lg:px-14 lg:pt-20">
                    <div className="relative flex w-full max-w-4xl flex-col justify-start gap-3 overflow-visible">
                        <AnimatePresence initial={false} mode="popLayout">
                            {visibleMessages.map((message) => (
                                <CappellaMessageRow
                                    key={message.id}
                                    message={message}
                                    currentTime={currentTime}
                                    currentLineIndex={currentLineIndex}
                                    theme={theme}
                                    coverUrl={coverUrl}
                                    cappellaTuning={resolvedCappellaTuning}
                                    avatarSeed={avatarSeed}
                                    baseFontSize={baseFontSize}
                                    maxTextWidth={maxTextWidth}
                                    metricsCache={bubbleMetricsCacheRef}
                                    intensityConfig={intensityConfig}
                                    customAvatarImages={customAvatarImages}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes cappella-char-fade {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes cappella-bubble-glow-pan {
                    from { transform: translateX(0); }
                    to { transform: translateX(-50%); }
                }

                @keyframes cappella-emo-wiggle {
                    0%, 100% { transform: rotate(-1.6deg); }
                    50% { transform: rotate(1.6deg); }
                }
            `}</style>

            <VisualizerSubtitleOverlay
                currentTime={currentTime}
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                subtitleTheme={subtitleTheme}
                translationFontSize={`${Math.max(14, 16 * lyricsFontScale)}px`}
                upcomingFontSize={`${Math.max(12, 14 * lyricsFontScale)}px`}
                subtitleOverlayOpacity={subtitleOverlayOpacity}
                subtitleOverlayBackground={subtitleOverlayBackground}
                subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
                subtitleFontScale={subtitleFontScale}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                showSubtitleTranslation={showSubtitleTranslation}
                subtitleContentMode={subtitleContentMode}
            />
        </VisualizerShell>
    );
};

export default VisualizerCappella;
