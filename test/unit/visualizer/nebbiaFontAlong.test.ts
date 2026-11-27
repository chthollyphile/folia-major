import { describe, expect, it } from 'vitest';
import { ALONG_OFF_INK, alongFromOutlines, fillRings, rasterizeBodies } from '@/components/visualizer/nebbia/nebbiaFontAlong';
import { buildFontStrokesGlyph, EM_UNITS, OUTLINE_SIDE } from '@/services/fontStrokes/fontStrokesOutline';

// test/unit/visualizer/nebbiaFontAlong.test.ts
// 从笔画服务存下的轮廓还原墨像素的书写位置：轮廓填充按像素中心、盖住的归那一笔、几笔都盖住取中线最近的、都没盖住取轮廓最近的、没有轮廓的笔不参与。

const SIDE = 64;
/** 1 em = 32 网格像素，原点在 (0, 0)；轮廓单位 = em × 100。 */
const GRID = { a: 32, bx: 0, by: 0 };
const UNITS = 100;
/** 矩形环（em → 轮廓单位），flat。 */
const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1].map(v => v * UNITS);
/** 网格上一块墨（像素坐标，含头不含尾）。 */
const inkRect = (img: Float32Array, x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) img[y * SIDE + x] = 1;
};
const at = (x: number, y: number) => y * SIDE + x;
/** 书写位置 → 整字笔迹长度里的 em。 */
const em = (v: number, total: number) => (v / 65534) * total;

describe('nebbia font along from outlines', () => {
    it('fills rings by pixel centres, nonzero (a reversed inner ring is a hole)', () => {
        const hit = new Set<number>();
        fillRings([[2, 2, 6, 2, 6, 5, 2, 5]], SIDE, i => hit.add(i));
        expect(hit.size).toBe(4 * 3);
        expect(hit.has(at(2, 2)) && hit.has(at(5, 4))).toBe(true);
        expect(hit.has(at(6, 2)) || hit.has(at(2, 5))).toBe(false);
        const holed = new Set<number>();
        fillRings([[0, 0, 10, 0, 10, 10, 0, 10], [3, 3, 3, 7, 7, 7, 7, 3]], SIDE, i => holed.add(i));
        expect(holed.has(at(5, 5))).toBe(false);
        expect(holed.has(at(1, 1))).toBe(true);
        expect(holed.size).toBe(100 - 16);
    });

    it('a covered ink pixel projects onto its own stroke; off-ink pixels stay off', () => {
        // 两笔横：第一笔 y = 0.25 em，x 0..1；第二笔 y = 1.25 em，x 0..1（总长 2 em）
        const pens = [[[0, 0.25], [1, 0.25]], [[0, 1.25], [1, 1.25]]] as const;
        const outlines = [[rect(0, 0, 1, 0.5)], [rect(0, 1, 1, 1.5)]];
        const img = new Float32Array(SIDE * SIDE);
        inkRect(img, 0, 0, 32, 16); inkRect(img, 0, 32, 32, 48);
        const along = alongFromOutlines(pens.map(p => p.map(q => [q[0], q[1]] as const)), outlines, UNITS, img, GRID, SIDE);
        // 像素 (16, 8) 中心 x = 16.5 / 32 em
        expect(em(along[at(16, 8)], 2)).toBeCloseTo(16.5 / 32, 3);
        expect(em(along[at(16, 40)], 2)).toBeCloseTo(1 + 16.5 / 32, 3);
        expect(along[at(16, 24)]).toBe(ALONG_OFF_INK);
        expect(along[at(40, 8)]).toBe(ALONG_OFF_INK);
    });

    it('where two outlines overlap the nearer centreline wins', () => {
        // 两笔竖，轮廓在 x 0.4..0.6 重叠：x = 0.45 em 的像素更靠近第一笔（x = 0.25），x = 0.55 的更靠近第二笔（x = 0.75）
        const pens = [[[0.25, 0], [0.25, 1]], [[0.75, 0], [0.75, 1]]] as const;
        const outlines = [[rect(0, 0, 0.6, 1)], [rect(0.4, 0, 1, 1)]];
        const img = new Float32Array(SIDE * SIDE);
        inkRect(img, 0, 0, 32, 32);
        const along = alongFromOutlines(pens.map(p => p.map(q => [q[0], q[1]] as const)), outlines, UNITS, img, GRID, SIDE);
        // 像素 14 中心 14.5 / 32 ≈ 0.453 em；像素 17 中心 ≈ 0.547 em；都在 y = 10（中心 10.5 / 32 em）
        expect(em(along[at(14, 10)], 2)).toBeCloseTo(10.5 / 32, 3);
        expect(em(along[at(17, 10)], 2)).toBeCloseTo(1 + 10.5 / 32, 3);
    });

    it('ink outside every outline goes to the stroke whose outline is nearest, strokes with no outline are skipped', () => {
        // 第一笔没有轮廓（模型没分到墨），中线却正好穿过那块墨；墨外的像素应归轮廓最近的第二笔
        const pens = [[[0.5, 0], [0.5, 1]], [[0, 1.5], [1, 1.5]]] as const;
        const outlines = [[], [rect(0, 1.25, 1, 1.75)]];
        const img = new Float32Array(SIDE * SIDE);
        inkRect(img, 0, 40, 32, 56);
        // 轮廓上方一点（y = 38，中心 1.203 em）的墨：没被盖住
        inkRect(img, 10, 38, 12, 40);
        const along = alongFromOutlines(pens.map(p => p.map(q => [q[0], q[1]] as const)), outlines, UNITS, img, GRID, SIDE);
        const v = em(along[at(10, 38)], 2);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeCloseTo(1 + 10.5 / 32, 3);
    });

    it('no outlines at all leaves everything off ink', () => {
        const img = new Float32Array(SIDE * SIDE).fill(1);
        const along = alongFromOutlines([[[0, 0], [1, 0]]], [[]], UNITS, img, GRID, SIDE);
        expect(along.every(v => v === ALONG_OFF_INK)).toBe(true);
    });
});

describe('rasterizeBodies', () => {
    it('labels pixel centres inside each outline; the first stroke keeps overlaps and reports them', () => {
        // 一横（先写）一竖，交叉处归竖；网格 1 em = 256 像素
        const S = OUTLINE_SIDE, grid = { a: 256, bx: 0, by: 0 };
        const owner = new Int8Array(S * S).fill(-1);
        const paint = (v: number, x0: number, y0: number, x1: number, y1: number) => {
            for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) owner[y * S + x] = v;
        };
        paint(0, 50, 120, 150, 130);
        paint(1, 95, 50, 105, 200);
        const u = (px: number) => px / 128 - 1;
        const pen = (x0: number, y0: number, x1: number, y1: number) => new Float32Array([u(x0), u(y0), u(x1), u(y1)]);
        const glyph = buildFontStrokesGlyph(owner, [pen(50, 125, 150, 125), pen(100, 50, 100, 200)], grid);
        const overlaps: number[] = [];
        const body = rasterizeBodies(glyph.outlines, EM_UNITS, grid, S, i => overlaps.push(i));
        expect(body[125 * S + 60]).toBe(0);
        expect(body[60 * S + 100]).toBe(1);
        expect(body[125 * S + 100]).toBe(1);
        expect(body[10 * S + 10]).toBe(-1);
        expect(overlaps.length).toBeLessThan(40);
    });
});
