import React, { useEffect, useMemo, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import type { LyricRenderScale } from '../../../types';
import { resolveLyricPixelRatio } from '../../../utils/lyricRenderQuality';
import { colorWithAlpha } from '../colorMix';
import { drawPendoloClockwork2d } from './pendoloClockworkDraw2d';
import {
    createPendoloBeatCounter,
    isPendoloBeatFxIdle,
    readPendoloBeatTriggers,
} from './pendoloBeatFx';
import { getBeatEffectStrength } from '../../../services/beatFx/beatFxLive';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';
import {
    drawPendoloBeatFxOverlay2d,
    drawPendoloWaveLens2d,
    type PendoloBeatFxDrawFrame,
} from './pendoloBeatFxDraw';
import {
    createPendoloClockworkMotionState,
    stepPendoloClockworkMotion,
    type PendoloClockworkBeatInput,
} from './pendoloClockworkMotion';
import type { PendoloMotionProfile } from './pendoloMotionProfile';
import {
    resolvePendoloClockworkBox,
    type PendoloClockworkFrameInput,
    type PendoloGearDecorMode,
} from './pendoloClockworkScene';
import { PendoloClockworkRenderer } from './pendoloClockworkWebGL';
import type { PendoloDialProjection } from './pendoloDialProjection';
import type { PendoloBeatFxShared } from './usePendoloBeatFx';

// src/components/visualizer/pendolo/PendoloClockworkCanvas.tsx

export interface PendoloClockworkCanvasProps {
    centerX: number;
    centerY: number;
    viewportWidth: number;
    viewportHeight: number;
    baseRadius: number;
    lyricRingRadius: number;
    escapementAngleMotionValue: MotionValue<number>;
    audioBassMotionValue?: MotionValue<number>;
    audioBass?: number;
    primaryTextColor: string;
    accentTextColor: string;
    backgroundColor?: string;
    showGearDecor: PendoloGearDecorMode;
    showCenterGradient?: boolean;
    showCover?: boolean;
    coverUrl?: string | null;
    enableLineGlow?: boolean;
    paused?: boolean;
    motionProfile: PendoloMotionProfile;
    /** 智能动感模式's beat effects (usePendoloBeatFx); nothing is drawn or stepped while inactive. */
    beatFxRef?: React.MutableRefObject<PendoloBeatFxShared>;
    /** 分辨率倍数（#929）：乘在 devicePixelRatio 上，WebGL 和 Canvas2D 两条路都按它；默认 1 是原样。 */
    renderScale?: LyricRenderScale;
    /** WebGL 上下文开不开 MSAA（#929，默认开）；变了换一块画布重建上下文。 */
    antialias?: boolean;
    /** 歌词左右镜像（#1124）：表盘整体左右翻转，封面不翻。 */
    mirrored?: boolean;
    /** 表盘平面到屏幕的投影（含镜像与倾斜）；单位阵且不镜像时按原样画。 */
    projection?: PendoloDialProjection;
    /** 分层视差：各层高度（轮盘半径的比例）乘上它是 CSS px；不倾斜时传 0。 */
    parallaxScalePx?: number;
    /**
     * WebGL 上下文要不要深度、模板缓冲（分层视差的遮挡用）；按设置里请求的倾斜和视差给，
     * 不按实际后端，免得后端一变画布换 key、又变回来来回重建。变了换一块画布。
     */
    depthStencil?: boolean;
    /** 实际用哪个后端画（true = WebGL）变了时告诉上层；Canvas2D 画不了透视，上层据此关掉倾斜。 */
    onBackendChange?: (webgl: boolean) => void;
}

/**
 * PendoloClockworkCanvas: Renders dynamic wireframe clockwork gear train background.
 * PendoloClockworkCanvas: Wireframe clockwork gear train.
 * Prefers WebGL2; falls back to Canvas2D when unavailable.
 */
const PendoloClockworkCanvas: React.FC<PendoloClockworkCanvasProps> = ({
    centerX,
    centerY,
    viewportWidth,
    viewportHeight,
    baseRadius,
    lyricRingRadius,
    escapementAngleMotionValue,
    audioBassMotionValue,
    audioBass = 0.18,
    primaryTextColor,
    accentTextColor,
    backgroundColor = '#000000',
    showGearDecor,
    showCenterGradient = true,
    showCover = false,
    coverUrl = null,
    enableLineGlow = false,
    paused = false,
    motionProfile,
    beatFxRef,
    renderScale = 1,
    antialias = true,
    mirrored = false,
    projection,
    parallaxScalePx = 0,
    depthStencil = false,
    onBackendChange,
}) => {
    const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const canvas2dRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<PendoloClockworkRenderer | null>(null);
    const useWebglRef = useRef(false);
    // 上一帧实际用的后端，变了才通知上层
    const lastBackendRef = useRef<boolean | null>(null);
    const onBackendChangeRef = useRef(onBackendChange);
    onBackendChangeRef.current = onBackendChange;
    const motionStateRef = useRef(createPendoloClockworkMotionState());
    const lastTimestampRef = useRef<number | null>(null);
    const coverImageRef = useRef<HTMLImageElement | null>(null);
    // 封面图源不带 CORS 时 WebGL 传不了，这一张要走 Canvas2D。不带 CORS 的重试加载成功就记下，不等上传报错；
    // 按图源记住，下一首同一图源的封面一换上就走 2D，后端不会每首歌先 WebGL 再 2D 来回切
    const coverNeeds2dRef = useRef(false);
    const noCorsCoverOriginsRef = useRef(new Set<string>());
    // Beats for the gear train come from the clock through a counter of the canvas's own, so the
    // seconds gear and the balance step on the frame they fire, independent of the FX loop.
    const beatCounterRef = useRef(createPendoloBeatCounter());
    const beatTriggersRef = useRef(readPendoloBeatTriggers(createPendoloBeatCounter()));
    const beatInputRef = useRef<PendoloClockworkBeatInput>({ beats: 0, downbeats: 0, beatGain: 0, downbeatGain: 0 });
    const beatFxFrameRef = useRef<PendoloBeatFxDrawFrame | null>(null);
    const waveScratchRef = useRef<HTMLCanvasElement | null>(null);

    // The canvases cover only the clockwork, not the viewport; everything is drawn relative to
    // the box, so the frame's centre is shifted by its offset.
    const contentBox = useMemo(
        () => resolvePendoloClockworkBox(
            centerX,
            centerY,
            baseRadius,
            lyricRingRadius,
            viewportWidth,
            viewportHeight,
            showCenterGradient,
            mirrored,
            Boolean(projection && !projection.flat),
        ),
        [baseRadius, centerX, centerY, lyricRingRadius, mirrored, projection, showCenterGradient, viewportHeight, viewportWidth],
    );
    // 只在镜像或倾斜时把矩阵交给渲染器；都关着时是 null，画法和原来一样
    const projectionMatrix = mirrored || (projection && !projection.flat) ? projection?.matrix ?? null : null;

    const propsRef = useRef({
        contentBox,
        centerX,
        centerY,
        baseRadius,
        lyricRingRadius,
        audioBass,
        primaryTextColor,
        accentTextColor,
        backgroundColor,
        showGearDecor,
        showCenterGradient,
        showCover,
        coverUrl,
        enableLineGlow,
        paused,
        motionProfile,
        renderScale,
        projectionMatrix,
        projectionPerspective: Boolean(projection && !projection.flat),
        mirrored,
        parallaxScalePx: projection && !projection.flat ? parallaxScalePx : 0,
        parallaxLift: projection?.lift,
        parallaxInvFocal: projection?.invFocal,
    });

    useEffect(() => {
        propsRef.current = {
            contentBox,
            centerX,
            centerY,
            baseRadius,
            lyricRingRadius,
            audioBass,
            primaryTextColor,
            accentTextColor,
            backgroundColor,
            showGearDecor,
            showCenterGradient,
            showCover,
            coverUrl,
            enableLineGlow,
            paused,
            motionProfile,
            renderScale,
            projectionMatrix,
            projectionPerspective: Boolean(projection && !projection.flat),
            mirrored,
            parallaxScalePx: projection && !projection.flat ? parallaxScalePx : 0,
            parallaxLift: projection?.lift,
            parallaxInvFocal: projection?.invFocal,
        };
    }, [
        projectionMatrix, projection, mirrored, parallaxScalePx,
        contentBox, centerX, centerY, baseRadius, lyricRingRadius, audioBass,
        primaryTextColor, accentTextColor, backgroundColor, showGearDecor,
        showCenterGradient, showCover, coverUrl, enableLineGlow, paused, motionProfile, renderScale,
    ]);

    useEffect(() => {
        // 三层都关时画布不画也不跑循环，不会再上报后端；按 WebGL 报一次，上层不会一直卡在 2D 关着倾斜
        if (showGearDecor !== 'none' || showCenterGradient || showCover) return;
        lastBackendRef.current = null;
        onBackendChangeRef.current?.(true);
    }, [showGearDecor, showCenterGradient, showCover]);

    useEffect(() => {
        // The previous song's cover must not stay on screen (or be uploaded under the new song)
        // while the new one loads.
        coverImageRef.current = null;
        coverNeeds2dRef.current = false;
        if (!showCover || !coverUrl) return undefined;
        let origin = '';
        try {
            origin = new URL(coverUrl, window.location.href).origin;
        } catch {
            origin = '';
        }
        coverNeeds2dRef.current = noCorsCoverOriginsRef.current.has(origin);
        let cancelled = false;
        let img: HTMLImageElement | null = null;
        // CORS first, like the other cover consumers: WebGL cannot upload a tainted image. A
        // host without CORS headers still gets a plain load, which the Canvas2D path can draw.
        const load = (crossOrigin: boolean) => {
            const next = new Image();
            if (crossOrigin) next.crossOrigin = 'anonymous';
            next.onload = () => {
                if (cancelled) return;
                coverImageRef.current = next;
                // 不带 CORS 才加载得到的，才算这个图源没有 CORS；带 CORS 加载成功就把记录删掉
                coverNeeds2dRef.current = !crossOrigin;
                if (crossOrigin) noCorsCoverOriginsRef.current.delete(origin);
                else noCorsCoverOriginsRef.current.add(origin);
            };
            next.onerror = () => {
                if (cancelled) return;
                if (crossOrigin) {
                    load(false);
                } else {
                    // 两次都没加载到（404、离线）：没有封面可画，照常走 WebGL，也不记这个图源
                    coverImageRef.current = null;
                    coverNeeds2dRef.current = false;
                }
            };
            next.src = coverUrl;
            img = next;
        };
        load(true);
        return () => {
            cancelled = true;
            if (img) {
                img.onload = null;
                img.onerror = null;
            }
        };
    }, [coverUrl, showCover]);

    useEffect(() => {
        const webglCanvas = webglCanvasRef.current;
        // A renderer belongs to one canvas. Turning every layer off unmounts the canvases, and
        // turning one back on mounts new ones, so a renderer for any other canvas is dropped.
        // 抗锯齿变了时 WebGL 画布换了 key，也走这里：旧画布已经离开文档，release 把它的上下文还给浏览器。
        if (rendererRef.current && rendererRef.current.canvas !== webglCanvas) {
            rendererRef.current.release();
            rendererRef.current = null;
            useWebglRef.current = false;
        }
        if (showGearDecor === 'none' && !showCenterGradient && !showCover) return undefined;

        const attachRenderer = () => {
            if (!webglCanvas || rendererRef.current) return;
            const created = new PendoloClockworkRenderer(webglCanvas, antialias, depthStencil);
            if (created.isReady) {
                rendererRef.current = created;
                useWebglRef.current = true;
                if (canvas2dRef.current) canvas2dRef.current.style.visibility = 'hidden';
            } else {
                created.release();
                useWebglRef.current = false;
                webglCanvas.style.visibility = 'hidden';
                if (canvas2dRef.current) canvas2dRef.current.style.visibility = 'visible';
            }
        };
        attachRenderer();

        // A lost context (GPU reset, driver update, too many contexts) draws with Canvas2D until
        // the browser restores it; preventDefault is what allows the restore.
        const handleContextLost = (event: Event) => {
            event.preventDefault();
            rendererRef.current?.dispose();
            rendererRef.current = null;
            useWebglRef.current = false;
        };
        const handleContextRestored = () => attachRenderer();
        webglCanvas?.addEventListener('webglcontextlost', handleContextLost);
        webglCanvas?.addEventListener('webglcontextrestored', handleContextRestored);

        let animationFrameId = 0;

        const render = (timestamp: number) => {
            const p = propsRef.current;
            if (p.showGearDecor === 'none' && !p.showCenterGradient && !p.showCover) return;

            if (lastTimestampRef.current === null) {
                lastTimestampRef.current = timestamp;
            }
            const dt = Math.min((timestamp - lastTimestampRef.current) / 1000, 0.05);
            lastTimestampRef.current = timestamp;

            const rawBass = audioBassMotionValue ? audioBassMotionValue.get() : p.audioBass;
            // The gears step on beat_this' beats only while 齿轮随拍 plays; it is retired (2026-10-17),
            // so they keep their own motion, and beat_this does not run for 时计 at all.
            const gearBeats = beatFxRef?.current.active && getBeatEffectStrength(BEAT_EFFECT_IDS.pendoloGearBeats) > 0;
            // What 仿真鼓面 lights on this canvas - the jewels, the tick and outer dials - is drawn whenever the
            // effect frame is active, not only under 齿轮随拍: gated on that retired effect, the drumhead's
            // jewels and dials were never drawn, only its DOM halo and shake (2026-10-18).
            const beatFx = beatFxRef?.current.active ? beatFxRef.current : null;
            let beatInput: PendoloClockworkBeatInput | null = null;
            if (gearBeats) {
                const triggers = readPendoloBeatTriggers(beatCounterRef.current, beatTriggersRef.current);
                beatInput = beatInputRef.current;
                beatInput.beats = triggers.beats;
                beatInput.downbeats = triggers.downbeats;
                beatInput.beatGain = triggers.beatGain;
                beatInput.downbeatGain = triggers.downbeatGain;
            } else {
                beatCounterRef.current.synced = false;
            }
            const motion = stepPendoloClockworkMotion(
                motionStateRef.current,
                dt,
                rawBass,
                p.paused,
                p.motionProfile,
                beatInput,
            );
            // 2. Main gear wheel angle is strictly tied to lyric line ratchet steps
            // Gears remain stationary while a line is being sung, and ratchet ONLY when lyrics switch
            const escapementAngle = escapementAngleMotionValue.get();

            const box = p.contentBox;
            const frame: PendoloClockworkFrameInput = {
                centerX: p.centerX - box.left,
                centerY: p.centerY - box.top,
                baseRadius: p.baseRadius,
                lyricRingRadius: p.lyricRingRadius,
                escapementAngle,
                phase: motion.phase,
                bassOscillation: motion.bassOscillation,
                secondGearAngle: motion.secondGearAngle,
                transBeatAngle: motion.transBeatAngle,
                primaryTextColor: p.primaryTextColor,
                accentTextColor: p.accentTextColor,
                backgroundColor: p.backgroundColor || '#000000',
                showGearDecor: p.showGearDecor,
                showCenterGradient: p.showCenterGradient,
                showCover: p.showCover,
                coverImage: coverImageRef.current,
                projection: p.projectionMatrix,
                projectionPerspective: p.projectionPerspective,
                mirrored: p.mirrored,
                parallaxScalePx: p.parallaxScalePx,
                parallaxLift: p.parallaxLift,
                parallaxInvFocal: p.parallaxInvFocal,
            };

            // Between beats, with nothing lit or moving, the frame is drawn exactly as with the switch off.
            let fxFrame: PendoloBeatFxDrawFrame | null = null;
            if (beatFx && !(beatFx.wave === null && isPendoloBeatFxIdle(beatFx.state, beatFx.now))) {
                fxFrame = beatFxFrameRef.current ?? {
                    jewelFlare: 0,
                    smallJewelFlare: 0,
                    tickDialLight: 0,
                    outerDialLight: 0,
                    sparks: beatFx.state.sparks,
                    offsetX: 0,
                    offsetY: 0,
                    wave: null,
                    color: beatFx.color,
                };
                beatFxFrameRef.current = fxFrame;
                fxFrame.jewelFlare = beatFx.state.jewelFlare;
                fxFrame.smallJewelFlare = beatFx.state.smallJewelFlare;
                fxFrame.tickDialLight = beatFx.state.tickDialLight;
                fxFrame.outerDialLight = beatFx.state.outerDialLight;
                fxFrame.sparks = beatFx.state.sparks;
                fxFrame.offsetX = box.left;
                fxFrame.offsetY = box.top;
                fxFrame.wave = beatFx.wave;
                fxFrame.color = beatFx.color;
            }

            const width = box.width;
            const height = box.height;
            if (width <= 0 || height <= 0) {
                animationFrameId = window.requestAnimationFrame(render);
                return;
            }
            // 分辨率（#929）：原来的像素密度（devicePixelRatio）当底，乘上倍数；渲染器按变了的尺寸就地换缓冲
            const dpr = resolveLyricPixelRatio(window.devicePixelRatio || 1, p.renderScale);

            const renderer = rendererRef.current;
            if (useWebglRef.current && !renderer?.isReady) useWebglRef.current = false;
            // WebGL cannot upload a cover served without CORS headers, so frames that show such
            // a cover are drawn with Canvas2D, which can. The renderer stays attached.
            const coverNeeds2d = Boolean(
                frame.showCover && (coverNeeds2dRef.current || renderer?.isCoverRejected(frame.coverImage)),
            );

            const drawWebgl = Boolean(useWebglRef.current && renderer && !coverNeeds2d);
            if (lastBackendRef.current !== drawWebgl) {
                lastBackendRef.current = drawWebgl;
                onBackendChangeRef.current?.(drawWebgl);
            }
            if (drawWebgl && renderer) {
                if (webglCanvasRef.current) webglCanvasRef.current.style.visibility = 'visible';
                if (canvas2dRef.current) canvas2dRef.current.style.visibility = 'hidden';
                // Glow comes from the same CSS drop-shadow as Canvas2D, so both backends match.
                renderer.draw({
                    input: frame,
                    cssWidth: width,
                    cssHeight: height,
                    dpr,
                    beatFx: fxFrame,
                });
            } else {
                if (webglCanvasRef.current) webglCanvasRef.current.style.visibility = 'hidden';
                const canvas = canvas2dRef.current;
                if (!canvas) {
                    animationFrameId = window.requestAnimationFrame(render);
                    return;
                }
                canvas.style.visibility = 'visible';
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    animationFrameId = window.requestAnimationFrame(render);
                    return;
                }
                const pixelWidth = Math.round(width * dpr);
                const pixelHeight = Math.round(height * dpr);
                if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
                    canvas.width = pixelWidth;
                    canvas.height = pixelHeight;
                }
                ctx.save();
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, width, height);
                // 镜像 / 倾斜在 Canvas2D 回退里只取投影的仿射部分（没有透视）；透镜是对画好的像素做的，放在外面
                const applyDialTransform = () => {
                    const m = frame.projection;
                    if (!m) return;
                    ctx.translate(frame.centerX, frame.centerY);
                    ctx.transform(m[0], m[3], m[1], m[4], 0, 0);
                    ctx.translate(-frame.centerX, -frame.centerY);
                };
                ctx.save();
                applyDialTransform();
                drawPendoloClockwork2d(ctx, frame);
                ctx.restore();
                if (fxFrame) {
                    if (fxFrame.wave) {
                        waveScratchRef.current ??= document.createElement('canvas');
                        drawPendoloWaveLens2d(ctx, canvas, waveScratchRef.current, frame, fxFrame.wave, fxFrame.color, width, height);
                    }
                    ctx.save();
                    applyDialTransform();
                    drawPendoloBeatFxOverlay2d(ctx, frame, fxFrame);
                    ctx.restore();
                }
                ctx.restore();
            }

            animationFrameId = window.requestAnimationFrame(render);
        };

        animationFrameId = window.requestAnimationFrame(render);

        return () => {
            if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
            webglCanvas?.removeEventListener('webglcontextlost', handleContextLost);
            webglCanvas?.removeEventListener('webglcontextrestored', handleContextRestored);
        };
    }, [showGearDecor, showCenterGradient, showCover, audioBassMotionValue, escapementAngleMotionValue, beatFxRef, antialias, depthStencil]);

    useEffect(() => () => {
        rendererRef.current?.release();
        rendererRef.current = null;
    }, []);

    if (showGearDecor === 'none' && !showCenterGradient && !showCover) {
        return null;
    }

    const canvasClass = 'absolute inset-0 w-full h-full pointer-events-none';
    const boxStyle: React.CSSProperties = {
        left: `${contentBox.left}px`,
        top: `${contentBox.top}px`,
        width: `${contentBox.width}px`,
        height: `${contentBox.height}px`,
        zIndex: 1,
    };
    // Same CSS glow on both backends so WebGL/Canvas2D luminance stays aligned.
    const lineGlow = enableLineGlow
        ? `drop-shadow(0 0 4px ${colorWithAlpha(accentTextColor, 0.65)}) drop-shadow(0 0 12px ${colorWithAlpha(accentTextColor, 0.3)})`
        : undefined;

    return (
        <div className="absolute pointer-events-none" style={boxStyle}>
            {/* 上下文属性跟着画布走：抗锯齿、深度模板变了换一块新画布 */}
            <canvas
                key={`${antialias ? 'msaa' : 'plain'}${depthStencil ? '-depth' : ''}`}
                ref={webglCanvasRef}
                className={canvasClass}
                style={{ filter: lineGlow }}
                aria-hidden="true"
            />
            <canvas
                ref={canvas2dRef}
                className={canvasClass}
                style={{ visibility: 'hidden', filter: lineGlow }}
                aria-hidden="true"
            />
        </div>
    );
};

export default PendoloClockworkCanvas;
