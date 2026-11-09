import { describe, expect, it } from 'vitest';
import type { DrumHits } from '@/services/analysis/drumHits';
import { findLastFlash, flashEnvelope } from '@/components/visualizer/tempera/temperaInkFlash';

// test/unit/visualizer/temperaInkFlash.test.ts
// Locks how 墨染奥行's ink picks the flash for a moment and how bright that flash is: each frame
// is a function of the time alone, so a seek or a pause shows the same ink.
const hits = (times: number[]): DrumHits => ({
    times: Float64Array.from(times),
    strengths: new Float32Array(times.length).fill(1),
    kinds: new Uint8Array(times.length),
});

describe('墨染奥行 flash lookup', () => {
    // Hits 1 and 3 are the flashing ones (say the others are hats or too weak).
    const track = hits([0.5, 1, 1.5, 2, 2.5]);
    const indices = Int32Array.from([1, 3]);

    it('is -1 before the first flashing hit', () => {
        expect(findLastFlash(track, indices, 0)).toBe(-1);
        expect(findLastFlash(track, indices, 0.99)).toBe(-1);
    });

    it('lands on a hit at its own time and holds it until the next', () => {
        expect(findLastFlash(track, indices, 1)).toBe(0);
        expect(findLastFlash(track, indices, 1.99)).toBe(0);
        expect(findLastFlash(track, indices, 2)).toBe(1);
        expect(findLastFlash(track, indices, 60)).toBe(1);
    });

    it('is -1 with no flashing hits at all', () => {
        expect(findLastFlash(track, new Int32Array(0), 2)).toBe(-1);
    });
});

describe('墨染奥行 flash envelope', () => {
    it('is dark before the hit, rises fast, holds, then falls away', () => {
        expect(flashEnvelope(-0.01)).toBe(0);
        expect(flashEnvelope(0)).toBe(0);
        expect(flashEnvelope(0.0075)).toBeCloseTo(0.5);
        expect(flashEnvelope(0.015)).toBe(1);
        expect(flashEnvelope(0.17)).toBe(1);
        expect(flashEnvelope(0.3)).toBeLessThan(0.5);
        expect(flashEnvelope(0.6)).toBeLessThan(0.01);
    });

    it('never rises again once it falls', () => {
        let previous = 1;
        for (let age = 0.2; age < 1; age += 0.01) {
            const value = flashEnvelope(age);
            expect(value).toBeLessThanOrEqual(previous);
            previous = value;
        }
    });
});
