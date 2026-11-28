import { describe, expect, it } from 'vitest';
import {
    polylineLength, resolveStrokeProgress, resolveWriteGlyphState, resolveWriteProgress, resolveWriteWindowEnd,
} from '@/components/visualizer/fontStrokes/strokeWriteTiming';

// test/unit/visualizer/strokeWriteTiming.test.ts
// 手写笔画的时序：书写窗口（时长夹在 0.3..1.0 秒）、冻结规则、字内各笔按长度分时间。

describe('resolveWriteProgress', () => {
    it('is null before the window and after it', () => {
        expect(resolveWriteProgress(10, 10.5, 9.99)).toBeNull();
        expect(resolveWriteProgress(10, 10.5, 10.5)).toBeNull();
        expect(resolveWriteProgress(10, 10.5, 11)).toBeNull();
        expect(resolveWriteProgress(Number.NaN, 11, 10)).toBeNull();
    });

    it('lasts the grapheme duration clamped to 0.3..1.0 s, and eases out', () => {
        // 0.1 s 的字也写 0.3 s；5 s 的字只写 1 s
        expect(resolveWriteProgress(0, 0.1, 0.29)).not.toBeNull();
        expect(resolveWriteProgress(0, 0.1, 0.3)).toBeNull();
        expect(resolveWriteProgress(0, 5, 0.99)).not.toBeNull();
        expect(resolveWriteProgress(0, 5, 1)).toBeNull();
        expect(resolveWriteWindowEnd(0, 0.1)).toBeCloseTo(0.3);
        expect(resolveWriteWindowEnd(0, 5)).toBeCloseTo(1);
        // 缓出：过一半时间已经写过一半以上
        expect(resolveWriteProgress(0, 0.6, 0.3)!).toBeGreaterThan(0.5);
        expect(resolveWriteProgress(0, 0.6, 0)).toBe(0);
    });

    it('takes other clamps', () => {
        expect(resolveWriteWindowEnd(0, 5, { maxSeconds: 2 })).toBeCloseTo(2);
        expect(resolveWriteProgress(0, 0.1, 0.4, { minSeconds: 0.5 })).not.toBeNull();
    });
});

describe('resolveWriteGlyphState', () => {
    const state = (decisions: Map<string, boolean>, time: number, has: () => boolean) => resolveWriteGlyphState(decisions, 'k', time, 10, 10.5, has);

    it('is hidden before the write start (no dim underlay), writes inside the window, plain after it', () => {
        const d = new Map<string, boolean>();
        expect(state(d, 5, () => true)).toBe('hidden');
        expect(state(d, 9.99, () => true)).toBe('hidden');
        expect(state(d, 10, () => true)).toBe(0);
        expect(typeof state(d, 10.2, () => true)).toBe('number');
        expect(state(d, 10.5, () => true)).toBeNull();
        expect(state(d, 11, () => true)).toBeNull();
        expect(d.size).toBe(0);
    });

    it('decides when the char is first seen and keeps it: strokes arriving later never turn a visible plain char invisible', () => {
        const d = new Map<string, boolean>();
        let has = false;
        expect(state(d, 5, () => has)).toBeNull();
        has = true;
        expect(state(d, 9.99, () => has)).toBeNull();
        expect(state(d, 10.2, () => has)).toBeNull();
    });

    it('keeps handwriting decided at first sight even if the strokes go away later', () => {
        const d = new Map<string, boolean>();
        expect(state(d, 5, () => true)).toBe('hidden');
        expect(state(d, 10.2, () => false)).toEqual(expect.any(Number));
    });

    it('forgets after the window so a replay after a seek decides again', () => {
        const d = new Map<string, boolean>();
        state(d, 5, () => false);
        state(d, 11, () => true);
        expect(state(d, 5, () => true)).toBe('hidden');
    });

    it('is plain for a char without word timing', () => {
        expect(resolveWriteGlyphState(new Map(), 'k', 5, Number.NaN, Number.NaN, () => true)).toBeNull();
    });
});

describe('polylineLength', () => {
    it('sums the segments of a flat [x, y] list', () => {
        expect(polylineLength([0, 0, 3, 4, 3, 10])).toBeCloseTo(11);
        expect(polylineLength([1, 1])).toBe(0);
        expect(polylineLength(new Int16Array([]))).toBe(0);
    });
});

describe('resolveStrokeProgress', () => {
    const run = (weights: number[], p: number) => Array.from(resolveStrokeProgress(weights, p, new Float32Array(weights.length)));

    it('writes strokes one after another, each taking time in proportion to its weight', () => {
        expect(run([1, 3], 0)).toEqual([0, 0]);
        expect(run([1, 3], 0.125)).toEqual([0.5, 0]);
        expect(run([1, 3], 0.25)).toEqual([1, 0]);
        expect(run([1, 3], 0.625)).toEqual([1, 0.5]);
        expect(run([1, 3], 1)).toEqual([1, 1]);
    });

    it('gives zero-weight strokes no time: done as soon as the strokes before them are', () => {
        expect(run([0, 2, 0, 2], 0)).toEqual([0, 0, 0, 0]);
        expect(run([0, 2, 0, 2], 0.01)[0]).toBe(1);
        expect(run([0, 2, 0, 2], 0.4)).toEqual([1, expect.closeTo(0.8, 5), 0, 0]);
        expect(run([0, 2, 0, 2], 0.5)).toEqual([1, 1, 1, 0]);
    });

    it('clamps the progress and handles all-zero weights', () => {
        expect(run([1, 1], 2)).toEqual([1, 1]);
        expect(run([1, 1], -1)).toEqual([0, 0]);
        expect(run([1, 1], Number.NaN)).toEqual([0, 0]);
        expect(run([0, 0], 0.5)).toEqual([0, 0]);
        expect(run([0, 0], 1)).toEqual([1, 1]);
    });

    it('reuses the out array', () => {
        const out = new Float32Array(2);
        expect(resolveStrokeProgress([1, 1], 0.5, out)).toBe(out);
    });
});
