import { describe, expect, it } from 'vitest';
import { buildLineGraphemeTimeline, buildWordGraphemeTimings } from '@/utils/lyrics/graphemeTiming';
import type { Line, Word } from '@/types';

// test/unit/lyrics/graphemeTiming.test.ts
// Covers pure lyric grapheme timing helpers used by visualizer runtimes.

describe('graphemeTiming', () => {
    it('spreads untimed word graphemes evenly across the word duration', () => {
        const word: Word = { text: 'abc', startTime: 0, endTime: 3 };

        expect(buildWordGraphemeTimings(word)).toEqual([
            { char: 'a', startTime: 0, endTime: 1 },
            { char: 'b', startTime: 1, endTime: 2 },
            { char: 'c', startTime: 2, endTime: 3 },
        ]);
    });

    it('uses TTML syllable timing before falling back to whole-word timing', () => {
        const word: Word = {
            text: 'hurricane',
            startTime: 1,
            endTime: 2,
            syllables: [
                { text: 'hurri', startTime: 1, endTime: 1.4 },
                { text: 'cane', startTime: 1.4, endTime: 2, endsWithSpace: true },
            ],
        };

        const timings = buildWordGraphemeTimings(word);

        expect(timings).toHaveLength(9);
        expect(timings[0]).toEqual({ char: 'h', startTime: 1, endTime: 1.08 });
        expect(timings[5].char).toBe('c');
        expect(timings[5].startTime).toBeCloseTo(1.4);
        expect(timings[5].endTime).toBeCloseTo(1.55);
        expect(timings[8].char).toBe('e');
        expect(timings[8].startTime).toBeCloseTo(1.85);
        expect(timings[8].endTime).toBe(2);
    });

    it('maps word timings back onto the full line grapheme stream', () => {
        const line: Line = {
            fullText: 'hurricane 風',
            startTime: 1,
            endTime: 2.5,
            words: [
                {
                    text: 'hurricane',
                    startTime: 1,
                    endTime: 2,
                    syllables: [
                        { text: 'hurri', startTime: 1, endTime: 1.4 },
                        { text: 'cane', startTime: 1.4, endTime: 2, endsWithSpace: true },
                    ],
                },
                {
                    text: '風',
                    startTime: 2,
                    endTime: 2.5,
                    syllables: [
                        { text: '風', startTime: 2, endTime: 2.5, ruby: [{ text: 'かぜ', startTime: 2, endTime: 2.5 }] },
                    ],
                },
            ],
        };

        const timeline = buildLineGraphemeTimeline(line);

        expect(timeline.map(item => item.char).join('')).toBe('hurricane 風');
        expect(timeline[0].startTime).toBe(1);
        expect(timeline[5].startTime).toBe(1.4);
        expect(timeline[9]).toEqual({ char: ' ', startTime: 2, endTime: 2 });
        expect(timeline[10]).toEqual({ char: '風', startTime: 2, endTime: 2.5, wordIndex: 1 });
    });

    it('keeps emoji and CJK graphemes intact in fallback timing', () => {
        const word: Word = { text: '你😊好', startTime: 4, endTime: 7 };
        const timings = buildWordGraphemeTimings(word);

        expect(timings.map(item => item.char)).toEqual(['你', '😊', '好']);
        expect(timings.map(item => item.startTime)).toEqual([4, 5, 6]);
        expect(timings[2].endTime).toBe(7);
    });
});
