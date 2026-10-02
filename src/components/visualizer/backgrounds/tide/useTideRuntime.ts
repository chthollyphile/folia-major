import { useEffect, useRef } from 'react';
import { type MotionValue } from 'framer-motion';
import * as twgl from 'twgl.js';
import type { Line, Theme, TideBackgroundTuning } from '../../../../types';
import { LyricAnchorSampler, type TideAnchorSample } from './LyricAnchorSampler';
import { buildTideSplats, glideTideAnchors } from './tideSplats';
import { glideTideCamera, resolveTideCameraTarget, type TideCamera } from './tideCamera';
import { computeTideFluidSize, resolveTideDpr, resolveTideStageColors, type TideStageColors } from './tidePalette';
import { createTideResources, disposeTideResources, resizeTideResources, type TideResources } from './tideResources';
import { renderTideFrame, tideTrailSeconds } from './tideFrame';

// src/components/visualizer/backgrounds/tide/useTideRuntime.ts
// Owns the tide GL lifecycle: one canvas, one RAF loop, resources built on mount and disposed on
// unmount. Tuning, lyrics and audio are read through a ref every frame, so moving a slider never
// restarts the simulation - it only changes the next frame.

export interface TideRuntimeInput {
    canvas: HTMLCanvasElement | null;
    theme: Theme;
    isDaylight: boolean;
    paused: boolean;
    tuning: TideBackgroundTuning;
    stageRef?: { readonly current: HTMLElement | null };
    lines?: Line[];
    currentLineIndex?: number;
    currentTime?: MotionValue<number>;
    /** Called when the water cannot run at all, so the canvas is removed instead of left black. */
    onUnavailable?: () => void;
}

/** DOM 测量不便宜，锚点默认每 180ms 采一次；设置页里可以再放宽或收紧。 */
const DEFAULT_SAMPLE_SECONDS = 0.18;
const MIN_SAMPLE_SECONDS = 0.06;
const MAX_SAMPLE_SECONDS = 0.6;
const MAX_FRAME_SECONDS = 1 / 24;
/** 参考实现的开场：浪从地平线滚进来。 */
const INTRO_SECONDS = 1.5;
/** 一次推力最多让流体保持清醒 5 秒，之后清空，免得静置画面里留着死掉的涡。 */
const FLUID_IDLE_MULTIPLIER = 5000;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const useTideRuntime = (input: TideRuntimeInput): void => {
    const inputRef = useRef(input);
    inputRef.current = input;
    const samplerRef = useRef<LyricAnchorSampler | null>(null);
    if (!samplerRef.current) {
        samplerRef.current = new LyricAnchorSampler();
    }

    useEffect(() => {
        const canvas = input.canvas;
        if (!canvas) {
            return undefined;
        }

        const reportUnavailable = (message: string): void => {
            console.warn(message);
            inputRef.current.onUnavailable?.();
        };

        const gl = twgl.getContext(canvas, {
            alpha: false,
            depth: false,
            stencil: false,
            antialias: false,
            premultipliedAlpha: false,
        });
        if (!gl) {
            reportUnavailable('TideBackground: 无法创建 WebGL 上下文，已跳过流体背景');
            return undefined;
        }

        const halfFloatReady = Boolean(
            gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'),
        );
        if (!halfFloatReady) {
            reportUnavailable('TideBackground: 当前环境不支持半浮点渲染目标，已跳过流体背景');
            return undefined;
        }

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);

        const cssWidth = canvas.clientWidth || 1;
        const cssHeight = canvas.clientHeight || 1;
        const space = { width: cssWidth, height: cssHeight, dpr: resolveTideDpr(cssWidth, cssHeight) };
        twgl.resizeCanvasToDisplaySize(canvas, space.dpr);

        const initial = createTideResources(gl, ...computeTideFluidSize(cssWidth, cssHeight));
        if (!initial) {
            reportUnavailable('TideBackground: 流体着色器编译失败，已跳过流体背景');
            return undefined;
        }

        let resources: TideResources = initial;
        let colorCache: { key: string; colors: TideStageColors } | null = null;
        let anchors: TideAnchorSample[] = [];
        /** 上一次采样得到的目标值：采样次数被限制住，中间靠 glide 滑过去。 */
        let anchorTargets: TideAnchorSample[] = [];
        let lastSampleSeconds = Number.NEGATIVE_INFINITY;
        /** 跟随歌词的相机偏移：目标由锚点重心算出，逐帧滑行，关掉开关时归位。 */
        let camera: TideCamera = { x: 0, y: 0 };
        let lastFrameSeconds = performance.now() / 1000;
        let fluidUntilMilliseconds = 0;
        let fluidNeedsReset = false;
        let waveTime = 0;
        let introClock = 0;
        let painted = false;
        let contextLost = false;
        let frameHandle = 0;

        const handleContextLost = (event: Event): void => {
            event.preventDefault();
            contextLost = true;
        };

        const handleContextRestored = (): void => {
            const restored = createTideResources(gl, ...computeTideFluidSize(space.width, space.height));
            if (!restored) {
                reportUnavailable('TideBackground: 上下文恢复后着色器编译失败，已跳过流体背景');
                return;
            }

            resources = restored;
            fluidNeedsReset = true;
            contextLost = false;
        };

        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);

        const render = (now: number): void => {
            frameHandle = requestAnimationFrame(render);
            const current = inputRef.current;
            const nowSeconds = now / 1000;
            const elapsed = nowSeconds - lastFrameSeconds;
            lastFrameSeconds = nowSeconds;

            if (contextLost || (current.paused && painted)) {
                return;
            }

            const nextWidth = canvas.clientWidth;
            const nextHeight = canvas.clientHeight;
            if (nextWidth <= 0 || nextHeight <= 0) {
                return;
            }

            space.dpr = resolveTideDpr(nextWidth, nextHeight);
            twgl.resizeCanvasToDisplaySize(canvas, space.dpr);
            if (space.width !== nextWidth || space.height !== nextHeight) {
                space.width = nextWidth;
                space.height = nextHeight;
                resizeTideResources(gl, resources, ...computeTideFluidSize(nextWidth, nextHeight));
            }

            const dt = clamp(elapsed, 1 / 240, MAX_FRAME_SECONDS);
            const tuning = current.tuning;
            // 参考实现按 speed 推时间：flow 越大浪走得越快，waveSpeed 再整体倍率。
            waveTime += dt * (0.35 + clamp(tuning.flow, 0, 2) * 0.45) * clamp(tuning.waveSpeed, 0, 2.5);
            introClock = Math.min(1, introClock + dt / INTRO_SECONDS);

            const timeSec = current.currentTime ? current.currentTime.get() : 0;
            const requestedSampleSeconds = Number.isFinite(tuning.sampleSeconds) ? tuning.sampleSeconds : DEFAULT_SAMPLE_SECONDS;
            const sampleSeconds = clamp(requestedSampleSeconds, MIN_SAMPLE_SECONDS, MAX_SAMPLE_SECONDS);

            if (!tuning.followLyrics) {
                anchors = [];
                anchorTargets = [];
                lastSampleSeconds = Number.NEGATIVE_INFINITY;
            } else {
                if (nowSeconds - lastSampleSeconds >= sampleSeconds) {
                    const bounds = canvas.getBoundingClientRect();
                    anchorTargets = samplerRef.current?.sample({
                        stage: current.stageRef?.current ?? null,
                        bounds: {
                            left: bounds.left,
                            top: bounds.top,
                            width: bounds.width,
                            height: bounds.height,
                        },
                        lines: current.lines ?? [],
                        lineIndex: current.currentLineIndex ?? 0,
                        timeSec,
                        dt: clamp(nowSeconds - lastSampleSeconds, 1 / 240, 0.5),
                        maxAnchors: clamp(Math.round(tuning.maxAnchors), 1, 6),
                    }) ?? [];
                    lastSampleSeconds = nowSeconds;
                }

                // 限制采集次数之后，靠每帧滑行把锚点从上一组目标带向新目标：水面一直动，但不会抖。
                anchors = glideTideAnchors(anchors, anchorTargets, dt, tuning.smoothing);
            }

            const colorKey = [
                current.theme?.primaryColor ?? '',
                current.theme?.accentColor ?? '',
                current.isDaylight,
                tuning.colorMode,
                tuning.waterColor,
                tuning.glintColor,
                tuning.backgroundColor,
            ].join('|');
            if (!colorCache || colorCache.key !== colorKey) {
                colorCache = { key: colorKey, colors: resolveTideStageColors(current.theme, current.isDaylight, tuning) };
            }

            const cameraTarget = tuning.cameraFollow
                ? resolveTideCameraTarget(anchors, tuning.cameraStrength)
                : { x: 0, y: 0 };
            camera = glideTideCamera(camera, cameraTarget, dt, tuning.smoothing);

            const splats = buildTideSplats({
                anchors,
                camera,
                tuning,
                time: waveTime,
                width: nextWidth,
                height: nextHeight,
                dt,
                // glide 已经保证连续性，这里不再用采样间隙的假衰减。
                anchorFade: 1,
            });

            if (splats.length > 0) {
                fluidUntilMilliseconds = now + Math.max(1500, tideTrailSeconds(tuning.dissipation) * FLUID_IDLE_MULTIPLIER);
            }

            const fluidActive = now < fluidUntilMilliseconds;
            const resetFluid = !fluidActive && fluidNeedsReset;
            fluidNeedsReset = resetFluid ? false : fluidNeedsReset;

            renderTideFrame(gl, resources, {
                dt,
                time: waveTime,
                intro: introClock >= 1 ? 1 : 1 - Math.pow(1 - introClock, 3),
                tuning,
                splats,
                fluidActive,
                resetFluid,
                width: nextWidth,
                height: nextHeight,
                dpr: space.dpr,
                surfaceColor: colorCache.colors.surface,
                glowColor: colorCache.colors.glow,
                glintColor: colorCache.colors.glint,
                backgroundColor: colorCache.colors.background,
                camera,
            });
            painted = true;
        };

        frameHandle = requestAnimationFrame(render);

        return () => {
            cancelAnimationFrame(frameHandle);
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
            disposeTideResources(gl, resources);
        };
    }, [input.canvas]);
};
