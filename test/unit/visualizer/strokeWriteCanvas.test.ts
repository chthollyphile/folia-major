import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EM_UNITS, type FontStrokesGlyph } from '@/services/fontStrokes/fontStrokesOutline';
import type { StrokeFit } from '@/services/fontStrokes/fontStrokesFit';
import { drawStrokeWriteGlyph, strokeUnitsToWorld, strokeWriteWeights } from '@/components/visualizer/fontStrokes/strokeWriteCanvas';

// test/unit/visualizer/strokeWriteCanvas.test.ts
// canvas 写字：笔画坐标到世界坐标的换算（和 renderCanon 的字号 0.78 em、中心 0.5 em、基线 0.8 em 对上）、分时权重，
// 以及用假画布看一帧的绘制步骤（正在写的笔先画区域再 source-in 按进度画笔刷、写完的笔填区域 + 描缝、字 source-in、贴回目标；
// 有显示字重的落法时区域按 dilate 往外描、并上剩下的墨，外框跟着变大）。
// 真字体下轮廓和 fillText 的墨对不对得上，在笔顺开发壳里用真推理量（见提交说明）。

type Call = [string, ...unknown[]];
const recorder = (extra: Record<string, unknown> = {}) => {
    const calls: Call[] = [];
    const target: Record<string, unknown> = { ...extra };
    return {
        calls,
        ctx: new Proxy(target, {
            get(obj, prop: string) {
                if (prop in obj) return obj[prop];
                return (...args: unknown[]) => { calls.push([prop, ...args]); };
            },
            set(obj, prop: string, value) {
                obj[prop] = value;
                calls.push([`set:${prop}`, value]);
                return true;
            },
        }) as unknown as CanvasRenderingContext2D,
    };
};

class FakePath2D {
    ops: unknown[][] = [];
    moveTo(...a: number[]) { this.ops.push(['M', ...a]); }
    lineTo(...a: number[]) { this.ops.push(['L', ...a]); }
    closePath() { this.ops.push(['Z']); }
}

const scratch = recorder();
beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => scratch.ctx }) });
});
afterAll(() => { vi.unstubAllGlobals(); });

const square = (x0: number, y0: number, x1: number, y1: number) => new Int16Array([x0, y0, x1, y0, x1, y1, x0, y1]);
// 两笔：一横（先写）、一竖；em × 2048
const glyph: FontStrokesGlyph = {
    pens: [new Int16Array([400, 1000, 1600, 1000]), new Int16Array([1000, 400, 1000, 1600])],
    outlines: [[square(300, 900, 1700, 1100)], [square(900, 300, 1100, 1700)]],
    brush: new Uint8Array([30, 30]),
};

describe('strokeUnitsToWorld', () => {
    it('puts the em centre on cx and the 0.8 em line on the alphabetic baseline, 0.78 em per font size', () => {
        const { k, tx, ty } = strokeUnitsToWorld({ cx: 100, baseline: 50, fontPx: 78 });
        expect(tx + 0.5 * EM_UNITS * k).toBeCloseTo(100);
        expect(ty + 0.8 * EM_UNITS * k).toBeCloseTo(50);
        // 1 em（存盘单位）= 字号 / 0.78
        expect(EM_UNITS * k).toBeCloseTo(100);
    });
});

describe('strokeWriteWeights', () => {
    it('weights by centreline length, with a floor; strokes without outline or brush get none', () => {
        const w = strokeWriteWeights({
            pens: [new Int16Array([0, 0, 1000, 0]), new Int16Array([0, 0, 10, 0]), new Int16Array([0, 0, 500, 0]), new Int16Array([0, 0, 500, 0])],
            outlines: [[square(0, 0, 10, 10)], [square(0, 0, 10, 10)], [], [square(0, 0, 10, 10)]],
            brush: new Uint8Array([10, 10, 10, 0]),
        });
        expect(w[0]).toBeCloseTo(1000);
        expect(w[1]).toBeGreaterThan(10);
        expect(w[2]).toBe(0);
        expect(w[3]).toBe(0);
    });
});

describe('drawStrokeWriteGlyph', () => {
    const place = { cx: 100, baseline: 80, fontPx: 78 };
    const targetAt = (m: Partial<DOMMatrix>) => recorder({ getTransform: () => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0, ...m }) });

    it('draws the plain glyph straight onto the target once every stroke is written', () => {
        const target = targetAt({});
        const drawn: unknown[] = [];
        expect(drawStrokeWriteGlyph(target.ctx, glyph, 1, place, ctx => drawn.push(ctx))).toBe(true);
        expect(drawn).toHaveLength(1);
        expect(drawn[0]).toBe(target.ctx);
        expect(target.calls.some(c => c[0] === 'drawImage')).toBe(false);
    });

    it('masks mid-write: the current stroke draws its region then a source-in dashed brush, written strokes fill their region and stroke a seam, the glyph goes in source-in', () => {
        const target = targetAt({ e: 3.25, f: -1.5 });
        scratch.calls.length = 0;
        const drawn: unknown[] = [];
        // 两笔一样长：0.75 = 第一笔写完、第二笔写到一半
        expect(drawStrokeWriteGlyph(target.ctx, glyph, 0.75, place, ctx => { drawn.push(ctx); })).toBe(true);
        const names = scratch.calls.map(c => c[0]);
        expect(names).not.toContain('clip');
        // 先是正在写的第二笔的区域（fill + stroke），再 source-in 的笔刷
        const fills = scratch.calls.map((c, i) => (c[0] === 'fill' ? i : -1)).filter(i => i >= 0);
        expect(fills).toHaveLength(2);
        const brushIn = scratch.calls.findIndex(c => c[0] === 'set:globalCompositeOperation' && c[1] === 'source-in');
        expect(brushIn).toBeGreaterThan(fills[0]);
        expect(brushIn).toBeLessThan(fills[1]);
        const dash = scratch.calls.filter(c => c[0] === 'setLineDash').map(c => (c[1] as number[]).slice());
        expect(dash.some(d => Math.abs(d[0] - 600) < 1e-6)).toBe(true);
        // 字 source-in 在最后一次 stroke 之后
        const glyphIn = scratch.calls.map((c, i) => (c[0] === 'set:globalCompositeOperation' && c[1] === 'source-in' ? i : -1)).filter(i => i >= 0).pop() ?? -1;
        expect(glyphIn).toBeGreaterThan(names.lastIndexOf('stroke'));
        expect(drawn).toHaveLength(1);
        expect(drawn[0]).toBe(scratch.ctx);

        const blit = target.calls.find(c => c[0] === 'drawImage');
        expect(blit).toBeDefined();
        const [, , , , W, H, dx, dy, dw, dh] = blit as [string, unknown, number, number, number, number, number, number, number, number];
        // 贴回来是 1:1 设备像素，原点在整数设备像素上，盖住整个轮廓外框
        expect(dw).toBeCloseTo(W / 2);
        expect(dh).toBeCloseTo(H / 2);
        expect(Number.isInteger(dx * 2 + 3.25)).toBe(true);
        expect(Number.isInteger(dy * 2 - 1.5)).toBe(true);
        const { k, tx, ty } = strokeUnitsToWorld(place);
        expect(dx).toBeLessThanOrEqual(tx + 300 * k);
        expect(dy).toBeLessThanOrEqual(ty + 300 * k);
        expect(dx + dw).toBeGreaterThanOrEqual(tx + 1700 * k);
        expect(dy + dh).toBeGreaterThanOrEqual(ty + 1700 * k);
    });

    it('with a display-weight fit: regions stroke 2 × (dilate + seam), add the leftover ink, use the fitted brush, and the scratch box grows', () => {
        const target = targetAt({});
        scratch.calls.length = 0;
        const fit: StrokeFit = {
            dilate: 40,
            leftover: [[], [square(1050, 1750, 1150, 1900)]],
            brush: new Float32Array([500, 700]),
            reachPx: 5,
        };
        expect(drawStrokeWriteGlyph(target.ctx, glyph, 0.75, place, () => undefined, { fit })).toBe(true);
        const { k } = strokeUnitsToWorld(place);
        const seam = 1 / (2 * k);
        const widths = scratch.calls.filter(c => c[0] === 'set:lineWidth').map(c => c[1] as number);
        expect(widths.some(w => Math.abs(w - 2 * (40 + seam)) < 1e-6)).toBe(true);
        expect(widths).toContain(700);
        // 第二笔（正在写）有剩下的墨：区域里多一次 fill
        expect(scratch.calls.filter(c => c[0] === 'fill')).toHaveLength(3);
        const blit = target.calls.find(c => c[0] === 'drawImage') as [string, unknown, number, number, number, number, number, number, number, number];
        const { ty } = strokeUnitsToWorld(place);
        expect(blit[7] + blit[9]).toBeGreaterThanOrEqual(ty + 1900 * k);
    });

    it('can force the mask at full progress (placement checks)', () => {
        const target = targetAt({});
        scratch.calls.length = 0;
        expect(drawStrokeWriteGlyph(target.ctx, glyph, 1, place, () => undefined, { forceMask: true })).toBe(true);
        expect(scratch.calls.filter(c => c[0] === 'fill')).toHaveLength(2);
        expect(target.calls.some(c => c[0] === 'drawImage')).toBe(true);
    });

    it('gives up on a rotated transform so the caller draws plain', () => {
        const target = targetAt({ b: 0.3 });
        expect(drawStrokeWriteGlyph(target.ctx, glyph, 0.5, place, () => undefined)).toBe(false);
    });
});
