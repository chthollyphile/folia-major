import { describe, expect, it } from 'vitest';
import { absorbSpecks, buildFontStrokesGlyph, EM_UNITS, extendOwners, OUTLINE_SIDE, simplifyRing, traceMaskRings } from '../../../../src/services/fontStrokes/fontStrokesOutline';

// test/unit/services/fontStrokes/fontStrokesOutline.test.ts
// 轮廓：用合成的归属图（交叉的两横竖、相碰的两条、一笔两块）验证描边、简化、笔刷，以及（探针用的）延伸。

const S = OUTLINE_SIDE;
/** 在归属图里涂一个矩形。 */
const rect = (owner: Int8Array, k: number, x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) owner[y * S + x] = k;
};
const blank = () => new Int8Array(S * S).fill(-1);
/** em = px / 256：a = 256，b = 0。 */
const GRID = { a: 256, bx: 0, by: 0 };
/** 一个环按非零绕数规则的内外判断（点在 em × EM_UNITS 坐标）。 */
const inside = (rings: Int16Array[], px: number, py: number) => {
    const x = (px / 256) * EM_UNITS, y = (py / 256) * EM_UNITS;
    let wn = 0;
    for (const r of rings) {
        const n = r.length / 2;
        for (let i = 0; i < n; i += 1) {
            const j = (i + 1) % n;
            const x0 = r[2 * i], y0 = r[2 * i + 1], x1 = r[2 * j], y1 = r[2 * j + 1];
            const cross = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
            if (y0 <= y) { if (y1 > y && cross > 0) wn += 1; } else if (y1 <= y && cross < 0) wn -= 1;
        }
    }
    return wn !== 0;
};

describe('traceMaskRings', () => {
    it('矩形一个环，面积对', () => {
        const mask = new Uint8Array(10 * 10);
        for (let y = 2; y < 6; y += 1) for (let x = 3; x < 9; x += 1) mask[y * 10 + x] = 1;
        const rings = traceMaskRings(mask, 10, 10);
        expect(rings).toHaveLength(1);
        const ring = simplifyRing(rings[0], 0.01);
        // 6 × 4 的像素块，轮廓在像素中心外半格，四角被切成斜边：面积在 24 附近
        let area = 0;
        for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; area += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
        expect(Math.abs(area / 2)).toBeGreaterThan(20);
        expect(Math.abs(area / 2)).toBeLessThan(30);
    });

    it('带洞的块得到外环和反向的洞', () => {
        const mask = new Uint8Array(20 * 20);
        for (let y = 2; y < 16; y += 1) for (let x = 2; x < 16; x += 1) mask[y * 20 + x] = 1;
        for (let y = 6; y < 12; y += 1) for (let x = 6; x < 12; x += 1) mask[y * 20 + x] = 0;
        const rings = traceMaskRings(mask, 20, 20);
        expect(rings).toHaveLength(2);
        const areas = rings.map(r => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a / 2; });
        expect(Math.sign(areas[0])).toBe(-Math.sign(areas[1]));
    });
});

describe('extendOwners', () => {
    it('相碰的两条在中间接上，外面按最近的墨延伸', () => {
        const owner = blank();
        rect(owner, 0, 40, 100, 100, 110);
        rect(owner, 1, 100, 100, 160, 110);
        const out = extendOwners(owner, 6);
        // 墨上不变，上下各延伸 6，延伸出去的像素跟着各自那一半
        expect(out[105 * S + 99]).toBe(0);
        expect(out[105 * S + 100]).toBe(1);
        expect(out[96 * S + 70]).toBe(0);
        expect(out[96 * S + 130]).toBe(1);
        expect(out[90 * S + 70]).toBe(-1);
    });

    it('交叉的两条：交叉处原归属不动，延伸的部分各取最近', () => {
        const owner = blank();
        rect(owner, 0, 50, 120, 150, 130);
        rect(owner, 1, 95, 50, 105, 200);
        // 横条先画、竖条后画：交叉处归竖条（模型的归属怎么给就怎么用）
        const out = extendOwners(owner, 5);
        expect(out[125 * S + 100]).toBe(1);
        expect(out[118 * S + 70]).toBe(0);
        expect(out[70 * S + 108]).toBe(1);
        // 竖条右侧的延伸区在横条上方时归竖条（竖条更近），横条延伸区里离横条近的归横条
        expect(out[117 * S + 112]).toBe(0);
    });

    it('maxR 为 0 时原样', () => {
        const owner = blank();
        rect(owner, 0, 10, 10, 20, 20);
        expect(extendOwners(owner, 0)).toEqual(owner);
    });
});

describe('absorbSpecks', () => {
    it('小块并给贴着它的邻居，不贴别的笔的小块留着', () => {
        const owner = blank();
        rect(owner, 0, 10, 10, 60, 30);
        rect(owner, 1, 30, 14, 32, 16);
        rect(owner, 2, 100, 100, 102, 102);
        absorbSpecks(owner, S, 6);
        expect(owner[14 * S + 30]).toBe(0);
        expect(owner[100 * S + 100]).toBe(2);
    });
});

describe('buildFontStrokesGlyph', () => {
    const pen = (x0: number, y0: number, x1: number, y1: number) => {
        // 画布坐标：px = (u + 1) * 128
        const u = (px: number) => px / 128 - 1;
        return new Float32Array([u(x0), u(y0), u(x1), u(y1)]);
    };

    it('相碰的两条：各有一个环，覆盖各自的墨且有延伸', () => {
        const owner = blank();
        rect(owner, 0, 40, 100, 100, 110);
        rect(owner, 1, 100, 100, 160, 110);
        const g = buildFontStrokesGlyph(owner, [pen(40, 105, 100, 105), pen(100, 105, 160, 105)], GRID, { extendEm: 6 / 256 });
        expect(g.outlines.map(o => o.length)).toEqual([1, 1]);
        expect(inside(g.outlines[0], 70, 105)).toBe(true);
        expect(inside(g.outlines[0], 130, 105)).toBe(false);
        expect(inside(g.outlines[1], 130, 105)).toBe(true);
        // 延伸：墨上方 4 个像素处仍在轮廓里，10 个像素处不在
        expect(inside(g.outlines[0], 70, 100 - 4)).toBe(true);
        expect(inside(g.outlines[0], 70, 100 - 10)).toBe(false);
        // 笔刷：轮廓到中线的最大距离约为 半宽 5 + 延伸 6 → 在笔端处更大；至少 2 × 1.2 × 11 / 256 em
        expect(g.brush[0]).toBeGreaterThanOrEqual(Math.floor(2 * 1.2 * 11));
        expect(g.pens[0].length).toBe(4);
    });

    it('交叉的两条：交叉处归后画的竖条，被切开的横条是两个环', () => {
        const owner = blank();
        rect(owner, 0, 50, 120, 150, 130);
        rect(owner, 1, 95, 50, 105, 200);
        const g = buildFontStrokesGlyph(owner, [pen(50, 125, 150, 125), pen(100, 50, 100, 200)], GRID, { extendEm: 4 / 256 });
        expect(g.outlines.map(o => o.length)).toEqual([2, 1]);
        expect(inside(g.outlines[1], 100, 60)).toBe(true);
        expect(inside(g.outlines[0], 60, 125)).toBe(true);
    });

    it('一笔两块：一笔得到两个环；碎斑被并掉不单独成环', () => {
        const owner = blank();
        rect(owner, 0, 40, 60, 80, 70);
        rect(owner, 0, 160, 60, 200, 70);
        rect(owner, 1, 40, 150, 200, 160);
        rect(owner, 1, 100, 152, 102, 154);
        const g = buildFontStrokesGlyph(owner, [pen(40, 65, 200, 65), pen(40, 155, 200, 155)], GRID, { extendEm: 2 / 256 });
        expect(g.outlines[0]).toHaveLength(2);
        expect(g.outlines[1]).toHaveLength(1);
    });

    it('默认不往墨外延伸：轮廓就是 400 的笔身', () => {
        const owner = blank();
        rect(owner, 0, 40, 100, 100, 110);
        rect(owner, 1, 100, 100, 160, 110);
        const g = buildFontStrokesGlyph(owner, [pen(40, 105, 100, 105), pen(100, 105, 160, 105)], GRID);
        expect(inside(g.outlines[0], 70, 101)).toBe(true);
        expect(inside(g.outlines[0], 70, 98)).toBe(false);
        expect(inside(g.outlines[1], 130, 111)).toBe(false);
        // 笔刷：半宽约 5 个像素 × 2 × 1.2（笔端处到中线更远）
        expect(g.brush[0]).toBeGreaterThanOrEqual(Math.floor(2 * 1.2 * 5));
        expect(g.brush[0]).toBeLessThan(2 * 1.2 * 11);
    });

    it('没有墨的笔：轮廓为空，笔刷 0', () => {
        const owner = blank();
        rect(owner, 0, 40, 60, 80, 70);
        const g = buildFontStrokesGlyph(owner, [pen(40, 65, 80, 65), pen(0, 0, 10, 10)], GRID);
        expect(g.outlines[1]).toHaveLength(0);
        expect(g.brush[1]).toBe(0);
    });
});
