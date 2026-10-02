import type { TideAnchorSample } from './LyricAnchorSampler';

// src/components/visualizer/backgrounds/tide/tideCamera.ts
// The camera: the whole sea pans and tilts towards the word being sung, so the shot follows the
// lyrics. The camera never moves the fluid itself - the surface pass samples the field at uv +
// camera, and the splats are shifted by the same offset, so a splash still grows under its glyph.
// The camera also lags behind the lyrics on purpose (its own, slower time constant): a camera that
// snaps to every word reads as a glitch, a camera that drifts after it reads as a camera.

export interface TideCamera {
    x: number;
    y: number;
}

/** 相机最大位移，按屏幕比例：再大就会把水面推出画外。 */
export const TIDE_CAMERA_LIMIT = 0.16;
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

/** 相机滑行：时间常数比锚点更大（跟拍慢半拍），smoothing 沿用同一档手感。 */
export const glideTideCamera = (
    current: TideCamera,
    target: TideCamera,
    dt: number,
    smoothing: number,
): TideCamera => {
    const step = clamp(dt, 1 / 240, 1 / 24);
    const smooth = clamp(smoothing, 0, 0.92);
    const alpha = smooth <= 0 ? 1 : 1 - Math.exp(-step / (0.1 + smooth * 0.6));
    return {
        x: current.x + (target.x - current.x) * alpha,
        y: current.y + (target.y - current.y) * alpha,
    };
};
