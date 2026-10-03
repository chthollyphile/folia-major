import { drawTidePass, tideTargetTexture } from './tideGl';
import { clearTideFluid, swapTidePair, type TideResources } from './tideResources';
import type { TideSplat } from './tideSplats';
import type { TideCamera } from './tideCamera';
import type { TideAudioFrame } from './tideAudio';
import type { TideBackgroundTuning } from '../../../../types';

// src/components/visualizer/backgrounds/tide/tideFrame.ts
// One frame of the water, in the reference's own pass order: splat -> curl -> vorticity ->
// divergence -> damped pressure -> 16 Jacobi steps -> project -> advect velocity -> advect ink ->
// surface pass, which is the only pass that draws to the canvas.

export interface TideFrameParams {
    dt: number;
    /** Wave clock in seconds, already scaled by the flow tuning. */
    time: number;
    /** 0..1 intro progress, eased by the caller. */
    intro: number;
    tuning: TideBackgroundTuning;
    splats: TideSplat[];
    /** false => the fluid is asleep: the water keeps rolling but no solver work happens. */
    fluidActive: boolean;
    /** true on the frame the fluid fell asleep: wipe the fields once so no stale ink freezes. */
    resetFluid: boolean;
    /** CSS stage size and the device pixel ratio the surface pass renders at. */
    width: number;
    height: number;
    dpr: number;
    surfaceColor: [number, number, number];
    glowColor: [number, number, number];
    /** Near-white sparkle colour for the wave crests, tinted by the accent. */
    glintColor: [number, number, number];
    backgroundColor: [number, number, number];
    /** 跟随歌词的相机偏移（uv 单位），见 tideCamera.ts。 */
    camera?: TideCamera;
    /** 声音驱动：已按设置缩放过的频段能量、节拍波环与歌词光池，只作用于水面。 */
    audio?: TideAudioFrame;
}

/** 没有节拍波环 / 歌词光池时要塞给着色器的空槽（uniform 不能被漏设，否则会留着上一帧的值）。 */
const EMPTY_SLOT = [0, 0, 0, 0];
const EMPTY_FOCUS: number[][] = [EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT];

const PRESSURE_STEPS = 16;
const PRESSURE_DAMPING = 0.8;
/**
 * 涡量约束强度。参考实现用 30，但它是「指针划过去」那种瞬态激励；这里是驻留源，
 * 值一大就会把每个撇出去的涡放大成一个常驻漩涡 —— 降到很低，让扰动吹散而不是积起来。
 */
const SWIRL_FORCE = 6;
/** 参考实现的默认预设 swell：250 度，雾和透视都拉开。 */
const WAVE_DIRECTION = 4.3633;
const WAVE_SCALE_BASE = 1.5;
const WAVE_SCALE_PER_FLOW = 0.35;
const WAVE_STRETCH = 0.12;
/** 水面尺度、陡度、闪光、雾气、透视都可以在设置里单独调，常量只做默认系数。 */
const WAVE_SCALE_MIN = 0.35;
const WAVE_SCALE_MAX = 3;
/** 坡度转法线时的放大倍数：坡度本身可以到几十，乘这个数才不会翻过去。 */
const GLINT_RELIEF = 0.12;
const GLINT_POWER_BASE = 24;
const GLINT_POWER_PER_INTENSITY = 18;
const CONTRAST_BASE = 1.1;
const CONTRAST_PER_INTENSITY = 0.15;
const INK_BASE = 0.6;
const INK_PER_INTENSITY = 0.7;
const TRAIL_BASE = 0.6;
const TRAIL_PER_DISSIPATION = 1.8;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** How long a splash keeps the solver awake, in the reference's own mapping (trail 1.4 by default). */
export const tideTrailSeconds = (dissipation: number): number =>
    TRAIL_BASE + clamp(dissipation, 0, 1) * TRAIL_PER_DISSIPATION;

/** The reference's decay rates: ink 1/trail, velocity 1.4/trail, both applied as 1/(1 + fade*dt). */
export const tideInkFade = (dissipation: number): number => 1 / tideTrailSeconds(dissipation);

/**
 * 响度驱动拖尾：安静时保持设定值（水干净利落），越响耗散越小 —— 墨迹久久不散，翻涌起来。
 * 只缩放「这一帧的衰减率」，不碰设定本身，所以设置面板里的值仍是基准。
 */
export const tideLoudnessDissipation = (dissipation: number, loudness: number): number =>
    clamp(dissipation, 0, 1) * (1 - 0.55 * clamp(loudness, 0, 1));

const applySplat = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    resources: TideResources,
    target: 'velocity' | 'ink',
    splat: TideSplat,
    value: [number, number, number],
    aspect: number,
): void => {
    const pair = resources[target];
    drawTidePass(gl, resources.programs.splat, resources.buffer, pair.write, {
        u_target: tideTargetTexture(pair.read),
        u_aspect: aspect,
        u_point: [splat.u, splat.v],
        u_value: value,
        u_radius: Math.max(splat.radius, 1e-5),
    });
    swapTidePair(pair);
};

const stepTideFluid = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    resources: TideResources,
    dt: number,
    inkFade: number,
): void => {
    const { programs, buffer, texel } = resources;
    const velocityFade = clamp(inkFade * 1.4, 0, 1);

    drawTidePass(gl, programs.curl, buffer, resources.curl, {
        u_velocity: tideTargetTexture(resources.velocity.read),
        u_texel: texel,
    });

    drawTidePass(gl, programs.vorticity, buffer, resources.velocity.write, {
        u_velocity: tideTargetTexture(resources.velocity.read),
        u_curl: tideTargetTexture(resources.curl),
        u_swirl: SWIRL_FORCE,
        u_dt: dt,
        u_texel: texel,
    });
    swapTidePair(resources.velocity);

    drawTidePass(gl, programs.divergence, buffer, resources.divergence, {
        u_velocity: tideTargetTexture(resources.velocity.read),
        u_texel: texel,
    });

    drawTidePass(gl, programs.scale, buffer, resources.pressure.write, {
        u_source: tideTargetTexture(resources.pressure.read),
        u_value: PRESSURE_DAMPING,
        u_texel: texel,
    });
    swapTidePair(resources.pressure);

    for (let step = 0; step < PRESSURE_STEPS; step += 1) {
        drawTidePass(gl, programs.pressure, buffer, resources.pressure.write, {
            u_pressure: tideTargetTexture(resources.pressure.read),
            u_divergence: tideTargetTexture(resources.divergence),
            u_texel: texel,
        });
        swapTidePair(resources.pressure);
    }

    drawTidePass(gl, programs.project, buffer, resources.velocity.write, {
        u_pressure: tideTargetTexture(resources.pressure.read),
        u_velocity: tideTargetTexture(resources.velocity.read),
        u_texel: texel,
    });
    swapTidePair(resources.velocity);

    drawTidePass(gl, programs.advect, buffer, resources.velocity.write, {
        u_velocity: tideTargetTexture(resources.velocity.read),
        u_source: tideTargetTexture(resources.velocity.read),
        u_texel: texel,
        u_dt: dt,
        u_fade: velocityFade,
    });
    swapTidePair(resources.velocity);

    drawTidePass(gl, programs.advect, buffer, resources.ink.write, {
        u_velocity: tideTargetTexture(resources.velocity.read),
        u_source: tideTargetTexture(resources.ink.read),
        u_texel: texel,
        u_dt: dt,
        u_fade: inkFade,
    });
    swapTidePair(resources.ink);
};

export const renderTideFrame = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    resources: TideResources,
    params: TideFrameParams,
): void => {
    const { programs, buffer } = resources;
    const { tuning } = params;
    const intensity = clamp(tuning.intensity, 0, 2);
    const aspect = clamp(params.width, 1, 8192) / clamp(params.height, 1, 8192);
    const pulseSlots = params.audio?.pulses ?? [];
    const focusSlots = params.audio?.focus ?? EMPTY_FOCUS;

    for (const splat of params.splats) {
        applySplat(gl, resources, 'velocity', splat, [splat.forceX, splat.forceY, 0], aspect);
        applySplat(gl, resources, 'ink', splat, [splat.ink * params.dt, 0, 0], aspect);
    }

    if (params.fluidActive) {
        // 拖尾跟着响度走：安静时短、大声时长，水面因此有「呼吸」而非匀速消散。
        const loudness = clamp(params.audio?.level ?? 0, 0, 1);
        stepTideFluid(gl, resources, params.dt, tideInkFade(tideLoudnessDissipation(tuning.dissipation, loudness)));
    } else if (params.resetFluid) {
        clearTideFluid(gl, resources);
    }

    drawTidePass(gl, programs.surface, buffer, null, {
        u_size: [params.width, params.height],
        u_dpr: params.dpr,
        u_time: params.time,
        u_scale: clamp(
            (WAVE_SCALE_BASE - tuning.flow * WAVE_SCALE_PER_FLOW) * clamp(tuning.waveScale, 0.4, 2.5),
            WAVE_SCALE_MIN,
            WAVE_SCALE_MAX,
        ),
        u_direction: WAVE_DIRECTION,
        u_chop: clamp(tuning.chop, 0, 1.5),
        u_stretch: WAVE_STRETCH,
        u_relief: GLINT_RELIEF,
        // 高光的「紧度」和对比度是水面自身的属性，不该跟着「推力强度」一起收紧：
        // intensity 只管推水与染色，让它继续收窄高光会把浪尖收成一层亚像素级的碎点，
        // 逐帧重采样就是闪。所以这两项里 intensity 的贡献封顶在 1。
        u_glint_power: GLINT_POWER_BASE + Math.min(intensity, 1) * GLINT_POWER_PER_INTENSITY,
        u_glint: clamp(tuning.glintStrength, 0, 2.5) * (0.75 + intensity * 0.25),
        u_contrast: CONTRAST_BASE + Math.min(intensity, 1) * CONTRAST_PER_INTENSITY,
        u_perspective: clamp(tuning.perspective, 0, 1),
        u_fog: clamp(tuning.fog, 0, 1),
        u_intro: params.intro,
        u_camera: [clamp(params.camera?.x ?? 0, -0.5, 0.5), clamp(params.camera?.y ?? 0, -0.5, 0.5)],
        u_bass: clamp(params.audio?.bass ?? 0, 0, 3),
        u_mid: clamp(params.audio?.mid ?? 0, 0, 3),
        u_treble: clamp(params.audio?.treble ?? 0, 0, 3),
        u_breath: clamp(params.audio?.breath ?? 0, 0, 1.5),
        u_pulse0: pulseSlots[0] ?? EMPTY_SLOT,
        u_pulse1: pulseSlots[1] ?? EMPTY_SLOT,
        u_pulse2: pulseSlots[2] ?? EMPTY_SLOT,
        u_focus0: focusSlots[0] ?? EMPTY_SLOT,
        u_focus1: focusSlots[1] ?? EMPTY_SLOT,
        u_focus2: focusSlots[2] ?? EMPTY_SLOT,
        u_focus3: focusSlots[3] ?? EMPTY_SLOT,
        u_focus4: focusSlots[4] ?? EMPTY_SLOT,
        u_focus5: focusSlots[5] ?? EMPTY_SLOT,
        t_velocity: tideTargetTexture(resources.velocity.read),
        t_ink: tideTargetTexture(resources.ink.read),
        u_fluid_texel: resources.texel,
        u_fluid: params.fluidActive ? 1 : 0,
        u_ink: INK_BASE + intensity * INK_PER_INTENSITY,
        u_surface: params.surfaceColor,
        u_glow_color: params.glowColor,
        u_glint_color: params.glintColor,
        u_background: params.backgroundColor,
    });
};
