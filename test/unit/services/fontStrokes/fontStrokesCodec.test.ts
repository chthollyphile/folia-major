import { describe, expect, it } from 'vitest';
import { decodeFontStrokesGlyph, encodeFontStrokesGlyph } from '../../../../src/services/fontStrokes/fontStrokesCodec';
import type { FontStrokesGlyph } from '../../../../src/services/fontStrokes/fontStrokesOutline';

// test/unit/services/fontStrokes/fontStrokesCodec.test.ts
// 编解码：往返一致、负数和大跳变、空笔、坏数据返回 null。

const sample = (): FontStrokesGlyph => ({
    pens: [new Int16Array([-100, 200, -90, 230, 32767, -32768]), new Int16Array([5, 5])],
    outlines: [[new Int16Array([0, 0, 40, 0, 40, 40, 0, 40]), new Int16Array([10, 10, 20, 10, 20, 20])], []],
    brush: new Uint8Array([123, 0]),
});

describe('fontStrokesCodec', () => {
    it('往返一致', () => {
        const g = sample();
        const back = decodeFontStrokesGlyph(encodeFontStrokesGlyph(g));
        expect(back).not.toBeNull();
        expect(back!.pens).toEqual(g.pens);
        expect(back!.outlines).toEqual(g.outlines);
        expect(Array.from(back!.brush)).toEqual([123, 0]);
    });

    it('零笔的字', () => {
        const g: FontStrokesGlyph = { pens: [], outlines: [], brush: new Uint8Array(0) };
        expect(decodeFontStrokesGlyph(encodeFontStrokesGlyph(g))).toEqual(g);
    });

    it('相邻点差小时一个点两字节左右', () => {
        const pts = new Int16Array(200);
        for (let i = 0; i < 100; i += 1) { pts[2 * i] = 1000 + i * 20; pts[2 * i + 1] = -500 + i * 7; }
        const bytes = encodeFontStrokesGlyph({ pens: [pts], outlines: [[]], brush: new Uint8Array(1) });
        expect(bytes.length).toBeLessThan(pts.byteLength / 1.8);
    });

    it('截断、多余字节、乱数据都是 null', () => {
        const bytes = encodeFontStrokesGlyph(sample());
        expect(decodeFontStrokesGlyph(bytes.subarray(0, bytes.length - 1))).toBeNull();
        expect(decodeFontStrokesGlyph(new Uint8Array([...bytes, 0]))).toBeNull();
        expect(decodeFontStrokesGlyph(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toBeNull();
        expect(decodeFontStrokesGlyph(new Uint8Array(0))).toBeNull();
    });
});
