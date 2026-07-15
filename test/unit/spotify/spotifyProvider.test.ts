import { describe, expect, it } from 'vitest';
import { createSpotifyProgressUpdate, spotifyPlaybackToTrackSnapshot } from '@/services/spotifyProvider';
import { resolveNowPlayingAnchorTime } from '@/utils/nowPlayingClock';
import { hasSynchronizedLyricTimeline } from '@/utils/lyrics/autoMatchBestLyric';

// test/unit/spotify/spotifyProvider.test.ts
// Locks the Spotify-to-external-playback mapping used by the Stage controller.

describe('spotifyPlaybackToTrackSnapshot', () => {
    it('maps Spotify playback into the existing external track shape', () => {
        const snapshot = spotifyPlaybackToTrackSnapshot({
            id: 'track-1',
            uri: 'spotify:track:track-1',
            type: 'track',
            title: 'Track',
            artist: 'Artist One, Artist Two',
            album: 'Album',
            coverUrl: 'https://image.test/cover.jpg',
            durationMs: 240_000,
            progressMs: 42_000,
            isPlaying: true,
            sampledAtMs: 1,
            device: null,
        });

        expect(snapshot).toEqual({
            id: 'track-1',
            title: 'Track',
            artist: 'Artist One, Artist Two',
            album: 'Album',
            coverUrl: 'https://image.test/cover.jpg',
            durationMs: 240_000,
            isVideo: false,
            isAdvertisement: false,
        });
    });

    it('returns null when Spotify has no active playback', () => {
        expect(spotifyPlaybackToTrackSnapshot(null)).toBeNull();
    });
});

describe('Spotify synchronized-lyrics gate', () => {
    it('accepts a real line timeline', () => {
        expect(hasSynchronizedLyricTimeline({
            title: 'Track',
            artist: 'Artist',
            isWordByWord: false,
            lines: [
                { fullText: 'First line', startTime: 0, endTime: 1.5, words: [] },
                { fullText: 'Second line', startTime: 1.5, endTime: 3, words: [] },
            ],
        } as any)).toBe(true);
    });

    it('rejects static or synthetic text without a timeline', () => {
        expect(hasSynchronizedLyricTimeline({
            title: 'Track',
            artist: 'Artist',
            isWordByWord: false,
            lines: [
                { fullText: 'Static lyrics only', startTime: 0, endTime: 0, words: [] },
            ],
        } as any)).toBe(false);
    });
});

describe('Spotify clock latency compensation', () => {
    it('preserves the measured RTT and advances a playing anchor by half the round trip', () => {
        const playback = {
            id: 'track-1',
            uri: 'spotify:track:track-1',
            type: 'track',
            title: 'Track',
            artist: 'Artist',
            album: 'Album',
            coverUrl: null,
            durationMs: 240_000,
            progressMs: 42_000,
            isPlaying: true,
            sampledAtMs: 1,
            device: null,
        } satisfies ElectronSpotifyPlayback;
        const update = createSpotifyProgressUpdate(playback, 41_000, 180);

        expect(update.rttMs).toBe(180);
        expect(resolveNowPlayingAnchorTime({
            progressMs: update.progressMs,
            rttMs: update.rttMs,
            paused: false,
            durationSec: 240,
        })).toBeCloseTo(42.09, 5);
    });
});
