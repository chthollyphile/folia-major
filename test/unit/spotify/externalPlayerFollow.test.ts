// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

// test/unit/spotify/externalPlayerFollow.test.ts
// A way of playing that follows what its listener does in the player's own window (Spotify's own
// app: `followsPlayerChanges`). Two moments are read here, both with nothing of Folia sounding in
// the player yet:
//   - the player is on the song this app shows: the follow takes it over, so the song is shown
//     playing and the progress bar moves with the player's own clock;
//   - the player is on another song: that one is looked up by the id the player names, made the
//     song this app shows and taken over in its place, while what the player holds behind it (the
//     queue of the listener's, the level it sounds at) is left alone.
// A way that declared nothing says nothing here: Apple Music keeps pausing what it cannot follow.

const traits = vi.hoisted(() => ({
    declared: {
        capturesSystemAudio: true,
        startsWithoutWaiting: true,
        backsOffStatusPolls: true,
        holdsMediaKeysWhilePlaying: true,
        followsPlayerChanges: true,
    } as Record<string, boolean>,
}));

const omniMock = vi.hoisted(() => ({
    canPlayExternally: vi.fn<(song: SongResult) => boolean>(() => true),
    canPlaySong: vi.fn(() => true),
    prepareExternalPlaybackQueue: vi.fn(async () => {}),
    playSongExternally: vi.fn(async () => {}),
    pauseExternalPlayback: vi.fn(async () => {}),
    resumeExternalPlayback: vi.fn(async () => {}),
    seekExternalPlayback: vi.fn(async () => {}),
    setExternalPlaybackVolume: vi.fn(async () => {}),
    getExternalPlaybackStatus: vi.fn(async (): Promise<ProviderExternalPlaybackStatus> => ({
        mediaId: '123', isPlaying: true, positionMs: 10000, durationMs: 200000, ended: false,
    })),
    getExternalPlaybackRunningStatus: vi.fn(async (): Promise<ProviderExternalPlaybackStatus | null> => null),
    getExternalPlaybackRunningPositionMs: vi.fn(async (): Promise<number | null> => null),
    isExternalPlaybackStatusForSong: vi.fn((song: SongResult, status: ProviderExternalPlaybackStatus) => (
        status.mediaId === (song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : '')
    )),
    getSongDetail: vi.fn(async (): Promise<SongResult | null> => null),
    adoptExternalPlayback: vi.fn(() => {}),
    externalPlaybackTraits: vi.fn(() => traits.declared),
    followsPlayerChangesOf: vi.fn(() => traits.declared.followsPlayerChanges === true),
    followingPlayerChangesProviderId: vi.fn((): string | null => (traits.declared.followsPlayerChanges === true ? 'spotify' : null)),
    getExternalPlaybackRunningTrack: vi.fn(async (): Promise<ProviderExternalPlaybackStatus | null> => null),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { followRunningExternalPlayer, followsPlayerChangesForShownSong, takeOverRunningPlayer } = await import('@/components/app/playback/bridges/externalPlayerFollow');
const { makeSongCurrent } = await import('@/components/app/playback/currentSong');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');

const songOn = (mediaId: string, name = mediaId): SongResult => ({
    id: mediaId,
    name,
    artists: [{ id: '', name: 'Artist' }],
    album: { id: '', name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'spotify', mediaId },
});

/** A song of the listener's own library, and one of another platform: neither plays in Spotify. */
const localSong: SongResult = {
    ...songOn('local-1', 'Local'),
    id: 'local-1',
    isLocal: true,
    localRef: { songId: 'local-1' },
    sourceRef: { kind: 'local', mediaId: 'local-1' },
} as SongResult;
const appleSong: SongResult = {
    ...songOn('am-1', 'Apple'),
    id: 'am-1',
    sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: 'am-1' },
};

const song = songOn('123', 'Example');
const other = songOn('456', 'Another');

const status = (overrides: Partial<ProviderExternalPlaybackStatus> = {}): ProviderExternalPlaybackStatus => ({
    mediaId: '123', isPlaying: true, positionMs: 10000, durationMs: 200000, ended: false, ...overrides,
});

describe('a player that follows the listener\'s own changes', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        traits.declared = {
            capturesSystemAudio: true,
            startsWithoutWaiting: true,
            backsOffStatusPolls: true,
            holdsMediaKeysWhilePlaying: true,
            followsPlayerChanges: true,
        };
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0,
            currentSong: song, playQueue: [song], isFmMode: false,
        });
        omniMock.canPlayExternally.mockReset().mockReturnValue(true);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.getExternalPlaybackRunningStatus.mockReset().mockResolvedValue(null);
        omniMock.getExternalPlaybackRunningPositionMs.mockReset().mockResolvedValue(null);
        omniMock.getSongDetail.mockReset().mockResolvedValue(null);
        omniMock.prepareExternalPlaybackQueue.mockReset().mockResolvedValue(undefined);
        omniMock.pauseExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.setExternalPlaybackVolume.mockReset().mockResolvedValue(undefined);
        useAudioSettingsStore.setState({ volume: 1, isMuted: false });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // A2: no session here at all - the app was reopened onto a player it does not steer - and the
    // player is on the song this app shows.
    it('takes the player over where it is playing the song this app shows', async () => {
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status({ positionMs: 42000 }));

        await expect(followRunningExternalPlayer()).resolves.toBe('adopted');
        expect(engine.getExternalSong()).toEqual(song);
        expect(engine.isExternalRoute()).toBe(true);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        // Taken over, never started: the player is doing the playing.
        expect(omniMock.playSongExternally).not.toHaveBeenCalled();
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
        expect(omniMock.resumeExternalPlayback).not.toHaveBeenCalled();
        expect(omniMock.getSongDetail).not.toHaveBeenCalled();
    });

    it('takes it over without writing the songs behind it or the level it sounds at', async () => {
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status());
        usePlaybackStore.setState({ playQueue: [song, other] });

        await followRunningExternalPlayer();
        // The checkpoint of a take-over: what the player holds was the listener's before this run.
        expect(engine.isExternalTakeoverPending()).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
        expect(omniMock.setExternalPlaybackVolume).not.toHaveBeenCalled();
    });

    // B2: no session here, and the player is on another song.
    it('makes the track it names the current song and takes it over', async () => {
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status({ mediaId: '456' }));
        omniMock.getSongDetail.mockResolvedValue(other);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '456' }));

        await expect(followRunningExternalPlayer()).resolves.toBe('adopted');
        expect(omniMock.getSongDetail).toHaveBeenCalledWith('spotify', '456');
        expect(usePlaybackStore.getState().currentSong).toEqual(other);
        expect(engine.getExternalSong()).toEqual(other);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        // Nothing of Folia's is written into the player's own queue before the listener asks for a song.
        await vi.advanceTimersByTimeAsync(5000);
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
        expect(omniMock.playSongExternally).not.toHaveBeenCalled();
    });

    it('says the track it could not look up is not one Folia can follow', async () => {
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status({ mediaId: '456' }));
        omniMock.getSongDetail.mockResolvedValue(null);

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        expect(usePlaybackStore.getState().currentSong).toEqual(song);
        expect(engine.getExternalSong()).toBeNull();
    });

    it('does nothing while a session of this route already follows the player', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status());

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        expect(omniMock.getExternalPlaybackRunningStatus).not.toHaveBeenCalled();
    });

    it('does nothing where nothing is playing in the player at all', async () => {
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(null);

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        expect(engine.getExternalSong()).toBeNull();
    });

    it('does nothing for a way of playing that declared it does not follow', async () => {
        traits.declared = {
            capturesSystemAudio: false,
            startsWithoutWaiting: false,
            backsOffStatusPolls: false,
            holdsMediaKeysWhilePlaying: false,
            followsPlayerChanges: false,
        };
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status());

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        expect(omniMock.getExternalPlaybackRunningStatus).not.toHaveBeenCalled();
        expect(engine.getExternalSong()).toBeNull();
    });

    it('does nothing for a song no external player can sound', async () => {
        omniMock.canPlayExternally.mockReturnValue(false);
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status());

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        expect(omniMock.getExternalPlaybackRunningStatus).not.toHaveBeenCalled();
    });

    it('drops a read that lands after another song was asked for', async () => {
        omniMock.getExternalPlaybackRunningStatus.mockImplementation(async () => {
            usePlaybackStore.setState({ currentSong: other });
            return status();
        });

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        expect(engine.getExternalSong()).toBeNull();
    });

    // The lookup of a track the player names waits on the platform's network. A song the listener
    // asked for in Folia while it waited owns the screen when the answer comes back: nothing of the
    // track lands on it, and no session replaces the one that song has.
    const deferredTrack = () => {
        let resolve!: (value: SongResult | null) => void;
        const promise = new Promise<SongResult | null>(done => { resolve = done; });
        return { promise, resolve };
    };
    const flush = () => vi.advanceTimersByTimeAsync(0);

    it('leaves the screen alone where a song was asked for while the track was looked up', async () => {
        const lookup = deferredTrack();
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status({ mediaId: '456' }));
        omniMock.getSongDetail.mockImplementation(() => lookup.promise);

        const following = followRunningExternalPlayer();
        await flush();
        expect(omniMock.getSongDetail).toHaveBeenCalledWith('spotify', '456');
        makeSongCurrent(other);
        lookup.resolve(songOn('789', 'Asked for'));

        await expect(following).resolves.toBe('untouched');
        expect(usePlaybackStore.getState().currentSong).toEqual(other);
        expect(engine.getExternalSong()).toBeNull();
        expect(engine.isExternalRoute()).toBe(false);
    });

    it('leaves the screen alone where a song was asked for while the player took the track', async () => {
        const lookup = deferredTrack();
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getSongDetail.mockImplementation(() => lookup.promise);

        const adopting = takeOverRunningPlayer(song, status({ mediaId: '456', positionMs: 3000 }), {
            isWanted: () => engine.isExternalRoute() && engine.getExternalSong() !== null,
        });
        await flush();
        makeSongCurrent(other);
        lookup.resolve(songOn('789', 'Asked for'));

        await expect(adopting).resolves.toBe('untouched');
        expect(usePlaybackStore.getState().currentSong).toEqual(other);
        expect(engine.getExternalSong()).not.toEqual(songOn('789', 'Asked for'));
        expect(engine.getExternalSong()).not.toEqual(songOn('456', 'Another'));
    });

    // A player that moved on to another track and was paused there: the session goes with the
    // screen, so the press of play in Folia continues that track rather than the one the player left.
    it('takes a track the player moved on to over even where it is paused there', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.playSongExternally.mockClear();
        omniMock.getSongDetail.mockResolvedValue(other);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '456', isPlaying: false, positionMs: 3000 }));

        await expect(takeOverRunningPlayer(song, status({ mediaId: '456', isPlaying: false, positionMs: 3000 }), {
            adoptsPausedTrack: true,
        })).resolves.toBe('adopted');
        expect(usePlaybackStore.getState().currentSong).toEqual(other);
        expect(engine.getExternalSong()).toEqual(other);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
        expect(omniMock.playSongExternally).not.toHaveBeenCalled();

        // The press of play is the track on screen: the player is asked for that one, not the one it left.
        engine.resumeExternalPlayback();
        expect(omniMock.resumeExternalPlayback).toHaveBeenCalledWith(other);
        expect(omniMock.resumeExternalPlayback).not.toHaveBeenCalledWith(song);
    });

    // The take-over is announced, and the listener presses play in Folia on that very announcement:
    // a session of its own takes the player, sounding another song. The take-over that was in flight
    // is nobody's from that moment, so giving it up must not stop the song the listener asked for.
    it('leaves a song asked for while the player was taken over sounding', async () => {
        const askedFor = songOn('789', 'Asked for');
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status({ mediaId: '456' }));
        omniMock.getSongDetail.mockResolvedValue(other);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '456' }));
        let started = false;
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type !== 'status' || started) return;
            started = true;
            engine.startExternalPlayback(askedFor, 0);
            makeSongCurrent(askedFor);
        });

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        unsubscribe();

        expect(engine.getExternalSong()).toEqual(askedFor);
        expect(engine.isExternalRoute()).toBe(true);
        expect(usePlaybackStore.getState().currentSong).toEqual(askedFor);
        // The player is the song asked for, and nothing of the take-over paused it.
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
    });

    // The same where the player never left the song on screen: the take-over is of this very song,
    // and the song asked for meanwhile is the one that keeps sounding.
    it('leaves that song sounding where the player was on the song this app showed', async () => {
        const askedFor = songOn('789', 'Asked for');
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status());
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status());
        let started = false;
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type !== 'status' || started) return;
            started = true;
            engine.startExternalPlayback(askedFor, 0);
            makeSongCurrent(askedFor);
        });

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        unsubscribe();

        expect(engine.getExternalSong()).toEqual(askedFor);
        expect(engine.isExternalRoute()).toBe(true);
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
    });

    // B1: Folia did start this song, and the listener moved the player on to another track from its
    // own window.
    it('hands the track the player moved on to over without pausing it', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getSongDetail.mockResolvedValue(other);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '456', positionMs: 3000 }));

        await expect(takeOverRunningPlayer(song, status({ mediaId: '456', positionMs: 3000 }))).resolves.toBe('adopted');
        expect(omniMock.getSongDetail).toHaveBeenCalledWith('spotify', '456');
        expect(usePlaybackStore.getState().currentSong).toEqual(other);
        expect(engine.getExternalSong()).toEqual(other);
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
    });

    // The track the player moved on to could not be looked up, so the player was stopped there: the
    // session is nobody's from that moment, and what the listener starts in the player's own window
    // afterwards is followed again rather than skipped for the rest of the run.
    it('follows the player again after a track it could not follow was stopped', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        // A poll sees a track this app did not ask for, which is the bridge's to take over.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '456' }));
        omniMock.isExternalPlaybackStatusForSong.mockReturnValueOnce(false);
        await vi.advanceTimersByTimeAsync(500);
        // The lookup behind that take-over found nothing, so the player is stopped where it stands.
        engine.stopForeignExternalPlayback();

        // Nothing of this route holds the player now, so the slow read is the one that sees it again.
        expect(engine.getExternalSong()).toBeNull();
        expect(engine.isExternalRoute()).toBe(false);
        expect(engine.isExternalTakeoverPending()).toBe(false);

        omniMock.getSongDetail.mockResolvedValue(other);
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status({ mediaId: '456' }));
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '456' }));

        await expect(followRunningExternalPlayer()).resolves.toBe('adopted');
        expect(engine.getExternalSong()).toEqual(other);
        expect(usePlaybackStore.getState().currentSong).toEqual(other);
    });
});

// The screen shows something that never plays in Spotify - a file of the listener's own, a song of
// another platform - and Folia is not sounding it. What they then start in Spotify's own window is
// followed all the same: the way of playing declares it, no session of this route holds the player,
// and nothing of Folia's is coming out of the speakers to be doubled. What the screen shows is
// replaced by the track the player names.
describe('a screen of another kind of song, with Folia silent', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        traits.declared = {
            capturesSystemAudio: true,
            startsWithoutWaiting: true,
            backsOffStatusPolls: true,
            holdsMediaKeysWhilePlaying: true,
            followsPlayerChanges: true,
        };
        omniMock.canPlayExternally.mockReset().mockReturnValue(true);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status({ mediaId: '456' }));
        omniMock.getExternalPlaybackRunningStatus.mockReset().mockResolvedValue(status({ mediaId: '456' }));
        omniMock.getExternalPlaybackRunningTrack.mockReset().mockResolvedValue(status({ mediaId: '456' }));
        omniMock.getSongDetail.mockReset().mockResolvedValue(songOn('456', 'Another'));
        omniMock.prepareExternalPlaybackQueue.mockReset().mockResolvedValue(undefined);
        omniMock.setExternalPlaybackVolume.mockReset().mockResolvedValue(undefined);
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.pauseExternalPlayback.mockReset().mockResolvedValue(undefined);
        useAudioSettingsStore.setState({ volume: 1, isMuted: false });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('follows what is started in the player while a local song is on a paused screen', async () => {
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.PAUSED,
            currentSong: localSong, playQueue: [localSong], isFmMode: false,
        });

        await expect(followRunningExternalPlayer()).resolves.toBe('adopted');

        expect(usePlaybackStore.getState().currentSong).toEqual(songOn('456', 'Another'));
        expect(engine.getExternalSong()).toEqual(songOn('456', 'Another'));
        expect(engine.isExternalRoute()).toBe(true);
        // Taken over, never started: nothing here wakes, resumes or pauses the player.
        expect(omniMock.playSongExternally).not.toHaveBeenCalled();
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
    });

    it('follows it while another platform\'s song is on a paused screen too', async () => {
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.PAUSED,
            currentSong: appleSong, playQueue: [appleSong], isFmMode: false,
        });

        await expect(followRunningExternalPlayer()).resolves.toBe('adopted');
        expect(usePlaybackStore.getState().currentSong).toEqual(songOn('456', 'Another'));
    });

    it('follows it for a song of another platform that no external player can sound', async () => {
        // Apple Music, whose own player this is not: the song on screen plays in no player at all.
        omniMock.canPlayExternally.mockImplementation((song: SongResult) => (
            song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'spotify'
        ));
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE,
            currentSong: appleSong, playQueue: [appleSong], isFmMode: false,
        });

        await expect(followRunningExternalPlayer()).resolves.toBe('adopted');
        expect(usePlaybackStore.getState().currentSong).toEqual(songOn('456', 'Another'));
        expect(engine.getExternalSong()).toEqual(songOn('456', 'Another'));
    });

    it('reads nothing while Folia itself is sounding a song', async () => {
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: 'https://audio.test/local-1', playerState: PlayerState.PLAYING,
            currentSong: localSong, playQueue: [localSong], isFmMode: false,
        });

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        expect(omniMock.getExternalPlaybackRunningStatus).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().currentSong).toEqual(localSong);
    });

    it('drops the answer where the caller stopped wanting it while the player was read', async () => {
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.PAUSED,
            currentSong: localSong, playQueue: [localSong], isFmMode: false,
        });
        // The watcher's guard answers for a page that went away while the read was on its way.
        let wanted = true;
        omniMock.getExternalPlaybackRunningTrack.mockImplementation(async () => {
            wanted = false;
            return status({ mediaId: '456' });
        });

        await expect(followRunningExternalPlayer({ isWanted: () => wanted })).resolves.toBe('untouched');
        expect(usePlaybackStore.getState().currentSong).toEqual(localSong);
        expect(engine.getExternalSong()).toBeNull();
    });

    it('is watched while Folia is silent, whatever song the screen holds', () => {
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.PAUSED,
            currentSong: localSong, playQueue: [localSong], isFmMode: false,
        });
        expect(followsPlayerChangesForShownSong()).toBe(true);

        usePlaybackStore.setState({ playerState: PlayerState.PLAYING });
        expect(followsPlayerChangesForShownSong()).toBe(false);
    });
});
