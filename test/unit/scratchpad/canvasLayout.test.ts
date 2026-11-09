import { describe, expect, it } from 'vitest';
import {
    CARD_GAP,
    CARD_HEIGHT,
    CARD_WIDTH,
    cardRect,
    columnsFor,
    dropIndexAt,
    gridHeight,
    previewSlots,
    rectFromPoints,
    rectsIntersect,
    slotPosition,
} from '@/components/app/scratchpad/canvasLayout';

// test/unit/scratchpad/canvasLayout.test.ts
// 速记簿画布的几何：列数、格子位置、松手的吸附序号、拖动中的让位、框选碰撞。

const STEP_X = CARD_WIDTH + CARD_GAP;
const STEP_Y = CARD_HEIGHT + CARD_GAP;

describe('grid metrics', () => {
    it('fits whole columns, never fewer than one', () => {
        expect(columnsFor(0)).toBe(1);
        expect(columnsFor(CARD_WIDTH)).toBe(1);
        expect(columnsFor(STEP_X * 3 - CARD_GAP)).toBe(3);
        expect(columnsFor(STEP_X * 3 - CARD_GAP - 1)).toBe(2);
    });

    it('lays slots out row by row', () => {
        expect(slotPosition(0, 3)).toEqual({ x: 0, y: 0 });
        expect(slotPosition(4, 3)).toEqual({ x: STEP_X, y: STEP_Y });
        expect(gridHeight(0, 3)).toBe(0);
        expect(gridHeight(4, 3)).toBe(CARD_HEIGHT * 2 + CARD_GAP);
    });
});

describe('dropIndexAt', () => {
    it('snaps to the slot nearest the card', () => {
        expect(dropIndexAt({ x: STEP_X * 0.4, y: 0 }, 3, 9)).toBe(0);
        expect(dropIndexAt({ x: STEP_X * 0.6, y: 0 }, 3, 9)).toBe(1);
        expect(dropIndexAt({ x: STEP_X * 2, y: STEP_Y }, 3, 9)).toBe(5);
    });

    it('clamps outside the grid: left and above to the start, past the end to after the last card', () => {
        expect(dropIndexAt({ x: -500, y: -500 }, 3, 4)).toBe(0);
        expect(dropIndexAt({ x: 5000, y: 0 }, 3, 4)).toBe(2);
        expect(dropIndexAt({ x: 0, y: STEP_Y * 10 }, 3, 4)).toBe(4);
    });
});

describe('previewSlots', () => {
    it('opens a gap at the drop index as wide as the moving cards', () => {
        const slots = previewSlots(['a', 'b', 'c', 'd', 'e'], new Set(['b', 'd']), 1);
        // 剩下 a c e，在 1 处空出两格：a→0，c→3，e→4
        expect([...slots]).toEqual([['a', 0], ['c', 3], ['e', 4]]);
    });

    it('leaves the gap at the end when dropping after the last card', () => {
        expect([...previewSlots(['a', 'b', 'c'], new Set(['a']), 2)]).toEqual([['b', 0], ['c', 1]]);
    });
});

describe('marquee', () => {
    it('makes the same rect whichever way it is dragged', () => {
        expect(rectFromPoints({ x: 10, y: 50 }, { x: 0, y: 5 })).toEqual({ left: 0, top: 5, right: 10, bottom: 50 });
    });

    it('hits the cards it overlaps and misses the gap between them', () => {
        const origin = { x: 20, y: 100 };
        const box = rectFromPoints({ x: 20 + CARD_WIDTH + 2, y: 100 }, { x: 20 + STEP_X - 2, y: 300 });
        expect(rectsIntersect(box, cardRect(origin, 0, 3))).toBe(false);
        expect(rectsIntersect(box, cardRect(origin, 1, 3))).toBe(false);
        const wider = rectFromPoints({ x: 20 + CARD_WIDTH - 5, y: 100 }, { x: 20 + STEP_X + 5, y: 110 });
        expect(rectsIntersect(wider, cardRect(origin, 0, 3))).toBe(true);
        expect(rectsIntersect(wider, cardRect(origin, 1, 3))).toBe(true);
        expect(rectsIntersect(wider, cardRect(origin, 3, 3))).toBe(false);
    });
});
