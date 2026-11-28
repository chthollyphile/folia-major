import { describe, expect, it } from 'vitest';
import { blockHasModelChars, resolveGlyphTimes } from '@/components/visualizer/fume/fumeHandwriting';
import type { FumeBlock } from '@/components/visualizer/fume/fumeTypes';

// test/unit/visualizer/fumeHandwriting.test.ts
// 浮名手写笔画的纯逻辑：字在词里的时间、哪些句子有要手写的字（书写窗口和冻结规则在 strokeWriteTiming.test.ts）。

const block = (start: number, text: string, variant: 'body' | 'hero' = 'body') => ({
    line: { startTime: start }, graphemes: [...text], variant,
}) as unknown as FumeBlock;
const isHan = (ch: string) => ch >= '一' && ch <= '鿿';

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
