import { describe, expect, it } from 'vitest';
import {
    createPendoloBeatCounter,
    createPendoloBeatFxState,
    isPendoloBeatFxIdle,
    lightPendoloDials,
    PENDOLO_SPARK_STRIDE,
    PENDOLO_WAVE_SECONDS,
    resolvePendoloBeatFxColor,
    resolvePendoloBeatTriggers,
    resolvePendoloHaloOpacity,
    resolvePendoloWavePunch,
    resolvePendoloLineWave,
    resolvePendoloLitOpacity,
    resolvePendoloPointWave,
    resolvePendoloShake,
    resolvePendoloWave,
    resolvePendoloWaveBump,
    stepPendoloBeatFx,
    type PendoloBeatTriggers,
} from '@/components/visualizer/pendolo/pendoloBeatFx';

// test/unit/visualizer/pendoloBeatFx.test.ts
// 时计's beat effects: what each kind of beat fires, how the effects evolve, and that strengths of 0
// draw nothing.

const FRAME = 1 / 60;
const none: PendoloBeatTriggers = { beats: 0, downbeats: 0, beatGain: 1, downbeatGain: 1, beatAccentGain: 1, downbeatAccentGain: 1 };
const points = [{ x: 10, y: 10, tx: 1, ty: 0 }];
let seed = 1;
const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
};
const context = (now: number) => ({ now, dt: FRAME, beatPeriod: 0.5, meshPoints: points, random });

const run = (state: ReturnType<typeof createPendoloBeatFxState>, from: number, seconds: number, first: PendoloBeatTriggers) => {
    stepPendoloBeatFx(state, first, context(from));
    let now = from;
    for (let t = FRAME; t < seconds; t += FRAME) {
        now += FRAME;
        stepPendoloBeatFx(state, none, context(now));
    }
    return now;
};

describe('Pendolo beat triggers', () => {
    it('counts only what fired since the last read, the first read firing nothing', () => {
        const counter = createPendoloBeatCounter();
        const intensities = { beat: 1, downbeat: 0.5 };
        expect(resolvePendoloBeatTriggers(counter, { beats: 5, downbeats: 2 }, null, null, 1, intensities).beats).toBe(0);
        // The gains are the strengths, whatever the beat's impact; only the shockwave's carries the accent.
        const next = resolvePendoloBeatTriggers(counter, { beats: 7, downbeats: 3 }, { t: 1, rhythmic: true, impact: 0 }, null, 1, intensities);
        expect(next).toMatchObject({ beats: 2, downbeats: 1, beatGain: 1, downbeatGain: 0.5 });
        expect(next.beatAccentGain).toBeCloseTo(0.35);
        expect(next.downbeatAccentGain).toBeCloseTo(0.5);
    });

    it('drops beats the rhythm gate turned off (beat_this + HPSS)', () => {
        const counter = createPendoloBeatCounter();
        const intensities = { beat: 1, downbeat: 1 };
        resolvePendoloBeatTriggers(counter, { beats: 0, downbeats: 0 }, null, null, 1, intensities);
        const off = resolvePendoloBeatTriggers(counter, { beats: 1, downbeats: 1 }, { t: 1, rhythmic: false }, { t: 0.5, rhythmic: false }, 1, intensities);
        expect(off).toMatchObject({ beats: 0, downbeats: 0, beatAccentGain: 0, downbeatAccentGain: 0 });
        const on = resolvePendoloBeatTriggers(counter, { beats: 2, downbeats: 2 }, { t: 2, rhythmic: true }, { t: 1.5 }, 1, intensities);
        expect(on).toMatchObject({ beats: 1, downbeats: 1 });
        // A track opening on a downbeat in a gated bar: no plain beat has fired yet, and nothing fires.
        const opening = createPendoloBeatCounter();
        resolvePendoloBeatTriggers(opening, { beats: 0, downbeats: 0 }, null, null, 1, intensities);
        const first = resolvePendoloBeatTriggers(opening, { beats: 1, downbeats: 1 }, null, { t: 0.42, rhythmic: false, impact: 1 }, 1, intensities);
        expect(first).toMatchObject({ beats: 0, downbeats: 0, beatAccentGain: 0, downbeatAccentGain: 0 });
        // A downbeat after a gated plain beat, in a bar with rhythm, counts as a beat too.
        const into = resolvePendoloBeatTriggers(opening, { beats: 2, downbeats: 2 }, { t: 3, rhythmic: false }, { t: 3.4, rhythmic: true }, 1, intensities);
        expect(into).toMatchObject({ beats: 1, downbeats: 1 });
        expect(into.beatAccentGain).toBeGreaterThan(0);
    });
});

describe('Pendolo beat effects', () => {
    it('sends the shockwave on plain beats and downbeats alike, as strong as the accent', () => {
        const plain = createPendoloBeatFxState();
        stepPendoloBeatFx(plain, { ...none, beats: 1, beatAccentGain: 0.4 }, context(10));
        expect(plain.waveStart).toBe(10);
        expect(plain.waveGain).toBeCloseTo(0.4);
        const down = createPendoloBeatFxState();
        stepPendoloBeatFx(down, { ...none, beats: 1, downbeats: 1, downbeatAccentGain: 0.9 }, context(0));
        expect(down.waveGain).toBeCloseTo(0.9);
        // A beat with no accent gain (gated off, or strength 0) sends none.
        const silent = createPendoloBeatFxState();
        stepPendoloBeatFx(silent, { ...none, beats: 1, beatAccentGain: 0 }, context(0));
        expect(silent.waveStart).toBe(-1);
        expect(resolvePendoloHaloOpacity(silent, 0.1)).toBe(0);
        // The halo holds while it spreads and only fades toward the far corner.
        expect(resolvePendoloHaloOpacity(down, 0.5 * down.waveDuration)).toBeGreaterThan(0.7 * resolvePendoloHaloOpacity(down, 0));
        expect(resolvePendoloHaloOpacity(plain, 10 + plain.waveDuration + 0.01)).toBe(0);
        // Weak beats show faint, strong ones full (the accent read over 30 dB); both cross to the far
        // corner in the same time.
        expect(resolvePendoloHaloOpacity(plain, 10)).toBeCloseTo(0.041, 3);
        expect(resolvePendoloHaloOpacity(down, 0)).toBeCloseTo(0.588, 3);
        expect(resolvePendoloWave(plain, 10 + 0.999 * plain.waveDuration, 200, 2000)!.radius).toBeGreaterThan(0.99 * 2000);
        expect(resolvePendoloWave(down, 0.999 * down.waveDuration, 200, 2000)!.radius).toBeGreaterThan(0.99 * 2000);
        // Slow tracks keep the longest crossing; fast ones a floor.
        const slow = createPendoloBeatFxState();
        stepPendoloBeatFx(slow, { ...none, beats: 1 }, { ...context(0), beatPeriod: 2 });
        expect(slow.waveDuration).toBe(PENDOLO_WAVE_SECONDS);
        const fast = createPendoloBeatFxState();
        stepPendoloBeatFx(fast, { ...none, beats: 1 }, { ...context(0), beatPeriod: 0.2 });
        expect(fast.waveDuration).toBe(0.3);
    });

    it('speeds up as it spreads, and lights each dial once as it passes', () => {
        const state = createPendoloBeatFxState();
        stepPendoloBeatFx(state, { ...none, beats: 1, beatAccentGain: 0.8 }, context(0));
        // Most of a beat (0.5 s here), so it is out past the clock before the next one starts.
        expect(state.waveDuration).toBeCloseTo(0.425);
        const step = state.waveDuration / 10;
        const at = (t: number) => resolvePendoloWave(state, t, 200, 2000)!.radius;
        expect(at(0.9 * state.waveDuration) - at(0.8 * state.waveDuration)).toBeGreaterThan(3 * (at(step) - at(0)));
        // Not yet at the tick dial (1.15 x 200), then past it, then past the outermost (1.4 x 200).
        lightPendoloDials(state, { radius: 200, band: 100, strength: 1 }, 200);
        expect(state.tickDialLight).toBe(0);
        lightPendoloDials(state, { radius: 240, band: 100, strength: 1 }, 200);
        expect(state.tickDialLight).toBeCloseTo(0.3455, 3);
        expect(state.outerDialLight).toBe(0);
        lightPendoloDials(state, { radius: 300, band: 100, strength: 1 }, 200);
        expect(state.outerDialLight).toBeCloseTo(0.3455, 3);
        // Once per wave: fading, it is not lit again.
        state.tickDialLight = 0.1;
        lightPendoloDials(state, { radius: 320, band: 100, strength: 1 }, 200);
        expect(state.tickDialLight).toBe(0.1);
        run(state, 0, 2, none);
        expect(state.tickDialLight).toBe(0);
        expect(state.outerDialLight).toBe(0);
        expect(isPendoloBeatFxIdle(state, 2)).toBe(true);
    });

    it('flares the jewels on every beat as strong as the halo, and shakes only on a downbeat', () => {
        const down = createPendoloBeatFxState();
        stepPendoloBeatFx(down, { ...none, beats: 1, downbeats: 1 }, context(0));
        // Fired, then one frame of decay.
        expect(down.jewelFlare).toBeGreaterThan(0.8);
        const plain = createPendoloBeatFxState();
        stepPendoloBeatFx(plain, { ...none, beats: 1, beatAccentGain: 0.5 }, context(0));
        expect(plain.jewelFlare).toBeGreaterThan(0.06);
        expect(plain.jewelFlare).toBeLessThan(0.071);
        expect(plain.shake).toBe(0);
        const gated = createPendoloBeatFxState();
        stepPendoloBeatFx(gated, { ...none, beats: 1, beatAccentGain: 0 }, context(0));
        expect(gated.jewelFlare).toBe(0);
    });

    it('reads the accent as decibels, the strength scaling what it shows', () => {
        expect(resolvePendoloWavePunch(1, 1)).toBe(1);
        // The weak-beat floor sits 30 dB under the strongest beat.
        expect(resolvePendoloWavePunch(0.35, 1)).toBeCloseTo(10 ** -1.5, 5);
        expect(resolvePendoloWavePunch(0.675, 1)).toBeCloseTo(10 ** -0.75, 5);
        expect(resolvePendoloWavePunch(0.675, 2)).toBeCloseTo(2 * 10 ** -0.75, 5);
        expect(resolvePendoloWavePunch(1, 2)).toBe(1);
        expect(resolvePendoloWavePunch(0, 1)).toBe(0);
        expect(resolvePendoloWavePunch(1, 0)).toBe(0);
        // A wave at strength 2 shows its accent, not twice the accent read as decibels.
        const doubled = createPendoloBeatFxState();
        stepPendoloBeatFx(doubled, { ...none, beats: 1, beatGain: 2, beatAccentGain: 1.35 }, context(0));
        expect(doubled.wavePunch).toBeCloseTo(2 * 10 ** -0.75, 5);
    });

    it('throws sparks on every downbeat, with the shockwave', () => {
        const alive = (state: ReturnType<typeof createPendoloBeatFxState>) => {
            let count = 0;
            for (let at = 4; at < state.sparks.length; at += PENDOLO_SPARK_STRIDE) if (state.sparks[at] > 0) count += 1;
            return count;
        };
        const plain = createPendoloBeatFxState();
        stepPendoloBeatFx(plain, { ...none, beats: 1 }, context(0));
        expect(alive(plain)).toBe(0);
        const strong = createPendoloBeatFxState();
        stepPendoloBeatFx(strong, { ...none, beats: 1, downbeats: 1 }, context(0));
        expect(alive(strong)).toBeGreaterThan(10);
        expect(strong.waveStart).toBe(0);
        run(strong, 0, 1, none);
        expect(alive(strong)).toBe(0);
    });

    it('sends a shockwave across the screen, and shakes on a downbeat', () => {
        const state = createPendoloBeatFxState();
        stepPendoloBeatFx(state, { ...none, beats: 1, downbeats: 1 }, context(0));
        const early = resolvePendoloWave(state, 0.1 * state.waveDuration, 200, 2000)!;
        const late = resolvePendoloWave(state, 0.8 * state.waveDuration, 200, 2000)!;
        expect(late.radius).toBeGreaterThan(early.radius);
        expect(late.strength).toBeLessThan(early.strength);
        expect(resolvePendoloWave(state, state.waveDuration + 0.01, 200, 2000)).toBeNull();
        expect(resolvePendoloWaveBump(early, early.radius - early.band / 2)).toBeCloseTo(1);
        expect(resolvePendoloWaveBump(early, early.radius + 1)).toBe(0);
        expect(Math.abs(resolvePendoloShake(state, random).x)).toBeLessThanOrEqual(8 * 1.5);
        // A point on the clockwork moves out along its radius, as the shader moves a vertex there.
        const crest = late.radius - late.band / 2;
        const moved = resolvePendoloPointWave(0, -crest, late.radius, late.band, late.strength);
        expect(moved.x).toBe(0);
        expect(moved.y).toBeCloseTo(-crest * 0.2 * late.strength);
        expect(resolvePendoloPointWave(0, -crest, late.radius, late.band, 0)).toEqual({ x: 0, y: 0 });
    });

    it('draws nothing with both strengths at 0, and goes idle', () => {
        const state = createPendoloBeatFxState();
        const silent = { ...none, beats: 1, downbeats: 1, beatGain: 0, downbeatGain: 0, beatAccentGain: 0, downbeatAccentGain: 0 };
        stepPendoloBeatFx(state, silent, context(0));
        expect(state.jewelFlare).toBe(0);
        expect(state.waveStart).toBe(-1);
        expect(isPendoloBeatFxIdle(state, 0)).toBe(true);
        expect(resolvePendoloShake(state, random)).toEqual({ x: 0, y: 0 });
    });
});

describe('Pendolo beat effects at rest', () => {
    it('settle to exact zeros after a strong downbeat', () => {
        const state = createPendoloBeatFxState();
        stepPendoloBeatFx(state, { ...none, beats: 1, downbeats: 1 }, context(0));
        let now = 0;
        for (let frame = 0; frame < 60 * 4; frame += 1) {
            now += FRAME;
            stepPendoloBeatFx(state, none, context(now));
        }
        expect(isPendoloBeatFxIdle(state, now)).toBe(true);
        expect(state.jewelFlare).toBe(0);
        expect(state.smallJewelFlare).toBe(0);
        expect(state.shake).toBe(0);
        expect(resolvePendoloShake(state, random)).toEqual({ x: 0, y: 0 });
    });
});

describe('Pendolo shockwave on the lyric lines', () => {
    it('pushes a line outward and lights it only inside the lens', () => {
        expect(resolvePendoloLineWave(300, 0, 0, 0, 0)).toEqual({ x: 0, y: 0, light: 0 });
        // Line text centre at 340 px from the hub, lens crest centred there.
        const inside = resolvePendoloLineWave(300, 0, 340 + 60, 120, 1);
        expect(inside.x).toBeGreaterThan(10);
        expect(inside.y).toBeCloseTo(0);
        expect(inside.light).toBe(1);
        expect(resolvePendoloLineWave(300, 0, 1200, 120, 1)).toEqual({ x: 0, y: 0, light: 0 });
    });

    it('lights a visible line toward full, and keeps a hidden one hidden', () => {
        expect(resolvePendoloLitOpacity(0.4, 0)).toBe(0.4);
        expect(resolvePendoloLitOpacity(0.4, 1)).toBeCloseTo(1);
        expect(resolvePendoloLitOpacity(0, 1)).toBe(0);
    });
});

describe('Pendolo beat effect colour', () => {
    it('lifts the accent to glow and falls back to gold for grey', () => {
        const [r, g, b] = resolvePendoloBeatFxColor('#1E3A5F');
        expect(Math.max(r, g, b)).toBeGreaterThan(180);
        expect(b).toBeGreaterThan(r);
        expect(resolvePendoloBeatFxColor('#9CA3AF')).toEqual([243, 196, 107]);
        expect(resolvePendoloBeatFxColor('not a colour')).toEqual([243, 196, 107]);
    });
});
