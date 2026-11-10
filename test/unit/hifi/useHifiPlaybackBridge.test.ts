// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import { PlayerState } from '@/types';
import type {
    HifiClockUpdate,
    HifiEngineState,
    HifiErrorEvent,
    HifiLoadRequest,
    HifiLoadResult,
    HifiRuntimeStatus,
} from '@/types/hifi';
import type { HifiApi } from '@/services/hifi/hifiEngine';

// test/unit/hifi/useHifiPlaybackBridge.test.ts
// HiFi 播放桥挂在真的 hifiPlayback 服务上，主进程换成假的 window.electron.hifi：配置和循环的下发、载入就绪后的自动播放
// （等歌词、恢复成暂停）、引擎状态写回播放 store、放完换歌（同一首又放起来再放完时照样换）和队尾放开设备、失败时只提示一次并
// 回到 Web 引擎、熔断只提示一次，以及给传输控制用的跳转。后半是回落和关掉 HiFi 时带着位置和播放状态挪到 Web 引擎（之后开始的
// 播放没放成就放弃了时照样挪）、手动开播用掉意图、载入落定时补发 loop-file、队尾停下后跳转再播放，以及停着的恢复延后载入。

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
vi.mock('@/services/hifi/sourceSpec', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/hifi/sourceSpec')>(),
    readLocalSourceSpec: vi.fn(async () => ({
        origin: 'local', codec: 'FLAC', container: 'FLAC', bitDepth: 16, sampleRate: 44100, channels: 2,
        lossless: true, isDsd: false, dsdRate: null, bitrate: null,
    })),
}));

const { useHifiPlaybackBridge } = await import('@/components/hifi/useHifiPlaybackBridge');
const { resumeHifiPlayback, seekHifiRoute } = await import('@/components/hifi/hifiRouteTransport');
const { beginHifiTrack, getHifiPosition, isHifiRoute, leaveHifiRoute, useHifiTrackStore } = await import('@/services/hifi/hifiPlayback');
const { startPlay } = await import('@/components/app/playback/currentSong');
const { hifiEngine, useHifiEngineStore } = await import('@/services/hifi/hifiEngine');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { useHifiSettingsStore } = await import('@/stores/useHifiSettingsStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { currentTime } = await import('@/stores/motionSignals');

// 主进程的状态 seq 在整个文件里只增不减：引擎单例记得见过的最大 seq。
let seq = 100;
const nextSeq = () => {
    seq += 1;
    return seq;
};

const engineState = (overrides: Partial<HifiEngineState> = {}): HifiEngineState => ({
    status: 'paused',
    processRunning: true,
    trackKey: null,
    songKey: null,
    sourceKind: 'local',
    localSourceKey: null,
    durationSec: null,
    positionSec: 0,
    paused: true,
    loopFile: false,
    audioParams: null,
    audioOutParams: null,
    currentAo: 'pipewire',
    audioDevice: 'auto',
    exclusive: true,
    spdif: null,
    volume: 100,
    track: null,
    next: null,
    errorCode: null,
    circuitOpen: false,
    seq: nextSeq(),
    ...overrides,
});

const runtimeStatus: HifiRuntimeStatus = {
    available: true,
    path: '/usr/bin/mpv',
    version: '0.41.0',
    source: 'system',
    errorCode: null,
    manualPathRejected: false,
    platform: 'linux',
    arch: 'x64',
    download: { supported: false, version: null, installedVersion: null, updateAvailable: false, installing: false },
    dopCapable: false,
};

const push: {
    state?: (state: HifiEngineState) => void;
    clock?: (update: HifiClockUpdate) => void;
    error?: (event: HifiErrorEvent) => void;
} = {};

const okLoad = async (request: HifiLoadRequest): Promise<HifiLoadResult> => ({
    ok: true,
    state: engineState({
        trackKey: request.trackKey,
        songKey: request.songKey,
        localSourceKey: request.source.kind === 'local' ? request.source.sourceKey : null,
        positionSec: request.startSec,
    }),
});

// 整个文件一份假接口：installHifiPlayback 只装一次，订阅的回调就是第一次挂载时交来的这些。
const api = {
    getRuntimeStatus: vi.fn<HifiApi['getRuntimeStatus']>(async () => runtimeStatus),
    detectRuntime: vi.fn(async () => runtimeStatus),
    pickRuntimePath: vi.fn(async () => null),
    installRuntime: vi.fn<HifiApi['installRuntime']>(async () => ({ ok: true, errorCode: null, status: runtimeStatus })),
    cancelInstall: vi.fn(async () => undefined),
    configure: vi.fn<HifiApi['configure']>(async () => undefined),
    listDevices: vi.fn(async () => []),
    load: vi.fn<HifiApi['load']>(okLoad),
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    seek: vi.fn(async (_positionSec: number) => undefined),
    stop: vi.fn(async () => undefined),
    setLoopFile: vi.fn(async (_loop: boolean) => undefined),
    preloadNext: vi.fn(async (_request: HifiLoadRequest) => true),
    clearNext: vi.fn(async () => undefined),
    getSnapshot: vi.fn<HifiApi['getSnapshot']>(async () => engineState({ status: 'idle' })),
    probeOutput: vi.fn<HifiApi['probeOutput']>(async () => null),
    respondRead: vi.fn<HifiApi['respondRead']>(async () => undefined),
    onState: vi.fn((callback: (state: HifiEngineState) => void) => { push.state = callback; return () => {}; }),
    onClock: vi.fn((callback: (update: HifiClockUpdate) => void) => { push.clock = callback; return () => {}; }),
    onError: vi.fn((callback: (event: HifiErrorEvent) => void) => { push.error = callback; return () => {}; }),
    onInstallProgress: vi.fn(() => () => {}),
    onReadRequest: vi.fn(() => () => {}),
} satisfies HifiApi;

const localSong = { id: 'song-1', fileName: 'song.flac', filePath: 'Music/song.flac', mimeType: 'audio/flac' } as LocalSong;
const song = { id: 'song-1', name: 'Song', isLocal: true, localRef: { songId: 'song-1' }, sourceRef: { kind: 'local', mediaId: 'song-1' } } as unknown as SongResult;
const SONG_KEY = 'local:song-1';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

type BridgeParams = Parameters<typeof useHifiPlaybackBridge>[0];

const mount = (overrides: Partial<BridgeParams> = {}) => {
    const params: BridgeParams = {
        handleNextTrack: vi.fn(async () => undefined),
        playSong: vi.fn(async () => undefined),
        shouldAutoPlayRef: { current: true },
        isLyricsLoading: false,
        effectiveLoopMode: 'off',
        isFmMode: false,
        ...overrides,
    };
    function Probe(props: BridgeParams) {
        useHifiPlaybackBridge(props);
        return null;
    }
    root = createRoot(document.createElement('div'));
    act(() => root!.render(React.createElement(Probe, params)));
    const rerender = (next: Partial<BridgeParams>) => {
        Object.assign(params, next);
        act(() => root!.render(React.createElement(Probe, { ...params })));
    };
    return { params, rerender };
};

type BeginOptions = Partial<Omit<Parameters<typeof beginHifiTrack>[0], 'song' | 'source'>>;

/** 像 onPlayLocalSong 那样起播一首：歌设成当前，然后 beginHifiTrack 暂停着载入。 */
const startTrack = async (options: BeginOptions = {}) => {
    usePlaybackStore.setState({ currentSong: song });
    await act(async () => {
        await beginHifiTrack({ song, source: { kind: 'local', localSong, file: new Blob([new Uint8Array([1, 2, 3])]) }, startSec: 0, ...options });
    });
    const trackKey = useHifiTrackStore.getState().current?.trackKey;
    if (!trackKey) throw new Error('no HiFi track');
    return trackKey;
};

const pushState = async (overrides: Partial<HifiEngineState>) => {
    await act(async () => {
        push.state?.(engineState({ songKey: SONG_KEY, ...overrides }));
        await flush();
    });
};

const toast = () => useStatusMessageStore.getState().message;

beforeAll(() => {
    (window as unknown as { electron: unknown }).electron = { hifi: api };
});

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    usePlaybackStore.setState({ playerState: PlayerState.IDLE, duration: 0, currentSong: null, isFmMode: false });
    useStatusMessageStore.setState({ message: null });
    api.load.mockImplementation(okLoad);
});

afterEach(async () => {
    act(() => root?.unmount());
    root = null;
    leaveHifiRoute('test');
    hifiEngine.clearForcedWeb();
    useHifiEngineStore.setState({ lastError: null });
    await flush();
    Object.values(api).forEach(fn => fn.mockClear());
    vi.restoreAllMocks();
});

describe('useHifiPlaybackBridge', () => {
    it('installs the HiFi playback on mount and pushes the settings, the volume on mpv\'s curve and the mute on its own', async () => {
        useHifiSettingsStore.setState({ softwareVolume: true, mpvPath: '', audioDevice: 'auto', exclusive: true, dsdMode: 'pcm' });
        useAudioSettingsStore.setState({ volume: 0.125, isMuted: false });
        mount();
        await act(flush);
        expect(api.onState).toHaveBeenCalled();
        expect(api.getRuntimeStatus).toHaveBeenCalled();
        // mpv's gain is (volume / 100)^3: 50 gives the app's linear 0.125.
        expect(api.configure).toHaveBeenLastCalledWith(expect.objectContaining({ softwareVolume: true, volume: 50, muted: false }));

        // Mute is its own field: the volume stays, so unmuting comes back at the same level.
        act(() => useAudioSettingsStore.setState({ isMuted: true }));
        expect(api.configure).toHaveBeenLastCalledWith(expect.objectContaining({ volume: 50, muted: true }));
        act(() => useAudioSettingsStore.setState({ isMuted: false, volume: 0.8 }));
        expect(api.configure).toHaveBeenLastCalledWith(expect.objectContaining({ volume: expect.closeTo(Math.cbrt(0.8) * 100, 9), muted: false }));
        act(() => useHifiSettingsStore.setState({ exclusive: false }));
        expect(api.configure).toHaveBeenLastCalledWith(expect.objectContaining({ exclusive: false, muted: false }));

        // With software volume off, a mute still reaches mpv.
        act(() => useHifiSettingsStore.setState({ softwareVolume: false, exclusive: true }));
        act(() => useAudioSettingsStore.setState({ isMuted: true }));
        expect(api.configure).toHaveBeenLastCalledWith(expect.objectContaining({ softwareVolume: false, muted: true }));
        act(() => useAudioSettingsStore.setState({ isMuted: false, volume: 1 }));
    });

    it('waits for the lyrics before it spends the play intent, then starts mpv', async () => {
        const shouldAutoPlayRef = { current: true };
        const { rerender } = mount({ shouldAutoPlayRef, isLyricsLoading: true });
        await startTrack();
        expect(useHifiTrackStore.getState().loadState).toBe('ready');
        expect(api.play).not.toHaveBeenCalled();
        expect(shouldAutoPlayRef.current).toBe(true);

        rerender({ isLyricsLoading: false });
        expect(api.play).toHaveBeenCalledTimes(1);
        expect(shouldAutoPlayRef.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);

        // Only once per track: another render does not press play again.
        rerender({ isLyricsLoading: true });
        rerender({ isLyricsLoading: false });
        expect(api.play).toHaveBeenCalledTimes(1);
    });

    it('settles a load without a play intent as paused, the way a restore leaves it', async () => {
        mount({ shouldAutoPlayRef: { current: false } });
        await startTrack();
        expect(api.play).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });

    it('writes the engine state of the current track back to the playback store', async () => {
        mount({ shouldAutoPlayRef: { current: false } });
        const trackKey = await startTrack();
        usePlaybackStore.setState({ isLoadingToPlay: true } as never);

        await pushState({ trackKey, status: 'playing', paused: false, durationSec: 201.5 });
        expect(usePlaybackStore.getState()).toMatchObject({ playerState: PlayerState.PLAYING, duration: 201.5, isLoadingToPlay: false });

        await pushState({ trackKey, status: 'paused', paused: true, durationSec: 201.5 });
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);

        // Another track's state (a stale one, or the preloaded next) is not this song's.
        await pushState({ trackKey: 'local:other#x', status: 'playing', paused: false, durationSec: 99 });
        expect(usePlaybackStore.getState()).toMatchObject({ playerState: PlayerState.PAUSED, duration: 201.5 });
    });

    it('moves on when mpv reports the end, and leaves mpv running when a next song comes', async () => {
        const handleNextTrack = vi.fn(async () => undefined);
        mount({ handleNextTrack });
        const trackKey = await startTrack();
        await pushState({ trackKey, status: 'playing', paused: false, durationSec: 180 });

        await pushState({ trackKey, status: 'ended', paused: true, durationSec: 180 });
        expect(handleNextTrack).toHaveBeenCalledTimes(1);
        expect(handleNextTrack).toHaveBeenCalledWith({ allowStopOnMissing: true, shouldNavigateToPlayer: false });
        expect(api.stop).not.toHaveBeenCalled();

        // The same end pushed again (a snapshot, a coalesced repeat) is not a second end.
        await pushState({ trackKey, status: 'ended', paused: true, durationSec: 180 });
        expect(handleNextTrack).toHaveBeenCalledTimes(1);
    });

    it('moves on again when the song that ended plays again under the same track and ends once more', async () => {
        // The next song did not start (its file could not be read): handleNextTrack leaves the player as it was.
        const handleNextTrack = vi.fn(async () => undefined);
        mount({ handleNextTrack });
        const trackKey = await startTrack();
        await pushState({ trackKey, status: 'playing', paused: false, durationSec: 180 });
        await pushState({ trackKey, status: 'ended', paused: true, durationSec: 180 });
        expect(handleNextTrack).toHaveBeenCalledTimes(1);

        // The listener presses play: mpv plays the ended song again from 0 under the same trackKey.
        act(() => { expect(resumeHifiPlayback()).toBe(true); });
        await pushState({ trackKey, status: 'playing', paused: false, durationSec: 180, positionSec: 0 });
        await pushState({ trackKey, status: 'ended', paused: true, durationSec: 180 });
        expect(handleNextTrack).toHaveBeenCalledTimes(2);

        // Paused on the way (a seek back after the end) releases it as well.
        await pushState({ trackKey, status: 'paused', paused: true, durationSec: 180, positionSec: 30 });
        await pushState({ trackKey, status: 'ended', paused: true, durationSec: 180 });
        expect(handleNextTrack).toHaveBeenCalledTimes(3);
    });

    it('stops mpv at the end of the queue, and replays the song from the top on the next play', async () => {
        const handleNextTrack = vi.fn(async () => {
            // stopAtQueueEnd
            usePlaybackStore.getState().setPlayerState(PlayerState.IDLE);
        });
        const playSong = vi.fn(async () => undefined);
        mount({ handleNextTrack, playSong });
        const trackKey = await startTrack();
        await pushState({ trackKey, status: 'ended', paused: true, durationSec: 180 });
        expect(api.stop).toHaveBeenCalledTimes(1);
        api.play.mockClear();

        let resumed = true;
        act(() => { resumed = resumeHifiPlayback(); });
        expect(resumed).toBe(false);
        expect(api.play).not.toHaveBeenCalled();
        expect(playSong).toHaveBeenCalledWith(song, [], false, { shouldNavigateToPlayer: false });

        // The replay is spent once; a later play is an ordinary resume again.
        act(() => { resumed = resumeHifiPlayback(); });
        expect(resumed).toBe(true);
        expect(playSong).toHaveBeenCalledTimes(1);
    });

    it('on Windows keeps a song whose device another app holds on HiFi, paused, and loads it again on play', async () => {
        const electron = window.electron as unknown as { platform?: string };
        electron.platform = 'win32';
        try {
            api.load.mockImplementation(async () => ({ ok: false, errorCode: 'DEVICE_BUSY' }));
            const playSong = vi.fn(async () => undefined);
            mount({ playSong });
            const trackKey = await startTrack();
            expect(useHifiTrackStore.getState()).toMatchObject({ loadState: 'failed', loadError: 'DEVICE_BUSY' });
            expect(toast()).toEqual({ type: 'error', text: 'hifi.notice.deviceBusyHeld' });
            // Not handed to the Web engine: on the same held device it would stall at 0:00 or play on another device.
            expect(hifiEngine.isSongForcedWeb(SONG_KEY)).toBe(false);
            expect(playSong).not.toHaveBeenCalled();
            expect(isHifiRoute()).toBe(true);
            expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);

            // A seek while it waits only moves the clock; nothing goes to mpv.
            act(() => { seekHifiRoute(42); });
            expect(api.seek).not.toHaveBeenCalled();
            expect(api.load).toHaveBeenCalledTimes(1);
            expect(getHifiPosition()).toBe(42);

            // Still held: one more load from there, then it waits again with the same notice.
            useStatusMessageStore.setState({ message: null });
            let resumed = true;
            await act(async () => {
                resumed = resumeHifiPlayback();
                await flush();
            });
            expect(resumed).toBe(false);
            expect(api.load).toHaveBeenCalledTimes(2);
            expect(api.load.mock.calls[1][0]).toMatchObject({ trackKey, startSec: 42 });
            expect(toast()).toEqual({ type: 'error', text: 'hifi.notice.deviceBusyHeld' });
            expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);

            // Released: the next play loads it and starts it on mpv.
            api.load.mockImplementation(okLoad);
            await act(async () => {
                resumeHifiPlayback();
                await flush();
            });
            expect(api.load).toHaveBeenCalledTimes(3);
            expect(useHifiTrackStore.getState().loadState).toBe('ready');
            expect(api.play).toHaveBeenCalled();
            expect(playSong).not.toHaveBeenCalled();
        } finally {
            delete electron.platform;
        }
    });

    it('falls back to the Web engine once per track, with one toast, when the load fails', async () => {
        api.load.mockImplementation(async () => ({ ok: false, errorCode: 'DEVICE_BUSY' }));
        const playSong = vi.fn(async () => undefined);
        mount({ playSong });
        const trackKey = await startTrack();
        expect(useHifiTrackStore.getState().loadState).toBe('failed');
        expect(toast()).toEqual({ type: 'error', text: 'hifi.errors.DEVICE_BUSY' });
        expect(hifiEngine.isSongForcedWeb(SONG_KEY)).toBe(true);
        expect(playSong).toHaveBeenCalledTimes(1);
        // From where it was meant to start, playing as the play meant to, and without a 'loaded' toast over the reason.
        expect(playSong).toHaveBeenCalledWith(song, [], false, {
            shouldNavigateToPlayer: false, startAtSec: 0, autoplay: true, quietLoadedToast: true,
        });

        // main also reports the same failure as a fatal error: no second toast, no second replay.
        useStatusMessageStore.setState({ message: null });
        await act(async () => {
            push.error?.({ code: 'DEVICE_BUSY', trackKey, fatal: true });
            await flush();
        });
        expect(toast()).toBeNull();
        expect(playSong).toHaveBeenCalledTimes(1);
    });

    it('falls back when mpv dies mid-song, and ignores errors that are not fatal or not this track', async () => {
        const playSong = vi.fn(async () => undefined);
        mount({ playSong });
        const trackKey = await startTrack();
        await act(async () => {
            push.error?.({ code: 'DEVICE_UNAVAILABLE', trackKey, fatal: false });
            push.error?.({ code: 'MPV_CRASHED', trackKey: 'local:other#x', fatal: true });
            await flush();
        });
        expect(playSong).not.toHaveBeenCalled();

        await act(async () => {
            push.error?.({ code: 'MPV_CRASHED', trackKey, fatal: true });
            await flush();
        });
        expect(toast()).toEqual({ type: 'error', text: 'hifi.errors.MPV_CRASHED' });
        expect(playSong).toHaveBeenCalledTimes(1);
    });

    it('says once per session that the circuit is open', async () => {
        api.load.mockImplementation(async () => ({ ok: false, errorCode: 'CIRCUIT_OPEN' }));
        const playSong = vi.fn(async () => undefined);
        mount({ playSong });
        await startTrack();
        expect(toast()).toEqual({ type: 'error', text: 'hifi.errors.CIRCUIT_OPEN' });
        expect(useHifiEngineStore.getState().circuitOpen).toBe(true);
        expect(playSong).toHaveBeenCalledTimes(1);

        useStatusMessageStore.setState({ message: null });
        act(() => useHifiEngineStore.setState({ circuitOpen: false }));
        act(() => useHifiEngineStore.setState({ circuitOpen: true }));
        expect(toast()).toBeNull();
        useHifiEngineStore.setState({ circuitOpen: false });
    });

    it('sets loop-file on mpv when the loop mode changes on the HiFi route, never in Personal FM', async () => {
        const { rerender } = mount();
        rerender({ effectiveLoopMode: 'one' });
        expect(api.setLoopFile).not.toHaveBeenCalled();

        await startTrack();
        expect(api.setLoopFile).toHaveBeenLastCalledWith(true);
        rerender({ effectiveLoopMode: 'all' });
        expect(api.setLoopFile).toHaveBeenLastCalledWith(false);
        rerender({ effectiveLoopMode: 'one' });
        expect(api.setLoopFile).toHaveBeenLastCalledWith(true);
        rerender({ isFmMode: true });
        expect(api.setLoopFile).toHaveBeenLastCalledWith(false);
    });
});

describe('seekHifiRoute', () => {
    it('leaves a seek off the HiFi route to the caller', () => {
        expect(seekHifiRoute(12)).toBe(false);
        expect(api.seek).not.toHaveBeenCalled();
    });

    it('seeks mpv and the progress bar; only a resuming seek starts a paused song', async () => {
        mount({ shouldAutoPlayRef: { current: false } });
        await startTrack();

        expect(seekHifiRoute(42)).toBe(true);
        expect(api.seek).toHaveBeenLastCalledWith(42);
        expect(currentTime.get()).toBe(42);
        expect(api.play).not.toHaveBeenCalled();

        act(() => { seekHifiRoute(-3, { resume: true }); });
        expect(api.seek).toHaveBeenLastCalledWith(0);
        expect(api.play).toHaveBeenCalledTimes(1);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });
});

describe('moving a HiFi song to the Web engine', () => {
    it('keeps the place and the playing state of a song that fails mid-song', async () => {
        const playSong = vi.fn(async () => undefined);
        mount({ playSong, shouldAutoPlayRef: { current: false } });
        const trackKey = await startTrack();
        await pushState({ trackKey, status: 'playing', paused: false, durationSec: 300 });
        act(() => push.clock?.({ trackKey, positionSec: 192, paused: false, reason: 'tick', seq: 1, sampledAtMs: Date.now() }));

        await act(async () => {
            push.error?.({ code: 'DEVICE_UNAVAILABLE', trackKey, fatal: true });
            await flush();
        });

        expect(playSong).toHaveBeenCalledWith(song, [], false, {
            shouldNavigateToPlayer: false, startAtSec: expect.closeTo(192, 0), autoplay: true, quietLoadedToast: true,
        });
    });

    it('leaves a paused restore paused at its place when its load fails', async () => {
        api.load.mockImplementation(async () => ({ ok: false, errorCode: 'DEVICE_UNAVAILABLE' }));
        const playSong = vi.fn(async () => undefined);
        mount({ playSong, shouldAutoPlayRef: { current: false } });
        await startTrack({ startSec: 75 });

        expect(playSong).toHaveBeenCalledWith(song, [], false, {
            shouldNavigateToPlayer: false, startAtSec: 75, autoplay: false, quietLoadedToast: true,
        });
    });

    it('still says why and keeps the song off HiFi, but does not replay it, once a newer play has started', async () => {
        const failure = { promise: null as Promise<HifiLoadResult> | null, resolve: (_result: HifiLoadResult) => {} };
        failure.promise = new Promise((resolve) => { failure.resolve = resolve; });
        api.load.mockImplementation(() => failure.promise!);
        const playSong = vi.fn(async () => undefined);
        mount({ playSong });
        usePlaybackStore.setState({ currentSong: song });
        const stillWanted = startPlay().onceShown;
        let begun!: Promise<unknown>;
        act(() => {
            begun = beginHifiTrack({ song, source: { kind: 'local', localSong, file: new Blob([new Uint8Array([1])]) }, startSec: 0, stillWanted });
        });
        // The listener clicks an online song while the device answers: its play starts and fetches its address.
        startPlay();

        await act(async () => {
            failure.resolve({ ok: false, errorCode: 'DEVICE_BUSY' });
            await begun;
            await flush();
        });

        expect(toast()).toEqual({ type: 'error', text: 'hifi.errors.DEVICE_BUSY' });
        expect(hifiEngine.isSongForcedWeb(SONG_KEY)).toBe(true);
        expect(playSong).not.toHaveBeenCalled();
    });

    it('replays a song that dies mid-song, or moves it when HiFi is switched off, once the newer play after it gave up', async () => {
        useHifiSettingsStore.setState({ enabled: true });
        const playSong = vi.fn(async () => undefined);
        mount({ playSong });
        // As onPlayLocalSong hands it over: the answer for what the play leaves running once its song shows.
        const trackKey = await startTrack({ stillWanted: startPlay().onceShown });
        await pushState({ trackKey, status: 'playing', paused: false, durationSec: 180 });
        // The listener clicked a song whose file could not be read: that play started and gave up; this song plays on.
        startPlay().abandon();

        await act(async () => {
            push.error?.({ code: 'MPV_CRASHED', trackKey, fatal: true });
            await flush();
        });
        expect(playSong).toHaveBeenCalledTimes(1);

        // The same for HiFi switched off, on a song of its own.
        playSong.mockClear();
        const second = await startTrack({ stillWanted: startPlay().onceShown });
        await pushState({ trackKey: second, status: 'playing', paused: false, durationSec: 180 });
        startPlay().abandon();
        act(() => useHifiSettingsStore.getState().setEnabled(false));
        expect(playSong).toHaveBeenCalledTimes(1);
        // Back on for the tests after this one.
        useHifiSettingsStore.setState({ enabled: true });
    });

    it('does not fall back on an engine error pushed while the load is still deciding (a busy device being retried)', async () => {
        let answer!: (result: HifiLoadResult) => void;
        api.load.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
        const playSong = vi.fn(async () => undefined);
        mount({ playSong });
        usePlaybackStore.setState({ currentSong: song });
        let begun!: Promise<unknown>;
        act(() => {
            begun = beginHifiTrack({ song, source: { kind: 'local', localSong, file: new Blob([new Uint8Array([1])]) }, startSec: 0 });
        });
        const trackKey = useHifiTrackStore.getState().current!.trackKey;

        await pushState({ trackKey, status: 'error', errorCode: 'DEVICE_BUSY' });
        expect(playSong).not.toHaveBeenCalled();
        expect(toast()).toBeNull();

        await act(async () => {
            answer({ ok: true, state: engineState({ trackKey, songKey: SONG_KEY }) });
            await begun;
            await flush();
        });
        expect(playSong).not.toHaveBeenCalled();
        expect(useHifiTrackStore.getState().loadState).toBe('ready');
    });

    it('moves the song when HiFi is switched off, keeping its place and its playing state, without marking it', async () => {
        useHifiSettingsStore.setState({ enabled: true });
        const playSong = vi.fn(async () => undefined);
        mount({ playSong, shouldAutoPlayRef: { current: false } });
        const trackKey = await startTrack();
        await pushState({ trackKey, status: 'playing', paused: false, durationSec: 300 });
        act(() => push.clock?.({ trackKey, positionSec: 64, paused: false, reason: 'tick', seq: 1, sampledAtMs: Date.now() }));

        act(() => useHifiSettingsStore.getState().setEnabled(false));

        expect(playSong).toHaveBeenCalledTimes(1);
        expect(playSong).toHaveBeenCalledWith(song, [], false, {
            shouldNavigateToPlayer: false, startAtSec: expect.closeTo(64, 0), autoplay: true, quietLoadedToast: true,
        });
        expect(hifiEngine.isSongForcedWeb(SONG_KEY)).toBe(false);
        expect(toast()).toBeNull();

        // Switching it on and off again before the Web play lands moves nothing a second time.
        act(() => useHifiSettingsStore.getState().setEnabled(true));
        act(() => useHifiSettingsStore.getState().setEnabled(false));
        expect(playSong).toHaveBeenCalledTimes(1);
    });

    it('moves a paused song paused, and a Navidrome song only when Navidrome stops going through HiFi', async () => {
        useHifiSettingsStore.setState({ enabled: true, navidrome: true });
        const playSong = vi.fn(async () => undefined);
        mount({ playSong, shouldAutoPlayRef: { current: false } });
        await startTrack({ startSec: 30 });
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);

        // A local song does not care about the Navidrome scope.
        act(() => useHifiSettingsStore.getState().setNavidrome(false));
        expect(playSong).not.toHaveBeenCalled();

        act(() => useHifiSettingsStore.getState().setEnabled(false));
        expect(playSong).toHaveBeenCalledWith(song, [], false, {
            shouldNavigateToPlayer: false, startAtSec: 30, autoplay: false, quietLoadedToast: true,
        });
        useHifiSettingsStore.setState({ navidrome: true });
    });
});

describe('the play intent and loop-file on the HiFi route', () => {
    it('spends the intent when the listener starts the song by hand, so the lyrics finishing later do not resume it', async () => {
        const shouldAutoPlayRef = { current: true };
        const { rerender } = mount({ shouldAutoPlayRef, isLyricsLoading: true });
        const trackKey = await startTrack();

        act(() => { resumeHifiPlayback(); });
        expect(shouldAutoPlayRef.current).toBe(false);
        expect(api.play).toHaveBeenCalledTimes(1);
        await pushState({ trackKey, status: 'playing', paused: false });
        await pushState({ trackKey, status: 'paused', paused: true });

        rerender({ isLyricsLoading: false });
        expect(api.play).toHaveBeenCalledTimes(1);
    });

    it('spends the intent when mpv starts playing the song by any other way', async () => {
        const shouldAutoPlayRef = { current: true };
        const { rerender } = mount({ shouldAutoPlayRef, isLyricsLoading: true });
        const trackKey = await startTrack();

        await pushState({ trackKey, status: 'playing', paused: false });
        expect(shouldAutoPlayRef.current).toBe(false);
        await pushState({ trackKey, status: 'paused', paused: true });
        rerender({ isLyricsLoading: false });
        expect(api.play).not.toHaveBeenCalled();
    });

    it('leaves the intent of a newer play alone when a song that already started plays again', async () => {
        const shouldAutoPlayRef = { current: true };
        mount({ shouldAutoPlayRef });
        const trackKey = await startTrack();
        expect(shouldAutoPlayRef.current).toBe(false);
        await pushState({ trackKey, status: 'playing', paused: false });
        await pushState({ trackKey, status: 'paused', paused: true });

        // An online song the listener clicked is fetching its address: its play has set the intent.
        shouldAutoPlayRef.current = true;
        act(() => { resumeHifiPlayback(); });
        await pushState({ trackKey, status: 'playing', paused: false });
        expect(shouldAutoPlayRef.current).toBe(true);
    });

    it('sends loop-file again when a load lands with mpv looping otherwise than the player shows', async () => {
        const { rerender } = mount();
        rerender({ effectiveLoopMode: 'one' });
        // The load answers with loop-file off: mpv was still starting when the bridge asked for it.
        api.load.mockImplementationOnce(async request => ({ ok: true, state: engineState({ trackKey: request.trackKey, songKey: request.songKey, loopFile: false }) }));
        await startTrack();
        expect(api.setLoopFile.mock.calls.map(([loop]) => loop)).toEqual([true, true]);

        // A load that lands looping as shown sends nothing more.
        api.setLoopFile.mockClear();
        api.load.mockImplementationOnce(async request => ({ ok: true, state: engineState({ trackKey: request.trackKey, songKey: request.songKey, loopFile: true }) }));
        await startTrack();
        expect(api.setLoopFile).not.toHaveBeenCalled();
    });
});

describe('after the queue ended on HiFi', () => {
    const endTheQueue = async (playSong = vi.fn(async () => undefined)) => {
        const handleNextTrack = vi.fn(async () => {
            usePlaybackStore.getState().setPlayerState(PlayerState.IDLE);
        });
        mount({ handleNextTrack, playSong });
        const trackKey = await startTrack();
        await pushState({ trackKey, status: 'ended', paused: true, durationSec: 180 });
        expect(api.stop).toHaveBeenCalledTimes(1);
        api.seek.mockClear();
        return playSong;
    };

    it('a seek then play replays the song from the place sought', async () => {
        const playSong = await endTheQueue();

        act(() => { seekHifiRoute(42); });
        expect(api.seek).not.toHaveBeenCalled();
        expect(getHifiPosition()).toBe(42);
        expect(currentTime.get()).toBe(42);
        expect(playSong).not.toHaveBeenCalled();

        act(() => { resumeHifiPlayback(); });
        expect(playSong).toHaveBeenCalledWith(song, [], false, { shouldNavigateToPlayer: false, startAtSec: 42 });
    });

    it('a seek on the progress bar (which resumes) replays from there at once', async () => {
        const playSong = await endTheQueue();

        act(() => { seekHifiRoute(17, { resume: true }); });
        expect(playSong).toHaveBeenCalledTimes(1);
        expect(playSong).toHaveBeenCalledWith(song, [], false, { shouldNavigateToPlayer: false, startAtSec: 17 });
    });
});

describe('a restore that defers its load', () => {
    const restoredSong = { ...song, durationMs: 240_000 } as SongResult;
    const restore = async (startSec: number) => {
        usePlaybackStore.setState({ currentSong: restoredSong });
        await act(async () => {
            await beginHifiTrack({
                song: restoredSong,
                source: { kind: 'local', localSong, file: new Blob([new Uint8Array([1, 2, 3])]) },
                startSec,
                adoptRunning: true,
                deferLoad: true,
            });
            await flush();
        });
    };

    it('shows the song paused with its length, and loads nothing until the listener plays it', async () => {
        const shouldAutoPlayRef = { current: false };
        mount({ shouldAutoPlayRef });
        await restore(50);

        expect(api.load).not.toHaveBeenCalled();
        expect(useHifiTrackStore.getState().loadState).toBe('deferred');
        expect(usePlaybackStore.getState()).toMatchObject({ playerState: PlayerState.PAUSED, duration: 240 });

        await act(async () => {
            expect(resumeHifiPlayback()).toBe(false);
            await flush();
        });
        expect(api.load).toHaveBeenCalledTimes(1);
        expect(api.load.mock.calls[0][0]).toMatchObject({ startSec: 50, paused: true });
        // Started by the autoplay once the load is ready.
        expect(api.play).toHaveBeenCalledTimes(1);
        expect(shouldAutoPlayRef.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });

    it('starts from the top a song restored within half a second of its end, as an ended <audio> plays again', async () => {
        // After the queue ended on HiFi the position handed to a rebuilt window is the song's length.
        mount({ shouldAutoPlayRef: { current: false } });
        await restore(239.6);
        expect(getHifiPosition()).toBe(0);
        await act(async () => {
            expect(resumeHifiPlayback()).toBe(false);
            await flush();
        });
        expect(api.load.mock.calls[0][0].startSec).toBe(0);

        // Further from the end it starts where it was.
        api.load.mockClear();
        await restore(239);
        await act(async () => {
            resumeHifiPlayback();
            await flush();
        });
        expect(api.load.mock.calls[0][0].startSec).toBe(239);
    });

    it('loads from the top when the first thing the listener does is a seek to the very end', async () => {
        mount({ shouldAutoPlayRef: { current: false } });
        await restore(50);
        await act(async () => {
            seekHifiRoute(239.8);
            await flush();
        });
        expect(api.load.mock.calls[0][0].startSec).toBe(0);
    });

    it('loads at the place sought when the first thing the listener does is a seek, and stays paused', async () => {
        mount({ shouldAutoPlayRef: { current: false } });
        await restore(50);

        await act(async () => {
            seekHifiRoute(120);
            await flush();
        });
        expect(api.seek).not.toHaveBeenCalled();
        expect(api.load).toHaveBeenCalledTimes(1);
        expect(api.load.mock.calls[0][0].startSec).toBe(120);
        expect(api.play).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });

    it('loads at once when the restore left an intent to play', async () => {
        const shouldAutoPlayRef = { current: true };
        mount({ shouldAutoPlayRef });
        await restore(8);

        expect(api.load).toHaveBeenCalledTimes(1);
        expect(api.load.mock.calls[0][0].startSec).toBe(8);
        expect(api.play).toHaveBeenCalledTimes(1);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });
});
