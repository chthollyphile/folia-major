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
    canPlayExternally: vi.fn(() => true),
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
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { followRunningExternalPlayer, adoptPlayerTrack } = await import('@/components/app/playback/bridges/externalPlayerFollow');
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

    it('does nothing while the player is paused', async () => {
        omniMock.getExternalPlaybackRunningStatus.mockResolvedValue(status({ isPlaying: false }));

        await expect(followRunningExternalPlayer()).resolves.toBe('untouched');
        expect(engine.getExternalSong()).toBeNull();
        expect(usePlaybackStore.getState().playerState).not.toBe(PlayerState.PLAYING);
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

    // B1: Folia did start this song, and the listener moved the player on to another track from its
    // own window.
    it('hands the track the player moved on to over without pausing it', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getSongDetail.mockResolvedValue(other);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '456', positionMs: 3000 }));

        await expect(adoptPlayerTrack(song, status({ mediaId: '456', positionMs: 3000 }))).resolves.toBe('adopted');
        expect(omniMock.getSongDetail).toHaveBeenCalledWith('spotify', '456');
        expect(usePlaybackStore.getState().currentSong).toEqual(other);
        expect(engine.getExternalSong()).toEqual(other);
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
    });
});
