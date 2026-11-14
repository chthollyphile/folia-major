// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/spotifyOwnControls.test.ts — what a track change Spotify's own controls make
// becomes for Folia: the track the app is on is adopted as the song Folia shows, and Folia's own queue
// is not played into the app over it. A handoff to a song Folia wrote into the app's queue, and the
// end of a song that ran out, stay what they were.

const request = vi.hoisted(() => vi.fn(async (operation: string): Promise<unknown> => (
    operation === 'client_play' ? 'loaded' : { available: true }
)));
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: request,
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));
import { normalizeSpotifySong } from '@/services/onlineMusic/spotify/spotifyNormalize';
import { resetSpotifyClientPlayback, spotifyClientPlayback, statusOfClient } from '@/services/onlineMusic/spotify/spotifyClientPlayback';
import type { SongResult } from '@/types';

const id = (letter: string) => letter.repeat(22);
const songOf = (letter: string): SongResult => normalizeSpotifySong({
    __typename: 'Track', uri: `spotify:track:${id(letter)}`, name: `Song ${letter}`,
    artists: { items: [{ uri: `spotify:artist:${id('r')}`, profile: { name: 'Artist' } }] },
    albumOfTrack: { uri: `spotify:album:${id('m')}`, name: 'Album', coverArt: { sources: [] } },
    duration: { totalMilliseconds: 200000 },
} as never);

const playing = (mediaId: string, extra: Record<string, unknown> = {}) => ({
    id: mediaId, ad: false, isPaused: false, isBuffering: false, positionMs: 1000, durationMs: 200000, ...extra,
});

const queueTaken = (params?: unknown) => {
    const ids = (params as { ids?: string[] } | undefined)?.ids ?? [];
    return { aborted: false, cleared: true, canClear: true, written: ids, read: ids };
};

beforeEach(() => {
    Object.defineProperty(window, 'electron', {
        value: { platform: 'win32', spotifyRequest: vi.fn() },
        configurable: true,
        writable: true,
    });
    request.mockReset();
    request.mockImplementation(async (operation: string, params?: unknown) => {
        if (operation === 'client_play') return 'loaded';
        if (operation === 'client_queue') return queueTaken(params);
        if (operation === 'client_repeat') return { read: true, changed: false, now: 2 };
        return { available: true };
    });
    resetSpotifyClientPlayback();
});

describe('a track Spotify picked with its own controls', () => {
    it('is adopted as the song Folia shows, and Folia plays nothing of its own queue into the app', async () => {
        await spotifyClientPlayback.play!(songOf('a'), 0);
        statusOfClient(playing(id('a'), { positionMs: 10000 }));
        request.mockClear();

        const status = statusOfClient(playing(id('c')));

        expect(status.ended).toBe(false);
        expect(status.skipped).toBeUndefined();
        expect(status.mediaId).toBe(id('c'));
        expect(status.isPlaying).toBe(true);
        expect(request).not.toHaveBeenCalledWith('client_play', expect.anything());
    });

    it('says in the log that the track is adopted and was chosen in Spotify', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        try {
            await spotifyClientPlayback.play!(songOf('a'), 0);
            statusOfClient(playing(id('a'), { positionMs: 10000 }));
            statusOfClient(playing(id('c')));

            const said = info.mock.calls.map(call => String(call[0])).join('\n');
            expect(said).toContain('adopted, chosen in Spotify');
        } finally {
            info.mockRestore();
        }
    });

    it('is adopted where the app went back to the track Folia played before it', async () => {
        await spotifyClientPlayback.play!(songOf('a'), 0);
        await spotifyClientPlayback.play!(songOf('b'), 0);
        statusOfClient(playing(id('b'), { positionMs: 10000 }));

        const status = statusOfClient(playing(id('a')));

        expect(status.ended).toBe(false);
        expect(status.skipped).toBeUndefined();
        expect(status.mediaId).toBe(id('a'));
    });

    it('says it once, however long the app stays on that track', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        try {
            await spotifyClientPlayback.play!(songOf('a'), 0);
            statusOfClient(playing(id('a'), { positionMs: 10000 }));
            statusOfClient(playing(id('c')));
            statusOfClient(playing(id('c')));
            statusOfClient(playing(id('c')));

            const said = info.mock.calls.map(call => String(call[0])).filter(line => line.includes('adopted, chosen in Spotify'));
            expect(said).toHaveLength(1);
        } finally {
            info.mockRestore();
        }
    });

    it('keeps the handoff to the song Folia wrote into the app queue as this song ending', async () => {
        await spotifyClientPlayback.play!(songOf('a'), 0);
        await spotifyClientPlayback.prepareNext!(songOf('a'), [songOf('b')]);
        statusOfClient(playing(id('a')));

        const handoff = statusOfClient(playing(id('b')));

        expect(handoff.ended).toBe(true);
        expect(handoff.skipped).toBeUndefined();
    });

    it('keeps a song that ran out ending, rather than adopting what the app went on to', async () => {
        await spotifyClientPlayback.play!(songOf('a'), 0);
        statusOfClient(playing(id('a'), { positionMs: 199400 }));

        const ran = statusOfClient(playing(id('c')));

        expect(ran.ended).toBe(true);
        expect(ran.skipped).toBeUndefined();
    });
});
