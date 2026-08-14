import { describe, expect, it } from 'vitest';
import { prepareWritingGlyph } from '@/components/visualizer/elegy/elegyGeometry';

// test/unit/visualizer/elegyGeometry.test.ts
// Locks Elegy's language-agnostic cleanup, ordering, normalization, and length preparation.
describe('Elegy glyph geometry', () => {
    it('removes tiny fragments and normalizes coordinates by glyph size', () => {
        const glyph = prepareWritingGlyph('任', 100, 50, [
            [[10, 10], [50, 10]],
            [[80, 20], [80.2, 20]],
        ]);

        expect(glyph.width).toBe(1);
        expect(glyph.height).toBe(0.5);
        expect(glyph.strokes).toHaveLength(1);
        expect(glyph.strokes[0].points).toEqual([
            { x: 0.1, y: 0.1 },
            { x: 0.5, y: 0.1 },
        ]);
        expect(glyph.totalLength).toBeCloseTo(0.4);
    });

    it('orders and reverses paths from the nearest virtual pen endpoint', () => {
        const glyph = prepareWritingGlyph('A', 100, 100, [
            [[90, 90], [70, 90]],
            [[30, 10], [10, 10]],
        ]);

        expect(glyph.strokes[0].points[0]).toEqual({ x: 0.1, y: 0.1 });
        expect(glyph.strokes[0].points.at(-1)).toEqual({ x: 0.3, y: 0.1 });
        expect(glyph.strokes[1].points[0]).toEqual({ x: 0.7, y: 0.9 });
        expect(glyph.strokes[1].points.at(-1)).toEqual({ x: 0.9, y: 0.9 });
    });

    it('precomputes cumulative arc lengths after simplification', () => {
        const glyph = prepareWritingGlyph('∫', 100, 100, [
            [[0, 0], [30, 40], [60, 80]],
        ]);
        const stroke = glyph.strokes[0];

        expect(stroke.points).toHaveLength(2);
        expect(Array.from(stroke.cumulativeLengths)).toEqual([0, 1]);
        expect(stroke.length).toBe(1);
        expect(glyph.totalLength).toBe(1);
    });
});
