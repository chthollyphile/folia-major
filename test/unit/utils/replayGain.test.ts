import { describe, expect, it } from 'vitest';
import { calculateReplayGain, decibelsToLinearPeak } from '@/utils/replayGain';

// test/unit/utils/replayGain.test.ts

describe('replay gain calculations', () => {
    it('converts peak dB to a positive linear ratio', () => {
        expect(decibelsToLinearPeak(-0.4)).toBeCloseTo(0.95499, 4);
    });

    it('falls back from album values to track values', () => {
        expect(calculateReplayGain({ trackGain: -8, trackPeak: 0.9 }, 'album')).toMatchObject({
            gainDb: -8,
            effectiveGainDb: -8,
            peak: 0.9,
        });
    });

    it('clips positive gain for peaks above one as well as below one', () => {
        const calculation = calculateReplayGain({ trackGain: 6, trackPeak: 2 }, 'track');

        expect(calculation.effectiveGainDb).toBeCloseTo(-20 * Math.log10(2), 8);
        expect(calculation.linearGain).toBeCloseTo(0.5, 8);
    });

    it('keeps off mode and negative gain deterministic without metadata', () => {
        expect(calculateReplayGain({ trackGain: -4 }, 'track').linearGain).toBeCloseTo(Math.pow(10, -4 / 20), 8);
        expect(calculateReplayGain(undefined, 'track').linearGain).toBe(1);
        expect(calculateReplayGain({ trackGain: 6 }, 'off')).toMatchObject({
            gainDb: 0,
            effectiveGainDb: 0,
            linearGain: 1,
        });
    });
});
