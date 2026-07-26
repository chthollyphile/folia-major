import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { Star, type LucideIcon } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { DEFAULT_PENDOLO_TUNING } from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { type VisualizerSharedProps } from '../definition';
import VisualizerShell from '../VisualizerShell';
import PendoloClockworkCanvas from './PendoloClockworkCanvas';
import { resolveThemeFontStack, resolveThemeFontWeight, resolveThemeTranslationFontStack } from '../../../utils/fontStacks';
import { resolveSubtitleContentMode, resolveLyricAlternateText } from '../../../utils/lyrics/alternateText';
import { calculatePendoloWheelLayout } from './pendoloGeometry';
import PendoloActiveLyricSweep from './PendoloActiveLyricSweep';
import { buildPendoloTextLayout } from './pendoloTextLayout';
import { resolvePendoloChorusPresentation, resolvePendoloMotionProfile } from './pendoloMotionProfile';
import { resolvePendoloFallbackAnchorIndex } from './pendoloTimeline';
import PendoloRotatingLine from './PendoloRotatingLine';

const PENDOLO_SCROLL_IDLE_RESET_MS = 2500;
const PENDOLO_SCROLL_STEP_PX = 90;
const PENDOLO_TOUCH_STEP_PX = 60;
const PENDOLO_SCROLL_EVENT_OPTIONS = { passive: false } as const;

const READY_GRACE_MS = 3000;
const INSTRUMENTAL_COMMIT_SECONDS = 2;
const INSTRUMENTAL_SECONDS_PER_FRAME = 5;

const getScrollDirection = (delta: number) => {
    if (Math.abs(delta) < 1) return 0;
    return delta > 0 ? 1 : -1;
};

const clampScrollSteps = (steps: number) => {
    if (Math.abs(steps) > 5) return steps > 0 ? 5 : -5;
    return steps;
};

// src/components/visualizer/pendolo/VisualizerPendolo.tsx

/**
 * VisualizerPendolo: Escapement wheel & pendulum clockwork lyric visualizer.
 * Renders lyrics arranged in an adjustable circular arc on the left side of the screen.
 * Advance of song lines triggers a springy mechanical escapement ratchet step and subtle balance wheel motion.
 */
const VisualizerPendolo: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        audioBands,
        audioPower,
        showText = true,
        showSubtitleTranslation = true,
        subtitleContentMode = 'translation',
        pendoloTuning = DEFAULT_PENDOLO_TUNING,
        onLyricLineSeek,
        lyricsFontScale = 1,
        subtitleTheme,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleFontScale,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
    } = props;

    const [viewportSize, setViewportSize] = useState({
        width: typeof window !== 'undefined' ? window.innerWidth : 1920,
        height: typeof window !== 'undefined' ? window.innerHeight : 1080,
    });
    const visualizerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const element = visualizerRef.current;
        if (!element) return;

        const updateViewportSize = () => {
            const width = Math.round(element.clientWidth);
            const height = Math.round(element.clientHeight);
            if (width === 0 || height === 0) return;
            setViewportSize(previous => (
                previous.width === width && previous.height === height
                    ? previous
                    : { width, height }
            ));
        };

        updateViewportSize();
        const observer = new ResizeObserver(updateViewportSize);
        observer.observe(element);
        return () => {
            observer.disconnect();
        };
    }, []);

    const lastValidLineIndexRef = React.useRef<number>(0);
    const hasObservedLineRef = useRef(false);
    if (currentLineIndex >= 0 && currentLineIndex < lines.length) {
        lastValidLineIndexRef.current = currentLineIndex;
        hasObservedLineRef.current = true;
    }

    const wheelRailRef = useRef<HTMLDivElement | null>(null);
    const [manualScrollAnchorIndex, setManualScrollAnchorIndex] = useState<number | null>(null);
    const manualScrollResetRef = useRef<number | null>(null);
    const wheelAccumulatorRef = useRef(0);
    const wheelDirectionRef = useRef(0);
    const touchLastYRef = useRef<number | null>(null);
    const touchAccumulatorRef = useRef(0);
    const touchDirectionRef = useRef(0);
    const pendingSeekIndexRef = useRef<number | null>(null);

    const getFallbackAnchorIndex = useCallback(() => {
        if (manualScrollAnchorIndex !== null) return manualScrollAnchorIndex;
        return resolvePendoloFallbackAnchorIndex(
            lines,
            currentLineIndex,
            lastValidLineIndexRef.current,
            hasObservedLineRef.current,
            currentTime.get(),
        );
    }, [currentLineIndex, currentTime, lines, manualScrollAnchorIndex]);

    const [isInstrumental, setIsInstrumental] = useState(false);
    const lyricsSig = lines.length === 0 ? '' : `${lines.length}|${lines[0]?.fullText ?? ''}`;
    const seedRef = useRef(props.seed);

    useEffect(() => {
        if (lyricsSig !== '') {
            setIsInstrumental(false);
            seedRef.current = props.seed;
            return undefined;
        }
        if (props.seed !== seedRef.current) {
            setIsInstrumental(false);
            seedRef.current = props.seed;
        }

        let raf = 0;
        let sawReset = false;
        const startWall = performance.now();
        const watch = () => {
            const t = currentTime.get();
            const capped = performance.now() - startWall >= READY_GRACE_MS;
            if (!sawReset && t < 1) sawReset = true;
            if ((sawReset && t >= INSTRUMENTAL_COMMIT_SECONDS) || capped) {
                setIsInstrumental(true);
                return;
            }
            raf = requestAnimationFrame(watch);
        };
        raf = requestAnimationFrame(watch);
        return () => cancelAnimationFrame(raf);
    }, [props.seed, lyricsSig, currentTime]);

    const [instrumentalIndex, setInstrumentalIndex] = useState(0);
    const instrumentalIndexRef = useRef(0);

    useEffect(() => {
        if (!isInstrumental) return undefined;

        let raf = 0;
        const tick = () => {
            const t = currentTime.get();
            const idx = Math.floor(t / INSTRUMENTAL_SECONDS_PER_FRAME);
            if (idx !== instrumentalIndexRef.current) {
                instrumentalIndexRef.current = idx;
                setInstrumentalIndex(idx);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [isInstrumental, currentTime]);

    const targetLineIndex = useMemo(() => {
        if (lines.length === 0) {
            return isInstrumental ? instrumentalIndex : 0;
        }
        return getFallbackAnchorIndex();
    }, [getFallbackAnchorIndex, lines.length, isInstrumental, instrumentalIndex]);

    const scheduleManualScrollReset = useCallback(() => {
        if (manualScrollResetRef.current !== null) {
            window.clearTimeout(manualScrollResetRef.current);
        }
        manualScrollResetRef.current = window.setTimeout(() => {
            setManualScrollAnchorIndex(null);
            wheelAccumulatorRef.current = 0;
            wheelDirectionRef.current = 0;
            touchAccumulatorRef.current = 0;
            touchDirectionRef.current = 0;
            manualScrollResetRef.current = null;
        }, PENDOLO_SCROLL_IDLE_RESET_MS);
    }, []);

    useEffect(() => () => {
        if (manualScrollResetRef.current !== null) {
            window.clearTimeout(manualScrollResetRef.current);
        }
    }, []);

    useEffect(() => {
        if (pendingSeekIndexRef.current !== currentLineIndex) return;
        pendingSeekIndexRef.current = null;
        setManualScrollAnchorIndex(null);
    }, [currentLineIndex]);

    const moveManualScrollAnchor = useCallback((steps: number) => {
        if (lines.length === 0) return;
        setManualScrollAnchorIndex(current => {
            const baseIndex = current ?? getFallbackAnchorIndex();
            return Math.max(0, Math.min(lines.length - 1, Math.round(baseIndex + steps)));
        });
        scheduleManualScrollReset();
    }, [getFallbackAnchorIndex, lines.length, scheduleManualScrollReset]);

    const handleLineSeek = useCallback((lineIndex: number, startTime: number) => {
        if (!onLyricLineSeek) return;
        if (manualScrollResetRef.current !== null) {
            window.clearTimeout(manualScrollResetRef.current);
            manualScrollResetRef.current = null;
        }
        if (lineIndex === currentLineIndex) {
            pendingSeekIndexRef.current = null;
            setManualScrollAnchorIndex(null);
            onLyricLineSeek(startTime);
            return;
        }
        pendingSeekIndexRef.current = lineIndex;
        setManualScrollAnchorIndex(lineIndex);
        wheelAccumulatorRef.current = 0;
        wheelDirectionRef.current = 0;
        touchAccumulatorRef.current = 0;
        touchDirectionRef.current = 0;
        onLyricLineSeek(startTime);
    }, [currentLineIndex, onLyricLineSeek]);

    const handleRailWheel = useCallback((event: WheelEvent) => {
        if (lines.length === 0) return;
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        const direction = getScrollDirection(event.deltaY);
        if (direction !== 0 && wheelDirectionRef.current !== 0 && direction !== wheelDirectionRef.current) {
            wheelAccumulatorRef.current = 0;
        }
        wheelDirectionRef.current = direction || wheelDirectionRef.current;
        wheelAccumulatorRef.current += event.deltaY;
        const steps = clampScrollSteps(Math.trunc(wheelAccumulatorRef.current / PENDOLO_SCROLL_STEP_PX));
        if (steps !== 0) {
            wheelAccumulatorRef.current = 0;
            moveManualScrollAnchor(steps);
        } else {
            scheduleManualScrollReset();
        }
    }, [lines.length, moveManualScrollAnchor, scheduleManualScrollReset]);

    const handleRailTouchStart = useCallback((event: TouchEvent) => {
        if (lines.length === 0) return;
        event.stopPropagation();
        touchLastYRef.current = event.touches[0]?.clientY ?? null;
        touchAccumulatorRef.current = 0;
        touchDirectionRef.current = 0;
        setManualScrollAnchorIndex(getFallbackAnchorIndex());
        scheduleManualScrollReset();
    }, [getFallbackAnchorIndex, lines.length, scheduleManualScrollReset]);

    const handleRailTouchMove = useCallback((event: TouchEvent) => {
        if (lines.length === 0 || touchLastYRef.current === null) return;
        event.stopPropagation();
        const nextY = event.touches[0]?.clientY;
        if (typeof nextY !== 'number') return;
        const deltaY = touchLastYRef.current - nextY;
        touchLastYRef.current = nextY;
        const direction = getScrollDirection(deltaY);
        if (direction !== 0 && touchDirectionRef.current !== 0 && direction !== touchDirectionRef.current) {
            touchAccumulatorRef.current = 0;
        }
        touchDirectionRef.current = direction || touchDirectionRef.current;
        touchAccumulatorRef.current += deltaY;
        const steps = clampScrollSteps(Math.trunc(touchAccumulatorRef.current / PENDOLO_TOUCH_STEP_PX));
        if (steps !== 0) {
            touchAccumulatorRef.current = 0;
            moveManualScrollAnchor(steps);
        } else {
            scheduleManualScrollReset();
        }
    }, [lines.length, moveManualScrollAnchor, scheduleManualScrollReset]);

    const handleRailTouchEnd = useCallback(() => {
        touchLastYRef.current = null;
        touchDirectionRef.current = 0;
        touchAccumulatorRef.current = 0;
        scheduleManualScrollReset();
    }, [scheduleManualScrollReset]);

    useEffect(() => {
        const rail = wheelRailRef.current;
        if (!rail) return undefined;
        const wheelListener: EventListener = event => handleRailWheel(event as WheelEvent);
        const touchStartListener: EventListener = event => handleRailTouchStart(event as TouchEvent);
        const touchMoveListener: EventListener = event => handleRailTouchMove(event as TouchEvent);
        const touchEndListener: EventListener = () => handleRailTouchEnd();
        rail.addEventListener('wheel', wheelListener, PENDOLO_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchstart', touchStartListener, PENDOLO_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchmove', touchMoveListener, PENDOLO_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchend', touchEndListener, PENDOLO_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchcancel', touchEndListener, PENDOLO_SCROLL_EVENT_OPTIONS);
        return () => {
            rail.removeEventListener('wheel', wheelListener);
            rail.removeEventListener('touchstart', touchStartListener);
            rail.removeEventListener('touchmove', touchMoveListener);
            rail.removeEventListener('touchend', touchEndListener);
            rail.removeEventListener('touchcancel', touchEndListener);
        };
    }, [handleRailTouchEnd, handleRailTouchMove, handleRailTouchStart, handleRailWheel]);

    // Escapement spring motion for line transition tick
    const springSnappiness = pendoloTuning.tickSnappiness;
    const motionProfile = useMemo(
        () => resolvePendoloMotionProfile(theme.animationIntensity),
        [theme.animationIntensity],
    );
    const tickSpring = useSpring(targetLineIndex, {
        stiffness: 180 * springSnappiness * motionProfile.escapementSpringMultiplier,
        damping: (18 + 4 / Math.max(0.5, springSnappiness)) * motionProfile.escapementDampingMultiplier,
        mass: 0.8,
    });

    // Update target escapement spring when targetLineIndex updates
    useEffect(() => {
        tickSpring.set(targetLineIndex);
    }, [targetLineIndex, tickSpring]);

    // Font stack & weight setup
    const fontFamily = useMemo(() => resolveThemeFontStack(theme), [theme]);
    const fontWeight = useMemo(() => resolveThemeFontWeight(theme, 400), [theme]);

    const centerX = viewportSize.width * pendoloTuning.wheelCenterX;
    const centerY = viewportSize.height * pendoloTuning.wheelCenterY;
    const baseRadius = Math.min(viewportSize.width, viewportSize.height) * pendoloTuning.arcRadius;
    const lyricRadiusOffset = Math.min(viewportSize.width, viewportSize.height) * 0.06;
    const lyricRingRadius = baseRadius + lyricRadiusOffset;

    const maxItemX = centerX + baseRadius;
    const availableTextWidth = Math.max(
        140,
        Math.min(viewportSize.width * 0.46, viewportSize.width - maxItemX - 48),
    );

    // Escapement angular shift calculation
    const totalArcRad = (pendoloTuning.arcAngleDeg * Math.PI) / 180;
    const visibleWindowCount = 9;
    const angleStepRad = totalArcRad / Math.max(1, visibleWindowCount - 1);
    // Keep the ratchet interpolation out of React's render path. A line change is
    // discrete, but the spring emits many intermediate values while settling.
    const wheelRotationDeg = useTransform(
        tickSpring,
        value => -(value - targetLineIndex) * angleStepRad * (180 / Math.PI),
    );
    const textRotationCorrectionDeg = useTransform(wheelRotationDeg, value => -value * 0.65);
    const gearRotationAngleRad = useTransform(tickSpring, value => value * angleStepRad);

    const resolvedMode = useMemo(() => resolveSubtitleContentMode(subtitleContentMode, showSubtitleTranslation), [subtitleContentMode, showSubtitleTranslation]);

    const lineBlockHeights = useMemo(() => {
        const measureWidth = availableTextWidth / pendoloTuning.activeScale;
        return lines.map((line, index) => {
            if (Math.abs(index - targetLineIndex) > 10) {
                return 0;
            }
            // Always pre-allocate space for the focal state to prevent overlapping when scaled up
            const fontPx = Math.round(28 * lyricsFontScale);
            const mainHeight = buildPendoloTextLayout(
                line.fullText,
                `${fontWeight} ${fontPx}px ${fontFamily}`,
                measureWidth,
                Math.round(fontPx * 1.2),
            ).height;

            const translation = hideTranslationSubtitle ? null : resolveLyricAlternateText(line, resolvedMode);
            const hasReadableText = !!translation && /[\p{L}\p{N}]/u.test(translation);
            const translationPx = Math.round(16 * (subtitleFontScale ?? 1));

            const translationHeight = hasReadableText
                ? buildPendoloTextLayout(
                    translation,
                    `${resolveThemeFontWeight(subtitleTheme ?? theme, 500)} ${translationPx}px ${resolveThemeTranslationFontStack(subtitleTheme ?? theme)}`,
                    measureWidth,
                    Math.round(translationPx * 1.2),
                ).height + translationPx * 0.25 // Equivalent to marginTop: 0.25em
                : 0;

            return (mainHeight + translationHeight) * pendoloTuning.activeScale;
        });
    }, [availableTextWidth, fontFamily, fontWeight, hideTranslationSubtitle, lines, lyricsFontScale, pendoloTuning.activeScale, resolvedMode, subtitleFontScale, subtitleTheme, targetLineIndex, theme]);

    // Calculate line items for wheel
    const lineItems = useMemo(() => {
        return calculatePendoloWheelLayout(
            lines,
            targetLineIndex,
            0,
            viewportSize.width,
            viewportSize.height,
            pendoloTuning,
            lyricRadiusOffset,
            lineBlockHeights,
        );
    }, [lineBlockHeights, lines, targetLineIndex, viewportSize, pendoloTuning]);

    const primaryTextColor = theme.primaryColor || '#FFFFFF';
    const accentTextColor = theme.accentColor || '#3B82F6';
    const secondaryTextColor = theme.secondaryColor || '#9CA3AF';
    const BalanceIcon = useMemo<LucideIcon>(() => {
        const iconName = theme.lyricsIcons?.[0];
        return (iconName
            ? LucideIcons[iconName as keyof typeof LucideIcons]
            : undefined) as LucideIcon | undefined ?? Star;
    }, [theme.lyricsIcons]);
    const balanceGearX = centerX + baseRadius * 0.2;
    const balanceGearY = centerY - baseRadius * 0.75;

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <div ref={visualizerRef} className="relative w-full h-full overflow-hidden select-none pointer-events-none">
                {/* Wireframe Dynamic Clockwork Canvas (Gears, Escapement & Hairspring) */}
                <PendoloClockworkCanvas
                    centerX={centerX}
                    centerY={centerY}
                    baseRadius={baseRadius}
                    lyricRingRadius={lyricRingRadius}
                    escapementAngleMotionValue={gearRotationAngleRad}
                    audioBassMotionValue={audioBands.bass}
                    primaryTextColor={primaryTextColor}
                    accentTextColor={accentTextColor}
                    backgroundColor={theme.backgroundColor}
                    showGearDecor={pendoloTuning.showGearDecor}
                    showCenterGradient={pendoloTuning.showCenterGradient ?? true}
                    showCover={pendoloTuning.showCoverOnWatchFace ?? false}
                    coverUrl={props.coverUrl}
                    enableLineGlow={pendoloTuning.enableLineGlow ?? false}
                    paused={props.paused}
                    motionProfile={motionProfile}
                />
                {pendoloTuning.showGearDecor !== 'none' && (
                    <div
                        className="absolute pointer-events-none"
                        style={{
                            left: `${balanceGearX}px`,
                            top: `${balanceGearY}px`,
                            zIndex: 1,
                            transform: 'translate(-50%, -50%)',
                        }}
                    >
                        <BalanceIcon
                            size={Math.max(14, baseRadius * 0.13)}
                            strokeWidth={1.2}
                            absoluteStrokeWidth
                            color={colorWithAlpha(accentTextColor, 0.62)}
                        />
                    </div>
                )}

                {/* Lyric Wheel Arc Items */}
                {showText && (
                    <motion.div
                        ref={wheelRailRef}
                        className="absolute inset-0 w-full h-full pointer-events-auto"
                        style={{
                            zIndex: 2,
                            rotate: wheelRotationDeg,
                            transformOrigin: `${centerX}px ${centerY}px`,
                            WebkitTransform: 'translateZ(0)',
                        }}
                    >
                        {lineItems.map((item) => {
                            const isFocal = item.isActive;
                            const showChorusMarker = manualScrollAnchorIndex !== null && item.line.isChorus;
                            const chorusPresentation = resolvePendoloChorusPresentation(
                                item.line.isChorus,
                                isFocal && item.index === currentLineIndex,
                                motionProfile,
                            );
                            const maxTextWidth = availableTextWidth / item.scale;
                            const fontPx = Math.round((isFocal ? 28 : 22) * lyricsFontScale);
                            const translation = hideTranslationSubtitle ? null : resolveLyricAlternateText(item.line, resolvedMode);
                            const hasReadableText = !!translation && /[\p{L}\p{N}]/u.test(translation);
                            const translationPx = Math.round((isFocal ? 16 : 12) * (subtitleFontScale ?? 1));

                            return (
                                <PendoloRotatingLine
                                    key={item.line.id ?? `pendolo-line-${item.index}`}
                                    wheelRotationDeg={wheelRotationDeg}
                                    baseAngleDeg={item.angleDeg}
                                    baseOpacity={item.alpha}
                                    left={item.x}
                                    top={item.y}
                                    fontFamily={fontFamily}
                                    fontWeight={fontWeight}
                                    canSeek={Boolean(onLyricLineSeek)}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleLineSeek(item.index, item.line.startTime);
                                    }}
                                >
                                    <motion.div
                                        className="inline-block"
                                        style={{ rotate: textRotationCorrectionDeg, transformOrigin: 'left center', WebkitTransform: 'translateZ(0)' }}
                                    >
                                    <div
                                        className="relative inline-block"
                                        style={{
                                            transform: `rotate(${item.angleDeg * 0.35}deg) scale(${item.scale}) translateZ(0)`,
                                            transformOrigin: 'left center',
                                            isolation: 'isolate',
                                        }}
                                    >
                                    <motion.div
                                        initial={false}
                                        animate={{ scale: chorusPresentation.haloScale }}
                                        transition={{ duration: chorusPresentation.transitionDuration, ease: 'easeOut' }}
                                        style={{ transformOrigin: 'left center' }}
                                    >
                                        {chorusPresentation.isActive && (
                                            <motion.div
                                                aria-hidden
                                                className="absolute pointer-events-none -z-10 rounded-2xl"
                                                initial={{ opacity: 0, scale: 0.96 }}
                                                animate={{ opacity: chorusPresentation.haloOpacity, scale: 1 }}
                                                transition={{ duration: chorusPresentation.transitionDuration, ease: 'easeOut' }}
                                                style={{
                                                    inset: '-0.7em -1.1em',
                                                    background: `radial-gradient(circle at 42% 50%, ${colorWithAlpha(accentTextColor, 0.14 * chorusPresentation.haloOpacity)} 0%, ${colorWithAlpha(accentTextColor, 0.035 * chorusPresentation.haloOpacity)} 55%, transparent 82%)`,
                                                    filter: `blur(${Math.round(10 * motionProfile.chorusGlowMultiplier)}px)`,
                                                }}
                                            />
                                        )}
                                    <div style={{ transform: 'translateY(-50%)' }}>
                                            {showChorusMarker && (
                                                <span
                                                    aria-hidden
                                                    className="absolute pointer-events-none rounded-full"
                                                    style={{
                                                        width: '0.42em',
                                                        height: '0.42em',
                                                        left: '-0.95em',
                                                        top: '0.52em',
                                                        backgroundColor: accentTextColor,
                                                        boxShadow: `0 0 7px ${colorWithAlpha(accentTextColor, 0.58)}`,
                                                    }}
                                                />
                                            )}
                                            <div>
                                                {isFocal ? (
                                                    <PendoloActiveLyricSweep
                                                        line={item.line}
                                                        currentTime={currentTime}
                                                        fontFamily={fontFamily}
                                                        fontWeight={fontWeight}
                                                        maxWidth={maxTextWidth}
                                                        primaryTextColor={primaryTextColor}
                                                        accentTextColor={accentTextColor}
                                                        fontPx={fontPx}
                                                        wordColors={theme.wordColors}
                                                        isChorus={chorusPresentation.isActive}
                                                        accentMix={chorusPresentation.accentMix}
                                                        chorusGlowMultiplier={chorusPresentation.glowMultiplier}
                                                    />
                                                ) : (
                                                    <div
                                                        className="transition-all duration-200 whitespace-pre-wrap"
                                                        style={{
                                                            fontSize: `${fontPx}px`,
                                                            maxWidth: `${maxTextWidth}px`,
                                                            color: colorWithAlpha(primaryTextColor, 0.75),
                                                            letterSpacing: '0.01em',
                                                            whiteSpace: 'pre-wrap',
                                                            overflowWrap: 'anywhere',
                                                            wordBreak: 'break-word',
                                                        }}
                                                    >
                                                        {item.line.fullText}
                                                    </div>
                                                )}
                                            </div>
                                            {/* Secondary Translation / Romanization Line */}
                                            {hasReadableText && (
                                                <div
                                                    className="whitespace-pre-wrap transition-opacity duration-200"
                                                    style={{
                                                        fontFamily: resolveThemeTranslationFontStack(subtitleTheme ?? theme),
                                                        fontWeight: resolveThemeFontWeight(subtitleTheme ?? theme, 500),
                                                        fontSize: `${translationPx}px`,
                                                        maxWidth: `${maxTextWidth}px`,
                                                        color: isFocal ? secondaryTextColor : colorWithAlpha(secondaryTextColor, 0.6),
                                                        letterSpacing: '0.01em',
                                                        whiteSpace: 'pre-wrap',
                                                        overflowWrap: 'anywhere',
                                                        wordBreak: 'break-word',
                                                        marginTop: '0.25em',
                                                    }}
                                                >
                                                    {translation}
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                    </div>
                                    </motion.div>
                                </PendoloRotatingLine>
                            );
                        })}
                    </motion.div>
                )}
            </div>
        </VisualizerShell>
    );
};

export default React.memo(VisualizerPendolo);
