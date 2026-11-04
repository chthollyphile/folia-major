import { describe, expect, it } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, THREAD_SPACING } from '@/components/app/scratchpad/canvasLayout';
import { THREAD_LINE_Y, roundedPath, threadArrows, threadNodes, threadPoints } from '@/components/app/scratchpad/canvasThread';

// test/unit/scratchpad/canvasThread.test.ts
// 播放历史与播放队列画布上穿过卡片的线：折线顶点、换行的拐法、箭头的个数、时间轴节点的位置。

const S = THREAD_SPACING;
const STEP_X = CARD_WIDTH + S.x;
const STEP_Y = CARD_HEIGHT + S.y;
const center = (column: number, row: number) => ({ x: column * STEP_X + CARD_WIDTH / 2, y: row * STEP_Y + THREAD_LINE_Y });

describe('threadPoints', () => {
    it('runs straight through one row', () => {
        expect(threadPoints(3, 4, S)).toEqual([center(0, 0), center(2, 0)]);
    });

    it('turns at the end of a row, back along the gap, into the next row', () => {
        const turnX = 2 * STEP_X + CARD_WIDTH + S.x / 2;
        const gapY = CARD_HEIGHT + S.y / 2;
        expect(threadPoints(5, 3, S)).toEqual([
            center(0, 0),
            center(2, 0),
            { x: turnX, y: center(2, 0).y },
            { x: turnX, y: gapY },
            { x: -S.x / 2, y: gapY },
            { x: -S.x / 2, y: center(0, 1).y },
            center(1, 1),
        ]);
    });

    it('draws a part of the thread, and nothing for an empty range', () => {
        expect(threadPoints(5, 3, S, 3, 4)).toEqual([center(0, 1), center(1, 1)]);
        expect(threadPoints(0, 3, S)).toEqual([]);
        expect(threadPoints(5, 3, S, 4, 2)).toEqual([]);
    });
});

describe('marks', () => {
    it('puts one arrow on every step, pointing left on the way back', () => {
        const arrows = threadArrows(5, 3, S).split(' M').length;
        expect(arrows).toBe(4);
        expect(threadArrows(1, 3, S)).toBe('');
    });

    it('puts one time node in the gap before every card', () => {
        const nodes = threadNodes(5, 3, S);
        expect(nodes).toHaveLength(5);
        expect(nodes[0]).toEqual({ x: -S.x / 2, y: THREAD_LINE_Y });
        expect(nodes[4]).toEqual({ x: STEP_X - S.x / 2, y: STEP_Y + THREAD_LINE_Y });
        expect(threadNodes(0, 3, S)).toEqual([]);
    });
});

describe('roundedPath', () => {
    it('rounds the corners and keeps the ends', () => {
        const d = roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], 10);
        expect(d.startsWith('M0 0')).toBe(true);
        expect(d).toContain('Q100 0 100 10');
        expect(d.endsWith('L100 50')).toBe(true);
        expect(roundedPath([])).toBe('');
    });
});
