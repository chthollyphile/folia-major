import { describe, expect, it } from 'vitest';
import {
    BRUT_UNIT_GAP_EM,
    BRUT_UNIT_ROW_EM,
    BRUT_UNIT_ROW_STEP_EM,
} from '@/components/visualizer/brut/brutConstants';
import { layoutBrutUnits } from '@/components/visualizer/brut/brutUnitLayout';

// test/unit/visualizer/brutUnitLayout.test.ts
// The scatter has to stay readable: tokens keep their reading order, rows descend, and the layout
// is a pure function of the line so revisiting a line never rearranges the wall.

const cjkWidths = (count: number) => new Array(count).fill(1.36);

describe('layoutBrutUnits', () => {
    it('keeps reading order left to right within a row', () => {
        const block = layoutBrutUnits(cjkWidths(6), 3);
        for (let index = 1; index < block.slots.length; index += 1) {
            if (block.slots[index].y === block.slots[index - 1].y) continue;
            expect(block.slots[index].x).toBeGreaterThan(block.slots[index - 1].x - BRUT_UNIT_ROW_EM);
        }
    });

    it('descends to a new row once the row budget is spent', () => {
        const perRow = Math.floor(BRUT_UNIT_ROW_EM / (1.36 + BRUT_UNIT_GAP_EM));
        const block = layoutBrutUnits(cjkWidths(perRow * 2 + 1), 3);
        const rows = new Set(block.slots.map(slot => Math.round(slot.y / BRUT_UNIT_ROW_STEP_EM)));
        expect(rows.size).toBeGreaterThanOrEqual(2);
        expect(block.heightEm).toBeGreaterThan(BRUT_UNIT_ROW_STEP_EM);
    });

    it('is deterministic for the same seed and differs between lines', () => {
        expect(layoutBrutUnits(cjkWidths(8), 5)).toEqual(layoutBrutUnits(cjkWidths(8), 5));
        expect(layoutBrutUnits(cjkWidths(8), 5)).not.toEqual(layoutBrutUnits(cjkWidths(8), 6));
    });

    it('never lets a token leave the row budget', () => {
        const block = layoutBrutUnits(cjkWidths(24), 11);
        block.slots.forEach((slot) => {
            expect(Math.abs(slot.x)).toBeLessThanOrEqual(BRUT_UNIT_ROW_EM / 2 + BRUT_UNIT_GAP_EM);
        });
        expect(block.widthEm).toBeLessThanOrEqual(BRUT_UNIT_ROW_EM + BRUT_UNIT_GAP_EM * 2);
    });

    it('keeps every slot finite and positively sized', () => {
        layoutBrutUnits([0.4, 3.2, 1.1, 0.9], 2).slots.forEach((slot) => {
            expect(Number.isFinite(slot.x)).toBe(true);
            expect(Number.isFinite(slot.y)).toBe(true);
            expect(slot.scale).toBeGreaterThan(0);
            expect(slot.depth).toBeGreaterThanOrEqual(0);
        });
    });

    it('survives a line with no tokens', () => {
        const block = layoutBrutUnits([], 1);
        expect(block.slots).toEqual([]);
        expect(block.widthEm).toBeGreaterThan(0);
        expect(block.heightEm).toBeGreaterThan(0);
    });
});
