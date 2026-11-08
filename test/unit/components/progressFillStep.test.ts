import { describe, expect, it } from 'vitest';
import { getProgressFillStep, getProgressFillStepFraction } from '../../../src/components/progressFillStep';

// Covers the quarter-device-pixel stepping that keeps the progress fill from repainting every frame.

describe('progress fill step', () => {
    it('keeps the same step while the edge moves less than a quarter device pixel', () => {
        const width = 480;
        expect(getProgressFillStep(0.5, width)).toBe(getProgressFillStep(0.5 + 0.1 / (width * 4), width));
        expect(getProgressFillStep(0.5 + 1 / (width * 4), width)).toBe(getProgressFillStep(0.5, width)! + 1);
    });

    it('lands exactly on the ends', () => {
        expect(getProgressFillStepFraction(getProgressFillStep(0, 480)!, 480)).toBe(0);
        expect(getProgressFillStepFraction(getProgressFillStep(1, 480)!, 480)).toBe(1);
        expect(getProgressFillStep(1.2, 480)).toBe(480 * 4);
    });

    it('stays within a quarter device pixel of the real edge', () => {
        const width = 517;
        for (let p = 0; p <= 1; p += 0.0137) {
            const drawn = getProgressFillStepFraction(getProgressFillStep(p, width)!, width);
            expect(Math.abs(drawn - p) * width).toBeLessThanOrEqual(0.125 + 1e-9);
        }
    });

    it('returns null until the width is known', () => {
        expect(getProgressFillStep(0.3, 0)).toBeNull();
    });
});
