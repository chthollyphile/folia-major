import { describe, expect, it } from 'vitest';
import { MAX_EXTRAPOLATION_SEC, MAX_HELD_LAG_SEC, createHifiClock } from '@/services/hifi/hifiClock';

// test/unit/hifi/hifiClock.test.ts
// The extrapolated HiFi position: it moves on between mpv's ticks while playing, holds while paused,
// never runs more than MAX_EXTRAPOLATION_SEC past the last sync, and never leaves [0, duration].

describe('createHifiClock', () => {
    it('starts at zero, paused, with no duration', () => {
        const clock = createHifiClock();
        expect(clock.read(1000)).toBe(0);
        expect(clock.state()).toEqual({ baseSec: 0, startedAtMs: null, paused: true, durationSec: null, floorSec: null });
    });

    it('extrapolates from the last sync while playing', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: 10, paused: false, durationSec: 200, nowMs: 1000 });
        expect(clock.read(1000)).toBe(10);
        expect(clock.read(1750)).toBeCloseTo(10.75);
        expect(clock.state()).toEqual({ baseSec: 10, startedAtMs: 1000, paused: false, durationSec: 200, floorSec: null });
    });

    it('holds the position while paused', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: 42, paused: true, durationSec: 200, nowMs: 1000 });
        expect(clock.read(9000)).toBe(42);
        expect(clock.state().startedAtMs).toBeNull();
    });

    it('clamps to the duration once known, and does not clamp an unknown one', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: 199.5, paused: false, durationSec: 200, nowMs: 0 });
        expect(clock.read(800)).toBe(200);
        clock.sync({ positionSec: 199.5, paused: false, durationSec: null, nowMs: 0 });
        expect(clock.read(800)).toBeCloseTo(200.3);
    });

    it('stops extrapolating one second after the last sync until the next one arrives', () => {
        expect(MAX_EXTRAPOLATION_SEC).toBe(1);
        const clock = createHifiClock();
        clock.sync({ positionSec: 30, paused: false, durationSec: 200, nowMs: 0 });
        expect(clock.read(1000)).toBe(31);
        // mpv is buffering after a seek and no tick has come for three seconds: the position waits.
        expect(clock.read(3000)).toBe(31);
        clock.sync({ positionSec: 30.2, paused: false, nowMs: 3000 });
        expect(clock.read(3250)).toBeCloseTo(30.45);
        expect(clock.read(9000)).toBeCloseTo(31.2);
    });

    it('holds while main reports the buffering pause, then moves on from the resumed position', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: 120, paused: true, durationSec: 200, nowMs: 0 });
        expect(clock.read(2000)).toBe(120);
        clock.sync({ positionSec: 120, paused: false, nowMs: 2000 });
        expect(clock.read(2500)).toBeCloseTo(120.5);
    });

    it('keeps the previous duration when a sync leaves it out', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: 0, paused: true, durationSec: 120, nowMs: 0 });
        clock.sync({ positionSec: 300, paused: true, nowMs: 0 });
        expect(clock.state().durationSec).toBe(120);
        expect(clock.read(0)).toBe(120);
    });

    it('never reads below zero or from a non-finite position', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: -3, paused: true, nowMs: 0 });
        expect(clock.read(0)).toBe(0);
        clock.sync({ positionSec: Number.NaN, paused: false, durationSec: Number.POSITIVE_INFINITY, nowMs: 0 });
        expect(clock.state().durationSec).toBeNull();
        expect(clock.read(500)).toBeCloseTo(0.5);
        // A clock read before the sync time (another frame's timestamp) does not run backwards.
        expect(clock.read(-1000)).toBe(0);
    });

    it('holds instead of stepping back when a playing tick lands behind what is already shown', () => {
        expect(MAX_HELD_LAG_SEC).toBe(1);
        const clock = createHifiClock();
        clock.sync({ positionSec: 10, paused: false, durationSec: 200, nowMs: 0 });
        expect(clock.read(500)).toBeCloseTo(10.5);
        // The tick sampled at 10.2 s only arrives at 500 ms: the screen stays at 10.5 until mpv catches up.
        clock.sync({ positionSec: 10.2, paused: false, nowMs: 500, holdBackward: true });
        expect(clock.read(500)).toBeCloseTo(10.5);
        expect(clock.read(700)).toBeCloseTo(10.5);
        expect(clock.read(900)).toBeCloseTo(10.6);
        expect(clock.state()).toMatchObject({ baseSec: 10.2, startedAtMs: 500, floorSec: 10.5 });
    });

    it('neither runs ahead nor steps back over a hundred ticks that each arrive 25 ms late', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: 0, paused: false, durationSec: 600, nowMs: 0 });
        let shown = 0;
        for (let i = 1; i <= 100; i += 1) {
            const nowMs = i * 40;
            clock.sync({ positionSec: nowMs / 1000 - 0.025, paused: false, nowMs, holdBackward: true });
            for (const frameMs of [nowMs, nowMs + 16, nowMs + 33]) {
                const read = clock.read(frameMs);
                expect(read).toBeGreaterThanOrEqual(shown);
                shown = read;
            }
        }
        // Real position at 4.033 s is 4.008 s (25 ms behind): the screen sits at most one tick interval ahead of it.
        expect(shown).toBeLessThanOrEqual(4.033 - 0.025 + 0.04 + 1e-9);
    });

    it('follows a real step back: a seek, a pause, a lag over the limit, or a tick after a pause', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: 50, paused: false, durationSec: 200, nowMs: 0 });
        clock.sync({ positionSec: 49.8, paused: false, nowMs: 500 });
        expect(clock.read(500)).toBeCloseTo(49.8);

        clock.sync({ positionSec: 50, paused: false, nowMs: 0 });
        clock.sync({ positionSec: 48, paused: false, nowMs: 900, holdBackward: true });
        expect(clock.read(900)).toBeCloseTo(48);

        clock.sync({ positionSec: 50, paused: false, nowMs: 0 });
        clock.sync({ positionSec: 50.1, paused: true, nowMs: 500, holdBackward: true });
        expect(clock.read(500)).toBeCloseTo(50.1);
        clock.sync({ positionSec: 50, paused: false, nowMs: 600, holdBackward: true });
        expect(clock.read(600)).toBeCloseTo(50);
    });

    it('changes only the duration on setDuration, keeping a held position', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: 10, paused: false, durationSec: 200, nowMs: 0 });
        clock.sync({ positionSec: 10.2, paused: false, nowMs: 500, holdBackward: true });
        clock.setDuration(180);
        expect(clock.state()).toEqual({ baseSec: 10.2, startedAtMs: 500, paused: false, durationSec: 180, floorSec: 10.5 });
        clock.setDuration(Number.NaN);
        expect(clock.state().durationSec).toBeNull();
    });

    it('reads performance.now() when no time is given', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: 5, paused: false, durationSec: 100 });
        const read = clock.read();
        expect(read).toBeGreaterThanOrEqual(5);
        expect(read).toBeLessThan(6);
    });
});
