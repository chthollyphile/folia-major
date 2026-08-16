import { describe, expect, it } from 'vitest';
import { buildBrutInstallUnits } from '@/components/visualizer/brut/brutLyricUnits';
import { BRUT_MAX_INSTALL_UNITS } from '@/components/visualizer/brut/brutConstants';
import type { Line, Word } from '@/types';

// test/unit/visualizer/brutLyricUnits.test.ts
// The units that get bolted onto a lyric frame one at a time.

const word = (text: string, startTime: number, endTime: number): Word => ({ text, startTime, endTime });

const line = (fullText: string, words: Word[]): Line => ({
    fullText,
    words,
    startTime: words[0]?.startTime ?? 0,
    endTime: words[words.length - 1]?.endTime ?? 1,
});

describe('buildBrutInstallUnits', () => {
    it('glues trailing CJK punctuation onto the character before it', () => {
        const units = buildBrutInstallUnits(line('世界。', [word('世', 0, 1), word('界', 1, 2), word('。', 2, 3)]));
        expect(units.map(unit => unit.text)).toEqual(['世', '界。']);
        expect(units[1].endTime).toBe(3);
    });

    it('installs an english contraction as one plate', () => {
        const units = buildBrutInstallUnits(line('It’s', [word('It', 0, 1), word('’', 1, 1.1), word('s', 1.1, 1.4)]));
        expect(units).toHaveLength(1);
        expect(units[0].text).toBe('It’s');
        expect(units[0].endTime).toBeCloseTo(1.4, 5);
    });

    it('keeps every unit an exact slice of the line text', () => {
        const source = line('走吧, 现在', [
            word('走', 0, 1), word('吧', 1, 2), word(',', 2, 2.2), word('现', 2.2, 3), word('在', 3, 4),
        ]);
        buildBrutInstallUnits(source).forEach((unit) => {
            expect(source.fullText.slice(unit.charStart, unit.charEnd)).toBe(unit.text);
        });
    });

    it('keeps offsets and timings monotonic', () => {
        const source = line('你好世界再见', Array.from('你好世界再见', (char, index) => word(char, index, index + 1)));
        const units = buildBrutInstallUnits(source);
        for (let index = 1; index < units.length; index += 1) {
            expect(units[index].charStart).toBeGreaterThanOrEqual(units[index - 1].charEnd);
            expect(units[index].startTime).toBeGreaterThanOrEqual(units[index - 1].startTime);
        }
    });

    it('merges adjacent units until a very long line fits the batch', () => {
        const text = '字'.repeat(120);
        const words = Array.from(text, (char, index) => word(char, index * 0.1, (index + 1) * 0.1));
        const units = buildBrutInstallUnits(line(text, words));
        expect(units.length).toBeLessThanOrEqual(BRUT_MAX_INSTALL_UNITS);
        expect(units[0].startTime).toBe(0);
        expect(units[units.length - 1].endTime).toBeCloseTo(12, 5);
        expect(units.map(unit => unit.text).join('')).toBe(text);
    });

    it('returns nothing for a blank line', () => {
        expect(buildBrutInstallUnits(line('', []))).toEqual([]);
        expect(buildBrutInstallUnits(line('   ', [word('   ', 0, 1)]))).toEqual([]);
    });
});
