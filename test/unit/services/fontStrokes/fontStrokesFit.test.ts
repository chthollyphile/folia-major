import { describe, expect, it } from 'vitest';
import { fitStrokesToInk, rasterizeBodies, strokeReachPx } from '../../../../src/services/fontStrokes/fontStrokesFit';
import { buildFontStrokesGlyph, EM_UNITS, OUTLINE_SIDE } from '../../../../src/services/fontStrokes/fontStrokesOutline';

// test/unit/services/fontStrokes/fontStrokesFit.test.ts
// 显示字重的落法：膨胀量 r（多出来的墨离 400 墨的第 95 百分位）、各自膨胀后剩下的墨归最近的笔身、笔刷跟着放宽。

const S = OUTLINE_SIDE;
const GRID = { a: 256, bx: 0, by: 0 };
const blankInk = () => new Float32Array(S * S);
const paint = (img: Float32Array | Int8Array, v: number, x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) img[y * S + x] = v;
};
/** 画布坐标笔迹：px = (u + 1) * 128。 */
const pen = (x0: number, y0: number, x1: number, y1: number) => {
    const u = (px: number) => px / 128 - 1;
    return new Float32Array([u(x0), u(y0), u(x1), u(y1)]);
};

/** 一横（先写）一竖，交叉处归竖。 */
const cross = () => {
    const owner = new Int8Array(S * S).fill(-1);
    paint(owner, 0, 50, 120, 150, 130);
    paint(owner, 1, 95, 50, 105, 200);
    const ink400 = blankInk();
    paint(ink400, 1, 50, 120, 150, 130);
    paint(ink400, 1, 95, 50, 105, 200);
    const glyph = buildFontStrokesGlyph(owner, [pen(50, 125, 150, 125), pen(100, 50, 100, 200)], GRID);
    return { glyph, ink400 };
};

describe('strokeReachPx', () => {
    it('0 when the display weight adds no ink; about the added thickness otherwise; rounding modes', () => {
        const ink = blankInk();
        paint(ink, 1, 100, 100, 120, 110);
        expect(strokeReachPx(ink, ink)).toBe(0);
        const bold = blankInk();
        paint(bold, 1, 97, 97, 123, 113);
        const raw = strokeReachPx(ink, bold);
        expect(raw).toBeGreaterThan(2.5);
        expect(raw).toBeLessThan(4.5);
        expect(Number.isInteger(strokeReachPx(ink, bold, S, 'ceil'))).toBe(true);
        expect(strokeReachPx(ink, bold, S, 'ceil')).toBeGreaterThanOrEqual(raw);
        expect(strokeReachPx(ink, bold, S, 'round')).toBe(Math.round(raw));
    });
});

describe('rasterizeBodies', () => {
    it('labels pixel centres inside each body; the first stroke keeps overlaps and reports them', () => {
        const { glyph } = cross();
        const overlaps: number[] = [];
        const body = rasterizeBodies(glyph.outlines, EM_UNITS, GRID, S, i => overlaps.push(i));
        expect(body[125 * S + 60]).toBe(0);
        expect(body[60 * S + 100]).toBe(1);
        expect(body[125 * S + 100]).toBe(1);
        expect(body[10 * S + 10]).toBe(-1);
        expect(overlaps.length).toBeLessThan(40);
    });
});

describe('fitStrokesToInk', () => {
    it('uniformly bolder ink: dilate = r + ½ px, leftover only at the square corners, brush widened by 2 × 1.2 × dilate', () => {
        const { glyph, ink400 } = cross();
        const bold = blankInk();
        paint(bold, 1, 47, 117, 153, 133);
        paint(bold, 1, 92, 47, 108, 203);
        const fit = fitStrokesToInk(glyph, ink400, bold, GRID);
        expect(fit.reachPx).toBeGreaterThan(2.5);
        expect(fit.dilate).toBeCloseTo(((fit.reachPx + 0.5) * EM_UNITS) / GRID.a, 6);
        // 方角离笔身比 r 远（对角线），只有这几处剩下（各自再往外多留两个像素）：面积和远小于多出来的墨（约 1700 像素²）
        let area = 0;
        for (const rings of fit.leftover) for (const r of rings) {
            let a = 0;
            for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; }
            area += Math.abs(a / 2) / (EM_UNITS / GRID.a) ** 2;
        }
        expect(area).toBeLessThan(400);
        // 至少放宽 2 × 1.2 × dilate；方角剩下的墨离中线端点更远时再宽一点
        expect(fit.brush[0]).toBeGreaterThanOrEqual((glyph.brush[0] * EM_UNITS) / 256 + 2.4 * fit.dilate - 1e-3);
        expect(fit.brush[0]).toBeLessThan((glyph.brush[0] * EM_UNITS) / 256 + 2.4 * fit.dilate + 2.4 * (6 / 256) * EM_UNITS);
    });

    it('ink farther than r from every body goes to the nearest body, with a ring the brush reaches', () => {
        const { glyph, ink400 } = cross();
        const bold = Float32Array.from(ink400);
        // 竖的下端多出一大块（离竖近、离横远）：r 由大多数墨定，这一块超出 r，归竖
        paint(bold, 1, 49, 119, 151, 131);
        paint(bold, 1, 94, 49, 106, 201);
        paint(bold, 1, 80, 201, 120, 225);
        const fit = fitStrokesToInk(glyph, ink400, bold, GRID);
        expect(fit.leftover[0]).toHaveLength(0);
        expect(fit.leftover[1].length).toBeGreaterThan(0);
        // 剩下的墨的环在 em 单位里盖住那一块的中心
        const ring = fit.leftover[1][0];
        let x0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); y1 = Math.max(y1, ring[i + 1]); }
        expect(x0).toBeLessThan((82 / 256) * EM_UNITS);
        expect(y1).toBeGreaterThan((222 / 256) * EM_UNITS);
        // 笔刷放宽到够得着那一块最远的角（离竖的中线下端约 32 个像素）
        expect(fit.brush[1]).toBeGreaterThan(2.4 * (30 / 256) * EM_UNITS);
    });
});
