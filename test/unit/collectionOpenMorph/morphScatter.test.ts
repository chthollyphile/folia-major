import { describe, expect, it } from 'vitest';
import { scatterPush } from '@/library/suites/grid/transitions/morphScatter';

// test/unit/collectionOpenMorph/morphScatter.test.ts
// 返回时其余卡片散开的几何：每张卡沿自己的方向被推出去多远、转多少、晚多久出发。

describe('scatterPush', () => {
    const origin = { x: 720, y: 520 };

    it('pushes a card straight out from the card that flies, by exactly the reach', () => {
        const push = scatterPush({ x: 720 + 300, y: 520 + 400 }, origin, 240, 800, 0.3);
        expect(Math.hypot(push.x, push.y)).toBeCloseTo(240, 6);
        expect(push.x / push.y).toBeCloseTo(300 / 400, 6);
    });

    it('pushes a card that stands on the origin straight up', () => {
        const push = scatterPush(origin, origin, 240, 800, 0.3);
        expect(push.x).toBe(0);
        expect(push.y).toBe(-240);
    });

    it('starts the cards next to the one that flies first, and the farthest within the stagger', () => {
        const near = scatterPush({ x: 760, y: 520 }, origin, 240, 800, 0.3);
        const far = scatterPush({ x: 1520, y: 520 }, origin, 240, 800, 0.3);
        expect(near.delay).toBeLessThan(far.delay);
        expect(far.delay).toBe(70);
        // A card past the farthest one counted (the list is cut at a number) starts with it.
        expect(scatterPush({ x: 5000, y: 520 }, origin, 240, 800, 0.3).delay).toBe(70);
    });

    it('turns each card a little, one way or the other by its own seed', () => {
        const turns = Array.from({ length: 50 }, (_, index) => scatterPush({ x: 900, y: 600 }, origin, 240, 800, index / 50).rotate);
        for (const turn of turns) {
            expect(Math.abs(turn)).toBeGreaterThanOrEqual(1.6);
            expect(Math.abs(turn)).toBeLessThanOrEqual(3.2);
        }
        expect(turns.some(turn => turn < 0)).toBe(true);
        expect(turns.some(turn => turn > 0)).toBe(true);
    });
});
