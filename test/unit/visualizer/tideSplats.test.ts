import { describe, expect, it } from 'vitest';
import { DEFAULT_TIDE_BACKGROUND_TUNING, type TideBackgroundTuning } from '@/types';
import {
    TIDE_MAX_SPLATS,
    TIDE_SPLAT_FORCE,
    buildTideSplats,
    glideTideAnchors,
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
        const speed = Math.hypot(0.2 * (1600 / 900), 0.3);
        expect(splat.ink).toBeCloseTo(1.2 * clamp(DEFAULT_TIDE_BACKGROUND_TUNING.intensity, 0.2, 2), 5);
        expect(splat.radius).toBeCloseTo(
            tideSplatRadius(70 * DEFAULT_TIDE_BACKGROUND_TUNING.spread * (1 + Math.min(1, speed) * 0.6), 900),
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
    const alphaFor = (smoothing: number, dt = STEP): number =>
        1 - Math.exp(-clamp(dt, 1 / 240, 1 / 24) / (0.04 + clamp(smoothing, 0, 0.92) * 0.4));

    it('slides toward the newest sample instead of jumping straight to it', () => {
        const alpha = alphaFor(0.5);
        const glided = glideTideAnchors(
            [anchor({ x: 0, y: 1, strength: 1 })],
            [anchor({ x: 1, y: 0, strength: 0.4 })],
            STEP,
            0.5,
        );

        expect(glided).toHaveLength(1);
        expect(glided[0].x).toBeCloseTo(alpha, 6);
        expect(glided[0].y).toBeCloseTo(1 - alpha, 6);
        expect(glided[0].strength).toBeCloseTo(1 - 0.6 * alpha, 6);
        // 采样被限流之后，两次采样之间水面的位置仍然每一帧都在变。
        expect(glided[0].x).toBeGreaterThan(0);
        expect(glided[0].x).toBeLessThan(1);
    });

    it('snaps to the sample when smoothing is turned to zero', () => {
        const glided = glideTideAnchors([anchor({ x: 0 })], [anchor({ x: 0.75, strength: 0.5 })], STEP, 0);
        expect(glided[0].x).toBe(0.75);
        expect(glided[0].strength).toBe(0.5);
    });

    it('grows a brand new anchor from a fraction of its strength', () => {
        const glided = glideTideAnchors([], [anchor({ strength: 1 })], STEP, 0.5);
        expect(glided).toHaveLength(1);
        expect(glided[0].strength).toBeCloseTo(alphaFor(0.5), 6);
        expect(glided[0].strength).toBeLessThan(1);
    });

    it('eases a vanishing anchor out and drops it once it is faint', () => {
        const fading = glideTideAnchors([anchor({ strength: 0.1 })], [], STEP, 0.5);
        expect(fading).toHaveLength(1);
        expect(fading[0].strength).toBeCloseTo(0.1 * (1 - alphaFor(0.5)), 6);

        expect(glideTideAnchors([anchor({ strength: 0.02 })], [], STEP, 0.5)).toEqual([]);
    });

    it('glides velocity faster than position so pushes stay smooth', () => {
        const alpha = alphaFor(0.5);
        const velocityAlpha = Math.min(1, alpha * 1.6);
        const glided = glideTideAnchors([anchor({ vx: 0 })], [anchor({ vx: 1 })], STEP, 0.5);
        expect(glided[0].vx).toBeCloseTo(velocityAlpha, 6);
        expect(glided[0].vx).toBeGreaterThan(alpha);
    });
});

describe('tide camera compensation', () => {
    it('moves the splash so it still lands under its glyph once the camera has moved', () => {
        const splats = buildTideSplats(source({
            anchors: [anchor({ x: 0.4, y: 0.5 })],
            camera: { x: 0.1, y: -0.05 },
        }));

        expect(splats[0].u).toBeCloseTo(0.5, 6);
        expect(splats[0].v).toBeCloseTo(0.45, 6);
    });

    it('clamps the compensated splash inside the fluid', () => {
        const splats = buildTideSplats(source({
            anchors: [anchor({ x: 0.98, y: 0.02 })],
            camera: { x: 0.2, y: -0.2 },
        }));

        expect(splats[0].u).toBe(1);
        expect(splats[0].v).toBe(0);
    });
});
