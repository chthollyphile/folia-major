import type { TideBackgroundTuning } from '../../../../types';
import type { TideAnchorSample } from './LyricAnchorSampler';
import type { TideCamera } from './tideCamera';

// src/components/visualizer/backgrounds/tide/tideSplats.ts
// Turns one frame of inputs into the flat list of splats the solver eats: every lyric cluster pushes
// one force vector (a few glyphs grouped into one direction, measured in stage heights per second and
// scaled by SPLAT_FORCE) and lights up an ink blob. Nothing pops: no per-word burst, so the glow stays
// continuous instead of flickering word by word.

export interface TideSplat {
    u: number;
    v: number;
    /** Velocity impulse in fluid texels per second, SPLAT_FORCE already applied. */
    forceX: number;
    forceY: number;
    /** Ink added per second: the frame multiplies it by dt. */
    ink: number;
    /** Splat falloff radius: (pixels / height)^2 * 0.35, the reference's own scale. */
    radius: number;
}

export interface TideSplatSource {
    anchors: TideAnchorSample[];
    tuning: TideBackgroundTuning;
    time: number;
    /** CSS stage size: radii are in pixels, the fluid works in units of stage height. */
    width: number;
    height: number;
    /** Seconds since the previous frame: a splat is a per-frame impulse, not a rate. */
    dt: number;
    anchorFade: number;
    /** 相机偏移：整片水面按这个量平移，锚点必须反向补偿，水花才长在字上。 */
    camera?: TideCamera;
}

export const TIDE_SPLAT_FORCE = 6900;
export const TIDE_MAX_SPLATS = 10;
/** Reference cursor is 40px; the lyrics get a wider brush so the water visibly moves. */
const CURSOR_SIZE = 70;
const MAX_CURSOR_SIZE = 900;
const INK_RATE = 1.2;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const tideSplatRadius = (sizePx: number, height: number): number => {
    const ratio = clamp(sizePx, 4, MAX_CURSOR_SIZE) / clamp(height, 1, 8192);
    return ratio * ratio * 0.35;
};

/**
 * 锚点两次采样之间本来是冻结的，直接推水就会一顿一顿（用户说的"一闪一闪"）。
 * 这里按时间常数把位置/速度/强度滑向最新采样值：采样次数被限制住，但水面每一帧都在动。
 * smoothing 0 = 直接吸附，越大越丝滑（0.5 对应约 0.24s 的时间常数）。
 */
export const glideTideAnchors = (
    current: TideAnchorSample[],
    targets: TideAnchorSample[],
    dt: number,
    smoothing: number,
): TideAnchorSample[] => {
    const step = clamp(dt, 1 / 240, 1 / 24);
    const smooth = clamp(smoothing, 0, 0.92);
    const alpha = smooth <= 0 ? 1 : 1 - Math.exp(-step / (0.04 + smooth * 0.4));
    const velocityAlpha = Math.min(1, alpha * 1.6);
    const pending = new Map(targets.map(target => [target.key, target]));
    const next: TideAnchorSample[] = [];

    for (const anchor of current) {
        const target = pending.get(anchor.key);
        if (!target) {
            // 目标消失了：原地淡出，别让水面上的推力被硬切掉。
            const strength = anchor.strength * (1 - alpha);
            if (strength > 0.02) {
                next.push({
                    ...anchor,
                    vx: anchor.vx * (1 - velocityAlpha),
                    vy: anchor.vy * (1 - velocityAlpha),
                    strength,
                });
            }

            continue;
        }

        pending.delete(anchor.key);
        next.push({
            key: anchor.key,
            x: anchor.x + (target.x - anchor.x) * alpha,
            y: anchor.y + (target.y - anchor.y) * alpha,
            vx: anchor.vx + (target.vx - anchor.vx) * velocityAlpha,
            vy: anchor.vy + (target.vy - anchor.vy) * velocityAlpha,
            strength: anchor.strength + (target.strength - anchor.strength) * alpha,
        });
    }

    // 新出现的锚点从零强度长起来，新字一冒出来不会砸出一团亮斑。
    for (const target of pending.values()) {
        next.push({ ...target, strength: smooth <= 0 ? target.strength : target.strength * alpha });
    }

    return next;
};

export const buildTideSplats = (source: TideSplatSource): TideSplat[] => {
    const { tuning } = source;
    const intensity = clamp(tuning.intensity, 0, 2);
    const dt = clamp(source.dt, 1 / 240, 1 / 24);
    const aspect = clamp(source.width, 1, 8192) / clamp(source.height, 1, 8192);
    const cursorSize = CURSOR_SIZE * clamp(tuning.spread, 0.2, 4);
    const cameraX = clamp(source.camera?.x ?? 0, -0.5, 0.5);
    const cameraY = clamp(source.camera?.y ?? 0, -0.5, 0.5);
    const splats: TideSplat[] = [];
    const push = (splat: TideSplat): void => {
        if (splats.length < TIDE_MAX_SPLATS) {
            splats.push(splat);
        }
    };

    if (tuning.followLyrics) {
        // 几个字一组：每个锚点一股向量力，走出多快就推多狠。
        for (const anchor of source.anchors) {
            if (splats.length >= TIDE_MAX_SPLATS) {
                break;
            }

            const strength = clamp(anchor.strength * source.anchorFade, 0, 1.4);
            if (strength <= 0.01) {
                continue;
            }

            const gain = strength * clamp(0.4 + intensity * 0.7, 0, 2) * dt * TIDE_SPLAT_FORCE;
            const speed = Math.hypot(anchor.vx * aspect, anchor.vy);

            push({
                u: clamp(anchor.x + cameraX, 0, 1),
                v: clamp(anchor.y + cameraY, 0, 1),
                forceX: anchor.vx * aspect * gain,
                // Anchors are measured in the fluid's own frame: v counts up from the bottom.
                forceY: anchor.vy * gain,
                ink: INK_RATE * strength * clamp(intensity, 0.2, 2),
                radius: tideSplatRadius(cursorSize * (1 + Math.min(1, speed) * 0.6), source.height),
            });
        }
    }

    return splats;
};
