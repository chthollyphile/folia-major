import { describe, expect, it } from 'vitest';
import { getChorusMarkerFraction } from '@/components/progressChorusMarker';
import { applyChorusRangesByTime, findSourceChorusStart } from '@/utils/lyrics/chorusEffects';
import type { LyricData } from '@/types';

// test/unit/components/progressChorusMarker.test.ts
// The progress bar's chorus tick: only a chorus the lyric data marked, placed on the audio clock.

const lyrics = (lines: Partial<LyricData['lines'][number]>[]): LyricData => ({
    lines: lines.map((line, index) => ({ fullText: `line ${index}`, startTime: index * 10, endTime: index * 10 + 10, words: [], ...line })),
});

describe('findSourceChorusStart', () => {
    it('answers the first chorus line the lyric data marked', () => {
        expect(findSourceChorusStart(lyrics([
            {},
            { isChorus: true, chorusOrigin: 'text' },
            { isChorus: true, chorusOrigin: 'source', startTime: 42 },
            { isChorus: true, chorusOrigin: 'source', startTime: 90 },
        ]))).toBe(42);
    });

    it('starts at the source range, not at a line-timed line that runs into it', () => {
        // Line-timed lines end where the next begins: the range from 39.8 s also catches the line at 30 s.
        const marked = applyChorusRangesByTime(lyrics([{}, {}, {}, {}, {}]), [{ startTime: 39.8, endTime: 50 }]);
        expect(marked.lines.map(line => Boolean(line.isChorus))).toEqual([false, false, false, true, true]);
        expect(marked.sourceChorusRanges).toEqual([{ startTime: 39.8, endTime: 50 }]);
        expect(findSourceChorusStart(marked)).toBe(39.8);
        // A range that starts before the first line it marks: that line's start.
        expect(findSourceChorusStart(applyChorusRangesByTime(lyrics([{}, {}, {}]), [{ startTime: 5, endTime: 30 }]))).toBe(5);
        expect(findSourceChorusStart(applyChorusRangesByTime(lyrics([{ startTime: 3, endTime: 8 }, {}]), [{ startTime: 1, endTime: 9 }]))).toBe(3);
    });

    it('keeps no source ranges for ranges read back off guessed lines', () => {
        const marked = applyChorusRangesByTime(lyrics([{}, {}]), [{ startTime: 10, endTime: 20 }], Math.random, 'text');
        expect(marked.sourceChorusRanges).toBeUndefined();
        expect(findSourceChorusStart(marked)).toBeNull();
    });

    it('has nothing for a chorus guessed from repeated lines, or one of unknown origin', () => {
        expect(findSourceChorusStart(lyrics([{}, { isChorus: true, chorusOrigin: 'text' }]))).toBeNull();
        expect(findSourceChorusStart(lyrics([{}, { isChorus: true }]))).toBeNull();
        expect(findSourceChorusStart(lyrics([{}, {}]))).toBeNull();
        expect(findSourceChorusStart(null)).toBeNull();
    });
});

describe('getChorusMarkerFraction', () => {
    it('places the chorus start on the bar', () => {
        expect(getChorusMarkerFraction(60, 0, 240)).toBeCloseTo(0.25);
    });

    it('adds the lyric offset back to reach the audio position', () => {
        // Lyrics read 500 ms behind the audio: the line at 60 s plays at 60.5 s.
        expect(getChorusMarkerFraction(60, 500, 242)).toBeCloseTo(0.25);
    });

    it('draws nothing without a chorus, without a duration, or at either end of the bar', () => {
        expect(getChorusMarkerFraction(null, 0, 240)).toBeNull();
        expect(getChorusMarkerFraction(60, 0, 0)).toBeNull();
        expect(getChorusMarkerFraction(60, 0, Number.NaN)).toBeNull();
        expect(getChorusMarkerFraction(1, 0, 240)).toBeNull();
        expect(getChorusMarkerFraction(239, 0, 240)).toBeNull();
        expect(getChorusMarkerFraction(300, 0, 240)).toBeNull();
    });
});
