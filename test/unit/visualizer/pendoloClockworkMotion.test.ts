import { describe, expect, it } from 'vitest';
import {
    createPendoloClockworkMotionState,
    normalizePendoloBass,
    stepPendoloClockworkMotion,
} from '@/components/visualizer/pendolo/pendoloClockworkMotion';
import { resolvePendoloMotionProfile } from '@/components/visualizer/pendolo/pendoloMotionProfile';
import { resolvePendoloClockworkAnchors } from '@/components/visualizer/pendolo/pendoloClockworkScene';
import { buildPendoloClockworkCachedScene } from '@/components/visualizer/pendolo/pendoloClockworkMeshes';
import golden from './fixtures/pendoloClockworkMotion.golden.json';

// test/unit/visualizer/pendoloClockworkMotion.test.ts

describe('Pendolo clockwork motion', () => {
    it('normalizes byte-scale and unit-scale bass into 0..1', () => {
        expect(normalizePendoloBass(0.4)).toBeCloseTo(0.4);
        expect(normalizePendoloBass(128)).toBeCloseTo(128 / 255);
        expect(normalizePendoloBass(-1)).toBe(0);
        expect(normalizePendoloBass(300)).toBe(1);
    });

    it('advances phase while playing and freezes while paused', () => {
        const profile = resolvePendoloMotionProfile('normal');
        const playing = createPendoloClockworkMotionState();
        const paused = createPendoloClockworkMotionState();

        const played = stepPendoloClockworkMotion(playing, 0.1, 0.5, false, profile);
        stepPendoloClockworkMotion(paused, 0.1, 0.5, true, profile);

        expect(played.phase).toBeGreaterThan(0);
        expect(paused.phase).toBe(0);
        expect(paused.secondGearAngle).toBe(0);
    });

    it('steps the seconds gear toward discrete tooth targets over time', () => {
        const profile = resolvePendoloMotionProfile('normal');
        const state = createPendoloClockworkMotionState();

        for (let i = 0; i < 40; i++) {
            stepPendoloClockworkMotion(state, 0.05, 0.3, false, profile);
        }

        expect(state.secondGearStep).toBeGreaterThanOrEqual(1);
        expect(state.secondGearAngle).toBeGreaterThan(0);
    });
});

describe('Pendolo clockwork scene/mesh', () => {
    it('resolves shared gear anchors from layout', () => {
        const anchors = resolvePendoloClockworkAnchors({
            centerX: 100,
            centerY: 200,
            baseRadius: 120,
            lyricRingRadius: 300,
        });
        expect(anchors.balanceCx).toBeCloseTo(100 + 120 * 0.2);
        expect(anchors.balanceCy).toBeCloseTo(200 - 120 * 0.75);
        expect(anchors.coverRadius).toBeCloseTo(120 * 0.88);
        expect(anchors.focalAxisEndRadius).toBeLessThan(300);
    });

    it('builds a non-empty mesh for full decor and empty for none', () => {
        const base = {
            centerX: 400,
            centerY: 300,
            baseRadius: 160,
            lyricRingRadius: 420,
            escapementAngle: 0.2,
            phase: 1.1,
            bassOscillation: 0.05,
            secondGearAngle: 0.3,
            primaryTextColor: '#ffffff',
            accentTextColor: '#ffcc66',
            backgroundColor: '#000000',
            showCenterGradient: true,
            showCover: false,
            coverImage: null,
        };

        const empty = buildPendoloClockworkCachedScene({ ...base, showGearDecor: 'none' });
        expect(empty.parts).toHaveLength(0);
        expect(empty.vertexCount).toBe(0);

        const full = buildPendoloClockworkCachedScene({ ...base, showGearDecor: 'full' });
        expect(full.parts.length).toBeGreaterThan(8);
        expect(full.parts.length).toBeLessThanOrEqual(32);
        expect(full.vertexCount).toBeGreaterThan(1000);
        expect(full.key).toBe(buildPendoloClockworkCachedScene({ ...base, showGearDecor: 'full' }).key);
    });
});

describe('Pendolo clockwork motion with beats (智能动感模式)', () => {
    it('produces exactly the pre-beat outputs without a beat input', () => {
        // Recorded from the function before the beat input existed.
        const out: number[][] = [];
        for (const intensity of ['calm', 'normal', 'chaotic']) {
            const profile = resolvePendoloMotionProfile(intensity);
            const state = createPendoloClockworkMotionState();
            for (let i = 0; i < 400; i++) {
                const dt = [1 / 60, 1 / 120, 0.05, 1 / 30][i % 4];
                const r = stepPendoloClockworkMotion(state, dt, (i * 37) % 256, i % 97 > 90, profile, null);
                out.push([r.bass, r.bassOscillation, r.secondGearAngle, r.phase]);
            }
        }
        // To the last bits rather than bit for bit: the fixture was recorded on macOS arm64, and Math.sin
        // and friends differ in the last place on CI's Linux x64 (seen 1 ulp). 1e-12 relative still
        // catches any change to the motion itself.
        expect(out.length).toBe(golden.length);
        out.forEach((row, index) => row.forEach((value, column) => {
            const want = golden[index][column];
            expect(Math.abs(value - want)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(want)));
        }));
        const off =stepPendoloClockworkMotion(createPendoloClockworkMotionState(), 1 / 60, 0.5, false, resolvePendoloMotionProfile('normal'), null);
        expect(off.transBeatAngle).toBe(0);
    });

    const none = { beats: 0, downbeats: 0, beatGain: 1, downbeatGain: 1 };
    const run = (state: ReturnType<typeof createPendoloClockworkMotionState>, seconds: number, input = none) => {
        const profile = resolvePendoloMotionProfile('normal');
        let result = stepPendoloClockworkMotion(state, 1 / 60, 0.5, false, profile, input);
        for (let t = 1 / 60; t < seconds; t += 1 / 60) result = stepPendoloClockworkMotion(state, 1 / 60, 0.5, false, profile, none);
        return result;
    };

    it('turns the two lower gears a tooth each, against each other, on a beat - not on seconds', () => {
        const state = createPendoloClockworkMotionState();
        const idle = run(state, 2);
        expect(idle.secondGearAngle).toBeCloseTo(0, 6);
        expect(idle.transBeatAngle).toBeCloseTo(0, 6);
        const after = run(state, 1, { ...none, beats: 1 });
        expect(after.secondGearAngle).toBeCloseTo(-Math.PI * 2 / 15, 3);
        expect(after.transBeatAngle).toBeCloseTo(Math.PI * 2 / 24, 3);
    });

    it('jolts: the step overshoots, then settles', () => {
        const state = createPendoloClockworkMotionState();
        const profile = resolvePendoloMotionProfile('normal');
        let peak = 0;
        let result = stepPendoloClockworkMotion(state, 1 / 60, 0.5, false, profile, { ...none, beats: 1 });
        for (let i = 0; i < 30; i += 1) {
            result = stepPendoloClockworkMotion(state, 1 / 60, 0.5, false, profile, none);
            peak = Math.max(peak, result.transBeatAngle);
        }
        // A light jolt: past the tooth, by under about a tenth.
        expect(peak).toBeGreaterThan((Math.PI * 2 / 24) * 1.02);
        expect(peak).toBeLessThan((Math.PI * 2 / 24) * 1.15);
    });

    it('spins both a whole turn, against each other, on a downbeat', () => {
        const state = createPendoloClockworkMotionState();
        const after = run(state, 1.5, { ...none, beats: 1, downbeats: 1 });
        expect(after.transBeatAngle).toBeCloseTo(Math.PI * 2, 2);
        expect(after.secondGearAngle).toBeCloseTo(-Math.PI * 2, 2);
    });

    it('swings the balance to the other side on each beat, further on a stronger one', () => {
        const state = createPendoloClockworkMotionState();
        const first = run(state, 0.5, { ...none, beats: 1, beatGain: 1 });
        const second = run(state, 0.5, { ...none, beats: 1, beatGain: 1 });
        expect(Math.sign(first.bassOscillation)).toBe(-Math.sign(second.bassOscillation));
        const weak = run(createPendoloClockworkMotionState(), 0.5, { ...none, beats: 1, beatGain: 0 });
        expect(Math.abs(weak.bassOscillation)).toBeLessThan(Math.abs(first.bassOscillation));
    });
});
