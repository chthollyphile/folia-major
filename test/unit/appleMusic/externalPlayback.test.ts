// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

// test/unit/appleMusic/externalPlayback.test.ts
// The route that follows a player outside the app: it starts the song there, follows the player's
// clock between answers, pauses when another engine takes over, and moves the queue on at the end.

const omniMock = vi.hoisted(() => ({
    canPlayExternally: vi.fn(() => true),
    canPlaySong: vi.fn(() => true),
    prepareExternalPlaybackQueue: vi.fn(async () => {}),
    playSongExternally: vi.fn(async (_song: unknown, _startSec: number) => {}),
    pauseExternalPlayback: vi.fn(async (_song: unknown) => {}),
    resumeExternalPlayback: vi.fn(async (_song: unknown) => {}),
    seekExternalPlayback: vi.fn(async (_song: unknown, _seconds: number) => {}),
    getExternalPlaybackStatus: vi.fn(async (_song: unknown): Promise<ProviderExternalPlaybackStatus> => ({
        mediaId: '123', isPlaying: true, positionMs: 10000, durationMs: 200000, ended: false,
    })),
    isExternalPlaybackStatusForSong: vi.fn((_song: unknown, _status: ProviderExternalPlaybackStatus) => true),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { getObservedMedia } = await import('@/services/hifi/hifiMediaShim');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');

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
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.isExternalPlaybackStatusForSong.mockReset().mockReturnValue(true);
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
        expect(omniMock.playSongExternally).toHaveBeenCalledWith(song, 12);
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


    it('refreshes the prepared tail when queue order or repeat mode changes', async () => {
        const next = { ...song, id: '456', sourceRef: { kind: 'online' as const, providerId: 'appleMusic', mediaId: '456' } };
        const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
        useAudioSettingsStore.setState({ loopMode: 'off' });
        usePlaybackStore.setState({ playQueue: [song, next] });
        await engine.beginExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(song, [next]);
        usePlaybackStore.setState({ playQueue: [song] });
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(song, []);
        usePlaybackStore.setState({ playQueue: [song, next] });
        useAudioSettingsStore.setState({ loopMode: 'one' });
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(song, []);
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
});
