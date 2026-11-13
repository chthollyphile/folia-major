import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ExternalPlaybackTraits, ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

// test/unit/playback/externalShownTrackTakeOver.test.ts
// A player that can only name its track by the title and artist it shows reports the one it moved
// to that way: no id, and the two names instead. That is another song all the same, and the route
// hands it to the take-over the way it hands over one a player names by id - once, and with the
// names it was given, so the bridge can find that song again.

const songOf = (name: string, id: string): SongResult => ({
    id, name, artists: [{ name: 'Artist' }], durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'spotify', mediaId: id },
} as unknown as SongResult);

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
    getExternalPlaybackStatus: vi.fn(async () => ({ mediaId: '', isPlaying: false, positionMs: 0, durationMs: 0, ended: false }) as ProviderExternalPlaybackStatus),
    isExternalPlaybackStatusForSong: vi.fn((song: SongResult, status: ProviderExternalPlaybackStatus) => (
        status.mediaId !== '' && status.mediaId === (song.sourceRef?.kind === 'online' ? String(song.sourceRef.mediaId) : '')
    )),
    adoptExternalPlayback: vi.fn(() => {}),
    externalPlaybackTraits: vi.fn((): ExternalPlaybackTraits => ({
        capturesSystemAudio: false,
        startsWithoutWaiting: true,
        backsOffStatusPolls: false,
        holdsMediaKeysWhilePlaying: false,
        seekLimitMs: 8000,
        loopsTrackNatively: false,
        // The listener keeps using that player by hand, so what it moves on to is followed.
        followsPlayerChanges: true,
    })),
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');

const songA = songOf('Song a', 'aaaaaaaaaaaaaaaaaaaaaa');

/** The player's answer: this song, which it named by id when the route started it. */
const playingA: ProviderExternalPlaybackStatus = {
    mediaId: 'aaaaaaaaaaaaaaaaaaaaaa', isPlaying: true, positionMs: 1000, durationMs: 200000, ended: false,
};

/** The coarse channel's answer: no id at all, and the names of the track it moved to. */
const showsOther: ProviderExternalPlaybackStatus = {
    mediaId: '', isPlaying: true, positionMs: 1000, durationMs: 0, ended: false, degraded: true,
    shownTrack: { title: 'Song c', artist: 'Artist' },
};

describe('a player that can only name its track by the names it shows', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0,
            currentSong: songA, playQueue: [songA], isFmMode: false,
        });
        omniMock.getExternalPlaybackStatus.mockReset();
        omniMock.pauseExternalPlayback.mockClear();
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'all' });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
    });

    /** The route following song a, announced on screen, as a play of Folia's leaves it. */
    const routeOnA = async () => {
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => playingA);
        const start = engine.startExternalPlayback(songA, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(600);
    };

    it('is taken over once, with the names it shows', async () => {
        await routeOnA();

        const seen: { type: string; status?: ProviderExternalPlaybackStatus }[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type === 'track-changed') seen.push({ type: event.type, status: event.status });
        });
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => showsOther);
        await vi.advanceTimersByTimeAsync(600);
        await vi.advanceTimersByTimeAsync(600);
        await vi.advanceTimersByTimeAsync(600);
        unsubscribe();

        expect(seen).toHaveLength(1);
        expect(seen[0].status?.shownTrack).toEqual({ title: 'Song c', artist: 'Artist' });
        expect(seen[0].status?.mediaId).toBe('');
    });

    it('is not paused instead, which is what a player that follows nothing gets', async () => {
        await routeOnA();

        omniMock.getExternalPlaybackStatus.mockImplementation(async () => showsOther);
        await vi.advanceTimersByTimeAsync(600);

        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
    });
});
