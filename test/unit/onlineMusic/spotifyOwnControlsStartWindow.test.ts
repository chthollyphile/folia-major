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
const {
    resetSpotifyClientPlayback, spotifyClientAttempt, spotifyClientPlayback, statusOfClient,
} = await import('@/services/onlineMusic/spotify/spotifyClientPlayback');
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

/** A song of the given title and artists, for the cases where the names themselves are the point. */
const namedSong = (letter: string, name: string, artists: string[]): SongResult => normalizeSpotifySong({
    __typename: 'Track', uri: `spotify:track:${id(letter)}`, name,
    artists: { items: artists.map((artist, index) => ({
        uri: `spotify:artist:${id(String.fromCharCode(114 + index))}`, profile: { name: artist },
    })) },
    albumOfTrack: { uri: `spotify:album:${id('m')}`, name: 'Album', coverArt: { sources: [] } },
    duration: { totalMilliseconds: 200000 },
} as never);

const wire = (mediaId: string, extra: Record<string, unknown> = {}): SpotifyWireClientStatus => ({
    id: mediaId, ad: false, isPaused: false, isBuffering: false, positionMs: 1000, durationMs: 200000, ...extra,
} as SpotifyWireClientStatus);

/**
 * The media session's answer: no track id at all, the results of a port that is down, and the title
 * and artist it shows instead. The position is its own, and says nothing about the song Folia asked
 * for until that song has been shown there.
 */
const coarse = (extra: Record<string, unknown> = {}): SpotifyWireClientStatus => wire('', {
    fallback: true, durationMs: 0, ...extra,
});

/** What the app answers a read right now, as the way it is steered there answers it. */
let readOfApp: () => SpotifyWireClientStatus = () => wire('');

/** The app is on the track the test names, as every read of the route answers. */
const appOn = (letter: string, extra: Record<string, unknown> = {}) => {
    readOfApp = () => wire(id(letter), extra);
};

/** Everything the route reports that a bridge acts on, collected for the length of one case. */
const recordEvents = () => {
    const events: { type: string; status?: { mediaId: string; shownTrack?: { title: string; artist: string } } }[] = [];
    const unsubscribe = engine.subscribeExternalPlayback(event => {
        if (event.type === 'ended') events.push({ type: 'ended' });
        if (event.type === 'track-changed') events.push({ type: 'track-changed', status: event.status });
    });
    return { events, unsubscribe };
};

/** The song the screen holds. */
const shownName = () => usePlaybackStore.getState().currentSong?.name ?? null;

/** Whether a start of Folia's is still being waited for, as the provider itself records it. */
const startPending = () => spotifyClientAttempt()?.startPending ?? false;

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
describe('a start of Folia\'s the app answers through its coarse channel', () => {
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
        omniMock.playSongExternally.mockReset();
        omniMock.playSongExternally.mockImplementation(async (song: SongResult, startSec: number, options: unknown) => {
            await spotifyClientPlayback.play!(song, startSec, options as never);
        });
        omniMock.getExternalPlaybackStatus.mockReset();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => statusOfClient(readOfApp()) as never);
        omniMock.pauseExternalPlayback.mockClear();
        readOfApp = () => wire('');
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'all' });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        resetSpotifyClientPlayback();
        vi.useRealTimers();
    });

    it('reads the track it is leaving behind as still starting, not as where this song stands', async () => {
        // The start is asked for and the app has not taken the song yet: the first coarse read still
        // describes the track the app was on before, its own position and all.
        const held = holdNextStart();
        const start = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);

        // This song has never sounded there, so nothing of the leftover may stand for it.
        readOfApp = () => coarse({ positionMs: 123400, title: 'Song a', artist: 'Artist' });
        await vi.advanceTimersByTimeAsync(600);

        const status = statusOfClient(readOfApp());
        expect(status.starting).toBe(true);
        expect(status.isPlaying).toBe(false);
        expect(status.positionMs).toBe(0);
        expect(shownName()).toBe('Song a');
        void start;
        held.release();
    });

    it('reads a coarse answer that names no track at all the same way while the start is on its way', async () => {
        const held = holdNextStart();
        const start = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);

        // A media session that shows no title at all says nothing about the track it left behind.
        readOfApp = () => coarse({ positionMs: 123400 });
        await vi.advanceTimersByTimeAsync(600);

        const status = statusOfClient(readOfApp());
        expect(status.starting).toBe(true);
        expect(status.positionMs).toBe(0);
        void start;
        held.release();
    });

    it('takes nothing over from the track the coarse channel still shows while that start is on its way', async () => {
        const held = holdNextStart();
        const start = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);

        const { events, unsubscribe } = recordEvents();
        readOfApp = () => coarse({ positionMs: 123400, title: 'Song a', artist: 'Artist' });
        await vi.advanceTimersByTimeAsync(600);
        await vi.advanceTimersByTimeAsync(600);
        unsubscribe();

        expect(events.map(event => event.type)).toEqual([]);
        expect(shownName()).toBe('Song a');
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
        void start;
        held.release();
    });

    it('adopts at once what the listener picks after a coarse answer named this very song', async () => {
        // A start whose answer the app keeps for a while: the media session names this song meanwhile.
        request.mockImplementation(async (operation: string) => {
            if (operation !== 'client_play') return { available: true };
            return await new Promise(resolve => { setTimeout(() => resolve('loaded'), 5000); });
        });
        const start = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);

        readOfApp = () => coarse({ title: 'Song b', artist: 'Artist' });
        // Read the way the route reads it, whatever the call that plays the song is still doing.
        statusOfClient(readOfApp());

        // The coarse channel named this song: the start is over, whatever the app answers the call.
        expect(startPending()).toBe(false);

        // So a track the listener picks now is theirs, and is taken over straight away.
        const { events, unsubscribe } = recordEvents();
        const picked = coarse({ title: 'Song c', artist: 'Artist' });
        readOfApp = () => picked;
        await vi.advanceTimersByTimeAsync(600);
        const taken = statusOfClient(picked);
        unsubscribe();

        expect(taken.shownTrack).toEqual({ title: 'Song c', artist: 'Artist' });

        expect(events.map(event => event.type)).toEqual(['track-changed']);
        expect(events[0].status?.shownTrack).toEqual({ title: 'Song c', artist: 'Artist' });
        void start;
    });
});

describe('the window a start of Folia\'s opens', () => {
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
        omniMock.playSongExternally.mockReset();
        omniMock.playSongExternally.mockImplementation(async (song: SongResult, startSec: number, options: unknown) => {
            await spotifyClientPlayback.play!(song, startSec, options as never);
        });
        omniMock.getExternalPlaybackStatus.mockReset();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => statusOfClient(readOfApp()) as never);
        omniMock.pauseExternalPlayback.mockClear();
        readOfApp = () => wire('');
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'all' });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        resetSpotifyClientPlayback();
        vi.useRealTimers();
    });

    it('is open until the app says it took the song, and closed by that answer', async () => {
        const held = holdNextStart();
        const start = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);
        expect(startPending()).toBe(true);

        held.release();
        await start.started;
        await vi.advanceTimersByTimeAsync(0);

        expect(startPending()).toBe(false);
    });

    it('is closed by the app naming the song Folia asked for, before that answer lands', async () => {
        const held = holdNextStart();
        const start = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);
        expect(startPending()).toBe(true);

        // The app's own player named the song: it has it, so nothing of the start is left to wait for.
        readOfApp = () => wire(id('b'), { positionMs: 0 });
        await vi.advanceTimersByTimeAsync(600);

        expect(startPending()).toBe(false);
        void start;
        held.release();
    });

    it('is closed once the app has been waited for long enough, so a stuck call cannot freeze a pick', async () => {
        const held = holdNextStart();
        const start = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);
        expect(startPending()).toBe(true);

        // The call that plays the song never comes back. Past the limit it is no longer waited for,
        // and the reads that name the song before it are the app's own again.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        readOfApp = () => wire(id('a'), { positionMs: 11000 });
        await vi.advanceTimersByTimeAsync(70_001);
        statusOfClient(readOfApp());
        warn.mockRestore();

        expect(startPending()).toBe(false);
        void start;
        held.release();
    });
});
describe('a start of Folia\'s the app answers on its own player', () => {
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
        omniMock.playSongExternally.mockReset();
        omniMock.playSongExternally.mockImplementation(async (song: SongResult, startSec: number, options: unknown) => {
            await spotifyClientPlayback.play!(song, startSec, options as never);
        });
        omniMock.getExternalPlaybackStatus.mockReset();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => statusOfClient(readOfApp()) as never);
        omniMock.pauseExternalPlayback.mockClear();
        readOfApp = () => wire('');
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'all' });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        resetSpotifyClientPlayback();
        vi.useRealTimers();
    });

    it('is over as soon as the app names this very song, with no answer to the call yet', async () => {
        const held = holdNextStart();
        const start = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);
        expect(startPending()).toBe(true);

        // The app's own player named the song it was asked for: it has it, so the wait is over - the
        // call that plays it may still be on its way, and holding a pick behind it would be wrong.
        statusOfClient(wire(id('b'), { positionMs: 0 }));

        expect(startPending()).toBe(false);
        void start;
        held.release();
    });

    it('takes a pick made right after the app named this song, once that song has sounded', async () => {
        const held = holdNextStart();
        const start = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);

        // The app names this song, then has sounded it: from here the next track it names is the
        // listener's own pick rather than a leftover of the start.
        statusOfClient(wire(id('b'), { positionMs: 1000 }));
        expect(startPending()).toBe(false);

        const picked = statusOfClient(wire(id('c'), { positionMs: 1000 }));
        expect(picked.ended).toBe(false);
        expect(picked.mediaId).toBe(id('c'));
        void start;
        held.release();
    });
});
describe('the names that close a start of Folia\'s window on the coarse channel', () => {
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
        omniMock.playSongExternally.mockReset();
        omniMock.playSongExternally.mockImplementation(async (song: SongResult, startSec: number, options: unknown) => {
            await spotifyClientPlayback.play!(song, startSec, options as never);
        });
        omniMock.getExternalPlaybackStatus.mockReset();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => statusOfClient(readOfApp()) as never);
        omniMock.pauseExternalPlayback.mockClear();
        readOfApp = () => wire('');
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'all' });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        resetSpotifyClientPlayback();
        vi.useRealTimers();
    });

    /** A start of Folia\'s on song b whose answer the app keeps: the window is open when this returns. */
    const startOfBOnItsWay = async () => {
        const held = holdNextStart();
        const start = engine.startExternalPlayback(songOf('b'), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);
        expect(startPending()).toBe(true);
        return { held, start };
    };

    it('is not closed by a coarse answer that names no artist at all', async () => {
        const { held, start } = await startOfBOnItsWay();
        // The same title, and the media session reports no artist: nothing says this is song b, and
        // the leftover of the start carries the position the app was on before.
        readOfApp = () => coarse({ positionMs: 150000, title: 'Song b' });

        const status = statusOfClient(readOfApp());

        expect(status.starting).toBe(true);
        expect(status.isPlaying).toBe(false);
        expect(status.positionMs).toBe(0);
        expect(startPending()).toBe(true);
        void start;
        held.release();
    });

    it('is not closed by an artist whose name merely contains this song\'s', async () => {
        // The song is by DJ; the app shows DJ Snake. A name that holds another one inside it is a
        // different act, not this song's.
        const dj = namedSong('d', 'Song b', ['DJ']);
        await spotifyClientPlayback.play!(dj, 0);
        const held2 = holdNextStart();
        const start = engine.startExternalPlayback(namedSong('e', 'Song b', ['DJ']), 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held2.asked()).toBe(true);
        expect(startPending()).toBe(true);

        readOfApp = () => coarse({ positionMs: 150000, title: 'Song b', artist: 'DJ Snake' });
        const status = statusOfClient(readOfApp());

        expect(status.starting).toBe(true);
        expect(status.positionMs).toBe(0);
        expect(startPending()).toBe(true);
        void start;
        held2.release();
    });

    it('is not closed by a title whose bracketed credit was stripped away', async () => {
        const { held, start } = await startOfBOnItsWay();
        // The app shows a credit Folia never wrote: that is a different title, not this song's.
        readOfApp = () => coarse({ positionMs: 150000, title: 'Song b (feat. Guest)', artist: 'Artist' });

        const status = statusOfClient(readOfApp());

        expect(status.starting).toBe(true);
        expect(status.positionMs).toBe(0);
        expect(startPending()).toBe(true);
        void start;
        held.release();
    });

    it('is closed by the same title and the same artist, whatever the case and the spacing', async () => {
        const { held, start } = await startOfBOnItsWay();
        const read = coarse({ positionMs: 150000, title: '  song   B  ', artist: 'ARTIST' });
        readOfApp = () => read;

        const status = statusOfClient(read);

        // The app names this very song: the start has landed, so the window is over and the read is
        // this song's own, its position included, rather than the leftover of the one before it.
        expect(status.starting).toBe(false);
        expect(status.positionMs).toBe(150000);
        expect(startPending()).toBe(false);
        void start;
        held.release();
    });
});
describe('a start of Folia\'s whose window is open when the app moves to the song Folia queued next', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            value: { platform: 'win32', spotifyRequest: vi.fn() },
            configurable: true,
            writable: true,
        });
        vi.useFakeTimers();
        request.mockReset();
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_play') return 'loaded';
            if (operation === 'client_queue') {
                const ids = (params as { ids?: string[] } | undefined)?.ids ?? [];
                return { aborted: false, cleared: false, canClear: false, written: ids, read: ids };
            }
            return { available: true };
        });
        resetSpotifyClientPlayback();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        const song = songOf('a');
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0,
            currentSong: song, playQueue: [song], isFmMode: false,
        });
        omniMock.playSongExternally.mockReset();
        omniMock.playSongExternally.mockImplementation(async (song: SongResult, startSec: number, options: unknown) => {
            await spotifyClientPlayback.play!(song, startSec, options as never);
        });
        omniMock.getExternalPlaybackStatus.mockReset();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => statusOfClient(readOfApp()) as never);
        omniMock.pauseExternalPlayback.mockClear();
        readOfApp = () => wire('');
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'all' });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        resetSpotifyClientPlayback();
        vi.useRealTimers();
    });

    it('reads it as this song ending, rather than swallowing the handoff into the window', async () => {
        // Song b sounds there and Folia put song c behind it: the app moving on to c by itself is
        // this song ending, and Folia's queue steps on to it.
        const b = songOf('b');
        const c = songOf('c');
        await spotifyClientPlayback.play!(b, 0);
        statusOfClient(wire(id('b'), { positionMs: 10000 }));
        await spotifyClientPlayback.prepareNext!(b, [c]);

        // A start on top of it that the app has not answered yet: the window is open.
        const held = holdNextStart();
        const start = engine.startExternalPlayback(b, 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(0);
        expect(held.asked()).toBe(true);

        // The coarse channel shows the song Folia wrote next, with the window still open.
        const status = statusOfClient(coarse({ title: 'Song c', artist: 'Artist' }));

        expect(status.ended).toBe(true);
        void start;
        held.release();
    });
});
