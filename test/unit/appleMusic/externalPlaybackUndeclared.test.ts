// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

// test/unit/appleMusic/externalPlaybackUndeclared.test.ts
// A song whose provider declared nothing about its external player plays exactly as it played
// before the Spotify app became a way to play: the interface waits for the player to take the song
// before it shows it, and the status asks keep the app's own cadence - a failed ask is retried
// after the same two seconds every time, and a press of the listener moves no ask.
// The last block reads the one other way beside it: a player that declared startsWithoutWaiting and
// backsOffStatusPolls (Spotify's own app) is shown the song at once and is asked ever more rarely
// while it does not answer.

const traits = vi.hoisted(() => ({
    /** What the song's provider declared: all false is a provider that declared nothing. */
    declared: {
        capturesSystemAudio: false,
        startsWithoutWaiting: false,
        backsOffStatusPolls: false,
        holdsMediaKeysWhilePlaying: false,
    } as Record<string, boolean>,
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
    getExternalPlaybackStatus: vi.fn(async (): Promise<ProviderExternalPlaybackStatus> => ({
        mediaId: '123', isPlaying: true, positionMs: 5000, durationMs: 200000, ended: false,
    })),
    isExternalPlaybackStatusForSong: vi.fn(() => true),
    adoptExternalPlayback: vi.fn(() => {}),
    externalPlaybackTraits: vi.fn(() => traits.declared),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');

const song: SongResult = {
    id: '123',
    name: 'Example',
    artists: [{ id: '', name: 'Artist' }],
    album: { id: '', name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: '123', providerData: { resourceType: 'songs' } },
};

const songOf = (mediaId: string, name: string): SongResult => ({
    ...song, id: mediaId, name, sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId, providerData: { resourceType: 'songs' } },
});

const status = (overrides: Partial<ProviderExternalPlaybackStatus> = {}): ProviderExternalPlaybackStatus => ({
    mediaId: '123', isPlaying: true, positionMs: 5000, durationMs: 200000, ended: false, ...overrides,
});

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
};

const NONE_DECLARED = {
    capturesSystemAudio: false, startsWithoutWaiting: false, backsOffStatusPolls: false, holdsMediaKeysWhilePlaying: false,
};
const SPOTIFY_APP = {
    capturesSystemAudio: true, startsWithoutWaiting: true, backsOffStatusPolls: true, holdsMediaKeysWhilePlaying: true,
};

describe('a provider that declared nothing about its player', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        traits.declared = { ...NONE_DECLARED };
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: null,
            playQueue: [song, songOf('b', 'B'), songOf('c', 'C')], isFmMode: false,
        });
        omniMock.prepareExternalPlaybackQueue.mockClear();
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.pauseExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.resumeExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.seekExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.setExternalPlaybackVolume.mockReset().mockResolvedValue(undefined);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.isExternalPlaybackStatusForSong.mockReset().mockReturnValue(true);
        useAudioSettingsStore.setState({ volume: 1, isMuted: false });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('waits for the player to take the song before the song may be shown', async () => {
        const playing = deferred();
        omniMock.playSongExternally.mockImplementation(() => playing.promise);
        const start = engine.startExternalPlayback(song, 0);

        let waited = false;
        void start.waited.then(() => { waited = true; });
        await vi.advanceTimersByTimeAsync(2500);
        // The player is still loading the track: nothing of this song is shown yet, as it always was.
        expect(waited).toBe(false);
        expect(omniMock.getExternalPlaybackStatus).not.toHaveBeenCalled();

        playing.resolve();
        await start.waited;
        // The status was read once, before the interface was let go: the song is shown with its clock.
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(1);
        expect(start.timings.statusMs).not.toBeNull();
    });

    it('lets the wait end where the player refuses the song, and the failure is the start\'s own', async () => {
        omniMock.playSongExternally.mockRejectedValue(new Error('refused'));
        const start = engine.startExternalPlayback(song, 0);

        // The wait never rejects: the start's own promise is where the play path hears how it went.
        await expect(start.waited).resolves.toBeUndefined();
        await expect(start.started).rejects.toThrow('refused');
        expect(usePlaybackStore.getState().playbackRoute).toBe('web');
    });

    it('asks a player that stopped answering again after the same two seconds, every time', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockRejectedValue(new Error('playback-failed'));
        omniMock.getExternalPlaybackStatus.mockClear();

        // The player stopped answering (it was closed, its page is gone): every ask fails, and every
        // one of them is retried after the same two seconds rather than further and further out.
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(1);
        for (const asks of [2, 3, 4, 5]) {
            await vi.advanceTimersByTimeAsync(1999);
            expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(asks - 1);
            await vi.advanceTimersByTimeAsync(1);
            expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(asks);
        }
    });

    it('keeps the ordinary half second once the player answers again', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockRejectedValue(new Error('playback-failed'));
        omniMock.getExternalPlaybackStatus.mockClear();
        await vi.advanceTimersByTimeAsync(500 + 2000 + 2000);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(3);

        omniMock.getExternalPlaybackStatus.mockResolvedValue(status());
        await vi.advanceTimersByTimeAsync(2000);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(499);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(5);
    });

    it('does not pull the next ask forward when the player answers a press of the listener', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockRejectedValue(new Error('playback-failed'));
        omniMock.getExternalPlaybackStatus.mockClear();
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(1);

        // The retry is two seconds away. A resume the player took says it is there, which is a fact
        // about this app's own commands and not about how often the player is asked here.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status());
        expect(engine.resumeExternalPlayback()).toBe(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(2);
    });

    // Repeat one on this route is the bridge's: the player reports the end of a song it confirmed
    // playing, and the song is started again rather than the queue stepping on. Nothing of that is a
    // declaration, so it is the same for every player - a song that never sounded is the one exception.
    it('says an end was heard only for a song the player confirmed playing', async () => {
        const ends: { heard?: boolean }[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type === 'ended') ends.push(event);
        });
        let answers = 0;
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            answers++ === 0 ? status({ isPlaying: false, positionMs: 0 }) : status({ isPlaying: false, positionMs: 0, ended: true })
        ));
        const start = engine.startExternalPlayback(song, 0);
        await start.waited;
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(600);

        // The start never landed, so this end is not the song's own: repeating it here would restart
        // a song that never played.
        expect(ends).toHaveLength(1);
        expect(ends[0].heard).toBe(false);
        unsubscribe();
    });

    it('says an end was heard for a song the player did play, which repeat one replays', async () => {
        const ends: { heard?: boolean }[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type === 'ended') ends.push(event);
        });
        let positionMs = 5000;
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            positionMs > 0 ? status({ positionMs }) : status({ isPlaying: false, positionMs: 0, ended: true })
        ));
        const start = engine.startExternalPlayback(song, 0);
        await start.waited;
        engine.announceExternalPlayback();
        positionMs = 0;
        await vi.advanceTimersByTimeAsync(600);

        expect(ends).toHaveLength(1);
        expect(ends[0].heard).toBe(true);
        unsubscribe();
    });

    it('reads the declarations of the song it is asked to play, on every song', async () => {
        await engine.beginExternalPlayback(song, 0);
        expect(omniMock.externalPlaybackTraits).toHaveBeenCalledWith(song);
        engine.stopExternalPlayback('next song');
        const other = songOf('b', 'B');
        await engine.beginExternalPlayback(other, 0);
        expect(omniMock.externalPlaybackTraits).toHaveBeenCalledWith(other);
    });
});

describe('a provider that declared both of them', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        traits.declared = { ...SPOTIFY_APP };
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: null,
            playQueue: [song], isFmMode: false,
        });
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.resumeExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.isExternalPlaybackStatusForSong.mockReset().mockReturnValue(true);
        useAudioSettingsStore.setState({ volume: 1, isMuted: false });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('shows the song without waiting for the player, whose start is an instruction', async () => {
        const playing = deferred();
        omniMock.playSongExternally.mockImplementation(() => playing.promise);
        const start = engine.startExternalPlayback(song, 0);

        let waited = false;
        void start.waited.then(() => { waited = true; });
        await vi.advanceTimersByTimeAsync(0);
        expect(waited).toBe(true);
        expect(omniMock.getExternalPlaybackStatus).not.toHaveBeenCalled();
    });

    it('asks a player that stopped answering ever more rarely, as it asked to', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockRejectedValue(new Error('playback-failed'));
        omniMock.getExternalPlaybackStatus.mockClear();

        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1999);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(4000);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(3);
    });
});
