import { describe, expect, it } from 'vitest';
import {
    buildNowPlayingContentLoadKey,
    clampNowPlayingTimeSec,
    NOW_PLAYING_PROGRESS_CORRECTION_THRESHOLD_SEC,
    parseNowPlayingProgressResponseMs,
    resolveNowPlayingAnchorTime,
    shouldApplyNowPlayingProgressCorrection,
} from '@/utils/nowPlayingClock';

// test/unit/hooks/nowPlayingClock.test.ts

describe('nowPlayingClock', () => {
    it('anchors precise ws progress immediately without RTT compensation', () => {
        expect(resolveNowPlayingAnchorTime({
            progressMs: 500,
            paused: false,
            rttMs: 0,
            durationSec: 120,
        })).toBe(0.5);
    });

    it('applies half RTT compensation while playback is moving', () => {
        expect(resolveNowPlayingAnchorTime({
            progressMs: 12_000,
            paused: false,
            rttMs: 20,
            durationSec: 120,
        })).toBe(12.01);
    });

    it('does not add RTT compensation after pause', () => {
        expect(resolveNowPlayingAnchorTime({
            progressMs: 12_773,
            paused: true,
            rttMs: 20,
            durationSec: 120,
        })).toBe(12.773);
    });

    it('only applies low-frequency corrections when drift exceeds the threshold', () => {
        expect(shouldApplyNowPlayingProgressCorrection(10, 10.5)).toBe(false);
        expect(
            shouldApplyNowPlayingProgressCorrection(
                10,
                10 + NOW_PLAYING_PROGRESS_CORRECTION_THRESHOLD_SEC + 0.01
            )
        ).toBe(true);
    });

    it('parses numeric progress responses and rejects invalid payloads', () => {
        expect(parseNowPlayingProgressResponseMs(12773)).toBe(12773);
        expect(parseNowPlayingProgressResponseMs('12773')).toBe(12773);
        expect(parseNowPlayingProgressResponseMs('invalid')).toBeNull();
    });

    it('clamps display time to the current duration', () => {
        expect(clampNowPlayingTimeSec(15, 10)).toBe(10);
        expect(clampNowPlayingTimeSec(-1, 10)).toBe(0);
    });

    it('builds stable content load keys for now playing payloads', () => {
        const firstKey = buildNowPlayingContentLoadKey(
            {
                id: '1',
                title: 'Song',
                artist: 'Artist',
                album: 'Album',
                coverUrl: null,
                durationMs: 1000,
            },
            {
                source: 'netease',
                title: 'Song',
                artist: 'Artist',
                durationMs: 1000,
                hasLyric: true,
                hasTranslatedLyric: false,
                hasKaraokeLyric: false,
                lrc: '[00:00.00]hi',
                translatedLyric: null,
                karaokeLyric: null,
            }
        );
        const secondKey = buildNowPlayingContentLoadKey(
            {
                id: '1',
                title: 'Song',
                artist: 'Artist',
                album: 'Album',
                coverUrl: null,
                durationMs: 1000,
            },
            {
                source: 'netease',
                title: 'Song 2',
                artist: 'Artist',
                durationMs: 1000,
                hasLyric: true,
                hasTranslatedLyric: false,
                hasKaraokeLyric: false,
                lrc: '[00:00.00]hi',
                translatedLyric: null,
                karaokeLyric: null,
            }
        );

        expect(firstKey).not.toBeNull();
        expect(firstKey).not.toBe(secondKey);
    });
});
