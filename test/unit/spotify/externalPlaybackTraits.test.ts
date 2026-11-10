import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/externalPlaybackTraits.test.ts — what each provider declares about how its
// external player plays (src/types/onlineMusic.ts, OnlineExternalPlaybackProvider): a real spectrum
// that needs the machine's own sound, a start the interface does not wait on, spaced-out status
// polls, and the keys held while a song of Folia's sounds. omni.externalPlaybackTraits reads them
// and answers false for anything a provider left out, which is what Apple Music does.

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
const { spotifyClientPlayback } = await import('@/services/onlineMusic/spotify/spotifyClientPlayback');
const { spotifySoloistPlayback } = await import('@/services/onlineMusic/spotify/spotifySoloistPlayback');
const { appleMusicProvider } = await import('@/services/onlineMusic/appleMusic/appleMusicProvider');

const songOn = (providerId: string) => ({
    id: 'track',
    name: 'Song',
    artists: [{ id: '', name: 'Artist' }],
    album: { id: '', name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online' as const, providerId, mediaId: 'track', providerData: {} },
});

const NONE = {
    capturesSystemAudio: false,
    startsWithoutWaiting: false,
    backsOffStatusPolls: false,
    holdsMediaKeysWhilePlaying: false,
};

const pickWay = async (mode: 'soloist' | 'client') => {
    requestSpotify.mockImplementation(async (operation: string) => (
        operation === 'playback_mode' ? { mode, soloist: true, client: true } : null
    ));
    await (await import('@/services/onlineMusic/spotify/spotifySoloistPlayback')).setSpotifyPlaybackMode(mode);
};

afterEach(() => {
    requestSpotify.mockReset();
});

describe('what the providers declare', () => {
    it('the official app declares all four', () => {
        expect(spotifyClientPlayback).toMatchObject({
            capturesSystemAudio: true,
            startsWithoutWaiting: true,
            backsOffStatusPolls: true,
            holdsMediaKeysWhilePlaying: true,
        });
    });

    it('Soloist declares only that a real spectrum needs the machine\'s own sound', () => {
        expect(spotifySoloistPlayback.capturesSystemAudio).toBe(true);
        expect(spotifySoloistPlayback.startsWithoutWaiting).toBeUndefined();
        expect(spotifySoloistPlayback.backsOffStatusPolls).toBeUndefined();
        expect(spotifySoloistPlayback.holdsMediaKeysWhilePlaying).toBeUndefined();
    });

    it('Apple Music\'s own player declares none of them', () => {
        expect(appleMusicProvider.externalPlayback?.capturesSystemAudio).toBeUndefined();
        expect(appleMusicProvider.externalPlayback?.startsWithoutWaiting).toBeUndefined();
        expect(appleMusicProvider.externalPlayback?.backsOffStatusPolls).toBeUndefined();
        expect(appleMusicProvider.externalPlayback?.holdsMediaKeysWhilePlaying).toBeUndefined();
    });
});

describe('omni.externalPlaybackTraits', () => {
    it('reads the official app\'s four while that is the way Spotify plays', async () => {
        await pickWay('client');
        expect(omni.externalPlaybackTraits(songOn('spotify'))).toEqual({
            capturesSystemAudio: true,
            startsWithoutWaiting: true,
            backsOffStatusPolls: true,
            holdsMediaKeysWhilePlaying: true,
        });
    });

    it('reads Soloist\'s one while that is the way Spotify plays', async () => {
        await pickWay('soloist');
        expect(omni.externalPlaybackTraits(songOn('spotify'))).toEqual({ ...NONE, capturesSystemAudio: true });
    });

    it('answers false everywhere for Apple Music, which declared nothing', () => {
        expect(omni.externalPlaybackTraits(songOn('appleMusic'))).toEqual(NONE);
    });

    it('answers false everywhere for a song no provider owns', () => {
        expect(omni.externalPlaybackTraits(songOn('no-such-provider'))).toEqual(NONE);
    });
});

describe('the Spotify facade follows the way that is on', () => {
    it('hands every one of the four to whichever program plays now', async () => {
        await pickWay('client');
        expect(spotifyExternalPlayback.capturesSystemAudio).toBe(true);
        expect(spotifyExternalPlayback.startsWithoutWaiting).toBe(true);

        await pickWay('soloist');
        expect(spotifyExternalPlayback.capturesSystemAudio).toBe(true);
        expect(spotifyExternalPlayback.startsWithoutWaiting).toBe(false);
        expect(spotifyExternalPlayback.backsOffStatusPolls).toBe(false);
        expect(spotifyExternalPlayback.holdsMediaKeysWhilePlaying).toBe(false);
    });
});
