import { describe, expect, it } from 'vitest';
import type { NebbiaSourceLine } from '@/components/visualizer/nebbia/nebbiaChars';
import { measureGlyph, type Glyph, type Pt } from '@/components/visualizer/nebbia/nebbiaGlyphs';
import { buildNebbiaScene } from '@/components/visualizer/nebbia/nebbiaScene';
import { swapLineGlyphs } from '@/components/visualizer/nebbia/nebbiaSceneUpdate';
import { normalizeNebbiaTuning } from '@/components/visualizer/nebbia/tuning';

// test/unit/visualizer/nebbiaSceneUpdate.test.ts
// 雾笺字体笔画晚到：只换某几句的字形（swapLineGlyphs）和整首按同样字形重排（buildNebbiaScene）得到同样的结果；别的句子原样不动。

const tuning = normalizeNebbiaTuning({});
const size = { W: 1280, H: 720, fontScale: 1 };
const LINES = 7, PER = 5;
// 每句用自己的一组字（码点不重叠），换某句的字形不会碰到别的句子
const chOf = (li: number, i: number) => String.fromCodePoint(0x4e00 + li * 10 + i);
const source: NebbiaSourceLine[] = Array.from({ length: LINES }, (_, li) => ({
    chars: Array.from({ length: PER }, (_, i) => ({ ch: chOf(li, i), t: li * 3 + i * 0.4, d: 0.4 })),
    words: [[0, 1], [2, 3, 4]],
    t: li * 3, end: li * 3 + PER * 0.4, next: li === LINES - 1 ? Infinity : (li + 1) * 3,
}));

/** 假字形：笔数和长度由字和 variant 决定（variant 1 = 模型的字，笔画更多更长）。 */
const glyphOf = (ch: string, variant: number): Glyph => {
    const n = 2 + (ch.codePointAt(0)! % 4) + variant * 3;
    const polys = Array.from({ length: n }, (_, k): Pt[] => [[0.1 + k * 0.05, 0.1], [0.2 + k * 0.05, 0.5 + variant * 0.2], [0.1 + k * 0.05, 0.9]]);
    return measureGlyph(polys)!;
};
const cache = (variantOf: (ch: string) => number) => {
    const made = new Map<string, Glyph>();
    return { get: (ch: string) => { const v = variantOf(ch), k = `${v}${ch}`; if (!made.has(k)) made.set(k, glyphOf(ch, v)); return made.get(k)!; } };
};

describe('nebbia scene update', () => {
    const lineOf = (ch: string) => Math.floor((ch.codePointAt(0)! - 0x4e00) / 10);

    it('swapping a line\'s glyphs equals a full build with those glyphs', () => {
        const laid = buildNebbiaScene(source, cache(() => 0), tuning, size, 'seed-a');
        const model = cache(ch => (lineOf(ch) === 4 ? 1 : 0));
        swapLineGlyphs(laid, source, model, tuning, 'seed-a', [4]);
        const full = buildNebbiaScene(source, model, tuning, size, 'seed-a');
        expect(laid).toEqual(full);
    });

    it('also holds for several lines at once and with the credit/yield pass in play', () => {
        const laid = buildNebbiaScene(source, cache(() => 0), tuning, size, 's2');
        const model = cache(ch => ([2, 3, 6].includes(lineOf(ch)) ? 1 : 0));
        swapLineGlyphs(laid, source, model, tuning, 's2', [2, 3, 6]);
        expect(laid).toEqual(buildNebbiaScene(source, model, tuning, size, 's2'));
    });

    it('leaves the other lines\' characters untouched', () => {
        const laid = buildNebbiaScene(source, cache(() => 0), tuning, size, 'seed-a');
        const before = laid.map(l => l.chars);
        swapLineGlyphs(laid, source, cache(ch => (lineOf(ch) === 5 ? 1 : 0)), tuning, 'seed-a', [5]);
        laid.forEach((l, li) => { if (li !== 5) expect(l.chars).toBe(before[li]); });
        expect(laid[5].chars).not.toBe(before[5]);
    });
});

describe('nebbia scene update with started lines', () => {
    const lineOf = (ch: string) => Math.floor((ch.codePointAt(0)! - 0x4e00) / 10);
    it('keeps the timings of started lines and matches a full build on the rest', () => {
        const laid = buildNebbiaScene(source, cache(() => 0), tuning, size, 's3');
        const timings = (l: (typeof laid)[number]) => [l.fogAt, l.yieldAt, l.breathAt, l.breathUntil, l.breathDur, l.appearBreathAt, l.appearBreathUntil, ...l.chars.flatMap(c => [c.wt, c.wd])];
        const before = laid.map(timings);
        const model = cache(ch => ([4, 5].includes(lineOf(ch)) ? 1 : 0));
        swapLineGlyphs(laid, source, model, tuning, 's3', [4, 5], li => li < 3);
        const full = buildNebbiaScene(source, model, tuning, size, 's3');
        for (let li = 0; li < LINES; li += 1) {
            if (li < 3) expect(timings(laid[li])).toEqual(before[li]);
            else expect(laid[li]).toEqual(full[li]);
        }
    });
});
