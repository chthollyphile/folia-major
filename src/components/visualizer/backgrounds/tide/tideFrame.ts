import { drawTidePass, tideTargetTexture } from './tideGl';
import { clearTideFluid, swapTidePair, type TideResources } from './tideResources';
import type { TideSplat } from './tideSplats';
import type { TideCamera } from './tideCamera';
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
}

const PRESSURE_STEPS = 16;
const PRESSURE_DAMPING = 0.8;
const SWIRL_FORCE = 14;
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

    for (const splat of params.splats) {
        applySplat(gl, resources, 'velocity', splat, [splat.forceX, splat.forceY, 0], aspect);
        applySplat(gl, resources, 'ink', splat, [splat.ink * params.dt, 0, 0], aspect);
    }

    if (params.fluidActive) {
        stepTideFluid(gl, resources, params.dt, tideInkFade(tuning.dissipation));
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
        u_glint_power: GLINT_POWER_BASE + intensity * GLINT_POWER_PER_INTENSITY,
        u_glint: clamp(tuning.glintStrength, 0, 2.5) * (0.75 + intensity * 0.25),
        u_contrast: CONTRAST_BASE + intensity * CONTRAST_PER_INTENSITY,
        u_perspective: clamp(tuning.perspective, 0, 1),
        u_fog: clamp(tuning.fog, 0, 1),
        u_intro: params.intro,
        u_camera: [clamp(params.camera?.x ?? 0, -0.5, 0.5), clamp(params.camera?.y ?? 0, -0.5, 0.5)],
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
