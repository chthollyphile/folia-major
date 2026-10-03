import type { TideBackgroundTuning } from '../../../../types';
import type { TideAnchorSample } from './LyricAnchorSampler';
import { smoothDamp, tideSmoothTau } from './tideSmoothing';

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
    /** 当前整体响度（0..1，已平滑）：分贝越大，词推水的动量越大。缺省 0.5 为中性。 */
    loudness?: number;
}

export const TIDE_SPLAT_FORCE = 6900;
export const TIDE_MAX_SPLATS = 10;
/**
 * 标记自报方向推力的等效速度（uv/秒）。锚点现在完全静止（不含呼吸），推力是唯一的水动力源，
 * 所以这里给得比原来大 —— 之前那股力其实是被「环呼吸」泵出来的（量级大一个数量级）。
 */
export const TIDE_ANCHOR_PUSH_SPEED = 1;
/** Reference cursor is 40px; the lyrics get a wider brush so the water visibly moves. */
const CURSOR_SIZE = 70;
const MAX_CURSOR_SIZE = 900;
const INK_RATE = 1.2;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * 响度对歌词推力的倍率：0.5 是中性（倍率 1），越响词推得越狠、越静越轻；soundReactive 为 0 时恒为 1。
 * 只放大「词推动的水」，不额外灌力，所以音量变化不会把水面搅乱。
 */
export const TIDE_MOMENTUM_SPAN = 0.9;
export const tideMomentumGain = (loudness: number, soundReactive: number): number =>
    1 + clamp(soundReactive, 0, 2) * (clamp(loudness, 0, 1) - 0.5) * TIDE_MOMENTUM_SPAN;

export const tideSplatRadius = (sizePx: number, height: number): number => {
    const ratio = clamp(sizePx, 4, MAX_CURSOR_SIZE) / clamp(height, 1, 8192);
    return ratio * ratio * 0.35;
};

/**
 * 锚点两次采样之间本来会冻结，直接推水就一帧一顿。这里用一个临界阻尼二阶滤波把锚点带向最新采样值：
 * 位置丝滑，而且推力直接取滤波器的速度——于是「采样快慢」和「重新聚类造成的目标跳变」都只会让
 * 速度拐弯，不会出现尖峰（那正是快速采样/转向时的抽搐）。滤波器自带速度上限，跳变也甩不出去。
 * 强度另走一档最短淡入淡出：smoothing 0 时位置是吸附的，新字/离场字仍然淡，不会“啪”一下。
 * 自报的方向推力同理 —— 它也是每次采样才刷新，必须淡着过去，否则每 0.18s 跳一下。
 */
const STRENGTH_FADE_SECONDS = 0.28;

export const glideTideAnchors = (
    current: TideAnchorSample[],
    targets: TideAnchorSample[],
    dt: number,
    smoothing: number,
): TideAnchorSample[] => {
    const step = clamp(dt, 1 / 240, 1 / 24);
    const tau = tideSmoothTau(smoothing, 0.07, 0.55);
    const fade = clamp(step / STRENGTH_FADE_SECONDS, 0, 1);
    const pending = new Map(targets.map(target => [target.key, target]));
    const next: TideAnchorSample[] = [];

    for (const anchor of current) {
        const target = pending.get(anchor.key);
        if (!target) {
            // 目标消失了：原地淡出，速度跟着强度一起收干净，不留还在推水的残速。
            const strength = anchor.strength * (1 - fade);
            if (strength > 0.02) {
                next.push({
                    ...anchor,
                    vx: anchor.vx * (1 - fade),
                    vy: anchor.vy * (1 - fade),
                    strength,
                });
            }

            continue;
        }

        pending.delete(anchor.key);
        const x = smoothDamp({ value: anchor.x, velocity: anchor.vx }, target.x, step, tau);
        const y = smoothDamp({ value: anchor.y, velocity: anchor.vy }, target.y, step, tau);
        // 自报的方向推力同样不能直接取目标值：采样是「每 sampleSeconds 一次」的（默认 0.18s），
        // 每样一次就硬跳一下 —— 推力水花和由它撑大的半径会以 ~5.5Hz 闪，就是那股抽搐。
        // 位置走二阶滤波、强度走 fade，推力也走同一档 fade，输出才是连续的。
        const previousPushX = anchor.pushX ?? 0;
        const previousPushY = anchor.pushY ?? 0;
        next.push({
            ...anchor,
            x: x.value,
            y: y.value,
            vx: x.velocity,
            vy: y.velocity,
            strength: anchor.strength + (target.strength - anchor.strength) * fade,
            pushX: previousPushX + ((target.pushX ?? 0) - previousPushX) * fade,
            pushY: previousPushY + ((target.pushY ?? 0) - previousPushY) * fade,
        });
    }

    // 新出现的锚点从零强度长起来，新字一冒出来不会砸出一团亮斑；推力也从零长起。
    for (const target of pending.values()) {
        next.push({
            ...target,
            vx: 0,
            vy: 0,
            strength: target.strength * fade,
            pushX: (target.pushX ?? 0) * fade,
            pushY: (target.pushY ?? 0) * fade,
        });
    }

    return next;
};

export const buildTideSplats = (source: TideSplatSource): TideSplat[] => {
    const { tuning } = source;
    const intensity = clamp(tuning.intensity, 0, 2);
    const dt = clamp(source.dt, 1 / 240, 1 / 24);
    const aspect = clamp(source.width, 1, 8192) / clamp(source.height, 1, 8192);
    const cursorSize = CURSOR_SIZE * clamp(tuning.spread, 0.2, 4);
    const momentum = tideMomentumGain(source.loudness ?? 0.5, tuning.soundReactive);
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

            const gain = strength * clamp(0.4 + intensity * 0.7, 0, 2) * momentum * dt * TIDE_SPLAT_FORCE;
            // 有效速度 = 自移动速度 + 自报方向推力：交界向量是静止的，力的方向完全来自滚动方向；
            // 文字锚点不带方向推力，公式与原来一致（只剩自移动）。
            const velocityX = anchor.vx + (anchor.pushX ?? 0) * TIDE_ANCHOR_PUSH_SPEED;
            const velocityY = anchor.vy + (anchor.pushY ?? 0) * TIDE_ANCHOR_PUSH_SPEED;

            push({
                // 屏幕坐标：流体按 uv 采样，这里直接放字的屏幕位置，水花就长在字底下。
                u: clamp(anchor.x, 0, 1),
                v: clamp(anchor.y, 0, 1),
                forceX: velocityX * aspect * gain,
                // Anchors are measured in the fluid's own frame: v counts up from the bottom.
                forceY: velocityY * gain,
                ink: INK_RATE * strength * clamp(intensity, 0.2, 2),
                // 半径只由设置决定：以前跟着「速度」变大，会让每一次推的落点尺寸逐帧跳
                // （脉冲式推力下更是每喷一下就弹一下），那本身就是一处抖动。
                radius: tideSplatRadius(cursorSize, source.height),
            });
        }
    }

    return splats;
};
