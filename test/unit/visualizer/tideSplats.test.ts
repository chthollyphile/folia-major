import { describe, expect, it } from 'vitest';
import { DEFAULT_TIDE_BACKGROUND_TUNING, type TideBackgroundTuning } from '@/types';
import {
    TIDE_ANCHOR_PUSH_SPEED,
    TIDE_MAX_SPLATS,
    TIDE_SPLAT_FORCE,
    buildTideSplats,
    glideTideAnchors,
    tideMomentumGain,
    tideSplatRadius,
    type TideSplatSource,
} from '@/components/visualizer/backgrounds/tide/tideSplats';
import type { TideAnchorSample } from '@/components/visualizer/backgrounds/tide/LyricAnchorSampler';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// test/unit/visualizer/tideSplats.test.ts
// The splat list is the only thing the fluid actually reacts to, so the mapping is pinned here:
// one vector per lyric cluster (measured in stage heights per second, times SPLAT_FORCE), ink as a
// rate per second so the glow accumulates smoothly, and the reference's radius scale.

const tuning = (patch: Partial<TideBackgroundTuning> = {}): TideBackgroundTuning => ({
    ...DEFAULT_TIDE_BACKGROUND_TUNING,
    ...patch,
});

const source = (patch: Partial<TideSplatSource> = {}): TideSplatSource => ({
    anchors: [],
    tuning: tuning(),
    time: 0,
    width: 1600,
    height: 900,
    dt: 1 / 60,
    anchorFade: 1,
    ...patch,
});

const anchor = (patch: Partial<TideAnchorSample> = {}): TideAnchorSample => ({
    key: 'dom:0',
    x: 0.5,
    y: 0.5,
    vx: 0,
    vy: 0,
    strength: 1,
    ...patch,
});

describe('tide splats', () => {
    it('turns one lyric cluster into one force vector scaled by SPLAT_FORCE', () => {
        const splats = buildTideSplats(source({ anchors: [anchor({ x: 0.4, y: 0.6, vx: 0.2, vy: 0.3 })] }));
        expect(splats).toHaveLength(1);

        const [splat] = splats;
        const gain = 1 * (0.4 + DEFAULT_TIDE_BACKGROUND_TUNING.intensity * 0.7) * (1 / 60) * TIDE_SPLAT_FORCE;
        expect(splat.u).toBeCloseTo(0.4, 5);
        expect(splat.v).toBeCloseTo(0.6, 5);
        expect(splat.forceX).toBeCloseTo(0.2 * (1600 / 900) * gain, 5);
        expect(splat.forceY).toBeCloseTo(0.3 * gain, 5);
        expect(splat.ink).toBeCloseTo(1.2 * clamp(DEFAULT_TIDE_BACKGROUND_TUNING.intensity, 0.2, 2), 5);
        // 半径只由 spread 决定（不再跟着速度变）。
        expect(splat.radius).toBeCloseTo(
            tideSplatRadius(70 * DEFAULT_TIDE_BACKGROUND_TUNING.spread, 900),
            8,
        );
    });

    it('leaves the water alone when lyrics are not followed', () => {
        const splats = buildTideSplats(source({
            anchors: [anchor({ vx: 0.4, vy: 0.4 })],
            tuning: tuning({ followLyrics: false }),
        }));
        expect(splats).toEqual([]);
    });

    it('drives a stationary emitter along its self-reported direction (the handover vector)', () => {
        const gain = 1 * (0.4 + DEFAULT_TIDE_BACKGROUND_TUNING.intensity * 0.7) * (1 / 60) * TIDE_SPLAT_FORCE;

        // 静止且没有方向推力的锚点：只留下染料，不推水。
        const still = buildTideSplats(source({ anchors: [anchor()] }))[0];
        expect(still.forceX).toBe(0);
        expect(still.forceY).toBe(0);

        // 静止但有方向（流体坐标 y 向上，-1 就是向下推）：力完全来自自报方向。
        const outward = buildTideSplats(source({ anchors: [anchor({ pushX: 0, pushY: -1 })] }))[0];
        expect(outward.forceX).toBe(0);
        expect(outward.forceY).toBeCloseTo(-TIDE_ANCHOR_PUSH_SPEED * gain, 5);
        // 半径不再跟速度走：静点与喷点的落点尺寸一致。
        expect(outward.radius).toBeCloseTo(still.radius, 8);

        // 横向推力走 aspect：x 方向被换算进流体的横向尺度。
        const sideways = buildTideSplats(source({ anchors: [anchor({ pushX: 1, pushY: 0 })] }))[0];
        expect(sideways.forceX).toBeCloseTo(TIDE_ANCHOR_PUSH_SPEED * (1600 / 900) * gain, 5);
        expect(sideways.forceY).toBe(0);
    });

    it('never pops word by word: a fast word still yields exactly one splat', () => {
        const splats = buildTideSplats(source({ anchors: [anchor({ vx: 0.6, vy: 0.6 })] }));
        expect(splats).toHaveLength(1);
        // Ink is a rate per second, so two frames in a row cannot double the glow.
        const next = buildTideSplats(source({ anchors: [anchor({ vx: 0.6, vy: 0.6 })], dt: 1 / 30 }));
        expect(next[0].ink).toBeCloseTo(splats[0].ink, 8);
    });

    it('keeps the splat list inside the budget', () => {
        const anchors = Array.from({ length: 8 }, (unused, index) => anchor({
            key: `dom:${index}`,
            x: 0.1 + index * 0.05,
            vx: 0.8,
            vy: 0.8,
        }));
        const splats = buildTideSplats(source({ anchors }));
        expect(splats.length).toBeLessThanOrEqual(TIDE_MAX_SPLATS);
    });

    it('scales jitter with the spread tuning and keeps the fade honest', () => {
        const wide = buildTideSplats(source({ anchors: [anchor()], tuning: tuning({ spread: 2 }) }));
        const tight = buildTideSplats(source({ anchors: [anchor()], tuning: tuning({ spread: 0.5 }) }));
        expect(wide[0].radius).toBeGreaterThan(tight[0].radius);

        const faded = buildTideSplats(source({ anchors: [anchor({ vy: 0.3 })], anchorFade: 0.5 }));
        expect(faded[0].forceY).toBeCloseTo(buildTideSplats(source({
            anchors: [anchor({ vy: 0.3 })],
        }))[0].forceY / 2, 5);
    });

    it('converts pixel sizes into the reference falloff radius', () => {
        expect(tideSplatRadius(90, 900)).toBeCloseTo(Math.pow(0.1, 2) * 0.35, 8);
        // Both extremes are clamped so a bad caller cannot blow the falloff up.
        expect(tideSplatRadius(10_000, 900)).toBeCloseTo(tideSplatRadius(900, 900), 8);
        expect(tideSplatRadius(1, 900)).toBeCloseTo(tideSplatRadius(4, 900), 8);
        expect(tideSplatRadius(40, 0)).toBeCloseTo(tideSplatRadius(40, 1), 8);
    });
});

describe('tide anchor glide', () => {
    const STEP = 1 / 60;

    const chase = (frames: number, target: TideAnchorSample, start: TideAnchorSample): TideAnchorSample => {
        let current = [start];
        for (let frame = 0; frame < frames; frame += 1) {
            current = glideTideAnchors(current, [target], STEP, 0.5);
        }
        return current[0];
    };

    /** 逐帧跑一遍，回报「速度峰值」和「单帧速度最大变化」——后者就是抽搐的度量。 */
    const motion = (
        target: TideAnchorSample,
        start: TideAnchorSample,
        everyFrames: number,
    ): { peak: number; first: number; worstStep: number; final: TideAnchorSample } => {
        let current = [start];
        let peak = 0;
        let first = 0;
        let previous = 0;
        let worstStep = 0;

        for (let frame = 0; frame < 150; frame += 1) {
            const feed = frame % everyFrames === 0 ? [target] : current;
            current = glideTideAnchors(current, feed, STEP, 0.5);
            const speed = Math.hypot(current[0].vx, current[0].vy);
            if (frame === 0) {
                first = speed;
            }
            peak = Math.max(peak, speed);
            worstStep = Math.max(worstStep, Math.abs(speed - previous));
            previous = speed;
        }

        return { peak, first, worstStep, final: current[0] };
    };

    it('slides toward the newest sample instead of jumping straight to it', () => {
        const glided = glideTideAnchors([anchor({ x: 0, y: 1 })], [anchor({ x: 1, y: 0 })], STEP, 0.5);

        expect(glided).toHaveLength(1);
        // 采样被限流之后，两次采样之间水面的位置仍然每一帧都在变。
        expect(glided[0].x).toBeGreaterThan(0);
        expect(glided[0].x).toBeLessThan(0.05);
        expect(glided[0].y).toBeLessThan(1);
        expect(chase(300, anchor({ x: 1 }), anchor({ x: 0 })).x).toBeCloseTo(1, 3);
    });

    it('snaps the position but never pops the strength when smoothing is zero', () => {
        const glided = glideTideAnchors([anchor({ x: 0, strength: 0 })], [anchor({ x: 0.75, strength: 0.5 })], STEP, 0);

        expect(glided[0].x).toBe(0.75);
        // 强度仍走最短淡入：新字不会“啪”一下出现。
        expect(glided[0].strength).toBeGreaterThan(0);
        expect(glided[0].strength).toBeLessThan(0.5);
    });

    it('grows a brand new anchor from a fraction of its strength', () => {
        const glided = glideTideAnchors([], [anchor({ strength: 1 })], STEP, 0.5);

        expect(glided).toHaveLength(1);
        expect(glided[0].strength).toBeGreaterThan(0);
        expect(glided[0].strength).toBeLessThan(1);
        // 新锚点从静止开始，没有出生冲量。
        expect(glided[0].vx).toBe(0);
        expect(glided[0].vy).toBe(0);
    });

    it('eases the self-reported momentum instead of snapping it at the sample boundary', () => {
        const target = anchor({ pushX: 0.6, pushY: 0 });
        const start = anchor({ pushX: 0, pushY: 0 });
        const first = glideTideAnchors([start], [target], STEP, 0.5);

        // 一帧只走一小段：采样到的瞬间不会直接跳到目标值 —— 那正是每 0.18s 跳一下的抽搐来源。
        expect(first[0].pushX).toBeGreaterThan(0);
        expect(first[0].pushX).toBeLessThan(0.1);
        // 跑一会儿后跟上目标。
        expect(chase(120, target, start).pushX).toBeCloseTo(0.6, 3);
    });

    it('ramps a brand new anchor push from zero (no birth kick)', () => {
        const glided = glideTideAnchors([], [anchor({ pushX: 0.5, pushY: 0.5 })], STEP, 0.5);

        expect(glided[0].pushX).toBeGreaterThan(0);
        expect(glided[0].pushX).toBeLessThan(0.5);
        expect(glided[0].pushY).toBeLessThan(0.5);
    });

    it('eases a vanishing anchor out and drops it once it is faint', () => {
        const fading = glideTideAnchors([anchor({ strength: 0.1 })], [], STEP, 0.5);

        expect(fading).toHaveLength(1);
        expect(fading[0].strength).toBeLessThan(0.1);
        expect(glideTideAnchors([anchor({ strength: 0.02 })], [], STEP, 0.5)).toEqual([]);
    });

    it('ramps into a jumped target instead of spiking on the first frame', () => {
        const { peak, first, final } = motion(anchor({ x: 0.9, y: 0.9 }), anchor({ x: 0.2, y: 0.5 }), 1);

        expect(final.x).toBeCloseTo(0.9, 3);
        // 一阶滞后会第一帧就打到峰值；二阶滤波是爬上去的。
        expect(first).toBeGreaterThan(0);
        expect(first).toBeLessThan(peak * 0.5);
    });

    it('keeps the push smooth no matter how often the sample lands', () => {
        const target = anchor({ x: 0.95, y: 0.2 });
        const start = anchor({ x: 0.1, y: 0.5 });

        // 老实现是「位移差 / dt」：采样越密，噪声越大、单帧跳变越狠。
        expect(motion(target, start, 1).worstStep).toBeLessThan(0.5);
        expect(motion(target, start, 6).worstStep).toBeLessThan(0.5);
    });
});

describe('tide splash placement', () => {
    it('places the splash at the glyph screen position, so the camera never moves it', () => {
        const splats = buildTideSplats(source({ anchors: [anchor({ x: 0.4, y: 0.5 })] }));

        expect(splats[0].u).toBeCloseTo(0.4, 6);
        expect(splats[0].v).toBeCloseTo(0.5, 6);
    });

    it('clamps the splash inside the fluid', () => {
        const splats = buildTideSplats(source({ anchors: [anchor({ x: 1.2, y: -0.1 })] }));

        expect(splats[0].u).toBe(1);
        expect(splats[0].v).toBe(0);
    });
});

describe('tide loudness momentum', () => {
    const force = (patch: Partial<TideSplatSource> = {}): number =>
        buildTideSplats(source({ anchors: [anchor({ vx: 0.3, vy: 0.3 })], ...patch }))[0].forceY;

    it('pushes harder the louder the music is, with 0.5 as the neutral point', () => {
        const quiet = force({ loudness: 0 });
        const neutral = force({ loudness: 0.5 });
        const loud = force({ loudness: 1 });

        expect(tideMomentumGain(0.5, 1)).toBeCloseTo(1, 8);
        expect(quiet).toBeLessThan(neutral);
        expect(neutral).toBeLessThan(loud);
        // 期望值必须跟随默认配置读，不能写死 1：soundReactive 本身就是响度动量的倍率。
        const soundReactive = DEFAULT_TIDE_BACKGROUND_TUNING.soundReactive;
        expect(loud / quiet).toBeCloseTo(
            tideMomentumGain(1, soundReactive) / tideMomentumGain(0, soundReactive), 6,
        );
        // 缺省即中性：没有响度可用的调用方数值不变。
        expect(force()).toBeCloseTo(neutral, 8);
    });

    it('leaves the push alone when the sound layer is off', () => {
        expect(tideMomentumGain(1, 0)).toBe(1);
        expect(tideMomentumGain(0, 0)).toBe(1);
        expect(force({ loudness: 1, tuning: tuning({ soundReactive: 0 }) }))
            .toBeCloseTo(force({ loudness: 0, tuning: tuning({ soundReactive: 0 }) }), 8);
    });
});
