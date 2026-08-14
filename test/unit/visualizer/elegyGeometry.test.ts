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

    it('merges the straight continuation through a T junction but keeps the branch separate', () => {
        const glyph = prepareWritingGlyph('T', 100, 100, [
            [[10, 50], [50, 50]],
            [[50, 50], [90, 50]],
            [[50, 50], [50, 90]],
        ]);

        expect(glyph.strokes).toHaveLength(2);
        expect(glyph.strokes.map(stroke => stroke.length).sort((a, b) => b - a))
            .toEqual([0.8, 0.4]);
    });

    it('only bridges a small collinear gap when the original glyph mask covers it', () => {
        const paths: Array<Array<[number, number]>> = [
            [[10, 50], [40, 50]],
            [[42, 50], [90, 50]],
        ];
        const disconnectedMask = new Uint8Array(100 * 100);
        for (let x = 10; x <= 40; x += 1) disconnectedMask[50 * 100 + x] = 1;
        for (let x = 42; x <= 90; x += 1) disconnectedMask[50 * 100 + x] = 1;
        const connectedMask = disconnectedMask.slice();
        connectedMask[50 * 100 + 41] = 1;

        expect(prepareWritingGlyph('=', 100, 100, paths, disconnectedMask).strokes).toHaveLength(2);
        expect(prepareWritingGlyph('=', 100, 100, paths, connectedMask).strokes).toHaveLength(1);
    });

    it('does not merge nearby paths whose endpoint tangents form a corner', () => {
        const glyph = prepareWritingGlyph('L', 100, 100, [
            [[10, 10], [50, 10]],
            [[50, 10], [50, 50]],
        ]);

        expect(glyph.strokes).toHaveLength(2);
    });

    it('reconstructs a continuous chain when source fragments use mixed directions', () => {
        const glyph = prepareWritingGlyph('一', 100, 100, [
            [[10, 50], [30, 50]],
            [[50, 50], [30, 50]],
            [[50, 50], [90, 50]],
        ]);

        expect(glyph.strokes).toHaveLength(1);
        expect(glyph.strokes[0].length).toBeCloseTo(0.8);
        expect(glyph.strokes[0].points[0]).toEqual({ x: 0.1, y: 0.5 });
        expect(glyph.strokes[0].points.at(-1)).toEqual({ x: 0.9, y: 0.5 });
    });
});
