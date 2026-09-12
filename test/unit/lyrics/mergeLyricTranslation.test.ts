import { describe, expect, it } from 'vitest';
import { mergeLyricTranslation } from '@/utils/lyrics/mergeLyricTranslation';
import type { LyricData } from '@/types';

// test/unit/lyrics/mergeLyricTranslation.test.ts

const line = (startTime: number, fullText: string, translation?: string) => ({ startTime, endTime: startTime + 1, fullText, words: [], ...(translation ? { translation } : {}) });

describe('mergeLyricTranslation', () => {
    it('attaches donor translations by start time and keeps the base text and timing', () => {
        const base: LyricData = { lines: [line(1, 'one'), line(5, 'five'), line(9.4, 'nine')], isWordByWord: true };
        const donor: LyricData = { lines: [line(1.3, 'uno', '一'), line(5, 'cinco', '五'), line(20, 'far', '远')] };
        const merged = mergeLyricTranslation(base, donor);
        expect(merged?.lines.map(item => [item.fullText, item.translation])).toEqual([['one', '一'], ['five', '五'], ['nine', undefined]]);
        expect(merged?.isWordByWord).toBe(true);
        expect(base.lines[0].translation).toBeUndefined();
    });
    it('returns null when the donor has no translations or nothing lines up', () => {
        const base: LyricData = { lines: [line(1, 'one')] };
        expect(mergeLyricTranslation(base, { lines: [line(1, 'uno')] })).toBeNull();
        expect(mergeLyricTranslation(base, { lines: [line(30, 'uno', '一')] })).toBeNull();
    });
    it('does not overwrite translations the base already has', () => {
        const base: LyricData = { lines: [line(1, 'one', '壹'), line(2, 'two')] };
        const merged = mergeLyricTranslation(base, { lines: [line(1, 'uno', '一'), line(2, 'dos', '二')] });
        expect(merged?.lines.map(item => item.translation)).toEqual(['壹', '二']);
    });
});
