import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Hourglass } from 'lucide-react';
import { DEFAULT_FUME_TUNING, FumeTuning } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { useLyricRenderQuality } from '../renderQuality/useLyricRenderQuality';
import { colorWithAlpha } from '../colorMix';

import { type VisualizerSharedProps } from '../definition';
import { buildFumeBackgroundScene } from './FumeBackground';
import { getRecentCompletedLine, getSubtitleNextLines } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import { fumeBackgroundConfig } from './backgroundConfig';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import type { FumeArticleLayout, ViewportSize } from './fumeTypes';
import { createFumeCameraState, type FumeCameraState } from './fumeCameraStep';

import { clamp } from './fumeMath';

import { resolveFumePassedFadeDuration } from './fumeTextStyle';

import { buildArticleLayout, buildLayoutCacheKey, runLayoutInSlices } from './fumeArticleLayout';
import { resolveArticleOverviewCamera } from './fumeCamera';
import type { FumeStageDriver, FumeStageScene } from './fumeStage';
import { useFumeCanvasStage } from './useFumeCanvasStage';
import { useFirstFrameDrawn } from '../styleTransition/firstFrame';
import { ARRIVING_MARK } from '../preview/frozenPicture';

// This mode is basically "turn the whole lyric into an article, then move a camera through it".
// So the pipeline is much bigger than the others: prebuild the article layout, split it into blocks/render lines/graphemes,
// resolve which block the camera should care about right now, then draw background + paper + typed text + passed text together every frame.
// If this mode breaks, it is usually not one tiny animation bug, it is some step in that whole pipeline drifting out of sync.
//
// For a single lyric line, the state handling is:
// waiting -> line already exists in the article, but the camera may not be on it yet and glyphs can stay unprinted.
// active -> line becomes the main reading target, camera focuses in, and glyphs print with stronger glow/presence.
// passed -> line becomes already-read text, keep some paper trace and fade it out with textHoldRatio instead of removing it instantly.
type VisualizerProps = VisualizerSharedProps;

// Article layouts by what they were laid out from, the one used last at the end. More than one is
// kept: the playing page, the small pictures in the pickers and the sample in the settings window
// each lay out lines of their own, and with room for one they threw each other's layout away, so
// every switch back to this style laid the whole song out again.
const FUME_LAYOUT_CACHE_SIZE = 4;
const fumeLayoutCache = new Map<string, FumeArticleLayout | null>();
const keepFumeLayout = (key: string, article: FumeArticleLayout | null) => {
    fumeLayoutCache.delete(key);
    fumeLayoutCache.set(key, article);
    if (fumeLayoutCache.size > FUME_LAYOUT_CACHE_SIZE) {
        fumeLayoutCache.delete(fumeLayoutCache.keys().next().value as string);
    }
};

const LAYOUT_REBUILD_DEBOUNCE_MS = 96;

const VisualizerFume: React.FC<VisualizerProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        audioPower,
        audioBands,
        showText = true,
        seed,
        staticMode = false,
        lyricsFontScale = 1,
        subtitleFontScale = 1,
        fumeTuning,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        subtitleOverlayLayout,
        paused = false,
        isPreviewMode = false,
    } = props;
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const currentLineIndexRef = useRef(currentLineIndex);
    const cameraStateRef = useRef<FumeCameraState>(createFumeCameraState());
    const layoutBuildVersionRef = useRef(0);
    const hasResolvedArticleRef = useRef(false);
    const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
    const [article, setArticle] = useState<FumeArticleLayout | null>(null);
    const [isLayoutPending, setIsLayoutPending] = useState(false);
    const [hasPrintedContent, setHasPrintedContent] = useState(false);
    const hasPrintedContentRef = useRef(false);
    // The first layout of a song is the slow part of this style's start (about a second on a slow
    // machine, in slices): a style switch waits until the article is laid out and drawn, or there is
    // none to lay out.
    const firstFrameDrawn = useFirstFrameDrawn();

    useEffect(() => {
        currentLineIndexRef.current = currentLineIndex;
    }, [currentLineIndex]);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) {
            return;
        }

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            const nextWidth = entry.contentRect.width;
            const nextHeight = entry.contentRect.height;
            setViewport(previous => (
                previous.width === nextWidth && previous.height === nextHeight
                    ? previous
                    : { width: nextWidth, height: nextHeight }
            ));
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const runtime = useMemo(() => {
        const activeLine = lines[currentLineIndex] ?? null;
        const timeNow = currentTime.get();
        const recentCompletedLine = getRecentCompletedLine({
            lines,
            currentLineIndex,
            currentTime: timeNow,
            getLineEndTime: getLineRenderEndTime,
        });
        return {
            activeLine,
            recentCompletedLine,
            nextLines: getSubtitleNextLines(lines, currentLineIndex, recentCompletedLine),
        };
    }, [currentLineIndex, lines]);
    const resolvedFumeTuning = useMemo<FumeTuning>(() => ({
        render: fumeTuning?.render ?? DEFAULT_FUME_TUNING.render,
        hidePrintSymbols: fumeTuning?.hidePrintSymbols ?? DEFAULT_FUME_TUNING.hidePrintSymbols,
        disableGeometricBackground: fumeTuning?.disableGeometricBackground ?? DEFAULT_FUME_TUNING.disableGeometricBackground,
        backgroundObjectOpacity: clamp(
            fumeTuning?.backgroundObjectOpacity ?? DEFAULT_FUME_TUNING.backgroundObjectOpacity,
            0,
            1,
        ),
        textHoldRatio: clamp(fumeTuning?.textHoldRatio ?? DEFAULT_FUME_TUNING.textHoldRatio, 0, 1),
        cameraTrackingMode: fumeTuning?.cameraTrackingMode === 'stepped' || fumeTuning?.cameraTrackingMode === 'smooth'
            ? fumeTuning.cameraTrackingMode
            : DEFAULT_FUME_TUNING.cameraTrackingMode,
        cameraSpeed: clamp(fumeTuning?.cameraSpeed ?? DEFAULT_FUME_TUNING.cameraSpeed, 0.55, 1.85),
        glowIntensity: clamp(fumeTuning?.glowIntensity ?? DEFAULT_FUME_TUNING.glowIntensity, 0, 1.8),
        heroScale: clamp(fumeTuning?.heroScale ?? DEFAULT_FUME_TUNING.heroScale, 0.82, 1.32),
    }), [fumeTuning]);
    const layoutTheme = useMemo(
        () => ({
            name: theme.name,
            fontStyle: theme.fontStyle,
            fontFamily: theme.fontFamily,
            fontFamilyStack: theme.fontFamilyStack,
            fontWeight: theme.fontWeight,
        }),
        [theme.fontFamily, theme.fontFamilyStack, theme.fontStyle, theme.fontWeight, theme.name],
    );
    const layoutFumeTuning = useMemo<FumeTuning>(() => ({
        ...DEFAULT_FUME_TUNING,
        heroScale: resolvedFumeTuning.heroScale,
    }), [resolvedFumeTuning.heroScale]);

    useEffect(() => {
        const requestVersion = layoutBuildVersionRef.current + 1;
        layoutBuildVersionRef.current = requestVersion;

        if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) {
            hasResolvedArticleRef.current = false;
            setArticle(null);
            setIsLayoutPending(false);
            if (lines.length === 0) firstFrameDrawn();
            return;
        }

        setIsLayoutPending(true);

        let rafId = 0;
        let timeoutId = 0;
        let stopLayout: (() => void) | null = null;
        const delay = hasResolvedArticleRef.current ? LAYOUT_REBUILD_DEBOUNCE_MS : 0;

        rafId = window.requestAnimationFrame(() => {
            timeoutId = window.setTimeout(() => {
                if (layoutBuildVersionRef.current !== requestVersion) {
                    return;
                }

                const layoutCacheKey = buildLayoutCacheKey(lines, viewport, layoutTheme, lyricsFontScale, layoutFumeTuning);
                const applyArticle = (nextArticle: FumeArticleLayout | null) => {
                    if (layoutBuildVersionRef.current !== requestVersion) {
                        return;
                    }

                    keepFumeLayout(layoutCacheKey, nextArticle);
                    hasResolvedArticleRef.current = nextArticle !== null;
                    setArticle(nextArticle);
                    setIsLayoutPending(false);
                    if (!nextArticle) firstFrameDrawn();
                };
                if (fumeLayoutCache.has(layoutCacheKey)) {
                    applyArticle(fumeLayoutCache.get(layoutCacheKey) ?? null);
                    return;
                }
                // Laying a whole song out is long work on a slow machine: done in slices, frames keep coming.
                stopLayout = runLayoutInSlices(
                    buildArticleLayout(lines, viewport, layoutTheme, lyricsFontScale, layoutFumeTuning),
                    applyArticle,
                );
            }, delay);
        });

        return () => {
            window.cancelAnimationFrame(rafId);
            window.clearTimeout(timeoutId);
            stopLayout?.();
        };
    }, [firstFrameDrawn, layoutFumeTuning, layoutTheme, lines, lyricsFontScale, viewport]);
    const lastRenderableLine = useMemo(() => {
        for (let index = lines.length - 1; index >= 0; index -= 1) {
            const line = lines[index];
            if (line?.fullText.trim().length) {
                return line;
            }
        }
        return null;
    }, [lines]);
    const overviewStartTime = useMemo(() => {
        if (!lastRenderableLine) {
            return Number.POSITIVE_INFINITY;
        }

        const lineStartTime = lastRenderableLine.startTime;
        const lineRenderEndTime = getLineRenderEndTime(lastRenderableLine);
        return lineStartTime + Math.max(lineRenderEndTime - lineStartTime, 0) * 0.5;
    }, [lastRenderableLine]);
    const backgroundScene = useMemo(
        () => buildFumeBackgroundScene({
            viewport,
            world: {
                width: article?.width ?? Math.max(viewport.width * 1.8, viewport.width),
                height: article?.height ?? Math.max(viewport.height * 1.8, viewport.height),
            },
            paperBounds: article?.paperBounds,
            seed: `${seed ?? 'fume'}:${theme.name}`,
        }),
        [article?.height, article?.paperBounds, article?.width, seed, theme.name, viewport],
    );
    const overviewCamera = useMemo(
        () => (article ? resolveArticleOverviewCamera(article, viewport) : null),
        [article, viewport],
    );
    const cameraSpeed = resolvedFumeTuning.cameraSpeed;
    const glowIntensity = resolvedFumeTuning.glowIntensity;
    const backgroundObjectOpacity = resolvedFumeTuning.backgroundObjectOpacity;
    const showPrintStamp = !resolvedFumeTuning.hidePrintSymbols;
    const textHoldRatio = resolvedFumeTuning.textHoldRatio;
    const passedFadeDuration = useMemo(
        () => resolveFumePassedFadeDuration(lines, textHoldRatio),
        [lines, textHoldRatio],
    );
    const translationFontSize = `clamp(${(1.05 * lyricsFontScale).toFixed(3)}rem, ${(2.2 * lyricsFontScale).toFixed(3)}vw, ${(1.2 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(1.8 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`;

    useEffect(() => {
        hasPrintedContentRef.current = false;
        setHasPrintedContent(false);
    }, [article]);

    const stageScene = useMemo<FumeStageScene>(() => ({
        article,
        lines,
        theme,
        viewport,
        backgroundScene,
        overviewCamera,
        overviewStartTime,
        passedFadeDuration,
        cameraSpeed,
        cameraTrackingMode: resolvedFumeTuning.cameraTrackingMode,
        glowIntensity,
        backgroundObjectOpacity,
        showPrintStamp,
        textHoldRatio,
        showText,
        staticMode,
    }), [
        article,
        backgroundObjectOpacity,
        backgroundScene,
        cameraSpeed,
        glowIntensity,
        lines,
        overviewCamera,
        overviewStartTime,
        passedFadeDuration,
        resolvedFumeTuning.cameraTrackingMode,
        showPrintStamp,
        showText,
        staticMode,
        textHoldRatio,
        theme,
        viewport,
    ]);
    const stageDriver = useMemo<FumeStageDriver>(() => ({
        currentTime,
        audioPower,
        audioBands,
        cameraState: cameraStateRef.current,
        getLineIndex: () => currentLineIndexRef.current,
        onPrintedContent: () => {
            if (hasPrintedContentRef.current) return;
            hasPrintedContentRef.current = true;
            setHasPrintedContent(true);
        },
    }), [audioBands, audioPower, currentTime]);

    // 分辨率倍数（#929）：全局挡位叠上这个样式的覆盖；预览（样式架小图等）保持原来的密度。
    const renderQuality = useLyricRenderQuality(fumeTuning?.render);
    useFumeCanvasStage(canvasRef, stageScene, stageDriver, paused, isPreviewMode ? 1 : renderQuality.scale);
    // After the stage's effect, which draws the article's first frame.
    useEffect(() => {
        if (article) firstFrameDrawn();
    }, [article, firstFrameDrawn]);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={{ ...props, background: fumeBackgroundConfig(props) }}
        >
            <div ref={viewportRef} className="relative z-10 h-full w-full pointer-events-none">
                {(article || lines.length === 0) && (
                    <motion.div
                        initial={false}
                        animate={{
                            opacity: 1,
                            scale: article && showText ? (hasPrintedContent ? 1 : 0.985) : 1,
                        }}
                        transition={{ duration: 0.45, ease: 'easeOut' }}
                        className="absolute left-1/2 top-0 -translate-x-1/2"
                        style={{
                            width: viewport.width,
                            height: viewport.height,
                        }}
                    >
                        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
                    </motion.div>
                )}

                {isLayoutPending && (
                    // The layout runs while frames keep coming: a picture made of this stage waits for the article.
                    <motion.div
                        {...{ [ARRIVING_MARK]: '' }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        <div
                            className="flex min-w-40 flex-col items-center gap-4 rounded-3xl border px-6 py-5"
                            style={{
                                backgroundColor: theme.backgroundColor,
                                borderColor: colorWithAlpha(theme.secondaryColor, 0.24),
                                boxShadow: `0 18px 60px ${colorWithAlpha(theme.backgroundColor, 0.52)}`,
                            }}
                        >
                            <Hourglass
                                size={24}
                                className="animate-pulse"
                                style={{ color: colorWithAlpha(theme.primaryColor, 0.78) }}
                            />
                            <div className="flex w-28 flex-col gap-2.5">
                                <div
                                    className="h-2 rounded-full animate-pulse"
                                    style={{ backgroundColor: colorWithAlpha(theme.primaryColor, 0.32) }}
                                />
                                <div
                                    className="h-2 rounded-full animate-pulse"
                                    style={{
                                        width: '78%',
                                        backgroundColor: colorWithAlpha(theme.primaryColor, 0.22),
                                    }}
                                />
                                <div
                                    className="h-2 rounded-full animate-pulse"
                                    style={{
                                        width: '56%',
                                        backgroundColor: colorWithAlpha(theme.secondaryColor, 0.2),
                                    }}
                                />
                            </div>
                        </div>
                    </motion.div>
                )}
            </div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={runtime.activeLine}
                recentCompletedLine={runtime.recentCompletedLine}
                nextLines={runtime.nextLines}
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

export default VisualizerFume;
