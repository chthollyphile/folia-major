import { describe, expect, it } from 'vitest';
import { resolveHoldSettle } from '../../../src/components/visualizer/diorama/cameraPath';

// A line that is still being sung, and any ordinary breath between lines, must be untouched - the
// frozen end-of-move pose is still the tail of a real move there. The threshold is the parser's own:
// attachInterludes calls any gap over 3s an interlude, so a hold that outlasts 3s is exactly a hold
// the lyric file itself calls a gap.
describe('resolveHoldSettle', () => {
    it('leaves a live line and an ordinary gap fully composed', () => {
        expect(resolveHoldSettle(-3)).toBe(1);
        expect(resolveHoldSettle(0)).toBe(1);
        expect(resolveHoldSettle(2.9)).toBe(1);
    });

    it('releases the composition over a long hold and stays there', () => {
        expect(resolveHoldSettle(5.5)).toBeCloseTo(0.5, 5);
        expect(resolveHoldSettle(8)).toBe(0);
        expect(resolveHoldSettle(600)).toBe(0);
    });

    it('is monotone, so the settle only ever plays as one continuous move', () => {
        let previous = Infinity;
        for (let held = 0; held <= 12; held += 0.1) {
            const value = resolveHoldSettle(held);
            expect(value).toBeLessThanOrEqual(previous + 1e-9);
            previous = value;
        }
    });
});
