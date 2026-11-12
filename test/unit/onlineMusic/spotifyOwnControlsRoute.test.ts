// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ExternalPlaybackTraits } from '@/types/onlineMusic';

// test/unit/onlineMusic/spotifyOwnControlsRoute.test.ts
// The seam between Spotify's own app and the route: what the app answers about a track its listener
// picked is read by the provider, and the route acts on that reading. It must come through as another
// track - which the bridge takes over - and never as the end of the song on screen, whose skip would
// step Folia's queue and play it into the app over the listener's choice.

const request = vi.hoisted(() => vi.fn(async (operation: string): Promise<unknown> => (
    operation === 'client_play' ? 'loaded' : { available: true }
)));
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: request,
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));

const omniMock = vi.hoisted(() => ({
    canPlayExternally: vi.fn(() => true),
    canPlaySong: vi.fn(() => true),
    prepareExternalPlaybackQueue: vi.fn(async () => {}),
    playSongExternally: vi.fn(async () => {}),
    pauseExternalPlayback: vi.fn(async () => {}),
    resumeExternalPlayback: vi.fn(async () => {}),
    seekExternalPlayback: vi.fn(async () => {}),
    setExternalPlaybackVolume: vi.fn(async () => {}),
    setExternalTrackRepeat: vi.fn(async () => undefined),
    getExternalPlaybackStatus: vi.fn(async () => ({ mediaId: '', isPlaying: false, positionMs: 0, durationMs: 0, ended: false }) as never),
    isExternalPlaybackStatusForSong: vi.fn((song: SongResult, status: { mediaId: string }) => (
        status.mediaId !== '' && status.mediaId === (song.sourceRef?.kind === 'online' ? String(song.sourceRef.mediaId) : '')
    )),
    adoptExternalPlayback: vi.fn(() => {}),
    externalPlaybackTraits: vi.fn((): ExternalPlaybackTraits => ({
        capturesSystemAudio: true,
        startsWithoutWaiting: true,
        backsOffStatusPolls: true,
        holdsMediaKeysWhilePlaying: true,
        seekLimitMs: 8000,
        loopsTrackNatively: true,
        followsPlayerChanges: true,
    })),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { normalizeSpotifySong } = await import('@/services/onlineMusic/spotify/spotifyNormalize');
const { resetSpotifyClientPlayback, spotifyClientPlayback, statusOfClient } = await import('@/services/onlineMusic/spotify/spotifyClientPlayback');
type SpotifyWireClientStatus = Parameters<typeof statusOfClient>[0];
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');

const id = (letter: string) => letter.repeat(22);
const songOf = (letter: string): SongResult => normalizeSpotifySong({
    __typename: 'Track', uri: `spotify:track:${id(letter)}`, name: `Song ${letter}`,
    artists: { items: [{ uri: `spotify:artist:${id('r')}`, profile: { name: 'Artist' } }] },
    albumOfTrack: { uri: `spotify:album:${id('m')}`, name: 'Album', coverArt: { sources: [] } },
    duration: { totalMilliseconds: 200000 },
} as never);

const wire = (mediaId: string, extra: Record<string, unknown> = {}): SpotifyWireClientStatus => ({
    id: mediaId, ad: false, isPaused: false, isBuffering: false, positionMs: 1000, durationMs: 200000, ...extra,
} as SpotifyWireClientStatus);

describe('a track the listener picked in Spotify itself, as the route reads it', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            value: { platform: 'win32', spotifyRequest: vi.fn() },
            configurable: true,
            writable: true,
        });
        vi.useFakeTimers();
        request.mockReset();
        request.mockImplementation(async (operation: string) => (
            operation === 'client_play' ? 'loaded' : { available: true }
        ));
        resetSpotifyClientPlayback();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        const song = songOf('a');
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0,
            currentSong: song, playQueue: [song], isFmMode: false,
        });
        omniMock.playSongExternally.mockClear();
        omniMock.pauseExternalPlayback.mockClear();
        omniMock.prepareExternalPlaybackQueue.mockClear();
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'all' });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        resetSpotifyClientPlayback();
        vi.useRealTimers();
    });

    it('comes through as another track for the take-over, not as the end of the song in it', async () => {
        // The provider's own record of the song it asked the app for: this is what tells the app's
        // own move apart from the song running out or from the handoff to Folia's queued song.
        await spotifyClientPlayback.play!(songOf('a'), 0);
        let answers: SpotifyWireClientStatus[] = [wire(id('a'), { positionMs: 10000 }), wire(id('a'), { positionMs: 11000 })];
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => statusOfClient(answers.shift() ?? wire(id('a'))) as never);
        const start = engine.startExternalPlayback(songOf('a'), 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(600);

        const events: { type: string; status?: { mediaId: string } }[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type === 'ended') events.push({ type: 'ended' });
            if (event.type === 'track-changed') events.push({ type: 'track-changed', status: event.status });
        });

        answers = [wire(id('c'))];
        await vi.advanceTimersByTimeAsync(600);
        unsubscribe();

        expect(events.map(event => event.type)).toEqual(['track-changed']);
        expect(events[0].status?.mediaId).toBe(id('c'));
        // Nothing of Folia's queue was started or stopped over the listener's pick.
        expect(omniMock.playSongExternally).toHaveBeenCalledTimes(1);
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
    });

    it('keeps a song that ran out stepping the queue, with no direction to it', async () => {
        await spotifyClientPlayback.play!(songOf('a'), 0);
        let answers: SpotifyWireClientStatus[] = [wire(id('a'), { positionMs: 10000 }), wire(id('a'), { positionMs: 11000 })];
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => statusOfClient(answers.shift() ?? wire(id('a'))) as never);
        const start = engine.startExternalPlayback(songOf('a'), 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(600);

        const ends: { skipped?: string }[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type === 'ended') ends.push(event);
        });

        answers = [wire(id('a'), { positionMs: 200000, isPaused: true })];
        await vi.advanceTimersByTimeAsync(600);
        unsubscribe();

        expect(ends).toHaveLength(1);
        expect(ends[0].skipped).toBeUndefined();
    });
});
