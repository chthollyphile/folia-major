import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { Star, type LucideIcon } from 'lucide-react';
import { DEFAULT_PENDOLO_TUNING } from '../../../types';
import { resolveLyricAntialias } from '../../../utils/lyricRenderQuality';
import { useLyricRenderQuality } from '../renderQuality/useLyricRenderQuality';
import { colorWithAlpha } from '../colorMix';
import { useLucideIcons } from '../../../hooks/useLucideIcons';
import { resolveLucideIcon } from '../../../services/lucideIconResolver';
import { type VisualizerSharedProps } from '../definition';
import VisualizerShell from '../VisualizerShell';
import PendoloClockworkCanvas from './PendoloClockworkCanvas';
import { resolveThemeFontStack, resolveThemeFontWeight, resolveThemeTranslationFontStack } from '../../../utils/fontStacks';
import { resolveSubtitleContentMode } from '../../../utils/lyrics/alternateText';
import { calculatePendoloWheelLayout, resolvePendoloWheelCenterX } from './pendoloGeometry';
import { buildPendoloDialProjection, buildPendoloHubViewProjection, buildPendoloLayerProjection, buildPendoloTiltProjection, resolvePendoloPlaneCssTransform, resolvePendoloSpaceCssTransform } from './pendoloDialProjection';
import { PENDOLO_BALANCE_ICON_HEIGHT, PENDOLO_LYRIC_LAYER_HEIGHT } from './pendoloParallax';
import PendoloActiveLyricSweep from './PendoloActiveLyricSweep';
import { buildPendoloTextLayout } from './pendoloTextLayout';
import { buildPendoloSubtitleFontSpec, resolvePendoloSubtitleTracks, sumPendoloSubtitleTrackHeights } from './pendoloSubtitleTracks';
import { resolvePendoloChorusPresentation, resolvePendoloMotionProfile } from './pendoloMotionProfile';
import { resolvePendoloPointWave } from './pendoloBeatFx';
import { resolvePendoloFallbackAnchorIndex } from './pendoloTimeline';
import PendoloRotatingLine, { type PendoloStandUp } from './PendoloRotatingLine';
import { resolvePendoloWaveReach, usePendoloBeatFx } from './usePendoloBeatFx';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { smartBeatActive } from '../../../services/beatFx/beatEffects';

const PENDOLO_SCROLL_IDLE_RESET_MS = 2500;
/** Peak alpha of the beat halo's front, at full strength (additive). */
const PENDOLO_HALO_ALPHA = 0.45;
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
/**
 * 轮心视角下非焦点句的不透明度倍数：立起来以后离焦点句越近越容易和它叠在一起，所以越近越淡。
 * 紧挨着的前后句最淡（0.18），往外每一句加一档，到第 4 句回到原来的不透明度。
 */
const PENDOLO_STAND_SIDE_LINE_ALPHA_MIN = 0.18;
const PENDOLO_STAND_SIDE_LINE_FULL_DISTANCE = 4;
const resolvePendoloStandSideLineAlpha = (distance: number) => Math.min(
    1,
    // 间奏时没有焦点句，最近的两句离刻度针只有半档：按紧挨着的一句算，不再往下压
    PENDOLO_STAND_SIDE_LINE_ALPHA_MIN
        + ((1 - PENDOLO_STAND_SIDE_LINE_ALPHA_MIN) * (Math.max(1, distance) - 1)) / (PENDOLO_STAND_SIDE_LINE_FULL_DISTANCE - 1),
);

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
        isPreviewMode = false,
    } = props;

    // 分辨率与抗锯齿（#929）：齿轮画布原来按 devicePixelRatio、WebGL 开 MSAA；预览的小图保持原样
    const renderQuality = useLyricRenderQuality(pendoloTuning.render);
    const clockworkRenderScale = isPreviewMode ? 1 : renderQuality.scale;
    const clockworkAntialias = isPreviewMode ? true : resolveLyricAntialias(renderQuality.antialias, true);

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

    // 歌词左右镜像（#1124）：表盘在右、弧线朝左；关着时 sideSign 是 1，一切和原来一样
    const mirrored = pendoloTuning.mirrorLayout === true;
    const sideSign = mirrored ? -1 : 1;
    const centerX = resolvePendoloWheelCenterX(viewportSize.width, pendoloTuning);
    const centerY = viewportSize.height * pendoloTuning.wheelCenterY;
    const baseRadius = Math.min(viewportSize.width, viewportSize.height) * pendoloTuning.arcRadius;
    const lyricRadiusOffset = Math.min(viewportSize.width, viewportSize.height) * 0.06;
    const lyricRingRadius = baseRadius + lyricRadiusOffset;

    const maxItemX = centerX + baseRadius;
    const availableTextWidth = Math.max(
        140,
        Math.min(viewportSize.width * 0.46, mirrored ? centerX - baseRadius - 48 : viewportSize.width - maxItemX - 48),
    );
    // 表盘倾斜：歌词和摆轮图标放在一层里整体按倾斜投影（它们已经按镜像排过），表盘画布还要先镜像
    // Canvas2D 回退画不了透视，歌词层却是 matrix3d 透视加视差，两边会对不上：回退时整体不倾斜
    const [clockworkWebgl, setClockworkWebgl] = useState(true);
    const requestedTiltDeg = pendoloTuning.tiltDeg ?? 0;
    const tiltDeg = clockworkWebgl ? requestedTiltDeg : 0;
    const tiltAxisDeg = pendoloTuning.tiltAxisDeg ?? 0;
    // 轮心视角：相机在轮心后上方，顺着刻度针看向焦点句；代替倾斜，同样只在 WebGL 下生效
    const requestedHubView = pendoloTuning.hubView === true;
    const hubView = clockworkWebgl && requestedHubView;
    // 相机至少要比最高的一层（摆轮图标）高一截，不然那几层会跑到相机上面、从底下被看到
    const hubCameraHeightPx = baseRadius * Math.max(
        pendoloTuning.hubViewHeight ?? DEFAULT_PENDOLO_TUNING.hubViewHeight ?? 1.4,
        PENDOLO_BALANCE_ICON_HEIGHT * (pendoloTuning.parallaxDepth ?? 1) + 0.15,
    );
    // 相机从轮心沿刻度针反方向后退这么远，越过轮心看向焦点句，整套齿轮在近处
    const hubCameraBackPx = baseRadius * (pendoloTuning.hubViewBack ?? 1.2);
    const tiltProjection = useMemo(
        () => (hubView
            ? buildPendoloHubViewProjection(
                hubCameraHeightPx,
                hubCameraBackPx,
                lyricRingRadius,
                sideSign,
                centerX,
                centerY,
                viewportSize.width,
                viewportSize.height,
            )
            : buildPendoloTiltProjection(tiltDeg, tiltAxisDeg, viewportSize.width, viewportSize.height)),
        [centerX, centerY, hubCameraBackPx, hubCameraHeightPx, hubView, lyricRingRadius, sideSign, tiltAxisDeg, tiltDeg, viewportSize.height, viewportSize.width],
    );
    const dialProjection = useMemo(
        () => buildPendoloDialProjection(tiltProjection, mirrored),
        [mirrored, tiltProjection],
    );

    // Escapement angular shift calculation
    const totalArcRad = (pendoloTuning.arcAngleDeg * Math.PI) / 180;
    const visibleWindowCount = 9;
    const angleStepRad = totalArcRad / Math.max(1, visibleWindowCount - 1);
    // 智能动感模式 (usePendoloBeatFx): the shockwave on the lyric lines and the shake. Off, every
    // MotionValue it returns stays 0. The wheel itself keeps to the lyrics; beats move the lower gears.
    const smartBeatEnabled = useVisualizerSettingsStore(state => smartBeatActive(state.smartBeat));
    const beatFx = usePendoloBeatFx(
        smartBeatEnabled,
        {
            centerX,
            centerY,
            baseRadius,
            lyricRingRadius,
            viewportWidth: viewportSize.width,
            viewportHeight: viewportSize.height,
        },
        theme.accentColor || '#3B82F6',
    );

    // Keep the ratchet interpolation out of React's render path. A line change is
    // discrete, but the spring emits many intermediate values while settling.
    const wheelRotationDeg = useTransform(
        tickSpring,
        value => -(value - targetLineIndex) * angleStepRad * (180 / Math.PI),
    );
    // 镜像时轨道反着转，弧线在屏幕上才和原版对称地走
    const railRotationDeg = useTransform(wheelRotationDeg, value => value * sideSign);
    const textRotationCorrectionDeg = useTransform(railRotationDeg, value => -value * 0.65);
    // 轮心视角下句子立起来：抵掉轨道的转角，字的横向朝相机的右手（布局里是 (0, sideSign)）
    const standUpRotationDeg = useTransform(railRotationDeg, value => sideSign * 90 - value);
    const gearRotationAngleRad = useTransform(tickSpring, value => value * angleStepRad);

    // Pendolo lays subtitles out inside its own clockwork layout, not the shared bottom subtitle. 'both' stacks
    // romanization above translation under each lyric; the rows come from resolvePendoloSubtitleTracks, which both
    // the height pre-measurement below and the rendering read, so the reserved space always matches the drawn rows.
    const resolvedMode = useMemo(() => resolveSubtitleContentMode(subtitleContentMode, showSubtitleTranslation), [subtitleContentMode, showSubtitleTranslation]);
    const subtitleFontFamily = useMemo(() => resolveThemeTranslationFontStack(subtitleTheme ?? theme), [subtitleTheme, theme]);

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

            // Focal-state rows, same as the main lyric above: reserve the largest size the line will take.
            const subtitleTracks = resolvePendoloSubtitleTracks(line, {
                mode: resolvedMode,
                hidden: hideTranslationSubtitle,
                focal: true,
                subtitleFontScale: subtitleFontScale ?? 1,
            });
            const translationHeight = sumPendoloSubtitleTrackHeights(subtitleTracks, track => buildPendoloTextLayout(
                track.text,
                buildPendoloSubtitleFontSpec(track, resolveThemeFontWeight(subtitleTheme ?? theme, track.fontWeightFallback), subtitleFontFamily),
                measureWidth,
                track.lineHeightPx,
            ).height);

            return (mainHeight + translationHeight) * pendoloTuning.activeScale;
        });
    }, [availableTextWidth, fontFamily, fontWeight, hideTranslationSubtitle, lines, lyricsFontScale, pendoloTuning.activeScale, resolvedMode, subtitleFontFamily, subtitleFontScale, subtitleTheme, targetLineIndex, theme]);

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
    // Star stands in while the theme icon loads, and for names lucide does not have.
    const balanceIconName = theme.lyricsIcons?.[0];
    const lucideIconRevision = useLucideIcons(balanceIconName ? [balanceIconName] : undefined);
    const BalanceIcon = useMemo<LucideIcon>(
        () => resolveLucideIcon(balanceIconName) ?? Star,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [balanceIconName, lucideIconRevision],
    );
    // 智能动感模式's beat halo: a filled soft glow (no ring) out of the hub, grown by
    // usePendoloBeatFx with the shockwave to the far corner and faded with it.
    const haloReach = resolvePendoloWaveReach({
        centerX,
        centerY,
        baseRadius,
        lyricRingRadius: 0,
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
    });
    const haloBackground = useMemo(() => {
        const [r, g, b] = beatFx.color;
        const at = (alpha: number) => `rgba(${r},${g},${b},${alpha})`;
        // Only a soft band at its front, clear behind it: the screen it has passed is clean again at
        // once (a lit interior read as a muddy wash trailing the wave). No edge line: 0 at the rim.
        return `radial-gradient(circle closest-side, ${at(0)} 0%, ${at(0)} 45%, ${at(PENDOLO_HALO_ALPHA * 0.15)} 65%, `
            + `${at(PENDOLO_HALO_ALPHA)} 88%, ${at(0)} 100%)`;
    }, [beatFx.color]);
    // 镜像时摆轮翻到轮心另一侧；倾斜由外面的表盘平面层统一投影
    const balanceGearX = centerX + sideSign * baseRadius * 0.2;
    const balanceGearY = centerY - baseRadius * 0.75;
    // 倾斜时歌词和摆轮图标所在的那一层：和表盘画布同一个矩阵，字也躺在表盘平面上。
    // 不倾斜时这层没有 transform / zIndex，不成层叠上下文，画面和原来一样。
    // 冲击环是 plus-lighter 叠加，不能再包一层（那层会把它隔离、叠加失效），所以把同一个矩阵直接
    // 放在它自己的 transform 最前面；它的盒子以轮心为中心，默认的变换原点就是轮心。
    const planeCssTransform = tiltProjection.flat ? null : resolvePendoloPlaneCssTransform(tiltProjection);
    const haloTransformTemplate = useCallback(
        (_: unknown, generated: string) => `${planeCssTransform} ${generated === 'none' ? '' : generated}`,
        [planeCssTransform],
    );
    // 分层视差：摆轮图标和歌词各自浮在表盘平面上方一段高度，按各自那一层的投影画；
    // 只在倾斜时有高度（parallaxScalePx 为 0 时两层都是表盘平面本身）。
    const parallaxScalePx = tiltProjection.flat ? 0 : (pendoloTuning.parallaxDepth ?? 1) * baseRadius;
    const resolveLayerStyle = (heightRatio: number, zIndex: number, standUp = false): React.CSSProperties | undefined => {
        if (tiltProjection.flat) return undefined;
        const layer = buildPendoloLayerProjection(tiltProjection, heightRatio * parallaxScalePx);
        return {
            transform: standUp ? resolvePendoloSpaceCssTransform(layer) : resolvePendoloPlaneCssTransform(layer),
            transformOrigin: `${centerX}px ${centerY}px`,
            transformStyle: standUp ? 'preserve-3d' : undefined,
            zIndex,
        };
    };
    const iconLayerStyle = resolveLayerStyle(PENDOLO_BALANCE_ICON_HEIGHT, 1);
    // 轮心视角下歌词立起来：图层带上高度方向（z），轨道层也保留 3D，句子各自绕底边转起来
    const standLyrics = hubView;
    // 字面正对相机：上方取相机的上方 (s·H, 0, D')，绕底边转 -atan2(D', H)；相机越高、字越往后仰
    const standUpTiltDeg = (-Math.atan2(lyricRingRadius + hubCameraBackPx, hubCameraHeightPx) * 180) / Math.PI;
    const lyricStandUp = useMemo<PendoloStandUp | undefined>(
        () => (standLyrics ? { rotationDeg: standUpRotationDeg, tiltDeg: standUpTiltDeg } : undefined),
        [standLyrics, standUpRotationDeg, standUpTiltDeg],
    );
    const lyricLayerStyle = resolveLayerStyle(PENDOLO_LYRIC_LAYER_HEIGHT, 2, standLyrics);
    // The balance's icon is DOM over the canvas: it moves with the shockwave lens as the balance
    // wheel under it does in the shader (0 while off, so it stays exactly where it was).
    // 立起来时句子以中点对着刻度针，放大也从中点放，不然放大的那部分全堆到一侧
    const textOrigin = standLyrics ? 'center center' : mirrored ? 'right center' : 'left center';
    const balanceLensInputs = [beatFx.waveRadius, beatFx.waveBand, beatFx.waveStrength, beatFx.waveX, beatFx.waveY];
    const balanceIconX = useTransform(balanceLensInputs, ([radius, band, strength, x, y]: number[]) => (
        resolvePendoloPointWave(balanceGearX - centerX - x, balanceGearY - centerY - y, radius, band, strength).x
    ));
    const balanceIconY = useTransform(balanceLensInputs, ([radius, band, strength, x, y]: number[]) => (
        resolvePendoloPointWave(balanceGearX - centerX - x, balanceGearY - centerY - y, radius, band, strength).y
    ));

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <div ref={visualizerRef} className="relative w-full h-full overflow-hidden select-none pointer-events-none">
                {/* The halo sits under the clockwork and the lyrics, outside the shake: the shake's
                    transform would make a stacking context and change what the additive blend lights.
                    will-change keeps its gradient rastered once, the compositor scaling it: without it
                    every hit's scale re-rasters a layer that reaches past the far corner (7567 px square
                    at 2x), ~10-20 points of GPU-process CPU and ~300-500 MB more while 仿真鼓面 plays;
                    the pixels move by at most 2/255 of gradient rounding (2026-10-18). */}
                {smartBeatEnabled && (
                    <motion.div
                        aria-hidden
                        className="absolute pointer-events-none"
                        transformTemplate={planeCssTransform ? haloTransformTemplate : undefined}
                        style={{
                            left: centerX - haloReach,
                            top: centerY - haloReach,
                            width: haloReach * 2,
                            height: haloReach * 2,
                            zIndex: 0,
                            background: haloBackground,
                            mixBlendMode: 'plus-lighter',
                            willChange: 'transform',
                            x: beatFx.haloX,
                            y: beatFx.haloY,
                            scale: beatFx.haloScale,
                            opacity: beatFx.haloOpacity,
                        }}
                    />
                )}
                {/* 智能动感模式's shake moves the clockwork and the lyrics together; 0 while off. */}
                <motion.div
                    className="absolute inset-0 pointer-events-none"
                    style={{ x: beatFx.shakeX, y: beatFx.shakeY, scale: beatFx.breath, transformOrigin: `${centerX}px ${centerY}px` }}
                >
                {/* Wireframe Dynamic Clockwork Canvas (Gears, Escapement & Hairspring) */}
                <PendoloClockworkCanvas
                    centerX={centerX}
                    centerY={centerY}
                    viewportWidth={viewportSize.width}
                    viewportHeight={viewportSize.height}
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
                    beatFxRef={beatFx.shared}
                    renderScale={clockworkRenderScale}
                    antialias={clockworkAntialias}
                    mirrored={mirrored}
                    projection={dialProjection}
                    parallaxScalePx={parallaxScalePx}
                    depthStencil={(requestedTiltDeg !== 0 || requestedHubView) && (pendoloTuning.parallaxDepth ?? 1) > 0}
                    onBackendChange={setClockworkWebgl}
                />
                <div className="absolute inset-0 pointer-events-none" style={iconLayerStyle}>
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
                        <motion.div style={{ x: balanceIconX, y: balanceIconY }}>
                            <BalanceIcon
                                size={Math.max(14, baseRadius * 0.13)}
                                strokeWidth={1.2}
                                absoluteStrokeWidth
                                color={colorWithAlpha(accentTextColor, 0.62)}
                            />
                        </motion.div>
                    </div>
                )}
                </div>

                <div className="absolute inset-0 pointer-events-none" style={lyricLayerStyle}>
                {/* Lyric Wheel Arc Items */}
                {showText && (
                    <motion.div
                        ref={wheelRailRef}
                        className="absolute inset-0 w-full h-full pointer-events-auto"
                        style={{
                            zIndex: 2,
                            rotate: railRotationDeg,
                            transformOrigin: `${centerX}px ${centerY}px`,
                            WebkitTransform: 'translateZ(0)',
                            transformStyle: standLyrics ? 'preserve-3d' : undefined,
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
                            const subtitleTracks = resolvePendoloSubtitleTracks(item.line, {
                                mode: resolvedMode,
                                hidden: hideTranslationSubtitle,
                                focal: isFocal,
                                subtitleFontScale: subtitleFontScale ?? 1,
                            });

                            return (
                                <PendoloRotatingLine
                                    key={item.line.id ?? `pendolo-line-${item.index}`}
                                    wheelRotationDeg={railRotationDeg}
                                    mirrored={mirrored}
                                    railWidth={viewportSize.width}
                                    baseAngleDeg={item.angleDeg}
                                    // 轮心视角下突出焦点句：离它越近的句子越淡
                                    baseOpacity={standLyrics && !isFocal
                                        ? item.alpha * resolvePendoloStandSideLineAlpha(item.distanceFromActive)
                                        : item.alpha}
                                    left={item.x}
                                    top={item.y}
                                    hubX={centerX}
                                    hubY={centerY}
                                    waveRadius={beatFx.waveRadius}
                                    waveBand={beatFx.waveBand}
                                    waveStrength={beatFx.waveStrength}
                                    waveX={beatFx.waveX}
                                    waveY={beatFx.waveY}
                                    standUp={lyricStandUp}
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
                                        style={{
                                            rotate: standLyrics ? 0 : textRotationCorrectionDeg,
                                            // 立起来时句子的中点对准锚点（刻度针的方向），不再从锚点往一侧排开
                                            x: standLyrics ? (mirrored ? '50%' : '-50%') : 0,
                                            transformOrigin: textOrigin,
                                            WebkitTransform: 'translateZ(0)',
                                        }}
                                    >
                                    <div
                                        className="relative inline-block"
                                        style={{
                                            transform: `rotate(${standLyrics ? 0 : sideSign * item.angleDeg * 0.35}deg) scale(${item.scale}) translateZ(0)`,
                                            transformOrigin: textOrigin,
                                            textAlign: standLyrics ? 'center' : mirrored ? 'right' : undefined,
                                            isolation: 'isolate',
                                        }}
                                    >
                                    <motion.div
                                        initial={false}
                                        animate={{ scale: chorusPresentation.haloScale }}
                                        transition={{ duration: chorusPresentation.transitionDuration, ease: 'easeOut' }}
                                        style={{ transformOrigin: textOrigin }}
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
                                                    background: `radial-gradient(circle at ${mirrored ? 58 : 42}% 50%, ${colorWithAlpha(accentTextColor, 0.14 * chorusPresentation.haloOpacity)} 0%, ${colorWithAlpha(accentTextColor, 0.035 * chorusPresentation.haloOpacity)} 55%, transparent 82%)`,
                                                    filter: `blur(${Math.round(10 * motionProfile.chorusGlowMultiplier)}px)`,
                                                }}
                                            />
                                        )}
                                    <div style={{ transform: standLyrics ? 'translateY(-100%)' : 'translateY(-50%)' }}>
                                            {showChorusMarker && (
                                                <span
                                                    aria-hidden
                                                    className="absolute pointer-events-none rounded-full"
                                                    style={{
                                                        width: '0.42em',
                                                        height: '0.42em',
                                                        ...(mirrored ? { right: '-0.95em' } : { left: '-0.95em' }),
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
                                                        alignRight={mirrored}
                                                        alignCenter={standLyrics}
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
                                            {/* Secondary Romanization / Translation Lines (second row steps down in size and opacity) */}
                                            {subtitleTracks.map(track => (
                                                <div
                                                    key={track.role}
                                                    data-pendolo-subtitle-track={track.role}
                                                    className="whitespace-pre-wrap transition-opacity duration-200"
                                                    style={{
                                                        fontFamily: subtitleFontFamily,
                                                        fontWeight: resolveThemeFontWeight(subtitleTheme ?? theme, track.fontWeightFallback),
                                                        fontSize: `${track.fontPx}px`,
                                                        maxWidth: `${maxTextWidth}px`,
                                                        color: isFocal ? secondaryTextColor : colorWithAlpha(secondaryTextColor, 0.6),
                                                        opacity: track.opacityFactor === 1 ? undefined : track.opacityFactor,
                                                        letterSpacing: '0.01em',
                                                        whiteSpace: 'pre-wrap',
                                                        overflowWrap: 'anywhere',
                                                        wordBreak: 'break-word',
                                                        marginTop: `${track.gapEm}em`,
                                                    }}
                                                >
                                                    {track.text}
                                                </div>
                                            ))}
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
                </motion.div>
            </div>
        </VisualizerShell>
    );
};

export default React.memo(VisualizerPendolo);
