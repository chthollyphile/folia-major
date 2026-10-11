import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DEFAULT_CADENZA_TUNING, Line } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { colorWithAlpha, mixColors } from '../colorMix';
import { isGlowBlurQuantized } from '../../../utils/glowBlurQuantize';
import { prepareActiveAndUpcoming, useVisualizerRuntime } from '../runtime';
import { type VisualizerSharedProps } from '../definition';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { resolveSubtitleFontSizes } from '../subtitleFontSizes';
import type {
    AnimatedPlacementState,
    OverlayWordNodes,
    PreparedState,
    PreparedStateCacheContext,
    WordPlacement,
} from './cadenzaTypes';
import {
    clearOverlayWordNodes,
    createOverlayWordNodes,
    syncOverlayGlyphSpans,
    writeOverlayGlyphShadow,
    writeOverlayWord,
} from './cadenzaOverlayNodes';
import {
    ACTIVE_PULSE_FREQUENCY,
    buildDomTextShadow,
    clamp,
    getClassicBodyMix,
    getClassicCharGlow,
    getClassicGlowEnvelope,
    getClassicLineEnvelope,
    getClassicPassedDrift,
    getWordProgress,
    getWordStatus,
    isCJK,
    mix,
    resolveLineRenderTiming,
    splitGraphemes,
} from './cadenzaEnvelopes';
import { buildPreparedState } from './cadenzaPreparedState';

// This is the heavy layout mode.
// The line does not just show up and animate; we first prebuild the active/upcoming lines,
// run them through pretext, split them into fragments/placements, then mirror those placements into DOM + canvas layers.
// So when something looks weird here, the bug is usually either in the prepare step or in the placement-to-render sync step.
//
// For a single lyric line, the state flow is:
// waiting -> placements are ready, but keep them dim / offset so the line still feels "not entered".
// active -> this is the main event, drive beam, glow, emphasis, and body color here.
// passed -> line already sang, keep some drift and residue so it fades out gracefully instead of snapping away.
type VisualizerProps = VisualizerSharedProps;

/** Words are drawn waiting first and active last, so the word being sung sits on top. */
const STATUS_DRAW_ORDER = ['waiting', 'passed', 'active'] as const;

const VisualizerCadenza: React.FC<VisualizerProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        audioPower,
        audioBands,
        showText = true,
        cadenzaTuning = DEFAULT_CADENZA_TUNING,
        lyricsFontScale = 1,
        subtitleFontScale = 1,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        showSubtitleTranslation = true,
        subtitleContentMode,
    } = props;
    const { t } = useTranslation();
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const lineLayerRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const overlayNodesRef = useRef<Map<string, OverlayWordNodes>>(new Map());
    const textCanvasRef = useRef<HTMLCanvasElement>(null);
    const animatedPlacementRef = useRef<Map<string, AnimatedPlacementState>>(new Map());
    const preparedStateCacheRef = useRef<Map<string, PreparedState>>(new Map());
    const preparedStateCacheContextKeyRef = useRef<string>('');
    const lastFrameTimeRef = useRef<number | null>(null);

    const {
        activeLine,
        recentCompletedLine,
        upcomingLine,
        nextLines,
    } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    const tuning = cadenzaTuning;
    const emptyFontSize = `clamp(${(1.5 * lyricsFontScale).toFixed(3)}rem, ${(3.5 * lyricsFontScale).toFixed(3)}vw, ${(2.25 * lyricsFontScale).toFixed(3)}rem)`;
    const { translationFontSize, upcomingFontSize } = resolveSubtitleFontSizes(lyricsFontScale);

    const preparedStateContext = useMemo<PreparedStateCacheContext>(() => ({
        showText,
        viewport,
        theme,
        tuning: {
            fontScale: tuning.fontScale,
            widthRatio: tuning.widthRatio,
        },
    }), [showText, theme, tuning.fontScale, tuning.widthRatio, viewport]);

    const preparedStateContextKey = useMemo(() => {
        const wordColorSignature = (theme.wordColors ?? [])
            .map(entry => `${typeof entry?.word === 'string' ? entry.word : ''}:${typeof entry?.color === 'string' ? entry.color : ''}`)
            .join('||');

        // Prepared line state caches per-word highlight colors derived from the active theme.
        // Include accentColor so daylight/default resets invalidate already-seen lyric lines immediately.
        return [
            showText ? '1' : '0',
            viewport.width,
            viewport.height,
            theme.fontStyle,
            theme.fontFamily ?? '',
            theme.fontFamilyStack?.join(',') ?? '',
            theme.fontWeight ?? 'auto',
            theme.animationIntensity,
            theme.accentColor,
            tuning.fontScale,
            tuning.widthRatio,
            wordColorSignature,
        ].join('|');
    }, [
        theme.accentColor,
        showText,
        theme.animationIntensity,
        theme.fontFamily,
        theme.fontFamilyStack,
        theme.fontWeight,
        theme.fontStyle,
        theme.wordColors,
        tuning.fontScale,
        tuning.widthRatio,
        viewport.height,
        viewport.width,
    ]);

    if (preparedStateCacheContextKeyRef.current !== preparedStateContextKey) {
        preparedStateCacheRef.current.clear();
        preparedStateCacheContextKeyRef.current = preparedStateContextKey;
    }

    const getPreparedStateCacheKey = (line: Line) => [
        line.startTime,
        line.endTime,
        line.fullText,
        line.words.length,
    ].join('|');

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            setViewport({
                width: entry.contentRect.width,
                height: entry.contentRect.height,
            });
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const preparedState = useMemo<PreparedState | null>(() => {
        const getOrPrepareState = (line: Line | null | undefined) => {
            if (!line) {
                return null;
            }

            const cacheKey = getPreparedStateCacheKey(line);
            const cached = preparedStateCacheRef.current.get(cacheKey);
            if (cached) {
                return cached;
            }

            const nextState = buildPreparedState(line, preparedStateContext);
            if (nextState) {
                preparedStateCacheRef.current.set(cacheKey, nextState);
            }
            return nextState;
        };

        if (!showText || viewport.width <= 0 || viewport.height <= 0) {
            getOrPrepareState(upcomingLine);
            return null;
        }

        return prepareActiveAndUpcoming({
            activeLine,
            upcomingLine,
            prepareLine: getOrPrepareState,
        });
    }, [activeLine, preparedStateContext, upcomingLine, showText, viewport.height, viewport.width]);

    useEffect(() => {
        const textCanvas = textCanvasRef.current;
        const lineLayer = lineLayerRef.current;
        const overlay = overlayRef.current;
        if (!textCanvas || !lineLayer || !overlay || viewport.width <= 0 || viewport.height <= 0) return;

        let frameId = 0;
        const textContext = textCanvas.getContext('2d');
        if (!textContext) return;

        // Everything below is fixed for this prepared line, so it is worked out once per effect
        // run rather than every frame: the placement ids, and per placement its graphemes and
        // the ascent of its text in the line's font.
        const placementIds = new Set(preparedState?.placements.map(placement => placement.id));
        animatedPlacementRef.current.forEach((_value, key) => {
            if (!placementIds.has(key)) {
                animatedPlacementRef.current.delete(key);
            }
        });
        const placementGlyphs = new Map<WordPlacement, { glyphs: string[]; cjk: boolean; ascent?: number }>();
        const glyphsOf = (placement: WordPlacement) => {
            let entry = placementGlyphs.get(placement);
            if (!entry) {
                entry = { glyphs: splitGraphemes(placement.text), cjk: isCJK(placement.text) };
                placementGlyphs.set(placement, entry);
            }
            return entry;
        };
        // A web font that finishes loading mid-line changes the ascent; measure again next frame.
        const fontSet = typeof document !== 'undefined' ? document.fonts : undefined;
        const forgetAscents = () => placementGlyphs.forEach(entry => { entry.ascent = undefined; });
        fontSet?.addEventListener('loadingdone', forgetAscents);
        // Placements bucketed by status, each bucket in line order - what a stable sort on the
        // status gives, without the comparator re-deriving every status on every comparison.
        const byStatus: Record<'waiting' | 'passed' | 'active', WordPlacement[]> = { waiting: [], passed: [], active: [] };
        let frameNumber = 0;

        const draw = () => {
            const now = performance.now();
            const dt = lastFrameTimeRef.current === null
                ? 1 / 60
                : clamp((now - lastFrameTimeRef.current) / 1000, 1 / 240, 0.05);
            lastFrameTimeRef.current = now;
            const width = Math.max(Math.floor(viewport.width), 1);
            const height = Math.max(Math.floor(viewport.height), 1);
            const dpr = window.devicePixelRatio || 1;

            if (textCanvas.width !== Math.floor(width * dpr) || textCanvas.height !== Math.floor(height * dpr)) {
                textCanvas.width = Math.floor(width * dpr);
                textCanvas.height = Math.floor(height * dpr);
                textCanvas.style.width = `${width}px`;
                textCanvas.style.height = `${height}px`;
            }

            textContext.setTransform(dpr, 0, 0, dpr, 0, 0);
            textContext.clearRect(0, 0, width, height);

            if (!showText || !preparedState || !activeLine) {
                lineLayer.style.opacity = '0';
                lineLayer.style.filter = 'none';
                lineLayer.style.transform = 'scale(1)';
                lineLayer.style.perspective = '1000px';
                clearOverlayWordNodes(overlayNodesRef.current);
                frameId = window.requestAnimationFrame(draw);
                return;
            }

            const time = currentTime.get();
            const lineTiming = resolveLineRenderTiming(activeLine);
            const lineEnvelope = getClassicLineEnvelope(time, activeLine, lineTiming);
            const wordRevealMode = lineTiming.wordRevealMode;
            const isInstantWordReveal = wordRevealMode === 'instant';
            const lineSeed = Math.abs(Math.sin(activeLine.startTime * 997.1));
            const linePerspective = theme.animationIntensity === 'chaotic' ? 500 + Math.round(lineSeed * 500) : 1000;
            const energy = clamp(audioPower.get() / 255, 0, 1);
            const motionEnergy = energy * tuning.motionAmount;
            const verticalLift = Math.sin(time * 2.3) * (3 + motionEnergy * 8);
            const focusY = height * 0.42 + verticalLift;

            lineLayer.style.opacity = lineEnvelope.opacity.toString();
            lineLayer.style.filter = lineEnvelope.blur > 0.05 ? `blur(${lineEnvelope.blur.toFixed(2)}px)` : 'none';
            lineLayer.style.transform = `scale(${lineEnvelope.scale})`;
            lineLayer.style.perspective = `${linePerspective}px`;

            textContext.font = preparedState.font;
            textContext.textBaseline = 'alphabetic';
            textContext.lineJoin = 'round';
            textContext.lineCap = 'round';

            byStatus.waiting.length = 0;
            byStatus.passed.length = 0;
            byStatus.active.length = 0;
            for (const placement of preparedState.placements) {
                byStatus[getWordStatus(time, lineTiming, placement.word)].push(placement);
            }
            const overlayNodes = overlayNodesRef.current;
            frameNumber += 1;

            let placementIndex = -1;
            for (const status of STATUS_DRAW_ORDER) {
                for (const placement of byStatus[status]) {
                    placementIndex += 1;
                    const progress = getWordProgress(time, wordRevealMode, placement.word);
                    const passedAlpha = isInstantWordReveal
                        ? 0
                        : theme.animationIntensity === 'chaotic'
                            ? 0.9
                            : 0.82;
                    const pulse = status === 'active'
                        && !isInstantWordReveal
                        ? 1 + Math.sin(time * ACTIVE_PULSE_FREQUENCY + placement.word.startTime * 5) * 0.04 * tuning.motionAmount
                        : 1;
                    const passedDriftProgress = isInstantWordReveal ? 0 : getClassicPassedDrift(time, placement.word);
                    const targetScale = status === 'waiting'
                        ? isInstantWordReveal
                            ? placement.scale
                            : Math.max(placement.scale * 0.5, 0.5)
                        : status === 'active'
                            ? isInstantWordReveal
                                ? placement.scale
                                : placement.scale * 1.3 * pulse
                            : placement.scale;
                    const targetRotation = status === 'waiting'
                        ? isInstantWordReveal
                            ? placement.rotate
                            : placement.rotate + 20
                        : status === 'passed'
                            ? isInstantWordReveal
                                ? placement.rotate
                                : placement.rotate + placement.passedRotate * passedDriftProgress
                            : placement.rotate;
                    const localFloatX = Math.sin(time * 1.2 + placementIndex * 0.6) * motionEnergy * 4;
                    const localFloatY = Math.cos(time * 1.5 + placementIndex * 0.4) * motionEnergy * 2.5;
                    const passedDriftX = status === 'passed' ? placement.passedDriftX * passedDriftProgress : 0;
                    const passedDriftY = status === 'passed' ? placement.passedDriftY * passedDriftProgress : 0;
                    const targetX = width / 2 + placement.x + localFloatX + passedDriftX + (status === 'waiting' ? placement.entryOffsetX : 0);
                    const targetY = focusY + placement.y + localFloatY + passedDriftY + (status === 'waiting' ? placement.entryOffsetY : 0);
                    const targetBodyAlpha = status === 'waiting' ? 0 : status === 'active' ? 1 : passedAlpha;
                    const targetBlur = status === 'waiting' && !isInstantWordReveal ? 10 : 0;
                    const targetActiveMix = getClassicBodyMix(time, lineTiming, placement.word);
                    const targetGlowAlpha = getClassicGlowEnvelope(time, lineTiming, placement.word);
                    const transformTransitionAmount = 1 - Math.exp(-11 * dt);
                    const visualTransitionAmount = 1 - Math.exp(-14 * dt);
                    const stateMap = animatedPlacementRef.current;
                    const existingState = stateMap.get(placement.id);
                    const shouldInitializeAsActive = isInstantWordReveal && time >= placement.word.startTime;
                    const animatedState = existingState ?? {
                        x: width / 2 + placement.x + placement.entryOffsetX,
                        y: focusY + placement.y + placement.entryOffsetY,
                        rotation: shouldInitializeAsActive ? targetRotation : targetRotation + 16,
                        scale: shouldInitializeAsActive ? targetScale : Math.max(placement.scale * 0.5, 0.5),
                        bodyAlpha: shouldInitializeAsActive ? targetBodyAlpha : 0,
                        blur: shouldInitializeAsActive ? targetBlur : 10,
                        activeMix: shouldInitializeAsActive ? targetActiveMix : 0,
                        glowAlpha: shouldInitializeAsActive ? targetGlowAlpha : 0,
                    };

                    animatedState.x = mix(animatedState.x, targetX, transformTransitionAmount);
                    animatedState.y = mix(animatedState.y, targetY, transformTransitionAmount);
                    animatedState.rotation = mix(animatedState.rotation, targetRotation, transformTransitionAmount);
                    animatedState.scale = mix(animatedState.scale, targetScale, transformTransitionAmount);
                    animatedState.bodyAlpha = mix(animatedState.bodyAlpha, targetBodyAlpha, visualTransitionAmount);
                    animatedState.blur = mix(animatedState.blur, targetBlur, visualTransitionAmount);
                    animatedState.activeMix = mix(animatedState.activeMix, targetActiveMix, visualTransitionAmount);
                    animatedState.glowAlpha = mix(animatedState.glowAlpha, targetGlowAlpha, 1 - Math.exp(-16 * dt));
                    stateMap.set(placement.id, animatedState);

                    if (animatedState.bodyAlpha < 0.015 && animatedState.glowAlpha < 0.015) {
                        continue;
                    }

                    const drawX = animatedState.x;
                    const drawBaselineY = animatedState.y;
                    const visualWidth = placement.width * animatedState.scale;
                    const visualHeight = placement.height * animatedState.scale;
                    const highlightHeight = visualHeight * (status === 'active' ? 1.08 : 1);
                    const scaledLeft = drawX - (visualWidth - placement.width) / 2;
                    if (status === 'active' && !placement.isInterlude) {
                        if (activeLine.isChorus) {
                            const rippleRadius = Math.max(visualWidth, highlightHeight) * (0.55 + progress * 0.45);
                            textContext.strokeStyle = colorWithAlpha(placement.color, 0.45 * (1 - progress) * animatedState.bodyAlpha);
                            textContext.lineWidth = 1.2;
                            textContext.beginPath();
                            textContext.arc(
                                scaledLeft + visualWidth / 2,
                                drawBaselineY - visualHeight * 0.42,
                                rippleRadius,
                                0,
                                Math.PI * 2,
                            );
                            textContext.stroke();
                        }
                    }

                    const textX = -placement.width / 2;
                    const textY = placement.height * 0.42;
                    const textColor = mixColors(theme.primaryColor, placement.color, animatedState.activeMix);

                    const overlayAnchorX = drawX + placement.width / 2;
                    const overlayAnchorY = drawBaselineY - placement.height * 0.42;
                    const overlayOffsetX = textX;
                    const placementText = glyphsOf(placement);
                    // Measured once per placement: the canvas font is the prepared line's font on every frame.
                    placementText.ascent ??= textContext.measureText(placement.text).actualBoundingBoxAscent;
                    const measuredAscent = placementText.ascent || preparedState.fontPx * 0.78;
                    const overlayOffsetY = textY - measuredAscent;
                    const glyphs = placementText.glyphs;
                    const shouldSplitGlow = wordRevealMode === 'normal' && !placementText.cjk && glyphs.length > 1;
                    const blurScale = 1 + energy * 0.22;
                    let overlayWord = overlayNodes.get(placement.id);
                    if (!overlayWord) {
                        overlayWord = createOverlayWordNodes();
                        overlayNodes.set(placement.id, overlayWord);
                        overlay.appendChild(overlayWord.outer);
                    }
                    overlayWord.frame = frameNumber;

                    writeOverlayWord(overlayWord, {
                        outerTransform: `translate3d(${overlayAnchorX}px, ${overlayAnchorY}px, 0) rotate(${animatedState.rotation}deg) scale(${animatedState.scale})`,
                        // Own compositing layer while Lab > Fix lyric animation freeze on Linux is on: otherwise every
                        // new scale re-rasterizes the word and its 40px text-shadow at a new device size, and Chromium's
                        // glyph cache leaks shared memory for each one. See utils/glowBlurQuantize.ts.
                        willChange: isGlowBlurQuantized() ? 'transform' : '',
                        font: preparedState.font,
                        innerTransform: `translate3d(${overlayOffsetX}px, ${overlayOffsetY}px, 0)`,
                        text: placement.text,
                        color: textColor,
                        opacity: animatedState.bodyAlpha.toString(),
                        filter: animatedState.blur > 0.05 ? `blur(${animatedState.blur.toFixed(2)}px)` : 'none',
                    });

                    const glowTexts = shouldSplitGlow ? glyphs : [placement.text];
                    syncOverlayGlyphSpans(overlayWord, glowTexts);

                    if (shouldSplitGlow) {
                        for (let glyphIndex = 0; glyphIndex < overlayWord.glyphSpans.length; glyphIndex += 1) {
                            const absoluteIndex = placement.fragmentStartInWord + glyphIndex;
                            const intensity = getClassicCharGlow(
                                time,
                                placement.word,
                                absoluteIndex,
                                Math.max(placement.wordGraphemeCount, glyphs.length),
                                placement.wordGraphemeTimings,
                            ) * clamp(animatedState.glowAlpha, 0, 1) * Math.max(tuning.glowIntensity, 0);

                            writeOverlayGlyphShadow(overlayWord, glyphIndex, buildDomTextShadow(placement.color, intensity, blurScale));
                        }
                    } else if (overlayWord.glyphSpans[0]) {
                        const intensity = getClassicGlowEnvelope(time, lineTiming, placement.word)
                            * clamp(animatedState.glowAlpha, 0, 1)
                            * Math.max(tuning.glowIntensity, 0);
                        writeOverlayGlyphShadow(overlayWord, 0, buildDomTextShadow(placement.color, intensity, blurScale));
                    }

                }
            }

            overlayNodes.forEach((nodes, key) => {
                if (nodes.frame !== frameNumber) {
                    nodes.outer.remove();
                    overlayNodes.delete(key);
                }
            });

            frameId = window.requestAnimationFrame(draw);
        };

        draw();
        return () => {
            window.cancelAnimationFrame(frameId);
            fontSet?.removeEventListener('loadingdone', forgetAscents);
            lastFrameTimeRef.current = null;
            clearOverlayWordNodes(overlayNodesRef.current);
        };
    }, [
        audioPower,
        currentTime,
        activeLine,
        preparedState,
        showText,
        theme,
        tuning.glowIntensity,
        tuning.motionAmount,
        viewport.height,
        viewport.width,
    ]);

    return (
        <VisualizerShell
            ref={containerRef}
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <div
                ref={lineLayerRef}
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                    opacity: 0,
                    filter: 'none',
                    transform: 'scale(1)',
                    transformOrigin: '50% 42%',
                    perspective: '1000px',
                }}
            >
                <div ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none select-none" />
                <canvas ref={textCanvasRef} className="absolute inset-0 w-full h-full" />
            </div>

            <div className="relative z-10 w-full h-[70vh] flex items-center justify-center p-8 pointer-events-none">
                <AnimatePresence mode="wait">
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
            </div>

            <VisualizerSubtitleOverlay
                currentTime={currentTime}
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
                showSubtitleTranslation={showSubtitleTranslation}
                subtitleContentMode={subtitleContentMode}
            />
        </VisualizerShell>
    );
};

export default VisualizerCadenza;
