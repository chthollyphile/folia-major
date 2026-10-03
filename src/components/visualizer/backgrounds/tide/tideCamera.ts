import type { TideAnchorSample } from './LyricAnchorSampler';
import { smoothDamp, tideSmoothTau } from './tideSmoothing';

// src/components/visualizer/backgrounds/tide/tideCamera.ts
// The camera: the whole sea pans and tilts towards the word being sung, so the shot follows the
// lyrics. It only translates the wave field (the surface pass turns u_camera into a world offset);
// the fluid is sampled in screen space, so a splash stays under its glyph. The camera also lags
// behind the lyrics on purpose (its own, slower time constant) and has a hard pan rate: a camera
// that snaps to every word - or that gets yanked when the anchors are re-picked - reads as a
// glitch, a camera that drifts after the lyrics reads as a camera.

export interface TideCamera {
    x: number;
    y: number;
    /** 相机自身速度：二阶滤波要跨帧保留它。 */
    vx?: number;
    vy?: number;
}

/** 相机最大位移，按屏幕比例：再大就会把水面推出画外。 */
export const TIDE_CAMERA_LIMIT = 0.16;
/** 镜头最大扫速（uv/s）：转向再急也是扫过去，不是被拽过去。 */
const CAMERA_MAX_SPEED = 0.4;
/** 强度到位移的换算系数：默认强度 0.45 时，最靠边的字能把镜头推到接近上限。 */
const CAMERA_GAIN = 0.55;
/** 纵向少偏一点，免得地平线抖得太明显。 */
const CAMERA_VERTICAL_SCALE = 0.75;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * 目标相机位置：按强度加权求所有锚点的重心，再换算成相对画面中心的偏移。
 * 没有锚点或强度为 0 时回到正中，所以关掉开关时镜头会平滑归位而不是硬切。
 */
export const resolveTideCameraTarget = (anchors: TideAnchorSample[], strength: number): TideCamera => {
    const gain = clamp(strength, 0, 1);
    if (gain <= 0 || anchors.length === 0) {
        return { x: 0, y: 0 };
    }

    let weight = 0;
    let offsetX = 0;
    let offsetY = 0;
    for (const anchor of anchors) {
        const w = clamp(anchor.strength, 0, 1.4);
        weight += w;
        offsetX += (anchor.x - 0.5) * w;
        offsetY += (anchor.y - 0.5) * w;
    }

    if (weight <= 0.0001) {
        return { x: 0, y: 0 };
    }

    const limitY = TIDE_CAMERA_LIMIT * CAMERA_VERTICAL_SCALE;
    return {
        x: clamp((offsetX / weight) * gain * CAMERA_GAIN, -TIDE_CAMERA_LIMIT, TIDE_CAMERA_LIMIT),
        y: clamp((offsetY / weight) * gain * CAMERA_GAIN, -limitY, limitY),
    };
};

/** 相机滑行：和锚点同一个临界阻尼滤波（时间常数更大，跟拍慢半拍），外加扫速上限。 */
export const glideTideCamera = (
    current: TideCamera,
    target: TideCamera,
    dt: number,
    smoothing: number,
): TideCamera => {
    const step = clamp(dt, 1 / 240, 1 / 24);
    const tau = tideSmoothTau(smoothing, 0.12, 0.65);
    const x = smoothDamp({ value: current.x, velocity: current.vx ?? 0 }, target.x, step, tau, CAMERA_MAX_SPEED);
    const y = smoothDamp({ value: current.y, velocity: current.vy ?? 0 }, target.y, step, tau, CAMERA_MAX_SPEED);
    return { x: x.value, y: y.value, vx: x.velocity, vy: y.velocity };
};
