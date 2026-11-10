// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

// test/unit/appleMusic/externalPlayback.test.ts
// The route that follows a player outside the app: it starts the song there, follows the player's
// clock between answers, pauses when another engine takes over, and moves the queue on at the end.

// What the provider of the song declared about its player: nothing, as Apple Music declares.
const traits = vi.hoisted(() => ({
    declared: {
        capturesSystemAudio: false, startsWithoutWaiting: false, backsOffStatusPolls: false, holdsMediaKeysWhilePlaying: false,
    } as Record<string, boolean>,
}));

const omniMock = vi.hoisted(() => ({
    canPlayExternally: vi.fn(() => true),
    canPlaySong: vi.fn(() => true),
    prepareExternalPlaybackQueue: vi.fn(async () => {}),
    playSongExternally: vi.fn(async (_song: unknown, _startSec: number) => {}),
    pauseExternalPlayback: vi.fn(async (_song: unknown) => {}),
    resumeExternalPlayback: vi.fn(async (_song: unknown) => {}),
    seekExternalPlayback: vi.fn(async (_song: unknown, _seconds: number) => {}),
    setExternalPlaybackVolume: vi.fn(async (_song: unknown, _volume: number) => {}),
    getExternalPlaybackStatus: vi.fn(async (_song: unknown): Promise<ProviderExternalPlaybackStatus> => ({
        mediaId: '123', isPlaying: true, positionMs: 10000, durationMs: 200000, ended: false,
    })),
    isExternalPlaybackStatusForSong: vi.fn((_song: unknown, _status: ProviderExternalPlaybackStatus) => true),
    adoptExternalPlayback: vi.fn((_song: unknown) => {}),
    externalPlaybackTraits: vi.fn(() => traits.declared),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { getObservedMedia } = await import('@/services/hifi/hifiMediaShim');
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

const status = (overrides: Partial<ProviderExternalPlaybackStatus> = {}): ProviderExternalPlaybackStatus => ({
    mediaId: '123', isPlaying: true, positionMs: 10000, durationMs: 200000, ended: false, ...overrides,
});

const flush = () => vi.advanceTimersByTimeAsync(0);

/**
 * Makes the status asks fail four times in a row: this player declared nothing, so every one of them
 * is retried after the same two seconds, and the next ask is two seconds away again.
 */
const backOffStatusAsks = async () => {
    omniMock.getExternalPlaybackStatus.mockRejectedValue(new Error('playback-failed'));
    omniMock.getExternalPlaybackStatus.mockClear();
    const seen: number[] = [];
    for (const step of [500, 2000, 2000, 2000]) {
        await vi.advanceTimersByTimeAsync(step);
        seen.push(omniMock.getExternalPlaybackStatus.mock.calls.length);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
};

describe('external playback route', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: null });
        omniMock.prepareExternalPlaybackQueue.mockClear();
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.pauseExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.resumeExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.seekExternalPlayback.mockReset().mockResolvedValue(undefined);
        useAudioSettingsStore.setState({ volume: 1, isMuted: false });
        omniMock.setExternalPlaybackVolume.mockReset().mockResolvedValue(undefined);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.isExternalPlaybackStatusForSong.mockReset().mockReturnValue(true);
        omniMock.adoptExternalPlayback.mockClear();
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE });
        vi.useRealTimers();
    });

    it('keeps live broadcasts untimed while playing and ignores timeline seeks', async () => {
        usePlaybackStore.setState({ duration: 200 });
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ live: true, positionMs: 0, durationMs: 0 }));
        await engine.beginExternalPlayback({ ...song, durationMs: 0 }, 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(1250);
        expect(engine.getExternalPosition()).toBe(0);
        expect(usePlaybackStore.getState().duration).toBe(0);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        engine.seekExternalPlayback(30);
        expect(omniMock.seekExternalPlayback).not.toHaveBeenCalled();
        expect(engine.getExternalPosition()).toBe(0);
    });

    it('starts the song in the player and shows it only once the app has announced it', async () => {
        const playing = engine.beginExternalPlayback(song, 12);
        await flush();
        await playing;
        expect(omniMock.playSongExternally).toHaveBeenCalledWith(song, 12, { userAction: true });
        expect(usePlaybackStore.getState().playbackRoute).toBe('external');
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
        // The old song is still on screen: observers keep what they had until the app shows the new one.
        expect(engine.isExternalPlaybackSounding()).toBe(false);
        expect(getObservedMedia(null)).toBeNull();

        engine.announceExternalPlayback();
        expect(engine.isExternalPlaybackSounding()).toBe(true);
        expect(getObservedMedia(null)).toBe(engine.externalMediaShim);
        expect(engine.getExternalPosition()).toBeGreaterThanOrEqual(10);
        // The initial actual status already confirms playback; no extra loading tick is needed.
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        await vi.advanceTimersByTimeAsync(500);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });

    it('hands the player the app volume before the start, and muted as silence', async () => {
        useAudioSettingsStore.setState({ volume: 0.4, isMuted: false });
        const order: string[] = [];
        omniMock.setExternalPlaybackVolume.mockImplementation(async () => { order.push('volume'); });
        omniMock.playSongExternally.mockImplementation(async () => { order.push('play'); });
        await engine.beginExternalPlayback(song, 0);
        // Again once the player has the song: the page may have been replaced between the two.
        expect(order).toEqual(['volume', 'play', 'volume']);
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenCalledWith(song, 0.4);

        useAudioSettingsStore.setState({ isMuted: true });
        await flush();
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 0);
        useAudioSettingsStore.setState({ isMuted: false });
        await flush();
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 0.4);
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenCalledTimes(4);
    });

    it('sends one volume at a time during a drag and then the newest level', async () => {
        await engine.beginExternalPlayback(song, 0);
        await flush();
        omniMock.setExternalPlaybackVolume.mockClear();
        let finish!: () => void;
        omniMock.setExternalPlaybackVolume.mockImplementationOnce(() => new Promise<void>(done => { finish = done; }));
        engine.setExternalPlaybackVolume(0.8);
        engine.setExternalPlaybackVolume(0.6);
        engine.setExternalPlaybackVolume(0.5);
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenCalledTimes(1);
        finish();
        await flush();
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenCalledTimes(2);
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 0.5);
        // A level the player already has is not sent again.
        engine.setExternalPlaybackVolume(0.5);
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenCalledTimes(2);
    });

    it('previews a drag with the stored mute applied', async () => {
        await engine.beginExternalPlayback(song, 0);
        await flush();
        engine.previewExternalPlaybackVolume(0.3);
        await flush();
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 0.3);
        useAudioSettingsStore.setState({ isMuted: true });
        await flush();
        engine.previewExternalPlaybackVolume(0.7);
        await flush();
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 0);
    });

    it('does not touch the player volume off the external route', () => {
        useAudioSettingsStore.setState({ volume: 0.3 });
        engine.setExternalPlaybackVolume(0.2);
        engine.previewExternalPlaybackVolume(0.2);
        expect(omniMock.setExternalPlaybackVolume).not.toHaveBeenCalled();
    });

    it('follows the player position and length between answers', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 30000 }));
        await vi.advanceTimersByTimeAsync(500);
        expect(usePlaybackStore.getState().duration).toBe(200);
        // The answer is half a round trip old; the clock runs from there.
        expect(engine.getExternalPosition()).toBeGreaterThanOrEqual(30);
    });

    it('pauses with the player and reports the end once', async () => {
        const events: string[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => events.push(event.type));
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false, positionMs: 40000 }));
        await vi.advanceTimersByTimeAsync(500);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(engine.isExternalPaused()).toBe(true);

        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false, positionMs: 200000, ended: true }));
        await vi.advanceTimersByTimeAsync(500);
        await vi.advanceTimersByTimeAsync(2000);
        expect(events.filter(type => type === 'ended')).toHaveLength(1);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        unsubscribe();
    });



    it('announces an end observed before the track reached the app exactly once', async () => {
        const events: string[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => events.push(event.type));
        await engine.beginExternalPlayback(song, 0);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false, ended: true, positionMs: 200000 }));
        await vi.advanceTimersByTimeAsync(500);
        expect(events).not.toContain('ended');
        engine.announceExternalPlayback();
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(500);
        expect(events.filter(type => type === 'ended')).toHaveLength(1);
        unsubscribe();
    });


    it('ignores a previous song end before the new track is announced', async () => {
        const events: string[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => events.push(event.type));
        await engine.beginExternalPlayback(song, 0);
        omniMock.isExternalPlaybackStatusForSong.mockReturnValue(false);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: 'old', isPlaying: false, ended: true, durationMs: 999999 }));
        await vi.advanceTimersByTimeAsync(500);
        engine.announceExternalPlayback();
        expect(events).not.toContain('ended');
        expect(events).not.toContain('foreign-track');
        expect(usePlaybackStore.getState().duration).toBe(200);
        unsubscribe();
    });

    it('does not advance the queue when a different web song completes', async () => {
        const events: string[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => events.push(event.type));
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.isExternalPlaybackStatusForSong.mockReturnValue(false);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: 'foreign', ended: true, isPlaying: false, positionMs: 200000 }));
        await vi.advanceTimersByTimeAsync(500);
        expect(events).not.toContain('ended');
        expect(events).toContain('foreign-track');
        unsubscribe();
    });

    it('waits through a player with nothing loaded without calling it another song', async () => {
        const events: string[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => events.push(event.type));
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '', isPlaying: false, positionMs: 0, durationMs: 0 }));
        await vi.advanceTimersByTimeAsync(500);
        expect(events).not.toContain('foreign-track');
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        unsubscribe();
    });

    it('pauses the player when another engine takes the song', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        usePlaybackStore.getState().setPlaybackRoute('web');
        expect(omniMock.pauseExternalPlayback).toHaveBeenCalledWith(song);
        expect(engine.getExternalSong()).toBeNull();
    });


    it('keeps an accepted buffering start in loading state rather than paused', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ starting: true, isPlaying: false, positionMs: 0 }));
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(1000);
        expect(usePlaybackStore.getState().isLoadingToPlay).toBe(true);
        expect(omniMock.resumeExternalPlayback).not.toHaveBeenCalled();
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status());
        await vi.advanceTimersByTimeAsync(500);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        expect(usePlaybackStore.getState().isLoadingToPlay).toBe(false);
    });

    it('shows a buffering start that then fails as paused, not loading', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ starting: true, isPlaying: false, positionMs: 0 }));
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(500);
        expect(usePlaybackStore.getState().isLoadingToPlay).toBe(true);
        omniMock.getExternalPlaybackStatus.mockRejectedValue(new Error('playback-failed'));
        await vi.advanceTimersByTimeAsync(500);
        expect(usePlaybackStore.getState().isLoadingToPlay).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });

    it('does not mistake a seek jump for playback progress', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 0 }));
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        engine.seekExternalPlayback(60);
        await flush();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 60000 }));
        await vi.advanceTimersByTimeAsync(1000);
        expect(engine.isExternalPlaybackReadyForPrefetch(song)).toBe(false);
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 60500 }));
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.isExternalPlaybackReadyForPrefetch(song)).toBe(true);
    });

    it('does not treat a playing flag with a stalled startup position as ready', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 0 }));
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(1500);
        expect(engine.isExternalPlaybackReadyForPrefetch(song)).toBe(false);
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 500 }));
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.isExternalPlaybackReadyForPrefetch(song)).toBe(true);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledTimes(1);
    });

    it('does not prepare ahead of an optimistic resume', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false }));
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        engine.resumeExternalPlayback();
        usePlaybackStore.setState({ playQueue: [song] });
        expect(omniMock.resumeExternalPlayback).toHaveBeenCalledTimes(1);
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status());
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10500 }));
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledTimes(1);
    });

    it('releases deferred preparation when seeking finishes without a pause', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ seeking: true }));
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ seeking: false }));
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10500 }));
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledTimes(1);
    });

    it('waits until playback starts before preparing successors', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false }));
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: true }));
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10500 }));
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledTimes(1);
    });

    it('refreshes the prepared tail when queue order or repeat mode changes', async () => {
        const next = { ...song, id: '456', sourceRef: { kind: 'online' as const, providerId: 'appleMusic', mediaId: '456' } };
        const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
        useAudioSettingsStore.setState({ loopMode: 'off' });
        usePlaybackStore.setState({ playQueue: [song, next] });
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(song, [next], undefined);
        usePlaybackStore.setState({ playQueue: [song] });
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(song, [], undefined);
        usePlaybackStore.setState({ playQueue: [song, next] });
        useAudioSettingsStore.setState({ loopMode: 'one' });
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(song, [], { retract: true });
        useAudioSettingsStore.setState({ loopMode: 'off' });
    });


    it('does not rewind the main lyric clock when a buffering pause and resume report coarse time', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10000, isPlaying: false }));
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.getExternalPosition()).toBeGreaterThanOrEqual(10.5);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10000, isPlaying: true }));
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.getExternalPosition()).toBeGreaterThanOrEqual(10.5);
    });

    it('discards a status sampled before an explicit backward seek', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        let finish!: (value: ProviderExternalPlaybackStatus) => void;
        omniMock.getExternalPlaybackStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        await vi.advanceTimersByTimeAsync(500);
        engine.seekExternalPlayback(9.8);
        await flush();
        finish(status({ positionMs: 10000 }));
        await flush();
        expect(engine.getExternalPosition()).toBeLessThan(10);
    });


    it('accepts the final small backward position after a player-side seek settles', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10000, isPlaying: false, seeking: true }));
        await vi.advanceTimersByTimeAsync(500);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 9800, isPlaying: true, seeking: false }));
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.getExternalPosition()).toBeCloseTo(9.8, 2);
    });


    it('ignores a failed status request that belongs to the timeline before a seek', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        const events: string[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => events.push(event.type));
        let fail!: (error: Error) => void;
        omniMock.getExternalPlaybackStatus.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
        await vi.advanceTimersByTimeAsync(500);
        engine.seekExternalPlayback(9.8);
        await flush();
        fail(new Error('outdated position request'));
        await flush();
        expect(events).not.toContain('failure');
        expect(engine.getExternalPosition()).toBeLessThan(10);
        unsubscribe();
    });

    it('retains a native seek marker when MusicKit temporarily clears its current item', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '', positionMs: 0, isPlaying: false, seeking: true }));
        await vi.advanceTimersByTimeAsync(500);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 9800, isPlaying: true, seeking: false }));
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.getExternalPosition()).toBeCloseTo(9.8, 2);
    });

    it('seeks within the song and resumes only where asked', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 0, isPlaying: false }));
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.seekExternalPlayback(120)).toBe(true);
        expect(omniMock.seekExternalPlayback).toHaveBeenLastCalledWith(song, 120);
        expect(omniMock.resumeExternalPlayback).not.toHaveBeenCalled();

        omniMock.seekExternalPlayback.mockClear();
        expect(engine.seekExternalPlayback(500, { resume: true })).toBe(true);
        expect(omniMock.seekExternalPlayback).toHaveBeenLastCalledWith(song, 200);
        expect(omniMock.resumeExternalPlayback).toHaveBeenCalledWith(song);
    });

    it('leaves the route and reports a refusal when the player will not start the song', async () => {
        omniMock.playSongExternally.mockRejectedValue(new Error('refused'));
        await expect(engine.beginExternalPlayback(song, 0)).rejects.toThrow('refused');
        expect(usePlaybackStore.getState().playbackRoute).toBe('web');
        expect(engine.getExternalSong()).toBeNull();
    });

    it('retries a player that stopped answering after the same two seconds every time, and one answer puts the half second back', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        // The player stopped answering (it was closed, or its page is gone): every poll fails, and
        // this player declared nothing about its answers, so the retry rate never grows.
        omniMock.getExternalPlaybackStatus.mockRejectedValue(new Error('playback-failed'));
        omniMock.getExternalPlaybackStatus.mockClear();
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(1);
        for (const asks of [2, 3, 4]) {
            await vi.advanceTimersByTimeAsync(1999);
            expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(asks - 1);
            await vi.advanceTimersByTimeAsync(1);
            expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(asks);
        }
        // One answer puts the ordinary 500ms back.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status());
        await vi.advanceTimersByTimeAsync(2000);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(5);
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(6);
    });

    // A player that answers one of Folia's own commands is there, but its asks keep the app's own
    // cadence here: nothing about a command says when this player may be asked again.
    it('moves no ask forward when the player answers a press of the listener', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await backOffStatusAsks();

        omniMock.getExternalPlaybackStatus.mockResolvedValue(status());
        expect(engine.resumeExternalPlayback()).toBe(true);
        await flush();
        // The retry that was already two seconds away is the next ask, not one pulled forward now.
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(1500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(5);
    });

    it('moves no ask forward for a pause the player took either', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await backOffStatusAsks();

        // The player took the pause: the next ask stays where the retry put it.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false }));
        expect(engine.pauseExternalPlayback()).toBe(true);
        await flush();
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(4);
    });

    it('moves no ask forward for the volume the app writes there', async () => {
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await backOffStatusAsks();

        // A good write says the page is still there, and says nothing about when to ask it next.
        useAudioSettingsStore.setState({ volume: 0.5 });
        await flush();
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 0.5);
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(4);
    });
    // Two providers play through players of their own (the companion, Spotify's Soloist): a song of
    // one does not replace a track sounding in the other.
    describe('moving between external players', () => {
        const soloistSong: SongResult = {
            id: 'track1',
            name: 'Other',
            artists: [{ id: '', name: 'Artist' }],
            album: { id: '', name: 'Album' },
            durationMs: 180000,
            sourceRef: { kind: 'online', providerId: 'spotify', mediaId: 'track1' },
        };

        it('stops the old player before the other one starts, in both directions', async () => {
            const order: string[] = [];
            omniMock.pauseExternalPlayback.mockImplementation(async (paused: unknown) => { order.push(`pause:${(paused as SongResult).id}`); });
            omniMock.playSongExternally.mockImplementation(async (played: unknown) => { order.push(`play:${(played as SongResult).id}`); });

            await engine.beginExternalPlayback(soloistSong, 0);
            engine.announceExternalPlayback();
            await engine.beginExternalPlayback(song, 0);
            expect(order).toEqual(['play:track1', 'pause:track1', 'play:123']);
            expect(engine.getExternalSong()).toBe(song);
            expect(usePlaybackStore.getState().playbackRoute).toBe('external');

            engine.announceExternalPlayback();
            order.length = 0;
            await engine.beginExternalPlayback(soloistSong, 0);
            expect(order).toEqual(['pause:123', 'play:track1']);
            expect(engine.getExternalSong()).toBe(soloistSong);
        });

        it('leaves the player alone when the next song plays in the same one', async () => {
            await engine.beginExternalPlayback(song, 0);
            engine.announceExternalPlayback();
            await engine.beginExternalPlayback({ ...song, id: '456', sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: '456', providerData: { resourceType: 'songs' } } }, 0);
            expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
        });

        it('stops a start the other player took over while it was still starting', async () => {
            let started!: () => void;
            const order: string[] = [];
            omniMock.pauseExternalPlayback.mockImplementation(async (paused: unknown) => { order.push(`pause:${(paused as SongResult).id}`); });
            omniMock.playSongExternally.mockImplementationOnce(async () => {
                await new Promise<void>(done => { started = done; });
                order.push('play:track1');
            });
            const first = engine.beginExternalPlayback(soloistSong, 0);
            await flush();
            await engine.beginExternalPlayback(song, 0);
            // A player may take the stop ahead of a start still on its way (the companion's urgent
            // pause skips its command chain): once the overtaken start is through, it is stopped again.
            started();
            await first;
            expect(order.slice(-2)).toEqual(['play:track1', 'pause:track1']);
            expect(engine.getExternalSong()).toBe(song);
        });

        it('stops a start a web song took over while it was still starting', async () => {
            let started!: () => void;
            omniMock.playSongExternally.mockImplementationOnce(async () => {
                await new Promise<void>(done => { started = done; });
            });
            const first = engine.beginExternalPlayback(soloistSong, 0);
            await flush();
            engine.yieldExternalPlayback('another song started');
            expect(omniMock.pauseExternalPlayback).toHaveBeenCalledTimes(1);
            started();
            await first;
            expect(omniMock.pauseExternalPlayback).toHaveBeenCalledTimes(2);
            expect(omniMock.pauseExternalPlayback).toHaveBeenLastCalledWith(soloistSong);
        });

        it('stops a handed-over track of the other player while a session is live here', async () => {
            await engine.beginExternalPlayback(song, 0);
            engine.announceExternalPlayback();
            omniMock.pauseExternalPlayback.mockClear();
            engine.releaseUnclaimedExternalTrack(soloistSong, 'test');
            expect(omniMock.pauseExternalPlayback).toHaveBeenCalledTimes(1);
            expect(omniMock.pauseExternalPlayback).toHaveBeenCalledWith(soloistSong);
            expect(engine.getExternalSong()).toBe(song);
        });
    });

    // A window rebuild: the player kept sounding, and the new window takes the track over without
    // starting it again.
    describe('adopting a running player', () => {
        it('takes over the same track as playing, at the player position, and polls it', async () => {
            usePlaybackStore.setState({ playerState: PlayerState.PLAYING });
            omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 42000 }));
            expect(await engine.adoptExternalPlayback(song)).toBe(true);
            expect(omniMock.playSongExternally).not.toHaveBeenCalled();
            expect(omniMock.adoptExternalPlayback).toHaveBeenCalledWith(song);
            expect(usePlaybackStore.getState().playbackRoute).toBe('external');
            expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
            expect(engine.isExternalPlaybackSounding()).toBe(true);
            expect(engine.getExternalPosition()).toBeGreaterThanOrEqual(42);
            expect(engine.getExternalPosition()).toBeLessThan(43);
            omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 42500 }));
            await vi.advanceTimersByTimeAsync(500);
            expect(engine.getExternalPosition()).toBeGreaterThanOrEqual(42.5);
        });

        it('takes over the same track paused as paused', async () => {
            usePlaybackStore.setState({ playerState: PlayerState.PLAYING });
            omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false, positionMs: 42000 }));
            expect(await engine.adoptExternalPlayback(song)).toBe(true);
            expect(usePlaybackStore.getState().playbackRoute).toBe('external');
            expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
            expect(engine.isExternalPaused()).toBe(true);
            expect(engine.getExternalPosition()).toBe(42);
            // Taken over: resuming is the player's resume, not a start from the beginning.
            engine.resumeExternalPlayback();
            expect(omniMock.resumeExternalPlayback).toHaveBeenCalledWith(song);
            expect(omniMock.playSongExternally).not.toHaveBeenCalled();
        });

        it('takes nothing over when the player has another track, and leaves it alone', async () => {
            omniMock.isExternalPlaybackStatusForSong.mockReturnValue(false);
            omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '999' }));
            expect(await engine.adoptExternalPlayback(song)).toBe(false);
            expect(omniMock.adoptExternalPlayback).not.toHaveBeenCalled();
            expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
            expect(usePlaybackStore.getState().playbackRoute).toBe('web');
            expect(engine.getExternalSong()).toBeNull();
            expect(engine.isExternalPlaybackSounding()).toBe(false);
            await vi.advanceTimersByTimeAsync(1000);
            expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(1);
        });

        it('stops a player nobody took over, and never one a live session owns', async () => {
            engine.releaseUnclaimedExternalTrack(song, 'test');
            expect(omniMock.pauseExternalPlayback).toHaveBeenCalledTimes(1);
            expect(omniMock.pauseExternalPlayback).toHaveBeenCalledWith(song);

            omniMock.pauseExternalPlayback.mockClear();
            await engine.beginExternalPlayback(song, 0);
            engine.releaseUnclaimedExternalTrack(song, 'test');
            expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
        });

        it('stops following the player once handed over: no polling, no end, no pause', async () => {
            await engine.beginExternalPlayback(song, 0);
            engine.announceExternalPlayback();
            expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
            const ended = vi.fn();
            engine.subscribeExternalPlayback(event => { if (event.type === 'ended') ended(); });
            const asked = omniMock.getExternalPlaybackStatus.mock.calls.length;

            engine.handOverExternalPlayback();
            omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false, ended: true, positionMs: 200000 }));
            await vi.advanceTimersByTimeAsync(2000);
            expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(asked);
            expect(ended).not.toHaveBeenCalled();
            expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
            expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        });

        it('acts on no answer that was in flight when it handed over, a failed one included', async () => {
            await engine.beginExternalPlayback(song, 0);
            engine.announceExternalPlayback();
            const events = vi.fn();
            const unsubscribe = engine.subscribeExternalPlayback(event => events(event.type));
            let fail!: (error: unknown) => void;
            omniMock.getExternalPlaybackStatus.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
            await vi.advanceTimersByTimeAsync(500);
            const asked = omniMock.getExternalPlaybackStatus.mock.calls.length;

            engine.handOverExternalPlayback();
            fail(new Error('the companion is busy'));
            await vi.advanceTimersByTimeAsync(2000);
            expect(events).not.toHaveBeenCalled();
            expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
            expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(asked);
            unsubscribe();
        });

        it('takes the player back when the window is not replaced, and follows it to the end', async () => {
            await engine.beginExternalPlayback(song, 0);
            engine.announceExternalPlayback();
            const ended = vi.fn();
            const unsubscribe = engine.subscribeExternalPlayback(event => { if (event.type === 'ended') ended(); });

            engine.handOverExternalPlayback();
            omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false, ended: true, positionMs: 200000 }));
            await vi.advanceTimersByTimeAsync(2000);
            expect(ended).not.toHaveBeenCalled();
            // The rebuild was refused: followed again at once.
            engine.reclaimExternalPlayback('refused');
            await flush();
            expect(ended).toHaveBeenCalledTimes(1);
            unsubscribe();
        });

        it('takes the player back by itself when no rebuild came', async () => {
            await engine.beginExternalPlayback(song, 0);
            engine.announceExternalPlayback();
            engine.handOverExternalPlayback();
            const asked = omniMock.getExternalPlaybackStatus.mock.calls.length;
            await vi.advanceTimersByTimeAsync(9000);
            expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(asked);
            await vi.advanceTimersByTimeAsync(1500);
            expect(omniMock.getExternalPlaybackStatus.mock.calls.length).toBeGreaterThan(asked);
        });

        it('still stops the player when this window leaves it after handing over', async () => {
            await engine.beginExternalPlayback(song, 0);
            engine.announceExternalPlayback();
            engine.handOverExternalPlayback();
            // Another song in this window, or the listener's stop: a window that was not replaced
            // after all must not leave the player sounding with nobody to stop it.
            engine.yieldExternalPlayback('another song started');
            expect(omniMock.pauseExternalPlayback).toHaveBeenCalledWith(song);
            expect(engine.getExternalSong()).toBeNull();
        });

        // The new window is rebuilt again before its own restore took the player over: the snapshot
        // goes on to the next window as it came, and the take-over here must not follow the player.
        describe('asked to hand over while still restoring', () => {
            const followEnd = () => {
                const ended = vi.fn();
                const unsubscribe = engine.subscribeExternalPlayback(event => { if (event.type === 'ended') ended(); });
                return { ended, unsubscribe };
            };

            it('lands a later take-over handed over: shown as it sounds, not followed, taken back when no rebuild came', async () => {
                usePlaybackStore.setState({ playerState: PlayerState.PLAYING });
                engine.handOverExternalPlaybackDuringRestore();
                expect(await engine.adoptExternalPlayback(song)).toBe(true);
                expect(engine.isExternalPlaybackSounding()).toBe(true);
                expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
                const { ended, unsubscribe } = followEnd();
                const asked = omniMock.getExternalPlaybackStatus.mock.calls.length;

                omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false, ended: true, positionMs: 200000 }));
                await vi.advanceTimersByTimeAsync(2000);
                expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(asked);
                expect(ended).not.toHaveBeenCalled();
                expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();

                await vi.advanceTimersByTimeAsync(9000);
                expect(ended).toHaveBeenCalledTimes(1);
                unsubscribe();
            });

            it('lands a take-over already on its way handed over', async () => {
                usePlaybackStore.setState({ playerState: PlayerState.PLAYING });
                let answer!: (value: ProviderExternalPlaybackStatus) => void;
                omniMock.getExternalPlaybackStatus.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
                const adopting = engine.adoptExternalPlayback(song);
                await flush();
                engine.handOverExternalPlaybackDuringRestore();
                answer(status());
                expect(await adopting).toBe(true);
                expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
                await vi.advanceTimersByTimeAsync(2000);
                expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(1);
            });

            it('hands a take-over already done over at once', async () => {
                expect(await engine.adoptExternalPlayback(song)).toBe(true);
                engine.handOverExternalPlaybackDuringRestore();
                const asked = omniMock.getExternalPlaybackStatus.mock.calls.length;
                await vi.advanceTimersByTimeAsync(2000);
                expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(asked);
            });

            it('follows the take-over as usual once the rebuild was refused', async () => {
                engine.handOverExternalPlaybackDuringRestore();
                engine.reclaimExternalPlayback('refused');
                expect(await engine.adoptExternalPlayback(song)).toBe(true);
                await vi.advanceTimersByTimeAsync(500);
                expect(omniMock.getExternalPlaybackStatus).toHaveBeenCalledTimes(2);
            });
        });

        it('takes nothing over when the player has no track or cannot be asked', async () => {
            omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '', isPlaying: false }));
            expect(await engine.adoptExternalPlayback(song)).toBe(false);
            expect(usePlaybackStore.getState().playbackRoute).toBe('web');

            omniMock.getExternalPlaybackStatus.mockRejectedValue(new Error('companion gone'));
            expect(await engine.adoptExternalPlayback(song)).toBe(false);
            expect(usePlaybackStore.getState().playbackRoute).toBe('web');
            expect(engine.getExternalSong()).toBeNull();
            expect(omniMock.playSongExternally).not.toHaveBeenCalled();
        });
    });
});

// The player answering through its coarse channel: said once in a run of Folia, whichever way it
// comes and goes.
describe('the player answering coarsely', () => {
    let events: string[] = [];
    let unsubscribe = () => {};

    beforeEach(async () => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: null });
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        events = [];
        unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type === 'degraded') events.push(`degraded:${event.active}`);
            if (event.type === 'ended') events.push('ended');
        });
    });

    afterEach(() => {
        unsubscribe();
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE });
        vi.useRealTimers();
    });


    it('tells the fallback once in a run of Folia, not once an episode', async () => {
        await engine.beginExternalPlayback(song);
        engine.announceExternalPlayback();

        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '', isPlaying: true, degraded: true }));
        await vi.advanceTimersByTimeAsync(1200);
        expect(events.filter(event => event.startsWith('degraded:'))).toEqual(['degraded:true']);

        // The player comes back to its precise channel and falls back again: the listener was told
        // once already, and is not told again in this run.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 20000 }));
        await vi.advanceTimersByTimeAsync(600);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: '', degraded: true }));
        await vi.advanceTimersByTimeAsync(600);
        expect(events.filter(event => event.startsWith('degraded:'))).toEqual(['degraded:true']);
    });
});
