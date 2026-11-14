import { describe, expect, it } from 'vitest';
import { createExternalClock, EXTERNAL_MAX_EXTRAPOLATION_SEC } from '../../../src/services/onlineMusic/externalClock';

// Coarse SDK samples must not rewind the lyric timeline across buffering or pause/resume, and a song
// that starts again after a pause must go on at once rather than standing until an answer arrives.
describe('external playback clock', () => {
    it('goes on at once from the spot a paused song was stopped on', () => {
        // The line used to stand on that spot until the player's own answers came up to it, which is
        // the stall a listener met on every press of play after a pause. It runs on from the spot it is
        // showing from the first frame instead, and the answers that follow only bend its speed.
        const clock = createExternalClock();
        clock.sync({ positionSec: 10, paused: false, nowMs: 0, durationSec: 200 });
        expect(clock.read(700)).toBeCloseTo(10.7);
        clock.sync({ positionSec: 10, paused: true, nowMs: 700, holdBackward: true });
        expect(clock.read(2000)).toBeCloseTo(10.7);
        clock.sync({ positionSec: 10, paused: false, nowMs: 2000, holdBackward: true });
        expect(clock.read(2300), 'goes on from where it stood').toBeGreaterThan(10.7);
        expect(clock.read(2300), 'and never runs past what a player behind it allows').toBeLessThan(11);
        expect(clock.read(2800)).toBeGreaterThan(clock.read(2300));
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
            // Repeated identical answers no longer hold the line on the spot they name: it runs on
            // until the extrapolation it is given runs out, and stops there rather than drifting.
            expect(clock.read(now)).toBeLessThanOrEqual(10 + EXTERNAL_MAX_EXTRAPOLATION_SEC);
            previous = clock.read(now);
        }
    });
    it('keeps moving between repeated raw samples despite varying RPC compensation', () => {
        const clock = createExternalClock();
        clock.sync({ positionSec: 10.1, samplePositionSec: 10, paused: false, nowMs: 0 });
        clock.sync({ positionSec: 10.2, samplePositionSec: 10, paused: false, nowMs: 500, holdBackward: true });
        expect(clock.read(750)).toBeCloseTo(10.85);
        // The line runs on under the three seconds it is given rather than the one it used to have.
        expect(clock.read(1500)).toBeCloseTo(11.6);
        clock.sync({ positionSec: 10.3, samplePositionSec: 10, paused: false, nowMs: 2000, holdBackward: true });
        expect(clock.read(3000)).toBeCloseTo(13.1);
        // A length that is shorter than the spot the line has reached does not step it back: the line is
        // capped at the length, and an answer arriving at exactly that length leaves it where it stands.
        clock.sync({ positionSec: 10.3, samplePositionSec: 10, paused: false, nowMs: 3000, durationSec: 10.8, holdBackward: true });
        expect(clock.read(3000)).toBeCloseTo(10.8, 5);
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
