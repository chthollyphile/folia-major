import { describe, expect, it } from 'vitest';
import { formatLrcTimestamp } from '@/utils/lyrics/lrcTimestamp';

// test/unit/lyrics/lrcTimestamp.test.ts
// The one writer of the LRC line time stamp. Its four former copies differed in how they treated
// the thousandths: one rounded them, which could write sixty seconds.

describe('formatLrcTimestamp', () => {
    it('writes minutes, seconds and hundredths from milliseconds', () => {
        expect(formatLrcTimestamp(0)).toBe('[00:00.00]');
        expect(formatLrcTimestamp(500)).toBe('[00:00.50]');
        expect(formatLrcTimestamp(61230)).toBe('[01:01.23]');
    });

    it('cuts the thousandths instead of rounding them', () => {
        expect(formatLrcTimestamp(1995)).toBe('[00:01.99]');
        expect(formatLrcTimestamp(59999)).toBe('[00:59.99]');
        expect(formatLrcTimestamp(1239.7)).toBe('[00:01.23]');
    });

    it('writes a negative time as zero and keeps minutes past 99', () => {
        expect(formatLrcTimestamp(-250)).toBe('[00:00.00]');
        expect(formatLrcTimestamp(6005000)).toBe('[100:05.00]');
    });
});
