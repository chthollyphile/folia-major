import { describe, expect, it } from 'vitest';
import {
    collectionMorphEntranceTravel,
    collectionMorphFlyIn,
    collectionMorphSeed,
} from '@/library/suites/grid/transitions/morphGeometry';

// test/unit/collectionOpenMorph/morphGeometry.test.ts
// 移形换影的几何部分：卡片级联入场的公式。封面那一段飞行的关键帧在 morphFlight.test.ts。

describe('collectionMorphSeed', () => {
    it('is deterministic and stays in [0, 1)', () => {
        for (const key of ['song-1', 'song-2', '', '曲目', 'a'.repeat(200)]) {
            const first = collectionMorphSeed(key);
            expect(collectionMorphSeed(key)).toBe(first);
            expect(first).toBeGreaterThanOrEqual(0);
            expect(first).toBeLessThan(1);
        }
    });

    it('spreads different ids apart instead of collapsing them', () => {
        const seeds = new Set(Array.from({ length: 40 }, (_, i) => collectionMorphSeed(`track-${i}`)));
        expect(seeds.size).toBeGreaterThan(35);
    });
});

describe('collectionMorphFlyIn', () => {
    const origin = { x: 0, y: 0 };
    const flyIn = (card: { x: number; y: number }, spacing = 100, reach = 900) => (
        collectionMorphFlyIn(card, origin, spacing, reach, collectionMorphSeed(`card-${card.x}-${card.y}`))
    );

    it('pushes the card radially outward by exactly the reach', () => {
        const card = { x: 300, y: 400 };
        const result = flyIn(card);
        expect(Math.hypot(result.x, result.y)).toBeCloseTo(900, 6);
        // 方向沿着 origin → card 的径向。
        expect(result.x / result.y).toBeCloseTo(300 / 400, 6);
    });

    it('falls back to straight up for a card sitting on the origin', () => {
        const result = collectionMorphFlyIn({ x: 0, y: 0 }, origin, 100, 900, 0.5);
        expect(result.x).toBe(0);
        expect(result.y).toBe(-900);
    });

    it('never tilts a card, and keeps the stagger inside its window', () => {
        for (let x = -3; x <= 3; x += 1) {
            for (let y = -3; y <= 3; y += 1) {
                const result = flyIn({ x: x * 300, y: y * 300 });
                // 不倾斜是契约：网格入场让每一格各自歪一个角度，读起来是「随机」而不是
                // 「被安排好的」——Apple 的网格入场是有秩序的。
                expect(result.rotate).toBe(0);
                expect(result.delay).toBeGreaterThanOrEqual(0.04);
                expect(result.delay).toBeLessThanOrEqual(0.32);
            }
        }
    });

    it('starts nearer cards earlier than far ones with the same seed', () => {
        const near = collectionMorphFlyIn({ x: 50, y: 0 }, origin, 100, 900, 0.5);
        const far = collectionMorphFlyIn({ x: 5000, y: 0 }, origin, 100, 900, 0.5);
        expect(near.delay).toBeLessThan(far.delay);
    });
});

describe('travel distances', () => {
    // 入场是「就位」，不是「从屏幕外飞进来」：短距离是 Apple 网格入场的语言，顺带把
    // 每张卡要走的距离（也就是单帧要喂的动画量）压下来。
    it('keeps the entrance a short push instead of a flight from off-screen', () => {
        const desktop = collectionMorphEntranceTravel({ width: 1440, height: 1100 });
        const small = collectionMorphEntranceTravel({ width: 800, height: 600 });
        expect(desktop).toBeLessThanOrEqual(260);
        expect(small).toBeLessThan(desktop);
        expect(small).toBeGreaterThan(100);
    });
});
