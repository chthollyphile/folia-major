import { describe, expect, it } from 'vitest';
import type { WallMetrics } from '../../../src/components/wall/layout';
import {
    blockSeamPlan,
    getSeamBoundaryX,
    getSeamCameraSpan,
    getSeamGeometry,
    getSeamSplitOffsets,
    isSeamBoundaryX,
    nearestSeamBoundaryX,
} from '../../../src/components/wall/seamPlan';

// Block-boundary seam lines with minimal camera yield. Expected numbers were read off the prototype
// (dev/prototypes/bravais/index.html, `blockSeamPlan` with the same viewport, scale and camera).

const METRICS: WallMetrics = { cellSize: 128, gap: 8 };
const BLOCK_W = 12 * 136;
const PHONE = { width: 361, height: 780, scale: 0.52 };
const LAPTOP = { width: 887, height: 800, scale: 0.64 };

describe('seam boundaries', () => {
    it('sits on the gap midline between blocks', () => {
        expect(getSeamBoundaryX(0, METRICS)).toBe(-4);
        expect(getSeamBoundaryX(2, METRICS)).toBe(2 * BLOCK_W - 4);
        expect(nearestSeamBoundaryX(900, METRICS)).toBe(BLOCK_W - 4);
        expect(nearestSeamBoundaryX(-900, METRICS)).toBe(-BLOCK_W - 4);
        expect(isSeamBoundaryX(-BLOCK_W - 4, METRICS)).toBe(true);
        expect(isSeamBoundaryX(100, METRICS)).toBe(false);
    });

    it('rounds to the nearest midline of a wider gap (a street between blocks)', () => {
        const width = BLOCK_W + 64;
        const midline = (column: number) => getSeamBoundaryX(column, METRICS, width);
        expect(midline(1)).toBe(width - 36);
        // Just short of halfway between two midlines still belongs to the nearer one.
        const halfway = (midline(1) + midline(2)) / 2;
        expect(nearestSeamBoundaryX(halfway - 1, METRICS, width)).toBe(midline(1));
        expect(nearestSeamBoundaryX(halfway + 1, METRICS, width)).toBe(midline(2));
        expect(nearestSeamBoundaryX(midline(-3) + 5, METRICS, width)).toBe(midline(-3));
    });
});

describe('block seam plan', () => {
    it('matches the prototype at sampled camera positions', () => {
        const cases: Array<[typeof PHONE, number, number, number, number]> = [
            [PHONE, 500, 64, -4, 254.6538461538],
            [PHONE, 1000, 300, 1628, 1596.2692307692],
            [PHONE, 2448, 64, 3260, 3001.3461538462],
            [PHONE, 1628, 300, 1628, 1628],
            [LAPTOP, 500, 300, -4, 432.71875],
            [LAPTOP, 1000, 64, 1628, 1006.90625],
            [LAPTOP, 1000, 300, 1628, 1191.28125],
            [LAPTOP, 2000, 300, 1628, 2000],
            [LAPTOP, 2448, 64, 3260, 2638.90625],
        ];
        for (const [view, cameraX, openWidth, x, nextCameraX] of cases) {
            const plan = blockSeamPlan({ cameraX, openWidth, view, metrics: METRICS });
            expect(plan.x).toBe(x);
            expect(plan.cameraX).toBeCloseTo(nextCameraX, 6);
        }
    });

    it('always lands on a block boundary with the whole opening on screen; yields match the prototype', () => {
        // Same sweep as the prototype measurement: camera 0..3264 world px in 51 px steps.
        const expectedMaxShift: Array<[typeof PHONE, number, number]> = [
            [PHONE, 64, 287.74], [PHONE, 120, 315.74], [PHONE, 300, 405.74], [PHONE, 309, 410.24],
            [LAPTOP, 64, 122.18], [LAPTOP, 120, 150.18], [LAPTOP, 300, 240.18], [LAPTOP, 420, 300.18],
        ];
        for (const [view, openWidth, maxShift] of expectedMaxShift) {
            let worst = 0;
            for (let cameraX = 0; cameraX <= 3264; cameraX += 51) {
                const plan = blockSeamPlan({ cameraX, openWidth, view, metrics: METRICS });
                expect(isSeamBoundaryX(plan.x, METRICS)).toBe(true);
                const geometry = getSeamGeometry({ anchorX: plan.x, cameraX: plan.cameraX, openWidth, view });
                expect(geometry.width).toBeCloseTo(openWidth, 6);
                worst = Math.max(worst, plan.shift);
            }
            expect(worst).toBeCloseTo(maxShift, 2);
            // Never more than half a block minus the room the opening has around the base line.
            expect(worst).toBeLessThanOrEqual((BLOCK_W * view.scale) / 2 - (view.width / 2 - openWidth / 2 - 14) + 1e-6);
        }
    });

    it('keeps a visible split on its boundary and only moves the camera when the new width needs room', () => {
        const stay = blockSeamPlan({ cameraX: 1628, openWidth: 300, view: LAPTOP, metrics: METRICS, preferX: 1628 + BLOCK_W });
        expect(stay.x).toBe(1628 + BLOCK_W);
        expect(stay.cameraX).toBeCloseTo(1628 + BLOCK_W - (887 - 164 - 443.5) / 0.64, 6);
        const fits = blockSeamPlan({ cameraX: 1628, openWidth: 64, view: LAPTOP, metrics: METRICS, preferX: 1628 });
        expect(fits).toEqual({ x: 1628, cameraX: 1628, shift: 0 });
    });
});

describe('seam geometry', () => {
    it('narrows near the edge to twice the remaining room and closes off screen', () => {
        const centred = getSeamGeometry({ anchorX: 0, cameraX: 0, openWidth: 300, view: LAPTOP });
        expect(centred).toEqual({ screenX: 443.5, width: 300, collapsed: false, side: 'right' });

        // Anchor 100 px from the right edge: room 100 - 14 = 86, width 172.
        const near = getSeamGeometry({ anchorX: (787 - 443.5) / 0.64, cameraX: 0, openWidth: 300, view: LAPTOP });
        expect(near.width).toBeCloseTo(172, 6);
        expect(near.collapsed).toBe(false);

        const gone = getSeamGeometry({ anchorX: -2000, cameraX: 0, openWidth: 300, view: LAPTOP });
        expect(gone.width).toBe(0);
        expect(gone.collapsed).toBe(true);
        expect(gone.side).toBe('left');

        expect(getSeamGeometry({ anchorX: -2000, cameraX: 0, openWidth: 0, view: LAPTOP }).collapsed).toBe(false);
    });

    it('spans the camera positions that keep the whole opening on screen', () => {
        const span = getSeamCameraSpan({ anchorX: 100, openWidth: 64, view: PHONE });
        const need = 64 / 2 + 14;
        expect(span.min).toBeCloseTo(100 - (361 - need - 180.5) / 0.52, 6);
        expect(span.max).toBeCloseTo(100 + (180.5 - need) / 0.52, 6);
        for (const cameraX of [span.min, span.max]) {
            expect(getSeamGeometry({ anchorX: 100, cameraX, openWidth: 64, view: PHONE }).width).toBeCloseTo(64, 6);
        }
        const tooWide = getSeamCameraSpan({ anchorX: 100, openWidth: 500, view: PHONE });
        expect(tooWide.min).toBe(tooWide.max);
    });

    it('moves the two halves apart by half the opening plus half a scaled gap', () => {
        expect(getSeamSplitOffsets(300, 0.64, METRICS)).toEqual({ left: -150 - 2.56, right: 150 + 2.56 });
        expect(getSeamSplitOffsets(8, 0.5, METRICS)).toEqual({ left: -4 - 1, right: 4 + 1 });
    });
});
