// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layoutMotesText, prepareMotesLine } from '@/components/visualizer/motes/motesLayout';
import * as motesSampling from '@/components/visualizer/motes/motesSampling';
import { splitLyricGraphemes } from '@/utils/lyrics/graphemeTiming';
import type { Line } from '@/types';

// Keep Pretext's real wrapping and cursors; only font measurement and glyph rasterization are deterministic substitutes.

const options = { width: 640, height: 320, fontFamily: 'sans-serif', fontWeight: 600, fontScale: 1, density: 1 };
const makeLine = (fullText: string): Line => ({ fullText, startTime: 0, endTime: 5, words: [] });
const { MAX_MOTES_PARTICLES, RECOMMENDED_MOTES_PARTICLES } = motesSampling;

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((function (this: HTMLCanvasElement) {
        let scale = 1;
        const rectangles: number[][] = [];
        return {
            font: '16px sans-serif',
            scale(x: number) { scale = x; },
            measureText(text: string) {
                const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 16);
                return { width: splitLyricGraphemes(text).length * size * 0.6 };
            },
            fillText(text: string, left: number, centerY: number) {
                const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 16);
                splitLyricGraphemes(text).forEach((glyph, index) => {
                    if (glyph.trim()) rectangles.push([
                        (left + index * size * 0.6) * scale, (centerY - size * 0.4) * scale,
                        size * 0.5 * scale, size * 0.8 * scale,
                    ]);
                });
            },
            getImageData(_x: number, _y: number, width: number, height: number) {
                const data = new Uint8ClampedArray(width * height * 4);
                for (const [left, top, rectWidth, rectHeight] of rectangles) {
                    for (let y = Math.max(0, Math.ceil(top)); y < Math.min(height, top + rectHeight); y += 1) {
                        for (let x = Math.max(0, Math.ceil(left)); x < Math.min(width, left + rectWidth); x += 1) {
                            data[(y * width + x) * 4 + 3] = 255;
                        }
                    }
                }
                return { width, height, data };
            },
        };
    }) as never);
});

afterEach(() => vi.restoreAllMocks());

describe('Motes text targets', () => {
    it('preserves repeated Chinese words, spaces and a joined emoji with their separate word timings', () => {
        const line: Line = {
            fullText: '你好 👨‍👩‍👧‍👦 你好', startTime: 1, endTime: 4,
            words: [
                { text: '你好', startTime: 1, endTime: 2 },
                { text: '👨‍👩‍👧‍👦', startTime: 2, endTime: 3 },
                { text: '你好', startTime: 3, endTime: 4 },
            ],
        };
        const original = structuredClone(line);
        const prepared = prepareMotesLine(line, options);
        expect(prepared.timings.map(glyph => glyph.char)).toEqual(['你', '好', ' ', '👨‍👩‍👧‍👦', ' ', '你', '好']);
        expect(prepared.timings[0]).toMatchObject({ wordIndex: 0, startTime: 1 });
        expect(prepared.timings[3]).toMatchObject({ wordIndex: 1, startTime: 2, endTime: 3 });
        expect(prepared.timings[5]).toMatchObject({ wordIndex: 2, startTime: 3 });
        expect(new Set(prepared.glyphIndices)).toEqual(new Set([0, 1, 3, 5, 6]));
        expect(prepared.x.length).toBeGreaterThan(0);
        expect(line).toEqual(original);
    });

    it('retains source offsets across wrapped repetitions instead of matching every row to the first occurrence', () => {
        const line = makeLine('again again again 你好 👨‍👩‍👧‍👦 again again 你好');
        const graphemes = splitLyricGraphemes(line.fullText);
        const layout = layoutMotesText(line, { ...options, width: 180, height: 240 });
        expect(layout.rows.length).toBeGreaterThan(1);
        layout.rows.forEach((row, index) => {
            expect(graphemes.slice(row.start, row.end).join('')).toBe(row.text);
            if (index) expect(row.start).toBeGreaterThanOrEqual(layout.rows[index - 1].end);
        });
        expect(layout.rows.at(-1)!.end).toBe(graphemes.length);
    });

    it('fits a long sentence without truncating the source or exceeding the particle budget', () => {
        const line = makeLine('很长的歌词 👨‍👩‍👧‍👦 repeats again '.repeat(30));
        const layout = layoutMotesText(line, { ...options, width: 320, height: 180, density: 1.6 });
        const prepared = prepareMotesLine(line, { ...options, width: 320, height: 180, density: 1.6 });
        expect(prepared.timings.map(glyph => glyph.char).join('')).toBe(line.fullText);
        expect(layout.rows.at(-1)!.end).toBe(splitLyricGraphemes(line.fullText).length);
        expect(layout.rows.every(row => row.left >= 0 && row.left + row.width <= 320)).toBe(true);
        expect(layout.rows[0].top).toBeGreaterThanOrEqual(0);
        expect(layout.rows.at(-1)!.top + layout.lineHeight).toBeLessThanOrEqual(180);
        expect(prepared.x.length).toBeGreaterThan(0);
        expect(prepared.x.length).toBeLessThanOrEqual(MAX_MOTES_PARTICLES);
        expect([...prepared.glyphIndices].every(index => index < prepared.timings.length)).toBe(true);
    });

    it('keeps wrapped Chinese readable and gives long lyrics more than the short-line particle allowance', () => {
        const line = makeLine('当夜空中的星光缓缓落在你的眼里我们穿过漫长的时间仍然记得最初相遇的模样让所有温柔的心愿都在此刻变成清晰而明亮的诗行');
        const narrow = { ...options, width: 249, height: 310 };
        const layout = layoutMotesText(line, narrow);
        const graphemes = splitLyricGraphemes(line.fullText);
        expect(layout.rows.length).toBeGreaterThan(1);
        expect(layout.fontPx).toBeGreaterThanOrEqual(24);
        layout.rows.forEach(row => {
            expect(graphemes.slice(row.start, row.end).join('')).toBe(row.text);
            expect(row.left).toBeGreaterThanOrEqual(0);
            expect(row.left + row.width).toBeLessThanOrEqual(narrow.width);
        });
        expect(layout.rows.at(-1)!.end).toBe(graphemes.length);
        expect(layout.rows[0].top).toBeGreaterThanOrEqual(0);
        expect(layout.rows.at(-1)!.top + layout.lineHeight).toBeLessThanOrEqual(narrow.height);
        const dense = prepareMotesLine(line, narrow);
        const sparse = prepareMotesLine(line, { ...narrow, density: 0.6 });
        expect(dense.x.length).toBeGreaterThan(RECOMMENDED_MOTES_PARTICLES);
        expect(dense.x.length).toBeLessThanOrEqual(MAX_MOTES_PARTICLES);
        expect(sparse.x.length).toBeLessThan(dense.x.length);
        expect(sparse.particleSize).toBeGreaterThan(dense.particleSize);
        expect(sparse.timings).toEqual(dense.timings);
        expect(new Set(sparse.glyphIndices)).toEqual(new Set(dense.glyphIndices));
        expect(prepareMotesLine(line, { ...narrow, density: 0.6 })).toEqual(sparse);
    });

    it('keeps the short-line budget unchanged when joined glyphs or whitespace add source code units', () => {
        const sampler = vi.spyOn(motesSampling, 'sampleMotesMask');
        const short = prepareMotesLine(makeLine('你好 👨‍👩‍👧‍👦 é'), options);
        expect(short.x.length).toBeGreaterThan(0);
        expect(short.x.length).toBeLessThanOrEqual(RECOMMENDED_MOTES_PARTICLES);
        expect(sampler).toHaveBeenLastCalledWith(expect.anything(),
            expect.objectContaining({ maxPoints: RECOMMENDED_MOTES_PARTICLES }));
        prepareMotesLine(makeLine(`你好${' '.repeat(30)}👨‍👩‍👧‍👦 é`), options);
        expect(sampler).toHaveBeenLastCalledWith(expect.anything(),
            expect.objectContaining({ maxPoints: RECOMMENDED_MOTES_PARTICLES }));
    });

    it('prepares no particles for an empty line or an unmeasured viewport', () => {
        expect(prepareMotesLine(makeLine('   '), options).x).toHaveLength(0);
        expect(prepareMotesLine(makeLine('Hello'), { ...options, width: 0 }).x).toHaveLength(0);
    });
});
