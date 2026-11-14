import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/externalPlaybackRepeatOne.test.ts — repeat one handed to the program that
// plays, when that program has a single repeat of its own (src/services/onlineMusic/externalPlayback.ts,
// `syncExternalRepeatOne`). Soloist has one (`spotifySoloistPlayback.setRepeatOne`, its own
// `soloist_repeat`); Spotify's own app has the other one instead (`loopsTrackNatively` and
// `setTrackRepeat`, read by `syncExternalTrackRepeat`), and the two must never reach the same
// program: the facade answers `setRepeatOne` while Soloist plays and nothing while the app does.

const requestSpotify = vi.fn();
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: (operation: string, params?: unknown) => requestSpotify(operation, params),
    querySpotify: vi.fn(),
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));
vi.mock('@/services/onlineMusic/appleMusic/appleMusicTransport', () => ({
    requestAppleMusic: vi.fn(),
    getAppleMusicTransportAvailability: () => ({ configured: true }),
}));

const { omni } = await import('@/services/onlineMusic/omni');
const { spotifyExternalPlayback } = await import('@/services/onlineMusic/spotify/spotifyExternalPlayback');
const { spotifySoloistPlayback } = await import('@/services/onlineMusic/spotify/spotifySoloistPlayback');

const spotifySong = {
    id: 'track',
    name: 'Song',
    artists: [{ id: '', name: 'Artist' }],
    album: { id: '', name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online' as const, providerId: 'spotify', mediaId: 'track', providerData: {} },
};

const pickWay = async (mode: 'soloist' | 'client') => {
    requestSpotify.mockImplementation(async (operation: string) => (
        operation === 'playback_mode' ? { mode, soloist: true, client: true } : null
    ));
    await (await import('@/services/onlineMusic/spotify/spotifySoloistPlayback')).setSpotifyPlaybackMode(mode);
    requestSpotify.mockClear();
};

afterEach(() => {
    vi.restoreAllMocks();
    requestSpotify.mockReset();
});

describe('repeat one as Soloist\'s own single repeat', () => {
    it('is there while Soloist plays, and is Soloist\'s call the facade hands it to', async () => {
        await pickWay('soloist');
        const soloist = vi.spyOn(spotifySoloistPlayback, 'setRepeatOne');
        expect(typeof spotifyExternalPlayback.setRepeatOne).toBe('function');
        await spotifyExternalPlayback.setRepeatOne?.(true);
        expect(soloist).toHaveBeenCalledTimes(1);
        expect(soloist).toHaveBeenCalledWith(true);
        expect(requestSpotify).toHaveBeenCalledWith('soloist_repeat', { enabled: true });
    });

    it('is not there while Spotify\'s own app plays, which repeats a track its own other way', async () => {
        await pickWay('client');
        expect(spotifyExternalPlayback.setRepeatOne).toBeUndefined();
    });
});

describe('omni.setExternalPlaybackRepeatOne', () => {
    it('hands the repeat to Soloist while that is the program that plays', async () => {
        await pickWay('soloist');
        await omni.setExternalPlaybackRepeatOne(spotifySong, true);
        expect(requestSpotify).toHaveBeenCalledWith('soloist_repeat', { enabled: true });
        requestSpotify.mockClear();
        await omni.setExternalPlaybackRepeatOne(spotifySong, false);
        expect(requestSpotify).toHaveBeenCalledWith('soloist_repeat', { enabled: false });
    });

    it('asks nothing while Spotify\'s own app plays: its repeat is reached by setTrackRepeat alone', async () => {
        await pickWay('client');
        await omni.setExternalPlaybackRepeatOne(spotifySong, true);
        expect(requestSpotify).not.toHaveBeenCalled();
    });
});
