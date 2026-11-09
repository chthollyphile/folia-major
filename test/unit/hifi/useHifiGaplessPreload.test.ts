// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { PlayerState } from '@/types';
import type {
    HifiClockUpdate,
    HifiEngineState,
    HifiErrorEvent,
    HifiLoadRequest,
    HifiLoadResult,
    HifiPlaybackStatus,
    HifiRuntimeStatus,
} from '@/types/hifi';
import type { HifiApi } from '@/services/hifi/hifiEngine';
import type { HifiGaplessInput } from '@/components/hifi/useHifiGaplessPreload';

// test/unit/hifi/useHifiGaplessPreload.test.ts
// 无缝接播在 React 这一侧，挂在真的播放桥和 hifiPlayback 服务上，主进程换成假的 window.electron.hifi：什么时候该排下一首
// （纯函数的条件矩阵）、满 2 秒才预载、mpv 接上后经 handleNextTrack 换过去而不走放完那条路、playSong 认领后播放器回到在放、
// 改队列 / 打乱 / 单曲循环时撤掉、接上时已有更新的播放在路上（以及那次播放没放成、放弃了）、队列在这一下到头、预载着时按了下一首，
// 以及认领之后 Navidrome 收到新歌的 now-playing。

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
    readLocalSourceSpec: vi.fn(async () => null),
}));
const sources = vi.hoisted(() => ({
    sourceFor: (id: string) => ({
        kind: 'local' as const,
        localSong: { id, fileName: `${id}.flac`, filePath: `Music/${id}.flac`, mimeType: 'audio/flac' },
        file: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/flac' }),
    }),
}));
vi.mock('@/components/app/playback/source/songAudioSource', () => ({
    loadQueuedSongHifiSource: vi.fn(async (song: { id: string }) => sources.sourceFor(song.id)),
}));
// 只在挂了上报的那几个用例里有 Navidrome 配置；上报记在 scrobbles 里。
const scrobbles = vi.hoisted(() => ({ configured: false, sent: [] as Array<{ id: string; submission: boolean }> }));
vi.mock('@/services/navidromeService', async importOriginal => {
    const actual = await importOriginal<typeof import('@/services/navidromeService')>();
    return {
        ...actual,
        getNavidromeConfig: () => (scrobbles.configured ? { serverUrl: 'http://navi', username: 'u', password: 'p' } : actual.getNavidromeConfig()),
        navidromeApi: {
            ...actual.navidromeApi,
            scrobble: vi.fn(async (_config: unknown, id: string, options: { submission: boolean }) => {
                scrobbles.sent.push({ id, submission: options.submission });
                return true;
            }),
        },
    };
});

const { useHifiPlaybackBridge } = await import('@/components/hifi/useHifiPlaybackBridge');
const { useNavidromeScrobbleReporter } = await import('@/hooks/useNavidromeScrobbleReporter');
const { GAPLESS_PRELOAD_DELAY_MS, hifiGaplessNextSong } = await import('@/components/hifi/useHifiGaplessPreload');
const { resumeHifiPlayback } = await import('@/components/hifi/hifiRouteTransport');
const { loadQueuedSongHifiSource } = await import('@/components/app/playback/source/songAudioSource');
const { beginHifiTrack, leaveHifiRoute, useHifiTrackStore } = await import('@/services/hifi/hifiPlayback');
const { startPlay } = await import('@/components/app/playback/currentSong');
const { hifiEngine, useHifiEngineStore } = await import('@/services/hifi/hifiEngine');
const { hifiMediaShim } = await import('@/services/hifi/hifiMediaShim');
const { startLoadingToPlay, usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useHifiSettingsStore } = await import('@/stores/useHifiSettingsStore');

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

const push: { state?: (state: HifiEngineState) => void; clock?: (update: HifiClockUpdate) => void; error?: (event: HifiErrorEvent) => void } = {};

const okLoad = async (request: HifiLoadRequest): Promise<HifiLoadResult> => ({
    ok: true,
    state: engineState({
        trackKey: request.trackKey,
        songKey: request.songKey,
        localSourceKey: request.source.kind === 'local' ? request.source.sourceKey : null,
        positionSec: request.startSec,
    }),
});

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
    preloadNext: vi.fn<HifiApi['preloadNext']>(async () => true),
    clearNext: vi.fn<HifiApi['clearNext']>(async () => undefined),
    getSnapshot: vi.fn<HifiApi['getSnapshot']>(async () => engineState({ status: 'idle' })),
    probeOutput: vi.fn<HifiApi['probeOutput']>(async () => null),
    respondRead: vi.fn<HifiApi['respondRead']>(async () => undefined),
    onState: vi.fn((callback: (state: HifiEngineState) => void) => { push.state = callback; return () => {}; }),
    onClock: vi.fn((callback: (update: HifiClockUpdate) => void) => { push.clock = callback; return () => {}; }),
    onError: vi.fn((callback: (event: HifiErrorEvent) => void) => { push.error = callback; return () => {}; }),
    onInstallProgress: vi.fn(() => () => {}),
    onReadRequest: vi.fn(() => () => {}),
} satisfies HifiApi;

const song = (id: string, name = id) => ({
    id, name, isLocal: true, localRef: { songId: id }, sourceRef: { kind: 'local', mediaId: id },
}) as unknown as SongResult;
const onlineSong = (id: string) => ({ id, name: id, sourceRef: { kind: 'online', providerId: 'netease', mediaId: id } }) as unknown as SongResult;
const [A, B, C] = [song('a'), song('b'), song('c')];
const navi = (id: string) => ({
    id, name: id, isNavidrome: true, durationMs: 200000,
    navidromeData: { id, title: id, duration: 200 },
    sourceRef: { kind: 'navidrome', mediaId: id },
}) as unknown as SongResult;
const nowPlayingReports = (id: string) => scrobbles.sent.filter(report => report.id === id && !report.submission).length;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
// The Web deck the scrobble reporter falls back to off the HiFi route.
const deckRef = { current: null as HTMLAudioElement | null };

type BridgeParams = Parameters<typeof useHifiPlaybackBridge>[0];

/** withScrobbleReporter: App's Navidrome scrobble reporter is mounted next to the bridge, reading the current song. */
const mount = (overrides: Partial<BridgeParams> = {}, { withScrobbleReporter = false } = {}) => {
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
    function ProbeWithReporter(props: BridgeParams) {
        useHifiPlaybackBridge(props);
        const currentSong = usePlaybackStore(state => state.currentSong);
        useNavidromeScrobbleReporter({ audioRef: deckRef, currentSong, activeDeck: 'a' });
        return null;
    }
    const Component = withScrobbleReporter ? ProbeWithReporter : Probe;
    root = createRoot(document.createElement('div'));
    act(() => root!.render(React.createElement(Component, params)));
    const rerender = (next: Partial<BridgeParams>) => {
        Object.assign(params, next);
        act(() => root!.render(React.createElement(Component, { ...params })));
    };
    return { params, rerender };
};

/** 让假计时器走 ms 毫秒，途中的微任务和 React 提交都落定。 */
const advance = async (ms = 0) => {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
};

const pushState = async (overrides: Partial<HifiEngineState>) => {
    await act(async () => {
        push.state?.(engineState(overrides));
        await vi.advanceTimersByTimeAsync(0);
    });
};

/** 像 onPlayLocalSong 那样起播一首（歌设成当前、起播），主进程随后报它在放。 */
const playOnHifi = async (target: SongResult, stillWanted?: () => boolean) => {
    usePlaybackStore.setState({ currentSong: target });
    await act(async () => {
        await beginHifiTrack({ song: target, source: sources.sourceFor(String(target.id)) as never, startSec: 0, stillWanted });
    });
    const current = useHifiTrackStore.getState().current!;
    await pushState({
        trackKey: current.trackKey, songKey: current.songKey, localSourceKey: current.localSourceKey,
        status: 'playing', paused: false, durationSec: 180, positionSec: 1,
    });
    return current;
};

/** 像 playSong → onPlayLocalSong 落到一首歌那样：意图、当前歌、beginHifiTrack，紧接着 startLoadingToPlay，全在同一段同步代码里。 */
const landPlay = async (shouldAutoPlayRef: { current: boolean }, target: SongResult, stillWanted?: () => boolean) => {
    let outcome: Promise<unknown> | null = null;
    await act(async () => {
        shouldAutoPlayRef.current = true;
        usePlaybackStore.setState({ currentSong: target });
        outcome = beginHifiTrack({ song: target, source: sources.sourceFor(String(target.id)) as never, startSec: 0, stillWanted });
        startLoadingToPlay();
        await vi.advanceTimersByTimeAsync(0);
    });
    return outcome;
};

/** mpv 接上了排着的那一首。 */
const pushSwitch = async () => {
    const next = useHifiTrackStore.getState().next;
    if (!next) throw new Error('nothing queued');
    await pushState({
        trackKey: next.trackKey, songKey: next.songKey, localSourceKey: next.localSourceKey,
        status: 'playing', paused: false, durationSec: 200, positionSec: 0,
    });
    return next;
};

beforeAll(() => {
    (window as unknown as { electron: unknown }).electron = { hifi: api };
});

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useHifiSettingsStore.setState({ enabled: true, navidrome: true });
    usePlaybackStore.setState({
        playerState: PlayerState.IDLE, isLoadingToPlay: false, duration: 0, currentSong: null, isFmMode: false, playQueue: [A, B, C],
    });
    api.load.mockImplementation(okLoad);
    api.preloadNext.mockImplementation(async () => true);
    api.clearNext.mockImplementation(async () => undefined);
});

afterEach(async () => {
    act(() => root?.unmount());
    root = null;
    leaveHifiRoute('test');
    hifiEngine.clearForcedWeb();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    Object.values(api).forEach(fn => fn.mockClear());
    vi.mocked(loadQueuedSongHifiSource).mockClear();
    scrobbles.configured = false;
    scrobbles.sent.length = 0;
    deckRef.current = null;
    vi.restoreAllMocks();
});

describe('hifiGaplessNextSong', () => {
    const base: HifiGaplessInput = {
        playbackRoute: 'hifi',
        current: { trackKey: 'local:a#1', songKey: 'local:a' },
        loadState: 'ready',
        engineTrackKey: 'local:a#1',
        engineStatus: 'playing',
        playQueue: [A, B, C],
        currentSong: A,
        loopMode: 'off',
        isFmMode: false,
    };
    const hifi = () => 'hifi' as const;
    const next = (overrides: Partial<HifiGaplessInput> = {}, routeFor: () => 'hifi' | 'web' = hifi) => (
        hifiGaplessNextSong({ ...base, ...overrides }, routeFor)?.id ?? null
    );

    it('names the queue\'s next song while the current one plays or is paused on HiFi', () => {
        expect(next()).toBe('b');
        expect(next({ engineStatus: 'paused' })).toBe('b');
        expect(next({ currentSong: B, current: { trackKey: 'local:b#1', songKey: 'local:b' }, engineTrackKey: 'local:b#1' })).toBe('c');
    });

    it('names nothing unless the current track is ready and playing or paused in mpv', () => {
        expect(next({ playbackRoute: 'web' })).toBeNull();
        expect(next({ current: null })).toBeNull();
        for (const loadState of ['idle', 'loading', 'deferred', 'failed'] as const) expect(next({ loadState })).toBeNull();
        for (const engineStatus of ['loading', 'ended', 'error', 'idle', 'stopped', 'starting'] as HifiPlaybackStatus[]) expect(next({ engineStatus })).toBeNull();
        expect(next({ engineTrackKey: 'local:a#old' })).toBeNull();
        expect(next({ current: { trackKey: 'local:a#1', songKey: 'local:a', promotedByGapless: true } })).toBeNull();
        // The player still shows another song: a play is landing.
        expect(next({ currentSong: C })).toBeNull();
    });

    it('follows the loop and Personal FM rules of handleNextTrack', () => {
        expect(next({ loopMode: 'one' })).toBeNull();
        // In Personal FM mpv does not loop the file, so the next song still follows.
        expect(next({ loopMode: 'one', isFmMode: true })).toBe('b');
        const atEnd = { currentSong: C, current: { trackKey: 'local:c#1', songKey: 'local:c' }, engineTrackKey: 'local:c#1' };
        expect(next(atEnd)).toBeNull();
        expect(next({ ...atEnd, loopMode: 'all' })).toBe('a');
        expect(next({ ...atEnd, loopMode: 'all', isFmMode: true })).toBeNull();
        // Loop all over one song replays it: not a gapless switch.
        expect(next({ playQueue: [A], loopMode: 'all' })).toBeNull();
    });

    it('names nothing when the next song plays on the Web engine', () => {
        expect(next({ playQueue: [A, onlineSong('x')] })).toBeNull();
        expect(next({}, () => 'web')).toBeNull();
    });
});

describe('useHifiGaplessPreload', () => {
    it('queues the next song 2 s after the current one plays, follows the switch without an end, and the play takes it over', async () => {
        const handleNextTrack = vi.fn(async () => undefined);
        const shouldAutoPlayRef = { current: true };
        mount({ handleNextTrack, shouldAutoPlayRef });
        const a = await playOnHifi(A);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        expect(api.play).toHaveBeenCalledTimes(1);

        await advance(GAPLESS_PRELOAD_DELAY_MS - 1);
        expect(loadQueuedSongHifiSource).not.toHaveBeenCalled();
        await advance(1);
        expect(loadQueuedSongHifiSource).toHaveBeenCalledWith(B);
        expect(api.preloadNext).toHaveBeenCalledWith(expect.objectContaining({ songKey: 'local:b', startSec: 0 }));

        const shimEvents: string[] = [];
        hifiMediaShim.addEventListener('ended', () => shimEvents.push('ended'));
        const queued = await pushSwitch();
        expect(useHifiTrackStore.getState().current).toMatchObject({ trackKey: queued.trackKey, promotedByGapless: true });
        expect(handleNextTrack).toHaveBeenCalledTimes(1);
        expect(handleNextTrack).toHaveBeenCalledWith({ allowStopOnMissing: true, shouldNavigateToPlayer: false });
        expect(shimEvents).toEqual([]);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        expect(api.stop).not.toHaveBeenCalled();
        // mpv goes on reporting the song it switched to: none of that is an end of the one before.
        await pushState({ trackKey: queued.trackKey, songKey: queued.songKey, status: 'playing', paused: false, durationSec: 200, positionSec: 0.5 });
        expect(handleNextTrack).toHaveBeenCalledTimes(1);
        expect(useHifiTrackStore.getState().current?.trackKey).not.toBe(a.trackKey);

        // playSong lands on B: onPlayLocalSong sets the intent, shows B, begins it and marks the player loading.
        const unifiedB = song('b', 'B as playSong built it');
        const outcome = await landPlay(shouldAutoPlayRef, unifiedB);
        expect(await outcome).toBe('adopted');
        expect(usePlaybackStore.getState()).toMatchObject({ playerState: PlayerState.PLAYING, isLoadingToPlay: false });
        expect(shouldAutoPlayRef.current).toBe(false);
        expect(api.load).toHaveBeenCalledTimes(1);
        expect(useHifiTrackStore.getState().current).toMatchObject({ trackKey: queued.trackKey, promotedByGapless: false, song: unifiedB });

        // And the song after it is queued in turn.
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        expect(api.preloadNext).toHaveBeenLastCalledWith(expect.objectContaining({ songKey: 'local:c' }));
    });

    it('settles an adopted song the listener paused as paused', async () => {
        const shouldAutoPlayRef = { current: true };
        mount({ shouldAutoPlayRef });
        await playOnHifi(A);
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        const queued = await pushSwitch();
        await pushState({ trackKey: queued.trackKey, songKey: queued.songKey, status: 'paused', paused: true, durationSec: 200 });

        const shimStarts: string[] = [];
        hifiMediaShim.addEventListener('play', () => shimStarts.push('play'));
        await landPlay(shouldAutoPlayRef, B);
        expect(usePlaybackStore.getState()).toMatchObject({ playerState: PlayerState.PAUSED, isLoadingToPlay: false });
        expect(shouldAutoPlayRef.current).toBe(false);
        expect(api.play).toHaveBeenCalledTimes(1);
        // Paused, it is not announced as started.
        expect(shimStarts).toEqual([]);
    });

    it('sends Navidrome the now-playing of the song mpv switched to once the play takes it over', async () => {
        scrobbles.configured = true;
        deckRef.current = document.createElement('audio');
        // The source each one plays from is the local stand-in of this file; the songs are Navidrome's.
        const [NA, NB] = [navi('na'), navi('nb')];
        usePlaybackStore.setState({ playQueue: [NA, NB] });
        const shouldAutoPlayRef = { current: true };
        mount({ shouldAutoPlayRef }, { withScrobbleReporter: true });
        await playOnHifi(NA);
        expect(nowPlayingReports('na')).toBe(1);
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        expect(useHifiTrackStore.getState().next?.songKey).toBe('navidrome:nb');

        // The shim's play / playing at the switch came while the player still showed NA.
        await pushSwitch();
        expect(nowPlayingReports('nb')).toBe(0);

        await landPlay(shouldAutoPlayRef, NB);
        expect(usePlaybackStore.getState().currentSong).toBe(NB);
        expect(useHifiTrackStore.getState().current).toMatchObject({ songKey: 'navidrome:nb', promotedByGapless: false });
        expect(nowPlayingReports('nb')).toBe(1);
        expect(nowPlayingReports('na')).toBe(1);
    });

    it('clears the queued song when the queue changes, the queue is shuffled or loop one comes on', async () => {
        const { rerender } = mount();
        await playOnHifi(A);
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        expect(useHifiTrackStore.getState().next?.songKey).toBe('local:b');

        // B removed from the queue.
        act(() => usePlaybackStore.setState({ playQueue: [A, C] }));
        await advance(0);
        expect(api.clearNext).toHaveBeenCalledTimes(1);
        expect(useHifiTrackStore.getState().next).toBeNull();
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        expect(api.preloadNext).toHaveBeenLastCalledWith(expect.objectContaining({ songKey: 'local:c' }));

        // A shuffle that puts B after A.
        act(() => usePlaybackStore.setState({ playQueue: [A, B, C] }));
        await advance(0);
        expect(api.clearNext).toHaveBeenCalledTimes(2);
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        expect(useHifiTrackStore.getState().next?.songKey).toBe('local:b');

        rerender({ effectiveLoopMode: 'one' });
        await advance(0);
        expect(api.clearNext).toHaveBeenCalledTimes(3);
        const preloads = api.preloadNext.mock.calls.length;
        await advance(GAPLESS_PRELOAD_DELAY_MS * 2);
        expect(api.preloadNext).toHaveBeenCalledTimes(preloads);
        expect(useHifiTrackStore.getState().next).toBeNull();
    });

    it('waits the full 2 s again when the queue changes before the preload', async () => {
        mount();
        await playOnHifi(A);
        await advance(GAPLESS_PRELOAD_DELAY_MS - 500);
        act(() => usePlaybackStore.setState({ playQueue: [A, C, B] }));
        await advance(GAPLESS_PRELOAD_DELAY_MS - 1);
        expect(api.preloadNext).not.toHaveBeenCalled();
        await advance(1);
        expect(api.preloadNext).toHaveBeenCalledTimes(1);
        expect(api.preloadNext).toHaveBeenCalledWith(expect.objectContaining({ songKey: 'local:c' }));
    });

    it('leaves the switch to a newer play already on its way, which then takes the song over', async () => {
        const handleNextTrack = vi.fn(async () => undefined);
        const shouldAutoPlayRef = { current: true };
        mount({ handleNextTrack, shouldAutoPlayRef });
        // As onPlayLocalSong hands it over: the answer for what the play leaves running once its song shows.
        await playOnHifi(A, startPlay().onceShown);
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        // The listener pressed next: that play has started, wants to play, and is still reading B's file.
        const newerPlay = startPlay();
        shouldAutoPlayRef.current = true;
        await pushSwitch();
        expect(handleNextTrack).not.toHaveBeenCalled();
        // Its intent is its own: the switch does not spend it.
        expect(shouldAutoPlayRef.current).toBe(true);

        expect(await landPlay(shouldAutoPlayRef, B, newerPlay.onceShown)).toBe('adopted');
        expect(usePlaybackStore.getState()).toMatchObject({ playerState: PlayerState.PLAYING, isLoadingToPlay: false });
        expect(api.load).toHaveBeenCalledTimes(1);
    });

    it('follows the switch when the newer play gave up without showing its song, and moves on at the end of the song', async () => {
        const shouldAutoPlayRef = { current: true };
        // handleNextTrack steps from the song the player shows to the next and plays it, as playSong would.
        let landing: Promise<unknown> | null = null;
        const handleNextTrack = vi.fn(async () => {
            const target = usePlaybackStore.getState().currentSong === A ? B : C;
            shouldAutoPlayRef.current = true;
            usePlaybackStore.setState({ currentSong: target });
            landing = beginHifiTrack({ song: target, source: sources.sourceFor(String(target.id)) as never, startSec: 0, stillWanted: startPlay().onceShown });
            startLoadingToPlay();
        });
        mount({ handleNextTrack, shouldAutoPlayRef });
        await playOnHifi(A, startPlay().onceShown);
        // The listener clicked a song whose file could not be read: that play started and gave up, and A plays on.
        startPlay().abandon();
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        const queued = await pushSwitch();
        expect(handleNextTrack).toHaveBeenCalledTimes(1);
        expect(await landing).toBe('adopted');
        await advance(0);
        expect(usePlaybackStore.getState()).toMatchObject({ currentSong: B, playerState: PlayerState.PLAYING, isLoadingToPlay: false });

        // B's own end moves on to C, instead of stepping to B a second time.
        await pushState({ trackKey: queued.trackKey, songKey: queued.songKey, localSourceKey: queued.localSourceKey, status: 'ended', paused: true, durationSec: 200, positionSec: 200 });
        expect(handleNextTrack).toHaveBeenCalledTimes(2);
        expect(usePlaybackStore.getState().currentSong).toBe(C);
    });

    it('does not press play on a switch mpv reports paused, nor spend an intent waiting for its play', async () => {
        const shouldAutoPlayRef = { current: true };
        mount({ shouldAutoPlayRef });
        await playOnHifi(A);
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        expect(api.play).toHaveBeenCalledTimes(1);
        const next = useHifiTrackStore.getState().next!;
        shouldAutoPlayRef.current = true;
        await pushState({ trackKey: next.trackKey, songKey: next.songKey, localSourceKey: next.localSourceKey, status: 'paused', paused: true, durationSec: 200 });
        expect(useHifiTrackStore.getState().current).toMatchObject({ trackKey: next.trackKey, promotedByGapless: true });
        expect(api.play).toHaveBeenCalledTimes(1);
        expect(shouldAutoPlayRef.current).toBe(true);
    });

    it('a queued song that fails as mpv starts it goes to the Web engine instead of stepping past it', async () => {
        const handleNextTrack = vi.fn(async () => undefined);
        const playSong = vi.fn(async () => undefined);
        mount({ handleNextTrack, playSong });
        await playOnHifi(A);
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        const next = useHifiTrackStore.getState().next!;
        await pushState({
            trackKey: next.trackKey, songKey: next.songKey, localSourceKey: next.localSourceKey,
            status: 'error', errorCode: 'SOURCE_UNREACHABLE', paused: true,
        });
        expect(handleNextTrack).not.toHaveBeenCalled();
        expect(playSong).toHaveBeenCalledTimes(1);
        expect(playSong).toHaveBeenCalledWith(B, [], false, expect.objectContaining({ shouldNavigateToPlayer: false }));
        expect(hifiEngine.isSongForcedWeb('local:b')).toBe(true);
    });

    it('stops mpv when the queue ends at the switch, and a later play replays the song the player shows', async () => {
        const playSong = vi.fn(async () => undefined);
        const handleNextTrack = vi.fn(async () => {
            // stopAtQueueEnd
            usePlaybackStore.getState().setPlayerState(PlayerState.IDLE);
        });
        mount({ handleNextTrack, playSong });
        await playOnHifi(A);
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        await pushSwitch();
        expect(handleNextTrack).toHaveBeenCalledTimes(1);
        expect(api.stop).toHaveBeenCalledTimes(1);

        act(() => {
            expect(resumeHifiPlayback()).toBe(false);
        });
        expect(playSong).toHaveBeenCalledWith(A, [], false, { shouldNavigateToPlayer: false });
    });

    it('a user next while the song is queued loads it afresh, and the next song is queued behind it', async () => {
        const handleNextTrack = vi.fn(async () => undefined);
        const shouldAutoPlayRef = { current: true };
        mount({ handleNextTrack, shouldAutoPlayRef });
        await playOnHifi(A);
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        const queued = useHifiTrackStore.getState().next!;

        expect(await landPlay(shouldAutoPlayRef, B)).toBe('ready');
        expect(api.load).toHaveBeenCalledTimes(2);
        const loadedB = useHifiTrackStore.getState().current!;
        expect(loadedB.trackKey).not.toBe(queued.trackKey);
        expect(useHifiTrackStore.getState().next).toBeNull();
        // mpv's late word on the dropped entry switches nothing.
        await pushState({ trackKey: queued.trackKey, songKey: queued.songKey, status: 'playing', paused: false });
        expect(useHifiTrackStore.getState().current?.trackKey).toBe(loadedB.trackKey);
        expect(handleNextTrack).not.toHaveBeenCalled();

        await pushState({ trackKey: loadedB.trackKey, songKey: loadedB.songKey, localSourceKey: loadedB.localSourceKey, status: 'playing', paused: false, durationSec: 200 });
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        expect(api.preloadNext).toHaveBeenLastCalledWith(expect.objectContaining({ songKey: 'local:c' }));
    });

    it('queues nothing while HiFi is off for the next song, and clears when the route leaves HiFi', async () => {
        mount();
        usePlaybackStore.setState({ playQueue: [A, onlineSong('x')] });
        await playOnHifi(A);
        await advance(GAPLESS_PRELOAD_DELAY_MS * 2);
        expect(api.preloadNext).not.toHaveBeenCalled();

        act(() => usePlaybackStore.setState({ playQueue: [A, B] }));
        await advance(GAPLESS_PRELOAD_DELAY_MS);
        expect(useHifiTrackStore.getState().next?.songKey).toBe('local:b');
        act(() => usePlaybackStore.setState({ audioSrc: 'blob:web' }));
        await advance(0);
        expect(useHifiTrackStore.getState().next).toBeNull();
        expect(api.stop).toHaveBeenCalled();
    });
});
