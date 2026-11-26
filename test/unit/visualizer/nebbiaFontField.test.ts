import { describe, expect, it } from 'vitest';
import { DEFAULT_NEBBIA_TUNING } from '@/components/visualizer/nebbia/types';
import { NebbiaSegments, TILE_FLOATS } from '@/components/visualizer/nebbia/nebbiaSegments';
import {
    CANON, encodeSigned, FONT_REF_WIDTH, fontInkLook, penWidthProfile, relativeWidth, resamplePolyline, GROW_MAX, halfWidthAt, interpolateAt, median, propagateNearest, REF_STROKE_WIDTH, SD_SCALE, signedField,
} from '@/components/visualizer/nebbia/nebbiaFontField';

// test/unit/visualizer/nebbiaFontField.test.ts
// 字体墨的纯计算：有符号距离、书写位置往墨外延伸、半笔宽、笔画粗细设置换算（默认值时外扩恰好为 0）。

const SIDE = 64;
/** 横条：行 27..36（10 行）、列 10..53。 */
const bar = () => {
    const ink = new Uint8Array(SIDE * SIDE);
    for (let y = 27; y < 37; y += 1) for (let x = 10; x < 54; x += 1) ink[y * SIDE + x] = 1;
    return ink;
};

describe('nebbia font ink field', () => {
    it('signed distance is positive inside, negative outside, 0.5 at the edge pixels', () => {
        const sd = signedField(bar(), SIDE);
        expect(sd[27 * SIDE + 30]).toBeCloseTo(0.5, 1);
        expect(sd[26 * SIDE + 30]).toBeCloseTo(-0.5, 1);
        expect(sd[32 * SIDE + 30]).toBeGreaterThan(4);
        expect(sd[20 * SIDE + 30]).toBeLessThan(-6);
        expect(encodeSigned(0)).toBe(128);
        expect(encodeSigned(100)).toBe(255);
        expect(encodeSigned(-100)).toBe(0);
        expect(encodeSigned(2) - 128).toBe(Math.round(2 * SD_SCALE));
    });

    it('half width of a bar is its half thickness within a pixel (3x3 chamfer), also off the centre line', () => {
        const sd = signedField(bar(), SIDE);
        expect(Math.abs(halfWidthAt(sd, SIDE, 30, 32) - 5)).toBeLessThanOrEqual(1);
        expect(Math.abs(halfWidthAt(sd, SIDE, 30, 33) - 5)).toBeLessThanOrEqual(1);
        expect(halfWidthAt(sd, SIDE, -5, -5)).toBe(0.5);
    });

    it('propagates the nearest value out to maxR only, keeps inside pixels filled', () => {
        const v = new Float32Array(SIDE * SIDE).fill(-1);
        v[32 * SIDE + 10] = 0.25; v[32 * SIDE + 50] = 0.75;
        propagateNearest(v, SIDE, 6);
        expect(v[32 * SIDE + 14]).toBe(0.25);
        expect(v[34 * SIDE + 8]).toBe(0.25);
        expect(v[32 * SIDE + 48]).toBe(0.75);
        expect(v[32 * SIDE + 30]).toBe(-1);
        const w = new Float32Array(SIDE * SIDE).fill(-1);
        w[0] = 0.5;
        const inside = new Uint8Array(SIDE * SIDE); inside[40 * SIDE + 40] = 1;
        propagateNearest(w, SIDE, 3, inside);
        expect(w[40 * SIDE + 40]).toBe(0.5);
        expect(w[10 * SIDE + 10]).toBe(-1);
    });

    it('median and interpolation', () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([1, 2, 3, 10])).toBe(2.5);
        expect(median([])).toBe(0);
        expect(interpolateAt([0, 1, 3], [0.1, 0.2, 0.4], 2)).toBeCloseTo(0.3, 6);
    });

    it('stroke width default leaves the font ink untouched', () => {
        expect(REF_STROKE_WIDTH).toBe(DEFAULT_NEBBIA_TUNING.strokeWidth);
        const look = fontInkLook(0.05, DEFAULT_NEBBIA_TUNING.strokeWidth, 1);
        expect(look.grow).toBe(0);
        expect(look.width).toBe(0.05);
    });

    it('slider grows and thins the ink, bead size follows but stays modest', () => {
        const thick = fontInkLook(0.05, 0.16, 1), thin = fontInkLook(0.05, 0.04, 1);
        expect(thick.grow).toBeGreaterThan(0);
        expect(thin.grow).toBeLessThan(0);
        expect(thin.width).toBeGreaterThan(0.02);
        expect(thick.width).toBeGreaterThan(thin.width);
        expect(thick.beadScale).toBeGreaterThanOrEqual(thin.beadScale);
        expect(fontInkLook(0.12, 0.16, 1).beadScale).toBe(1);
        expect(fontInkLook(0.03, 0.09, 1).beadScale).toBeGreaterThanOrEqual(0.5);
        expect(fontInkLook(0.03, 0.09, 1).beadScale).toBeLessThan(0.6);
        // 最宽的字体、最粗的设置：外扩也在字块能装下的范围里
        expect(fontInkLook(0.12, 0.16, 1).grow * CANON / 1.1).toBeLessThanOrEqual(GROW_MAX + 1);
    });

    it('tile instance carries the grow in model pixels, 0 at default', () => {
        const s = new NebbiaSegments();
        const ink = { id: 1, tile: new Uint8Array(0), x0: 0, y0: 0, size: 1.28, width: 0.05 };
        s.tile(ink, 0.5, 1, 0.1);
        s.tile(ink, 0.5, 1, 0.1, 0.01);
        s.tile(ink, 0.5, 1, 0.1, 5);
        expect(s.tiles[10]).toBe(0);
        expect(s.tiles[TILE_FLOATS + 10]).toBeCloseTo(2, 5);
        expect(s.tiles[2 * TILE_FLOATS + 10]).toBe(GROW_MAX);
    });

    it('resamples a polyline evenly with its ends kept', () => {
        const out = resamplePolyline([[0, 0], [0.1, 0], [0.1, 0.1]], 0.02);
        expect(out[0]).toEqual([0, 0]);
        expect(out[out.length - 1][0]).toBeCloseTo(0.1, 9);
        expect(out[out.length - 1][1]).toBeCloseTo(0.1, 9);
        expect(out.length).toBe(11);
        const d = out.slice(1).map((p, i) => Math.hypot(p[0] - out[i][0], p[1] - out[i][1]));
        expect(Math.max(...d) - Math.min(...d)).toBeLessThan(1e-9);
    });

    it('width profile from along bins: a bar that is thin on the left and thick on the right, pen off centre', () => {
        // 256 网格上 1 em = 200 px 的横条：左半厚 8 px，右半厚 16 px，长 0.8 em（160 px），书写位置沿 x 线性
        const side = 256, pxPerEm = 200, area = new Float32Array(side * side), along = new Uint16Array(side * side).fill(65535);
        const len = 160 / pxPerEm;
        for (let x = 40; x < 200; x += 1) {
            const half = x < 120 ? 4 : 8;
            for (let y = 128 - half; y < 128 + half; y += 1) { area[y * side + x] = 1; along[y * side + x] = Math.round(((x - 40 + 0.5) / 160) * 65534); }
        }
        const n = Math.ceil(len / 0.012) + 1;
        const [w] = penWidthProfile(along, area, pxPerEm, len, [{ start: 0, len, n }]);
        expect(w.length).toBe(n);
        expect(w[Math.round(n * 0.25)]).toBeCloseTo(8 / pxPerEm, 2);
        expect(w[Math.round(n * 0.75)]).toBeCloseTo(16 / pxPerEm, 2);
    });

    it('two strokes: pixels go to the stroke their writing position falls in', () => {
        const side = 64, area = new Float32Array(side * side).fill(0), along = new Uint16Array(side * side).fill(65535);
        for (let x = 0; x < 20; x += 1) for (let y = 0; y < 2; y += 1) { area[y * side + x] = 1; along[y * side + x] = Math.round(((x + 0.5) / 40) * 65534); }
        for (let x = 20; x < 40; x += 1) for (let y = 10; y < 14; y += 1) { area[y * side + x] = 1; along[y * side + x] = Math.round(((x + 0.5) / 40) * 65534); }
        const [a, b] = penWidthProfile(along, area, 40, 1, [{ start: 0, len: 0.5, n: 11 }, { start: 0.5, len: 0.5, n: 11 }]);
        expect(a[5]).toBeCloseTo(2 / 40, 2);
        expect(b[5]).toBeCloseTo(4 / 40, 2);
    });

    it('relative width is exactly 1 at the reference width and thinner fonts get thinner strokes', () => {
        expect(relativeWidth(FONT_REF_WIDTH)).toBe(1);
        expect(relativeWidth(0.03)).toBeLessThan(1);
        expect(relativeWidth(0.03)).toBeGreaterThan(0.35);
        expect(relativeWidth(0.5)).toBeLessThanOrEqual(2.1);
    });

    it('stroke profile gives each segment the mean width of its ends, min-clamped', () => {
        const s = new NebbiaSegments();
        s.setTransform(2, 0, 0, 2, 0, 0);
        s.moveTo(0, 0); s.lineTo(1, 0); s.lineTo(2, 0); s.lineTo(3, 0);
        s.strokeProfile([1, 2, 0.1], 0.1, 0.05, 0.7);
        const w = [0, 1, 2].map(i => s.data[i * 6 + 4]);
        expect(w[0]).toBeCloseTo(0.15 * 2, 6);
        expect(w[1]).toBeCloseTo(0.105 * 2, 6);
        // 最后一点之后沿用最后一个倍数；平均 0.01 被下限 0.05 托住
        expect(w[2]).toBeCloseTo(0.05 * 2, 6);
        expect(s.count).toBe(3);
    });
});
