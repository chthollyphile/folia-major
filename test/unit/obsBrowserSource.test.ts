import { describe, expect, it } from 'vitest';
import { PlayerState } from '../../src/types';
import {
    downsampleObsSpectrum,
    resolveObsBrowserSourceClockTime,
    resolveObsBrowserSourceCoverUrl,
} from '../../src/utils/obsBrowserSource';

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

    it('converts main-window blob covers to data URLs for OBS', async () => {
        const coverBlob = new Blob(['cover'], { type: 'image/png' });
        const fetchCover = async () => new Response(coverBlob);

        await expect(resolveObsBrowserSourceCoverUrl('blob:http://127.0.0.1/cover', fetchCover))
            .resolves.toBe('data:image/png;base64,Y292ZXI=');
    });

    it('keeps non-blob covers unchanged without fetching', async () => {
        let fetchCount = 0;
        const fetchCover = async () => {
            fetchCount += 1;
            return new Response(new Blob(['unused']));
        };

        await expect(resolveObsBrowserSourceCoverUrl('https://img.test/cover.jpg', fetchCover))
            .resolves.toBe('https://img.test/cover.jpg');
        expect(fetchCount).toBe(0);
    });
});
