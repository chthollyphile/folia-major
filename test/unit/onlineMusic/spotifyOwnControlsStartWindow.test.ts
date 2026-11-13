// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ExternalPlaybackTraits } from '@/types/onlineMusic';

// test/unit/onlineMusic/spotifyOwnControlsStartWindow.test.ts
// Folia starting a song of its own in the Spotify app is not the listener picking one there. The
// provider names the song it asked for before the app has taken it, so the reads taken while that
// start is still on its way name the track the app is leaving behind. Such a read is the start's own
// leftover, not a track change: nothing is taken over from it, and the screen keeps the song Folia
// asked for. A listener who picks a track in Spotify while no start of Folia's is on its way is
// adopted at once, and so is one who picks a track after that start has landed or has failed.

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
    playSongExternally: vi.fn<(song: SongResult, startSec: number, options?: unknown) => Promise<void>>(async () => {}),
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

/** What the app answers a read right now, as the way it is steered there answers it. */
let readOfApp: () => SpotifyWireClientStatus = () => wire('');

/** The app is on the track the test names, as every read of the route answers. */
const appOn = (letter: string, extra: Record<string, unknown> = {}) => {
    readOfApp = () => wire(id(letter), extra);
};

/** Everything the route reports that a bridge acts on, collected for the length of one case. */
const recordEvents = () => {
    const events: { type: string; status?: { mediaId: string } }[] = [];
    const unsubscribe = engine.subscribeExternalPlayback(event => {
        if (event.type === 'ended') events.push({ type: 'ended' });
        if (event.type === 'track-changed') events.push({ type: 'track-changed', status: event.status });
    });
    return { events, unsubscribe };
};

/** The song the screen holds. */
const shownName = () => usePlaybackStore.getState().currentSong?.name ?? null;

/**
 * Makes the next start of Folia's hang in the app: the call that plays the song answers only when
 * the returned function is called. The app itself goes on answering reads meanwhile, and keeps
 * naming the track it was on: that is what a start still loading answers about the song before it.
 */
const holdNextStart = () => {
    let release: (() => void) | null = null;
    let asked = false;
    request.mockImplementation(async (operation: string) => {
        if (operation !== 'client_play') return { available: true };
        asked = true;
        return await new Promise(resolve => { release = () => resolve('loaded'); });
    });
    return {
        /** Whether the app was asked to play the song, and has not answered yet. */
        asked: () => asked && release !== null,
        release: () => release?.(),
    };
};

describe('Folia starting a song while the app still answers about the one before it', () => {
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
        readOfApp = () => wire('');
        omniMock.getExternalPlaybackStatus.mockReset();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => statusOfClient(readOfApp()) as never);
        // The route asks the provider for the song the way the app does: the provider is what names the
        // song it asked for, so the start's own wait is the real one.
        omniMock.playSongExternally.mockReset();
        omniMock.playSongExternally.mockImplementation(async (song: SongResult, startSec: number, options: unknown) => {
            await spotifyClientPlayback.play!(song, startSec, options as never);
        });
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'all' });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        resetSpotifyClientPlayback();
        vi.useRealTimers();
    });

    it('takes nothing over from the track the app still answers with while that start is on its way', async () => {
        // Song a sounds and the app has confirmed it: the route follows it, announced on screen.
        await spotifyClientPlayback.play!(songOf('a'), 0);
        appOn('a', { positionMs: 10000 });
        const first = engine.startExternalPlayback(songOf('a'), 0);
        engine.announceExternalPlayback();
        await first.seeded;
        await vi.advanceTimersByTimeAsync(600);
        expect(shownName()).toBe('Song a');

        // Folia plays song b in the app. The app is loading it and still answers about song a: that
        // answer is the start's own leftover, not a track the listener picked in Spotify.
        const held = holdNextStart();
        const second = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);

        const { events, unsubscribe } = recordEvents();
        appOn('a', { positionMs: 11000 });
        await vi.advanceTimersByTimeAsync(600);
        await vi.advanceTimersByTimeAsync(600);
        await vi.advanceTimersByTimeAsync(600);
        unsubscribe();

        expect(events.map(event => event.type)).toEqual([]);
        // The screen is still the song Folia asked for, which is what the start was for.
        expect(shownName()).toBe('Song a');
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
        void second;
        held.release();
    });

    it('is shown loading rather than stopped while that start is on its way', async () => {
        await spotifyClientPlayback.play!(songOf('a'), 0);
        appOn('a', { positionMs: 10000 });
        const first = engine.startExternalPlayback(songOf('a'), 0);
        engine.announceExternalPlayback();
        await first.seeded;
        await vi.advanceTimersByTimeAsync(600);

        const held = holdNextStart();
        const second = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);
        appOn('a', { positionMs: 11000 });
        await vi.advanceTimersByTimeAsync(600);

        // The read of the song it is leaving behind says nothing about where song b stands.
        expect(usePlaybackStore.getState().isLoadingToPlay).toBe(true);
        expect(usePlaybackStore.getState().playerState).not.toBe(PlayerState.PAUSED);
        expect(shownName()).toBe('Song a');
        void second;
        held.release();
    });

    it('adopts what the listener picks in Spotify once that start has landed', async () => {
        await spotifyClientPlayback.play!(songOf('a'), 0);
        appOn('a', { positionMs: 10000 });
        const start = engine.startExternalPlayback(songOf('a'), 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(600);

        // A second start, taken at once: the window it opened is over.
        appOn('b');
        const second = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await second.started;
        await second.seeded;
        await vi.advanceTimersByTimeAsync(600);

        const { events, unsubscribe } = recordEvents();
        appOn('c');
        await vi.advanceTimersByTimeAsync(600);
        unsubscribe();

        expect(events.map(event => event.type)).toEqual(['track-changed']);
        expect(events[0].status?.mediaId).toBe(id('c'));
    });

    it('adopts what the listener picks in Spotify after the start of Folia\'s failed', async () => {
        await spotifyClientPlayback.play!(songOf('a'), 0);
        appOn('a', { positionMs: 10000 });
        const first = engine.startExternalPlayback(songOf('a'), 0);
        engine.announceExternalPlayback();
        await first.seeded;
        await vi.advanceTimersByTimeAsync(600);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        request.mockImplementation(async (operation: string) => {
            if (operation === 'client_play') throw new Error('the app did not answer');
            return { available: true };
        });
        const failed = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await failed.started.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(600);
        warn.mockRestore();

        // The start is over, so a read naming another track is the listener's own again.
        request.mockImplementation(async (operation: string) => (
            operation === 'client_play' ? 'loaded' : { available: true }
        ));
        const again = engine.startExternalPlayback(songOf('a'), 0);
        engine.announceExternalPlayback();
        await again.started;
        await again.seeded;
        await vi.advanceTimersByTimeAsync(600);

        const { events, unsubscribe } = recordEvents();
        appOn('c');
        await vi.advanceTimersByTimeAsync(600);
        unsubscribe();

        expect(events.map(event => event.type)).toEqual(['track-changed']);
        expect(events[0].status?.mediaId).toBe(id('c'));
    });
});
