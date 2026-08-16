import { describe, expect, it } from 'vitest';
import { buildLineGraphemeTimeline } from '@/utils/lyrics/graphemeTiming';
import { buildGraphemeDisplayUnits } from '@/utils/lyrics/graphemeUnits';
import type { Line, Word } from '@/types';

// test/unit/lyrics/graphemeUnits.test.ts
// Locks the shared grapheme -> display unit rule used by per-character visualizers.

const word = (text: string, startTime: number, endTime: number): Word => ({ text, startTime, endTime });

const line = (fullText: string, words: Word[]): Line => ({
    fullText,
    words,
    startTime: words[0]?.startTime ?? 0,
    endTime: words[words.length - 1]?.endTime ?? 1,
});

const build = (input: Line) => buildGraphemeDisplayUnits(input.fullText, buildLineGraphemeTimeline(input));

describe('buildGraphemeDisplayUnits', () => {
    it('gives every CJK grapheme its own unit', () => {
        const units = build(line('你好世界', [word('你好', 0, 1), word('世界', 1, 2)]));
        expect(units.map(unit => unit.text)).toEqual(['你', '好', '世', '界']);
        expect(units[0].startTime).toBe(0);
        expect(units[3].endTime).toBe(2);
    });

    it('keeps a latin word whole and never emits whitespace as a unit', () => {
        const units = build(line('hold me now', [word('hold', 0, 1), word('me', 1, 2), word('now', 2, 3)]));
        expect(units.map(unit => unit.text)).toEqual(['hold', 'me', 'now']);
    });

    it('preserves whitespace inside the character offsets it skips', () => {
        const source = line('hold me', [word('hold', 0, 1), word('me', 1, 2)]);
        const units = build(source);
        expect(source.fullText.slice(units[0].charStart, units[0].charEnd)).toBe('hold');
        expect(source.fullText.slice(units[1].charStart, units[1].charEnd)).toBe('me');
        expect(units[1].charStart - units[0].charEnd).toBe(1);
    });

    it('reconstructs the line once whitespace runs are removed', () => {
        const source = line('go on 走 吧', [
            word('go', 0, 1), word('on', 1, 2), word('走', 2, 3), word('吧', 3, 4),
        ]);
        const units = build(source);
        expect(units.map(unit => unit.text).join('')).toBe(source.fullText.replace(/\s+/g, ''));
    });

    it('never lets a repeated word borrow another occurrence timing', () => {
        const units = build(line('走 走', [word('走', 0, 1), word('走', 4, 5)]));
        expect(units).toHaveLength(2);
        expect(units[0].startTime).toBe(0);
        expect(units[1].startTime).toBe(4);
        expect(units[0].charStart).toBeLessThan(units[1].charStart);
    });

    it('returns nothing for blank input', () => {
        expect(buildGraphemeDisplayUnits('', [])).toEqual([]);
        expect(build(line('   ', [word('   ', 0, 1)]))).toEqual([]);
    });
});
