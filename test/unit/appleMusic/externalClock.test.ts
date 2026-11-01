import { describe, expect, it } from 'vitest';
import { createExternalClock } from '../../../src/services/onlineMusic/externalClock';

// Coarse SDK samples must not rewind the lyric timeline across buffering or pause/resume.
describe('external playback clock', () => {
    it('holds a slightly late pause and resume sample until actual progress catches up', () => {
        const clock = createExternalClock();
        clock.sync({ positionSec: 10, paused: false, nowMs: 0, durationSec: 200 });
        expect(clock.read(700)).toBeCloseTo(10.7);
        clock.sync({ positionSec: 10, paused: true, nowMs: 700, holdBackward: true });
        expect(clock.read(2000)).toBeCloseTo(10.7);
        clock.sync({ positionSec: 10, paused: false, nowMs: 2000, holdBackward: true });
        expect(clock.read(2300)).toBeCloseTo(10.7);
        expect(clock.read(2800)).toBeCloseTo(10.8);
    });
    it('does not accumulate drift when unchanged coarse samples arrive repeatedly', () => {
        const clock = createExternalClock();
        clock.sync({ positionSec: 10, paused: false, nowMs: 0 });
        let previous = 10;
        for (let now = 500; now <= 10000; now += 500) {
            const before = clock.read(now);
            clock.sync({ positionSec: 10, paused: false, nowMs: now, holdBackward: true });
            expect(clock.read(now)).toBeGreaterThanOrEqual(before);
            expect(clock.read(now)).toBeGreaterThanOrEqual(previous);
            expect(clock.read(now)).toBeLessThanOrEqual(11);
            previous = clock.read(now);
        }
    });
    it('keeps moving between repeated raw samples despite varying RPC compensation', () => {
        const clock = createExternalClock();
        clock.sync({ positionSec: 10.1, samplePositionSec: 10, paused: false, nowMs: 0 });
        clock.sync({ positionSec: 10.2, samplePositionSec: 10, paused: false, nowMs: 500, holdBackward: true });
        expect(clock.read(750)).toBeCloseTo(10.85);
        expect(clock.read(1500)).toBeCloseTo(11.1);
        clock.sync({ positionSec: 10.3, samplePositionSec: 10, paused: false, nowMs: 2000, holdBackward: true });
        expect(clock.read(3000)).toBeCloseTo(11.1);
        clock.sync({ positionSec: 10.3, samplePositionSec: 10, paused: false, nowMs: 3000, durationSec: 10.8, holdBackward: true });
        expect(clock.read(3000)).toBe(10.8);
        clock.sync({ positionSec: 10, paused: false, nowMs: 4000, holdBackward: false });
        expect(clock.read(4000)).toBe(10);
    });
    it('accepts explicit backward seeks and duration corrections', () => {
        const clock = createExternalClock();
        clock.sync({ positionSec: 10, paused: false, nowMs: 0, durationSec: 200 });
        clock.sync({ positionSec: 9.8, paused: true, nowMs: 500, holdBackward: false });
        expect(clock.read(500)).toBe(9.8);
        clock.sync({ positionSec: 9.7, paused: true, nowMs: 600, durationSec: 9.7, holdBackward: true });
        expect(clock.read(600)).toBe(9.7);
    });
});
