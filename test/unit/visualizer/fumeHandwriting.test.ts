import { describe, expect, it } from 'vitest';
import {
    blockHasModelChars, buildHandwritingDemand, findHandwritingAnchor, resolveGlyphTimes, resolveHandwritingGlyph, resolveHandwritingProgress,
} from '@/components/visualizer/fume/fumeHandwriting';
import type { FumeBlock } from '@/components/visualizer/fume/fumeTypes';

// test/unit/visualizer/fumeHandwriting.test.ts
// 浮名手写笔画的纯逻辑：书写窗口（时长夹在 0.3..1.0 秒）、冻结规则、要向队列报的字。

const block = (start: number, text: string, variant: 'body' | 'hero' = 'body') => ({
    line: { startTime: start }, graphemes: [...text], variant,
}) as unknown as FumeBlock;
const isHan = (ch: string) => ch >= '一' && ch <= '鿿';

describe('resolveHandwritingProgress', () => {
    it('is null before the window and after it', () => {
        expect(resolveHandwritingProgress(10, 10.5, 9.99)).toBeNull();
        expect(resolveHandwritingProgress(10, 10.5, 10.5)).toBeNull();
        expect(resolveHandwritingProgress(10, 10.5, 11)).toBeNull();
        expect(resolveHandwritingProgress(Number.NaN, 11, 10)).toBeNull();
    });

    it('lasts the grapheme duration clamped to 0.3..1.0 s, and eases out', () => {
        // 0.1 s 的字也写 0.3 s；5 s 的字只写 1 s
        expect(resolveHandwritingProgress(0, 0.1, 0.29)).not.toBeNull();
        expect(resolveHandwritingProgress(0, 0.1, 0.3)).toBeNull();
        expect(resolveHandwritingProgress(0, 5, 0.99)).not.toBeNull();
        expect(resolveHandwritingProgress(0, 5, 1)).toBeNull();
        // 缓出：过一半时间已经写过一半以上
        expect(resolveHandwritingProgress(0, 0.6, 0.3)!).toBeGreaterThan(0.5);
        expect(resolveHandwritingProgress(0, 0.6, 0)).toBe(0);
    });
});

describe('resolveHandwritingGlyph', () => {
    const state = (decisions: Map<string, boolean>, time: number, has: () => boolean) => resolveHandwritingGlyph(decisions, 'k', time, 10, 10.5, has);

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

    it('decides when the char is first seen and keeps it: a reveal arriving later never turns a visible plain char invisible', () => {
        const d = new Map<string, boolean>();
        let has = false;
        expect(state(d, 5, () => has)).toBeNull();
        has = true;
        expect(state(d, 9.99, () => has)).toBeNull();
        expect(state(d, 10.2, () => has)).toBeNull();
    });

    it('keeps a reveal that was there at first sight even if it goes away later', () => {
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
        expect(resolveHandwritingGlyph(new Map(), 'k', 5, Number.NaN, Number.NaN, () => true)).toBeNull();
    });
});

describe('resolveGlyphTimes', () => {
    it('spreads an untimed word evenly and prefers syllable timings', () => {
        const range = { start: 4, end: 6, word: { startTime: 1, endTime: 2 }, graphemeTimings: [] } as never;
        expect(resolveGlyphTimes(range, 5)).toEqual({ start: 1.5, end: 2 });
        const timed = { start: 4, end: 6, word: { startTime: 1, endTime: 2, syllables: [{}, {}] }, graphemeTimings: [{ startTime: 1, endTime: 1.2 }, { startTime: 1.2, endTime: 2 }] } as never;
        expect(resolveGlyphTimes(timed, 5)).toEqual({ start: 1.2, end: 2 });
    });
});

describe('blockHasModelChars', () => {
    it('tells blocks with Han / kana from the rest', () => {
        expect(blockHasModelChars(block(0, 'abc'), isHan)).toBe(false);
        expect(blockHasModelChars(block(0, 'a永'), isHan)).toBe(true);
    });
});

describe('handwriting demand', () => {
    const blocks = [0, 10, 20, 30, 40, 50, 60].map((t, i) => block(t, `${'一二三四五六七'[i]}a`, i === 0 ? 'hero' : 'body'));

    it('anchors on the last line that has started', () => {
        expect(findHandwritingAnchor(blocks, -5)).toBe(0);
        expect(findHandwritingAnchor(blocks, 10)).toBe(1);
        expect(findHandwritingAnchor(blocks, 35)).toBe(3);
        expect(findHandwritingAnchor(blocks, 999)).toBe(6);
    });

    it('is the current + next 4 lines near, the rest far, earlier lines last; model chars only, with the variant weight', () => {
        const demand = buildHandwritingDemand(blocks, 1, v => (v === 'hero' ? 780 : 640), isHan);
        expect(demand.map(d => d.ch).join('')).toBe('二三四五六七一');
        expect(demand.filter(d => d.near).map(d => d.ch).join('')).toBe('二三四五六');
        expect(demand.find(d => d.ch === '七')!.near).toBe(false);
        expect(demand.find(d => d.ch === '一')).toMatchObject({ near: false, weight: 780 });
        expect(demand.find(d => d.ch === '二')!.weight).toBe(640);
    });

    it('lists a char once per weight', () => {
        const twice = [block(0, '一', 'hero'), block(5, '一', 'body'), block(9, '一', 'body')];
        const demand = buildHandwritingDemand(twice, 0, v => (v === 'hero' ? 780 : 640), isHan);
        expect(demand.map(d => d.weight)).toEqual([780, 640]);
    });
});
