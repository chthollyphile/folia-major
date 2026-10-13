// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackTransportController } from '@/hooks/usePlaybackTransportController';
import { buildPlaybackFailureStatus, resolvePlaybackFailurePolicy } from '@/services/playbackRecovery/playbackFailurePolicy';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { PlayerState } from '@/types';

// test/unit/playback/playbackTransportController.test.ts
vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    } });
});
vi.mock('react-i18next', async importOriginal => ({
    ...await importOriginal<typeof import('react-i18next')>(),
    useTranslation: () => ({ t: (key: string) => key }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
beforeEach(() => {
    usePlaybackStore.setState({ activePlaybackContext: 'main', audioSrc: 'fixture.mp3', playerState: PlayerState.PAUSED });
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => {
    act(() => root?.unmount());
    root = null;
});
function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
function mount({ contextResume, audioPlay, refreshSource = false }: {
    contextResume?: Promise<void>; audioPlay?: Promise<void>; refreshSource?: boolean;
} = {}) {
    const audio = {
        currentSrc: 'fixture.mp3', currentTime: 0, paused: true, ended: false,
        play: vi.fn(() => audioPlay ?? Promise.resolve()), pause: vi.fn(),
    };
    const recover = vi.fn<Parameters<typeof usePlaybackTransportController>[0]['recoverOnlinePlaybackSource']>(async () => ({ status: 'not-attempted' }));
    const params: Parameters<typeof usePlaybackTransportController>[0] = {
        stageActiveEntryKind: null, isNowPlayingStageActive: false,
        audioRef: { current: audio as unknown as HTMLAudioElement },
        audioContextRef: { current: {
            state: contextResume ? 'suspended' : 'running', resume: () => contextResume,
        } as unknown as AudioContext },
        stageLyricsClockRef: { current: { startTimeSec: 0, endTimeSec: 180, baseTimeSec: 0, startedAtMs: null } },
        setupAudioAnalyzer: vi.fn(), syncOutputGain: vi.fn(), getTargetPlaybackVolume: () => 1,
        shouldRefreshCurrentOnlineAudioSource: () => refreshSource, recoverOnlinePlaybackSource: recover,
        getSyntheticStageLyricsTime: () => 0, syncStageLyricsClock: vi.fn(),
    };
    let actions!: ReturnType<typeof usePlaybackTransportController>;
    function Probe() { actions = usePlaybackTransportController(params); return null; }
    root = createRoot(document.createElement('div'));
    act(() => root!.render(React.createElement(Probe)));
    return { audio, recover, params, actions: () => actions };
}
describe('transport pause during pending resume', () => {
    it('does not start audio when a pause interrupts AudioContext.resume', async () => {
        const context = deferred();
        const host = mount({ contextResume: context.promise });
        let pending!: Promise<void>;
        act(() => { pending = host.actions().resumePlayback(); host.actions().pausePlayback(); });
        await act(async () => { context.resolve(); await pending; });
        expect(host.audio.play).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });
    it('does not publish PLAYING when an old audio.play resolves after pause', async () => {
        const playback = deferred();
        const host = mount({ audioPlay: playback.promise });
        let pending!: Promise<void>;
        act(() => { pending = host.actions().resumePlayback(); host.actions().pausePlayback(); });
        await act(async () => { playback.resolve(); await pending; });
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });
    it('does not try to recover an obsolete play failure after pause', async () => {
        const playback = deferred();
        const host = mount({ audioPlay: playback.promise });
        let pending!: Promise<void>;
        act(() => { pending = host.actions().resumePlayback(); host.actions().pausePlayback(); });
        await act(async () => { playback.reject(new DOMException('Play interrupted', 'AbortError')); await pending; });
        expect(host.recover).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });
    it('allows a later resume without an obsolete rejection undoing it', async () => {
        const previousPlayback = deferred();
        const host = mount();
        host.audio.play.mockImplementationOnce(() => previousPlayback.promise);
        let previousResume!: Promise<void>;
        act(() => { previousResume = host.actions().resumePlayback(); host.actions().pausePlayback(); });
        await act(async () => { await host.actions().resumePlayback(); });
        expect(host.audio.play).toHaveBeenCalledTimes(2);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        await act(async () => {
            previousPlayback.reject(new DOMException('Earlier play interrupted', 'AbortError'));
            await previousResume;
        });
        expect(host.recover).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });
    it.each([false, true])('evaluates pending refresh autoplay using the latest intent (resume again: %s)', async (resumeAgain) => {
        const source = deferred();
        const host = mount({ refreshSource: true });
        let shouldAutoplay!: () => boolean;
        host.recover.mockImplementationOnce(async options => {
            shouldAutoplay = options.shouldAutoplay!;
            await source.promise;
            return { status: 'recovered' };
        });
        let pending!: Promise<void>;
        act(() => { pending = host.actions().resumePlayback(); host.actions().pausePlayback(); });
        expect(shouldAutoplay()).toBe(false);
        if (resumeAgain) await act(async () => { await host.actions().resumePlayback(); });
        expect(shouldAutoplay()).toBe(resumeAgain);
        await act(async () => { source.resolve(); await pending; });
        expect(usePlaybackStore.getState().playerState).toBe(resumeAgain ? PlayerState.PLAYING : PlayerState.PAUSED);
    });
});
describe('transport failure reasons', () => {
    it('falls back to the old URL and plays when the TTL refresh fails', async () => {
        const host = mount({ refreshSource: true });
        host.recover.mockResolvedValueOnce({
            status: 'failed', failure: { reason: 'rate-limited', stage: 'refresh', providerId: 'qq', retryAfterMs: 25_000 },
        });
        await act(async () => { await host.actions().resumePlayback(); });
        expect(host.recover).toHaveBeenCalledTimes(1);
        expect(host.audio.play).toHaveBeenCalledTimes(1);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        expect(useStatusMessageStore.getState().message).toBeNull();
    });
    it('names the recovery failure when play and the refresh both fail', async () => {
        const playError = new Error('MEDIA_ELEMENT_ERROR: Format error');
        const host = mount({ audioPlay: Promise.reject(playError) });
        host.recover.mockResolvedValueOnce({
            status: 'failed', failure: { reason: 'session-expired', stage: 'refresh', providerId: 'qq' },
        });
        await act(async () => { await expect(host.actions().resumePlayback()).rejects.toBe(playError); });
        expect(useStatusMessageStore.getState().message).toEqual({ type: 'error', text: 'status.loginExpired' });
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });
    it('names a failed TTL refresh when the fallback play then fails without a further reason', async () => {
        const playError = new Error('MEDIA_ELEMENT_ERROR: Format error');
        const host = mount({ refreshSource: true, audioPlay: Promise.reject(playError) });
        host.recover
            .mockResolvedValueOnce({ status: 'failed', failure: { reason: 'network', stage: 'refresh' } })
            .mockResolvedValueOnce({ status: 'not-attempted' });
        await act(async () => { await expect(host.actions().resumePlayback()).rejects.toBe(playError); });
        expect(useStatusMessageStore.getState().message).toEqual({ type: 'error', text: 'status.songNetworkFailed' });
    });
    it('keeps the generic message when no failure reason is known', async () => {
        const playError = new Error('MEDIA_ELEMENT_ERROR: Format error');
        const host = mount({ audioPlay: Promise.reject(playError) });
        await act(async () => { await expect(host.actions().resumePlayback()).rejects.toBe(playError); });
        expect(useStatusMessageStore.getState().message).toEqual({ type: 'error', text: 'status.playbackError' });
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });
    it('keeps a retry / skip failure toast when play on the failed deck is rejected again', async () => {
        const failureToast = buildPlaybackFailureStatus(
            resolvePlaybackFailurePolicy({ reason: 'unknown', stage: 'media-element', mediaErrorCode: 4 }, 'mid-playback'),
            key => key,
            { retry: vi.fn(), skip: vi.fn(), dismiss: vi.fn() },
        );
        useStatusMessageStore.setState({ message: failureToast });
        const playError = new DOMException('The element has no supported sources.', 'NotSupportedError');
        const host = mount({ audioPlay: Promise.reject(playError) });
        await act(async () => { await expect(host.actions().resumePlayback()).rejects.toBe(playError); });
        expect(host.recover).toHaveBeenCalledOnce();
        expect(useStatusMessageStore.getState().message).toBe(failureToast);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });
    it('keeps the toast onError showed for the same shared recovery that failed', async () => {
        const failureToast = buildPlaybackFailureStatus(
            resolvePlaybackFailurePolicy({ reason: 'network', stage: 'refresh' }, 'mid-playback'),
            key => key,
            { retry: vi.fn(), skip: vi.fn(), dismiss: vi.fn() },
        );
        useStatusMessageStore.setState({ message: failureToast });
        const playError = new Error('MEDIA_ELEMENT_ERROR: Format error');
        const host = mount({ audioPlay: Promise.reject(playError) });
        host.recover.mockResolvedValueOnce({ status: 'failed', failure: { reason: 'network', stage: 'refresh' } });
        await act(async () => { await expect(host.actions().resumePlayback()).rejects.toBe(playError); });
        expect(useStatusMessageStore.getState().message).toBe(failureToast);
    });
    it('still asks for a click when autoplay is blocked', async () => {
        const host = mount({ audioPlay: Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError')) });
        host.recover.mockResolvedValueOnce({ status: 'failed', failure: { reason: 'unknown', stage: 'refresh' } });
        await act(async () => { await host.actions().resumePlayback(); });
        expect(useStatusMessageStore.getState().message).toEqual({ type: 'info', text: 'status.clickToPlay' });
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });
    it('stops once the recovery restored the source', async () => {
        const host = mount({ audioPlay: Promise.reject(new Error('play failed')) });
        host.recover.mockResolvedValueOnce({ status: 'recovered' });
        await act(async () => { await host.actions().resumePlayback(); });
        expect(useStatusMessageStore.getState().message).toBeNull();
    });
    it('clears a leftover playback-failure toast once playback resumes, and nothing else', async () => {
        const failureToast = buildPlaybackFailureStatus(
            resolvePlaybackFailurePolicy({ reason: 'network', stage: 'resolve-url' }, 'play'),
            key => key,
            { retry: vi.fn(), skip: vi.fn(), dismiss: vi.fn() },
        );
        useStatusMessageStore.setState({ message: failureToast });
        const host = mount();
        await act(async () => { await host.actions().resumePlayback(); });
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        expect(useStatusMessageStore.getState().message).toBeNull();

        const countdown = { type: 'error' as const, text: 'status.songUnavailablePrompt', persistent: true, onAction: vi.fn() };
        useStatusMessageStore.setState({ message: countdown });
        await act(async () => { await host.actions().resumePlayback(); });
        expect(useStatusMessageStore.getState().message).toBe(countdown);
    });
});
