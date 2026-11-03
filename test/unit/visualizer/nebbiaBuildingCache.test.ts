import { describe, expect, it } from 'vitest';
import { ringColumns } from '@/components/visualizer/nebbia/nebbiaBuildingCache';

// test/unit/visualizer/nebbiaBuildingCache.test.ts
// 楼群缓存的环形列：一段世界横坐标落在缓存的哪几列，着色器按 x0 把每列换回的世界坐标正好落在这一段里。

/** 补画程序（NEBBIA_BLD_FILL_FS）的换算：第 i 列中心的世界横坐标。 */
const worldOf = (i: number, x0: number, span: number, w: number) => {
    const v = ((i + 0.5) / w * span - x0) / span;
    return x0 + (v - Math.floor(v)) * span;
};

describe('nebbia building cache ring columns', () => {
    const span = 2, w = 400;

    it('maps a short stretch to one run whose columns land inside it', () => {
        const { x0, runs } = ringColumns(10.3, 10.31, span, w);
        expect(runs).toHaveLength(1);
        const [start, n] = runs[0];
        for (let i = start; i < start + n; i += 1) {
            const x = worldOf(i, x0, span, w);
            expect(x).toBeGreaterThan(10.3 - span / w);
            expect(x).toBeLessThan(10.31 + span / w);
        }
    });

    it('splits a stretch that wraps past the end of the texture', () => {
        const { runs } = ringColumns(span * 3 - 0.05, span * 3 + 0.05, span, w);
        expect(runs).toEqual([[390, 10], [0, 10]]);
    });

    it('covers every column exactly once on a full refill, even at negative positions', () => {
        const { x0, runs } = ringColumns(-5.37, -5.37 + span, span, w);
        expect(runs.reduce((s, [, n]) => s + n, 0)).toBe(w);
        const xs = runs.flatMap(([start, n]) => Array.from({ length: n }, (_, k) => worldOf(start + k, x0, span, w)));
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(x0);
        expect(Math.max(...xs)).toBeLessThan(x0 + span);
    });

    it('keeps every column center half a column away from the wrap point in single precision', () => {
        const f = Math.fround;
        for (const a of [0.37, 12.345, 377.91, -5.37]) {
            const { x0, runs } = ringColumns(a, a + span, span, w);
            for (const [start, n] of runs) for (let i = start; i < start + n; i += 1) {
                // 着色器里的 (列中心 × 周期 − x0) / 周期，按单精度算
                const v = f(f(f(f(i + 0.5) / w) * span - f(x0)) / span);
                const frac = v - Math.floor(v);
                expect(Math.min(frac, 1 - frac) * w).toBeGreaterThan(0.4);
            }
        }
    });

    it('draws nothing for an empty stretch', () => {
        expect(ringColumns(3, 3, span, w).runs).toEqual([]);
    });
});
