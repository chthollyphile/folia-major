import { describe, expect, it } from 'vitest';
import type { BeatFxEvent } from '@/services/beatFx/clock';
import { snapMetaphorCollisions, writeMetaphorBeatRings } from '@/components/visualizer/metaphor/metaphorBeatFx';
import {
    METAPHOR_SHAPE_CAPACITY,
    METAPHOR_SHAPE_RING,
    METAPHOR_SHAPE_STRIDE,
    type MetaphorCollision,
} from '@/components/visualizer/metaphor/metaphorShapes';

// test/unit/visualizer/metaphor/metaphorBeatFx.test.ts
// 隐喻的「湮灭对撞」：对撞挪到拍上、平常的拍从对撞点放小环。

const hit = (time: number, x = 0): MetaphorCollision => ({ time, x, y: 0, angle: 0, unit: 1, fragments: [] });

// 每拍 0.5 秒、四拍一小节，从 0 秒起
const beats = (count: number, extra: Partial<BeatFxEvent> = {}): BeatFxEvent[] =>
    Array.from({ length: count }, (_, index) => ({ t: index * 0.5, kind: index % 4 === 0 ? 'downbeat' : 'beat', ...extra }));

const rings = (out: Float32Array, count: number) =>
    Array.from({ length: count }, (_, index) => out.subarray(index * METAPHOR_SHAPE_STRIDE, (index + 1) * METAPHOR_SHAPE_STRIDE));

describe('对撞挪到拍上', () => {
    it('附近有小节第一拍就挪到那一拍', () => {
        const [snapped] = snapMetaphorCollisions([hit(3.4)], beats(16));
        expect(snapped.time).toBe(4);
    });

    it('够不着小节第一拍就挪到最近的一拍', () => {
        const [snapped] = snapMetaphorCollisions([hit(3.05)], beats(16));
        expect(snapped.time).toBe(3);
    });

    it('哪一拍都够不着的不动，还是原来那个对象', () => {
        const original = hit(20.2);
        const [snapped] = snapMetaphorCollisions([original], beats(16));
        expect(snapped).toBe(original);
    });

    it('两次对撞不会挪到同一拍上', () => {
        const snapped = snapMetaphorCollisions([hit(3.8), hit(4.3)], beats(16));
        expect(snapped[0].time).toBe(4);
        expect(snapped[1].time).toBe(4.5);
    });

    it('不会挪到最早能撞的时刻以前', () => {
        const [snapped] = snapMetaphorCollisions([hit(4.4)], beats(16), 4.2);
        expect(snapped.time).toBe(4.5);
    });

    it('没有节奏的小节里的拍不算', () => {
        const original = hit(3.9);
        const [snapped] = snapMetaphorCollisions([original], beats(16, { rhythmic: false }));
        expect(snapped).toBe(original);
    });

    it('节拍表是空的就原样返回', () => {
        const original = hit(3.9);
        expect(snapMetaphorCollisions([original], [])[0]).toBe(original);
    });
});

describe('拍上的小环', () => {
    const out = () => new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);

    it('每一拍从对撞点放一圈，撞上的那一拍自己不放', () => {
        const data = out();
        // 4 秒撞上；4.9 秒时还活着的拍是 3、3.5、4、4.5，其中 4 是撞上的那一拍
        const count = writeMetaphorBeatRings([hit(4, 7)], beats(16), 4.9, 0, 1, 1, data, 0);
        expect(count).toBe(3);
        for (const ring of rings(data, count)) {
            expect(ring[8]).toBe(METAPHOR_SHAPE_RING);
            expect(ring[0]).toBe(7);
        }
    });

    it('越老的环越大、越淡', () => {
        const data = out();
        const count = writeMetaphorBeatRings([hit(4)], beats(16).filter(event => event.kind === 'beat'), 4.9, 0, 1, 1, data, 0);
        const [older, newer] = rings(data, count);
        expect(older[2]).toBeGreaterThan(newer[2]);
        expect(older[6]).toBeLessThan(newer[6]);
    });

    it('重的拍环更大，强度也放大它', () => {
        const radius = (impact: number, strength: number) => {
            const data = out();
            writeMetaphorBeatRings([hit(4)], [{ t: 3, kind: 'beat', impact }], 4, 0, strength, 1, data, 0);
            return data[2];
        };
        expect(radius(1, 1)).toBeGreaterThan(radius(0.1, 1));
        expect(radius(0.5, 2)).toBeGreaterThan(radius(0.5, 1));
    });

    it('没有对撞、强度是 0、没有节奏的小节都不放', () => {
        expect(writeMetaphorBeatRings([], beats(16), 4.9, 0, 1, 1, out(), 0)).toBe(0);
        expect(writeMetaphorBeatRings([hit(4)], beats(16), 4.9, 0, 0, 1, out(), 0)).toBe(0);
        expect(writeMetaphorBeatRings([hit(4)], beats(16, { rhythmic: false }), 4.9, 0, 1, 1, out(), 0)).toBe(0);
    });

    it('离哪个对撞都远的拍不放', () => {
        expect(writeMetaphorBeatRings([hit(60)], beats(16), 4.9, 0, 1, 1, out(), 0)).toBe(0);
    });

    it('接着 offset 写，不动前面的', () => {
        const data = out();
        data[0] = 42;
        const count = writeMetaphorBeatRings([hit(4)], beats(16), 4.9, 0, 1, 1, data, 1);
        expect(count).toBe(4);
        expect(data[0]).toBe(42);
    });
});
