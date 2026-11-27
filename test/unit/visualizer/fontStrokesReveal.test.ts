import { describe, expect, it } from 'vitest';
import { buildStrokeReveal, fillRevealAlpha, REVEAL_NEVER, REVEAL_SIDE } from '@/components/visualizer/fontStrokes/strokeReveal';

// test/unit/visualizer/fontStrokesReveal.test.ts
// 手写遮罩的纯计算：遮罩格怎么对回字体单位（相对字心和字母基线、每 1 px 字号）、书写位置往墨外延伸一圈、某个进度下的透明度。

const R = 256;
/** 合成的字：墨是网格 x 90..149、y 100..119 的横条，书写位置沿 x 从 0 走到 65534。 */
const synthetic = (a: number, bx: number, by: number) => {
    const img = new Float32Array(R * R), along = new Uint16Array(R * R).fill(65535);
    for (let y = 100; y < 120; y += 1) for (let x = 90; x < 150; x += 1) {
        img[y * R + x] = 1;
        along[y * R + x] = Math.round(((x - 90) / 59) * 65534);
    }
    return { canon: { img, a, bx, by }, along };
};

describe('buildStrokeReveal placement', () => {
    const a = 200, bx = 40, by = 70;
    const { canon, along } = synthetic(a, bx, by);
    const reveal = buildStrokeReveal(canon, along)!;

    it('maps the mask rect back onto font units around the char centre and alphabetic baseline', () => {
        // 网格像素 g → em (g - b) / a → 字体单位 (e - 0.5) / 0.78（横）、(e - 0.8) / 0.78（纵）
        expect(reveal.x0).toBeCloseTo((-bx / a - 0.5) / 0.78, 10);
        expect(reveal.y0).toBeCloseTo((-by / a - 0.8) / 0.78, 10);
        expect(reveal.size).toBeCloseTo((R / a) / 0.78, 10);
        // 遮罩格 (i, j) 的中心对应网格像素 (2i + 1, 2j + 1)：字体单位里的位置要对上
        for (const [i, j] of [[0, 0], [45, 50], [127, 127]]) {
            const gx = 2 * i + 1, gy = 2 * j + 1;
            expect(reveal.x0 + ((i + 0.5) / REVEAL_SIDE) * reveal.size).toBeCloseTo(((gx - bx) / a - 0.5) / 0.78, 10);
            expect(reveal.y0 + ((j + 0.5) / REVEAL_SIDE) * reveal.size).toBeCloseTo(((gy - by) / a - 0.8) / 0.78, 10);
        }
    });

    it('a known ink pixel lands on the same font-unit point through the mask', () => {
        // 网格 (120, 110) 在墨条正中：遮罩格 (60, 55) 有值，落点的字体单位和直接换算一致
        const v = reveal.mask[55 * REVEAL_SIDE + 60];
        expect(v).not.toBe(REVEAL_NEVER);
        expect(v / 254).toBeCloseTo((120 - 90) / 59, 1);
    });

    it('extends the writing position a margin beyond the ink and leaves the far field never', () => {
        const left = reveal.mask[55 * REVEAL_SIDE + 40];   // 网格 x 80..81，墨外 9 px
        expect(left).not.toBe(REVEAL_NEVER);
        expect(left).toBe(0);
        expect(reveal.mask[55 * REVEAL_SIDE + 10]).toBe(REVEAL_NEVER);
        expect(reveal.mask[5 * REVEAL_SIDE + 60]).toBe(REVEAL_NEVER);
    });

    it('is null when the model gave no writing position at all', () => {
        const empty = synthetic(a, bx, by);
        empty.along.fill(65535);
        expect(buildStrokeReveal(empty.canon, empty.along)).toBeNull();
    });
});

describe('fillRevealAlpha', () => {
    const mask = new Uint8Array([0, 127, 254, REVEAL_NEVER]);
    const alphaAt = (progress: number) => {
        const out = new Uint8ClampedArray(mask.length * 4);
        fillRevealAlpha(mask, progress, out);
        return Array.from({ length: mask.length }, (_, i) => out[i * 4 + 3]);
    };

    it('shows nothing at 0 and everything that can be written at 1', () => {
        expect(alphaAt(0)).toEqual([0, 0, 0, 0]);
        expect(alphaAt(1)).toEqual([255, 255, 255, 0]);
    });

    it('is a soft front: written behind, hidden ahead, in between at the front', () => {
        // 前沿 q = 0.5 × 1.05 = 0.525：位置 0 已写、位置 0.5 在柔边里、位置 1 还没写
        const a = alphaAt(0.5);
        expect(a[0]).toBe(255);
        expect(a[1]).toBeGreaterThan(0);
        expect(a[1]).toBeLessThan(255);
        expect(a[2]).toBe(0);
        expect(a[3]).toBe(0);
    });

    it('never goes backwards as the progress grows', () => {
        let previous = alphaAt(0);
        for (let p = 0.05; p <= 1.0001; p += 0.05) {
            const now = alphaAt(p);
            now.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(previous[i]));
            previous = now;
        }
    });
});
