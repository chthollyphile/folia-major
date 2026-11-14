// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyClientGetStatus.test.ts
// What the app has for a song, read for the take-over of the route. A coarse answer names no track
// at all: where the title and artist it shows are this song's, the answer is this song's own and
// must carry its id, since a track the take-over could never name could never be taken over. An
// answer showing another song keeps naming nothing, so nothing is taken over on a misread.

const request = vi.hoisted(() => vi.fn(async (operation: string): Promise<unknown> => (
    operation === 'client_play' ? 'loaded' : { available: true }
)));
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: request,
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));
import { normalizeSpotifySong } from '@/services/onlineMusic/spotify/spotifyNormalize';
import { resetSpotifyClientPlayback, spotifyClientPlayback } from '@/services/onlineMusic/spotify/spotifyClientPlayback';
import type { SongResult } from '@/types';

const id = (letter: string) => letter.repeat(22);
const songOf = (letter: string, name: string, artist: string): SongResult => normalizeSpotifySong({
    __typename: 'Track', uri: `spotify:track:${id(letter)}`, name,
    artists: { items: [{ uri: `spotify:artist:${id('r')}`, profile: { name: artist } }] },
    albumOfTrack: { uri: `spotify:album:${id('m')}`, name: 'Album', coverArt: { sources: [] } },
    duration: { totalMilliseconds: 200000 },
} as never);

/** The media session's answer: no track id, and the title and artist it shows. */
const degraded = (extra: Record<string, unknown> = {}) => ({
    id: '', ad: false, fallback: true, isPaused: false, isBuffering: false, positionMs: 1000, durationMs: 0, ...extra,
});

beforeEach(() => {
    Object.defineProperty(window, 'electron', {
        value: { platform: 'win32', spotifyRequest: vi.fn() },
        configurable: true,
        writable: true,
    });
    request.mockReset();
    request.mockImplementation(async (operation: string) => (
        operation === 'client_play' ? 'loaded' : { available: true }
    ));
    resetSpotifyClientPlayback();
});

describe('what the app has for a song, read for a take-over', () => {
    it('names the song where the coarse answer shows that song', async () => {
        const a = songOf('a', 'Song a', 'Artist');
        request.mockResolvedValueOnce(degraded({ title: 'Song a', artist: 'Artist' }));

        const status = await spotifyClientPlayback.getStatus!(a);

        expect(status.mediaId).toBe(id('a'));
        expect(status.degraded).toBe(true);
    });

    it('names nothing where the coarse answer shows another song', async () => {
        const a = songOf('a', 'Song a', 'Artist');
        request.mockResolvedValueOnce(degraded({ title: 'Something Else', artist: 'Somebody' }));

        const status = await spotifyClientPlayback.getStatus!(a);

        expect(status.mediaId).toBe('');
    });

    it('names the song the app itself named, whatever the coarse channel would have shown', async () => {
        const a = songOf('a', 'Song a', 'Artist');
        request.mockResolvedValueOnce({
            id: id('a'), ad: false, isPaused: false, isBuffering: false, positionMs: 1000, durationMs: 200000,
        });

        const status = await spotifyClientPlayback.getStatus!(a);

        expect(status.mediaId).toBe(id('a'));
        expect(status.degraded).toBe(false);
    });
});
