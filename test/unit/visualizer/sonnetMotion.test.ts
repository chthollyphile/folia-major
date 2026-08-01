import { describe, expect, it } from 'vitest';
import {
    resolveCubicBezier,
    resolveSegmentProgress,
    resolveSonnetFocusWeights,
    resolveShotMotionFrame,
    resolveShotPathProgress,
} from '@/components/visualizer/sonnet/sonnetMotion';

// test/unit/visualizer/sonnetMotion.test.ts
// Keeps Sonnet shot movement deliberate, template-specific, and seek deterministic.
describe('Sonnet shot motion', () => {
    it('uses bounded CSS-style cubic-bezier timing', () => {
        expect(resolveCubicBezier(0.65, 0, 0.35, 1, 0)).toBe(0);
        expect(resolveCubicBezier(0.65, 0, 0.35, 1, 1)).toBe(1);
        expect(resolveCubicBezier(0.22, 1, 0.36, 1, 0.2)).toBeGreaterThan(0.2);
        expect(resolveSegmentProgress(0, 1, 0.2)).toBeLessThan(0.2);
        expect(resolveSegmentProgress(0, 1, 0.8)).toBeGreaterThan(0.8);
    });

    it('moves tracking shots across a meaningful portion of the frame', () => {
        const start = resolveShotMotionFrame('tracking-ribbon', 0);
        const end = resolveShotMotionFrame('tracking-ribbon', 1);

        expect(end.x - start.x).toBeGreaterThan(0.25);
        expect(Math.abs(end.y - start.y)).toBeGreaterThan(0.08);
        expect(end.scale).toBeGreaterThan(start.scale);
    });

    it('keeps quiet shots restrained while still moving visibly', () => {
        const start = resolveShotMotionFrame('quiet-tableau', 0);
        const end = resolveShotMotionFrame('quiet-tableau', 1);

        expect(end.x - start.x).toBeGreaterThan(0.03);
        expect(end.x - start.x).toBeLessThan(0.05);
        expect(end.scale - start.scale).toBeLessThan(0.04);
    });

    it('returns the same frame for the same absolute progress', () => {
        expect(resolveShotMotionFrame('fragment-collage', 0.43))
            .toEqual(resolveShotMotionFrame('fragment-collage', 0.43));
    });

    it('holds editorial composition between its entrance and exit beats', () => {
        expect(resolveShotPathProgress('editorial-column', 0.3)).toBe(0.3);
        expect(resolveShotPathProgress('editorial-column', 0.65)).toBe(0.3);
        expect(resolveShotPathProgress('tracking-ribbon', 0.65))
            .toBeGreaterThan(resolveShotPathProgress('tracking-ribbon', 0.3));
    });

    it('keeps camera focus normalized through lyric gaps and after the final glyph', () => {
        const ranges = [
            { startTime: 1, endTime: 2 },
            { startTime: 4, endTime: 5 },
        ];
        const middleGap = resolveSonnetFocusWeights(ranges, 3);
        const finalTail = resolveSonnetFocusWeights(ranges, 12);

        expect(middleGap[0]).toBeCloseTo(0.5, 5);
        expect(middleGap[1]).toBeCloseTo(0.5, 5);
        expect(finalTail.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 10);
        expect(finalTail[1]).toBeGreaterThan(0.999);
    });
});
