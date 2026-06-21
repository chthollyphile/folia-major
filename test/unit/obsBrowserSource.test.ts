import { describe, expect, it } from 'vitest';
import { PlayerState } from '../../src/types';
import { downsampleObsSpectrum, resolveObsBrowserSourceClockTime } from '../../src/utils/obsBrowserSource';

describe('obsBrowserSource utilities', () => {
    it('extrapolates playing clock snapshots', () => {
        expect(resolveObsBrowserSourceClockTime({
            currentTime: 10,
            duration: 60,
            playerState: PlayerState.PLAYING,
            playbackRate: 1,
            sentAtMs: 1_000,
        }, 3_500)).toBe(12.5);
    });

    it('clamps extrapolated time to duration', () => {
        expect(resolveObsBrowserSourceClockTime({
            currentTime: 59,
            duration: 60,
            playerState: PlayerState.PLAYING,
            playbackRate: 1,
            sentAtMs: 1_000,
        }, 5_000)).toBe(60);
    });

    it('does not extrapolate paused snapshots', () => {
        expect(resolveObsBrowserSourceClockTime({
            currentTime: 20,
            duration: 60,
            playerState: PlayerState.PAUSED,
            playbackRate: 1,
            sentAtMs: 1_000,
        }, 5_000)).toBe(20);
    });

    it('downsamples spectrum buckets by average value', () => {
        expect(downsampleObsSpectrum(new Uint8Array([0, 10, 20, 30]), 2)).toEqual([5, 25]);
    });
});
