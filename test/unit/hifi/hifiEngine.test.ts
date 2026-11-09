import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHifiEngine, hifiEngine, isHifiLoadCancelled, type HifiApi } from '@/services/hifi/hifiEngine';
import type {
    HifiClockUpdate,
    HifiEngineConfig,
    HifiEngineState,
    HifiErrorCode,
    HifiErrorEvent,
    HifiInstallProgress,
    HifiLoadRequest,
    HifiOutputProbe,
    HifiReadRequest,
    HifiRuntimeStatus,
} from '@/types/hifi';
import { isOutputProbe, isPipewireOutputDriver, isSameOutputProbe, outputProbeLogFields } from '@/services/hifi/hifiEngineRules';
import { fixtureProbe } from './pipewireProbeFixture';

// test/unit/hifi/hifiEngine.test.ts
// 渲染端的 HiFi 引擎客户端：订阅只做一次、按 seq 丢旧状态、时钟只放行认得的曲目、读请求经真的 responder 回给主进程、
// 回落 Web 的歌记在会话里，相同的配置不重发、mpv 路径变了或 mpv 不能用时刷新运行时，取消的载入不算失败，
// 没有 window.electron.hifi 时每个方法回安全的默认值；PipeWire 探测只收当前这首、最新发出的那次，一样的不重写 store。

const engineState = (overrides: Partial<HifiEngineState> = {}): HifiEngineState => ({
    status: 'playing',
    processRunning: true,
    trackKey: 'local:1#a',
    songKey: 'local:1',
    sourceKind: 'local',
    localSourceKey: 'source-a',
    durationSec: 200,
    positionSec: 0,
    paused: false,
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
    seq: 1,
    ...overrides,
});

const runtimeStatus = (overrides: Partial<HifiRuntimeStatus> = {}): HifiRuntimeStatus => ({
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
    ...overrides,
});

const clock = (overrides: Partial<HifiClockUpdate> = {}): HifiClockUpdate => ({
    trackKey: 'local:1#a',
    positionSec: 1,
    paused: false,
    reason: 'tick',
    seq: 1,
    sampledAtMs: 0,
    ...overrides,
});

const engineConfig = (overrides: Partial<HifiEngineConfig> = {}): HifiEngineConfig => ({
    mpvPath: null,
    audioDevice: 'auto',
    exclusive: true,
    dsdMode: 'pcm',
    softwareVolume: false,
    volume: 100,
    muted: false,
    ...overrides,
});

const loadRequest = (trackKey: string): HifiLoadRequest => ({
    trackKey,
    songKey: trackKey.split('#')[0],
    source: { kind: 'local', sourceKey: 'source-a', size: 10, mimeType: 'audio/flac', fileName: 'song.flac' },
    startSec: 0,
    paused: true,
    loopFile: false,
});

/** 一份假的 window.electron.hifi：每个方法都是 vi.fn，onX 的回调存进 push 里由测试代主进程推送。 */
const makeApi = () => {
    const push: {
        state?: (state: HifiEngineState) => void;
        clock?: (update: HifiClockUpdate) => void;
        error?: (event: HifiErrorEvent) => void;
        installProgress?: (progress: HifiInstallProgress) => void;
        read?: (request: HifiReadRequest) => void;
    } = {};
    const unsubscribe = vi.fn();
    const subscribe = <T>(key: keyof typeof push) => vi.fn((callback: (value: T) => void) => {
        (push as Record<string, unknown>)[key] = callback;
        return unsubscribe;
    });
    const api = {
        getRuntimeStatus: vi.fn<HifiApi['getRuntimeStatus']>(async () => runtimeStatus()),
        detectRuntime: vi.fn(async () => runtimeStatus({ source: 'manual' })),
        pickRuntimePath: vi.fn(async () => '/opt/mpv/mpv'),
        installRuntime: vi.fn<HifiApi['installRuntime']>(async () => ({ ok: true, errorCode: null, status: runtimeStatus({ source: 'downloaded' }) })),
        cancelInstall: vi.fn(async () => undefined),
        configure: vi.fn<HifiApi['configure']>(async () => undefined),
        listDevices: vi.fn(async () => [{ name: 'auto', description: 'Autoselect device', driver: 'auto', direct: false }]),
        load: vi.fn<HifiApi['load']>(async () => ({ ok: true, state: engineState({ status: 'paused', paused: true }) })),
        play: vi.fn(async () => undefined),
        pause: vi.fn(async () => undefined),
        seek: vi.fn(async (_positionSec: number) => undefined),
        stop: vi.fn(async () => undefined),
        setLoopFile: vi.fn(async (_loop: boolean) => undefined),
        preloadNext: vi.fn(async (_request: HifiLoadRequest) => true),
        clearNext: vi.fn(async () => undefined),
        getSnapshot: vi.fn<HifiApi['getSnapshot']>(async () => engineState()),
        probeOutput: vi.fn<HifiApi['probeOutput']>(async () => null),
        respondRead: vi.fn<HifiApi['respondRead']>(async () => undefined),
        onState: subscribe<HifiEngineState>('state'),
        onClock: subscribe<HifiClockUpdate>('clock'),
        onError: subscribe<HifiErrorEvent>('error'),
        onInstallProgress: subscribe<HifiInstallProgress>('installProgress'),
        onReadRequest: subscribe<HifiReadRequest>('read'),
    } satisfies HifiApi;
    return { api, push, unsubscribe };
};

const setup = () => {
    const fake = makeApi();
    const engine = createHifiEngine(() => fake.api);
    return { ...fake, engine };
};

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('hifi engine client', () => {
    it('subscribes once however many times attach runs, and again after detach', () => {
        const { api, engine, unsubscribe } = setup();

        expect(engine.store.getState().supported).toBe(true);
        expect(engine.attach()).toBe(true);
        expect(engine.attach()).toBe(true);
        for (const subscribe of [api.onState, api.onClock, api.onError, api.onInstallProgress, api.onReadRequest]) {
            expect(subscribe).toHaveBeenCalledTimes(1);
        }

        engine.detach();
        expect(unsubscribe).toHaveBeenCalledTimes(5);

        engine.attach();
        expect(api.onState).toHaveBeenCalledTimes(2);
    });

    it('keeps the newest state and drops ones whose seq is not newer', () => {
        const { push, engine } = setup();
        const seen = vi.fn();
        engine.onState(seen);
        engine.attach();

        push.state?.(engineState({ seq: 2, positionSec: 20 }));
        push.state?.(engineState({ seq: 1, positionSec: 10 }));
        push.state?.(engineState({ seq: 2, positionSec: 30 }));
        expect(engine.store.getState().engine?.positionSec).toBe(20);
        expect(seen).toHaveBeenCalledTimes(1);

        push.state?.(engineState({ seq: 3, circuitOpen: true }));
        expect(engine.store.getState().engine?.seq).toBe(3);
        expect(engine.store.getState().circuitOpen).toBe(true);
        expect(seen).toHaveBeenCalledTimes(2);
    });

    it('takes a snapshot whose seq equals the last pushed one, since main builds snapshots without bumping seq', async () => {
        const { api, push, engine } = setup();
        const seen = vi.fn();
        engine.onState(seen);
        engine.attach();
        push.state?.(engineState({ seq: 5, status: 'paused', paused: true, positionSec: 30 }));

        // 暂停在 30 秒时 seek 到 120 秒：主进程只推时钟，不推状态，快照的 seq 还是 5。
        api.getSnapshot.mockResolvedValueOnce(engineState({ seq: 5, status: 'paused', paused: true, positionSec: 120 }));
        expect((await engine.getSnapshot())?.positionSec).toBe(120);
        expect(engine.store.getState().engine?.positionSec).toBe(120);
        // 同一个 seq 只通知订阅者一次。
        expect(seen).toHaveBeenCalledTimes(1);

        api.getSnapshot.mockResolvedValueOnce(engineState({ seq: 6, positionSec: 60 }));
        expect((await engine.getSnapshot())?.positionSec).toBe(60);
        expect(engine.store.getState().engine?.seq).toBe(6);
        expect(seen).toHaveBeenCalledTimes(2);

        // 推送仍然只收比上一份新的。
        push.state?.(engineState({ seq: 6, positionSec: 61 }));
        expect(engine.store.getState().engine?.positionSec).toBe(60);
    });

    it('fans the clock out only for the current, next or just-requested track', async () => {
        const { api, push, engine } = setup();
        const ticks: Array<string | null> = [];
        const unsubscribeClock = engine.onClock(update => ticks.push(update.trackKey));
        engine.attach();
        push.state?.(engineState({ trackKey: 'local:1#a', next: { trackKey: 'local:2#b', songKey: 'local:2' } }));

        push.clock?.(clock({ trackKey: 'local:1#a' }));
        push.clock?.(clock({ trackKey: 'local:9#stale' }));
        push.clock?.(clock({ trackKey: null }));
        push.clock?.(clock({ trackKey: 'local:2#b' }));
        expect(ticks).toEqual(['local:1#a', null, 'local:2#b']);

        // 起播那一下的时钟比主进程的状态先到。
        let finishLoad: (value: Awaited<ReturnType<HifiApi['load']>>) => void = () => {};
        api.load.mockImplementationOnce(() => new Promise((resolve) => { finishLoad = resolve; }));
        const pending = engine.load(loadRequest('local:3#c'));
        push.clock?.(clock({ trackKey: 'local:3#c', reason: 'load' }));
        expect(ticks.at(-1)).toBe('local:3#c');
        finishLoad({ ok: true, state: engineState({ seq: 2, trackKey: 'local:3#c' }) });
        await pending;

        await engine.stop();
        push.clock?.(clock({ trackKey: 'local:2#b' }));
        expect(ticks).toHaveLength(4);

        unsubscribeClock();
        push.clock?.(clock({ trackKey: 'local:3#c' }));
        expect(ticks).toHaveLength(4);
    });

    it('reads a registered File for the bridge and replies through respondRead', async () => {
        const { api, push, engine } = setup();
        engine.attach();
        engine.responder.register('source-a', new File([Uint8Array.from([0, 1, 2, 3, 4, 5])], 'song.flac'));

        push.read?.({ readId: 'read-1', sourceKey: 'source-a', offset: 2, length: 3 });
        push.read?.({ readId: 'read-2', sourceKey: 'source-gone', offset: 0, length: 3 });

        await vi.waitFor(() => expect(api.respondRead).toHaveBeenCalledTimes(2));
        const replies = new Map(api.respondRead.mock.calls);
        const first = replies.get('read-1');
        expect(first?.status).toBe('ok');
        expect(first?.status === 'ok' ? Array.from(first.data) : []).toEqual([2, 3, 4]);
        expect(replies.get('read-2')).toEqual({ status: 'unknown-source' });
    });

    it('records pushed errors, fans them out and opens the circuit on CIRCUIT_OPEN', () => {
        const { push, engine } = setup();
        const errors = vi.fn();
        engine.onError(errors);
        engine.attach();

        const crash: HifiErrorEvent = { code: 'MPV_CRASHED', trackKey: 'local:1#a', fatal: true };
        push.error?.(crash);
        expect(engine.store.getState().lastError).toEqual(crash);
        expect(engine.store.getState().circuitOpen).toBe(false);

        push.error?.({ code: 'CIRCUIT_OPEN', trackKey: null, fatal: true });
        expect(engine.store.getState().circuitOpen).toBe(true);
        expect(errors).toHaveBeenCalledTimes(2);
    });

    it('applies a load result: the state on success, lastError and the circuit on failure', async () => {
        const { api, engine } = setup();

        await engine.load(loadRequest('local:1#a'));
        expect(engine.store.getState().engine?.status).toBe('paused');

        api.load.mockResolvedValueOnce({ ok: false, errorCode: 'LOAD_FAILED', detail: 'superseded' });
        await engine.load(loadRequest('local:1#b'));
        expect(engine.store.getState().lastError).toBeNull();

        // 还在载入时被 stop() 取消（比如路由守卫切去 Web）：和 superseded 一样只记 info。
        api.load.mockResolvedValueOnce({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
        await engine.load(loadRequest('local:1#e'));
        expect(engine.store.getState().lastError).toBeNull();
        expect(console.info).toHaveBeenCalledWith('[HiFi] load cancelled by stop', { trackKey: 'local:1#e', sourceKind: 'local' });
        expect(console.warn).not.toHaveBeenCalled();

        api.load.mockResolvedValueOnce({ ok: false, errorCode: 'CIRCUIT_OPEN' });
        await engine.load(loadRequest('local:1#c'));
        expect(engine.store.getState().lastError).toMatchObject({ code: 'CIRCUIT_OPEN', trackKey: 'local:1#c', fatal: true });
        expect(engine.store.getState().circuitOpen).toBe(true);

        api.load.mockRejectedValueOnce(new Error('Error invoking remote method'));
        expect(await engine.load(loadRequest('local:1#d'))).toEqual({ ok: false, errorCode: 'UNKNOWN' });
    });

    it('tells a cancelled load (superseded or stopped) from a failed one', () => {
        expect(isHifiLoadCancelled({ ok: false, errorCode: 'LOAD_FAILED', detail: 'superseded' })).toBe(true);
        expect(isHifiLoadCancelled({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' })).toBe(true);
        expect(isHifiLoadCancelled({ ok: false, errorCode: 'LOAD_FAILED', detail: 'timeout' })).toBe(false);
        expect(isHifiLoadCancelled({ ok: false, errorCode: 'LOAD_FAILED', detail: 'constructor' })).toBe(false);
        expect(isHifiLoadCancelled({ ok: false, errorCode: 'LOAD_FAILED' })).toBe(false);
        expect(isHifiLoadCancelled({ ok: true, state: engineState() })).toBe(false);
    });

    const runtimeFailureCodes: HifiErrorCode[] = ['MPV_NOT_FOUND', 'MPV_SPAWN_FAILED', 'MPV_TOO_OLD'];
    it.each(runtimeFailureCodes)('refreshes the runtime when a load fails with %s', async (code) => {
        const { api, engine } = setup();
        api.getRuntimeStatus.mockResolvedValueOnce(runtimeStatus({ available: false, path: null, source: null, errorCode: 'MPV_NOT_FOUND' }));
        api.load.mockResolvedValueOnce({ ok: false, errorCode: code });

        await engine.load(loadRequest('local:1#a'));
        expect(api.getRuntimeStatus).toHaveBeenCalledTimes(1);
        expect(engine.store.getState().runtime?.available).toBe(false);
        expect(engine.store.getState().lastError).toMatchObject({ code, trackKey: 'local:1#a', fatal: true });
    });

    it('leaves the runtime alone when a load fails for a reason that is not about mpv itself', async () => {
        const { api, engine } = setup();
        for (const errorCode of ['LOAD_FAILED', 'DEVICE_BUSY', 'SOURCE_UNREACHABLE', 'MPV_CRASHED'] as const) {
            api.load.mockResolvedValueOnce({ ok: false, errorCode });
            await engine.load(loadRequest('local:1#a'));
        }
        api.load.mockResolvedValueOnce({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
        await engine.load(loadRequest('local:1#b'));
        expect(api.getRuntimeStatus).not.toHaveBeenCalled();
    });

    it('skips a configure identical to the last one sent, including volume while software volume is off', async () => {
        const { api, engine } = setup();

        await engine.configure(engineConfig());
        await engine.configure(engineConfig());
        // 不开软件音量时 mpv 固定 100：桥随音量推来的配置对主进程没区别。
        await engine.configure(engineConfig({ volume: 40 }));
        expect(api.configure).toHaveBeenCalledTimes(1);

        await engine.configure(engineConfig({ volume: 40, exclusive: false }));
        expect(api.configure).toHaveBeenCalledTimes(2);
        expect(api.configure).toHaveBeenLastCalledWith(engineConfig({ volume: 40, exclusive: false }));

        await engine.configure(engineConfig({ volume: 40, exclusive: false, softwareVolume: true }));
        await engine.configure(engineConfig({ volume: 40, exclusive: false, softwareVolume: true }));
        await engine.configure(engineConfig({ volume: 55, exclusive: false, softwareVolume: true }));
        expect(api.configure).toHaveBeenCalledTimes(4);
        expect(api.configure).toHaveBeenLastCalledWith(engineConfig({ volume: 55, exclusive: false, softwareVolume: true }));
    });

    it('always sends a change of mute, with software volume on or off', async () => {
        const { api, engine } = setup();

        await engine.configure(engineConfig());
        await engine.configure(engineConfig({ muted: true }));
        expect(api.configure).toHaveBeenCalledTimes(2);
        expect(api.configure).toHaveBeenLastCalledWith(engineConfig({ muted: true }));
        // The volume of a muted config still does not matter while software volume is off.
        await engine.configure(engineConfig({ muted: true, volume: 30 }));
        expect(api.configure).toHaveBeenCalledTimes(2);

        await engine.configure(engineConfig({ muted: false, volume: 30 }));
        expect(api.configure).toHaveBeenCalledTimes(3);
        expect(api.configure).toHaveBeenLastCalledWith(engineConfig({ muted: false, volume: 30 }));
    });

    it('does not let a caller mutating its config object defeat the comparison', async () => {
        const { api, engine } = setup();
        const config = engineConfig();
        await engine.configure(config);
        config.exclusive = false;
        await engine.configure(config);
        expect(api.configure).toHaveBeenCalledTimes(2);
    });

    it('refreshes the runtime after main took a config whose mpv path changed', async () => {
        const { api, engine } = setup();

        // 第一次发配置：启动时 refreshRuntime 可能先于它，主进程那次是按没有手动路径测的。
        let finishConfigure: () => void = () => {};
        api.configure.mockImplementationOnce(() => new Promise<void>((resolve) => { finishConfigure = resolve; }));
        api.getRuntimeStatus.mockResolvedValueOnce(runtimeStatus({ source: 'manual', path: '/opt/mpv/mpv' }));
        const pending = engine.configure(engineConfig({ mpvPath: '/opt/mpv/mpv' }));
        await Promise.resolve();
        expect(api.getRuntimeStatus).not.toHaveBeenCalled();
        finishConfigure();
        await pending;
        expect(api.getRuntimeStatus).toHaveBeenCalledTimes(1);
        expect(engine.store.getState().runtime?.path).toBe('/opt/mpv/mpv');

        // 路径没变，别的设置变了：不刷新。
        await engine.configure(engineConfig({ mpvPath: '/opt/mpv/mpv', exclusive: false }));
        expect(api.configure).toHaveBeenCalledTimes(2);
        expect(api.getRuntimeStatus).toHaveBeenCalledTimes(1);

        // 清掉手动路径：系统里没有 mpv，路由要马上知道。
        api.getRuntimeStatus.mockResolvedValueOnce(runtimeStatus({ available: false, path: null, source: null, errorCode: 'MPV_NOT_FOUND' }));
        await engine.configure(engineConfig({ exclusive: false }));
        expect(api.getRuntimeStatus).toHaveBeenCalledTimes(2);
        expect(engine.store.getState().runtime?.available).toBe(false);
    });

    it('sends the same config again after main failed to take it, and does not refresh on the failure', async () => {
        const { api, engine } = setup();
        api.configure.mockRejectedValueOnce(new Error('ipc gone'));

        await engine.configure(engineConfig({ mpvPath: '/opt/mpv/mpv' }));
        expect(api.getRuntimeStatus).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith('[HiFi] configure failed', expect.any(Error));

        await engine.configure(engineConfig({ mpvPath: '/opt/mpv/mpv' }));
        expect(api.configure).toHaveBeenCalledTimes(2);
        expect(api.getRuntimeStatus).toHaveBeenCalledTimes(1);
    });

    it('refreshes the runtime after an install settles, also when the install call itself failed', async () => {
        const { api, engine } = setup();

        await engine.install();
        expect(engine.store.getState().runtime?.source).toBe('downloaded');
        // 主进程装完会重新检测并带回状态，不用再问。
        expect(api.getRuntimeStatus).not.toHaveBeenCalled();

        api.installRuntime.mockRejectedValueOnce(new Error('Error invoking remote method'));
        api.getRuntimeStatus.mockResolvedValueOnce(runtimeStatus({ source: 'system', version: '0.40.0' }));
        expect(await engine.install()).toBeNull();
        expect(api.getRuntimeStatus).toHaveBeenCalledTimes(1);
        expect(engine.store.getState().runtime?.version).toBe('0.40.0');
    });

    it('keeps runtime, devices and install progress in the store', async () => {
        const { push, engine } = setup();
        engine.attach();

        expect((await engine.refreshRuntime())?.source).toBe('system');
        expect((await engine.detect())?.source).toBe('manual');
        expect((await engine.install())?.ok).toBe(true);
        expect(engine.store.getState().runtime?.source).toBe('downloaded');
        expect(await engine.pickRuntimePath()).toBe('/opt/mpv/mpv');

        expect(await engine.listDevices()).toHaveLength(1);
        expect(engine.store.getState().devices[0]?.name).toBe('auto');

        const progress: HifiInstallProgress = { phase: 'downloading', version: '0.41.0', receivedBytes: 1, totalBytes: 2, errorCode: null };
        push.installProgress?.(progress);
        expect(engine.store.getState().installProgress).toEqual(progress);
    });

    it('never throws from transport calls when the main process rejects', async () => {
        const { api, engine } = setup();
        const warn = vi.mocked(console.warn);
        const failure = new Error('ipc gone');
        for (const call of [api.play, api.pause, api.seek, api.stop, api.setLoopFile, api.clearNext, api.configure]) {
            call.mockRejectedValueOnce(failure);
        }
        api.preloadNext.mockRejectedValueOnce(failure);
        api.listDevices.mockRejectedValueOnce(failure);

        await expect(engine.play()).resolves.toBeUndefined();
        await expect(engine.pause()).resolves.toBeUndefined();
        await expect(engine.seek(12)).resolves.toBeUndefined();
        await expect(engine.stop()).resolves.toBeUndefined();
        await expect(engine.setLoopFile(true)).resolves.toBeUndefined();
        await expect(engine.clearNext()).resolves.toBeUndefined();
        await expect(engine.configure({ mpvPath: null, audioDevice: 'auto', exclusive: true, dsdMode: 'pcm', softwareVolume: false, volume: 100, muted: false })).resolves.toBeUndefined();
        await expect(engine.preloadNext(loadRequest('local:2#b'))).resolves.toBe(false);
        await expect(engine.listDevices()).resolves.toEqual([]);
        expect(warn).toHaveBeenCalledWith('[HiFi] play failed', failure);
        expect(api.seek).toHaveBeenCalledWith(12);
    });

    it('remembers songs that fell back to the Web engine until cleared', () => {
        const { engine } = setup();

        expect(engine.isSongForcedWeb('local:1')).toBe(false);
        engine.markSongForcedWeb('local:1');
        engine.markSongForcedWeb('local:1');
        expect(engine.isSongForcedWeb('local:1')).toBe(true);
        expect(engine.isSongForcedWeb('local:2')).toBe(false);

        engine.clearForcedWeb();
        expect(engine.isSongForcedWeb('local:1')).toBe(false);
    });

    it('returns safe defaults when window.electron.hifi is missing', async () => {
        const engine = createHifiEngine(() => undefined);

        expect(engine.attach()).toBe(false);
        expect(engine.store.getState().supported).toBe(false);
        expect(await engine.load(loadRequest('local:1#a'))).toEqual({ ok: false, errorCode: 'UNSUPPORTED_PLATFORM' });
        expect(await engine.listDevices()).toEqual([]);
        expect(await engine.getSnapshot()).toBeNull();
        expect(await engine.refreshRuntime()).toBeNull();
        expect(await engine.detect()).toBeNull();
        expect(await engine.install()).toBeNull();
        expect(await engine.pickRuntimePath()).toBeNull();
        expect(await engine.preloadNext(loadRequest('local:2#b'))).toBe(false);
        await expect(engine.play()).resolves.toBeUndefined();
        await expect(engine.pause()).resolves.toBeUndefined();
        await expect(engine.seek(3)).resolves.toBeUndefined();
        await expect(engine.stop()).resolves.toBeUndefined();
        expect(engine.store.getState().engine).toBeNull();
    });

    it('the singleton is inert without a window', async () => {
        expect(typeof window).toBe('undefined');
        expect(hifiEngine.attach()).toBe(false);
        expect(await hifiEngine.load(loadRequest('local:1#a'))).toEqual({ ok: false, errorCode: 'UNSUPPORTED_PLATFORM' });
    });
});

describe('PipeWire output probe', () => {
    /** 引擎在放 local:1#a，和 makeApi 的默认状态一样。 */
    const playing = () => {
        const fake = setup();
        fake.engine.attach();
        fake.push.state?.(engineState({ seq: 2 }));
        return fake;
    };

    it('keeps the probe with its trackKey for the track mpv plays, and logs what PipeWire reports once', async () => {
        const { api, engine } = playing();
        const probe = fixtureProbe();
        api.probeOutput.mockResolvedValue(probe);

        expect(await engine.probeOutput('local:1#a')).toEqual(probe);
        expect(engine.store.getState().outputProbe).toEqual({ probe, trackKey: 'local:1#a' });
        expect(console.info).toHaveBeenCalledWith('[HiFi] PipeWire reports', {
            trackKey: 'local:1#a',
            streamRate: 96000,
            device: 'alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__Speaker__sink',
            deviceRate: 48000,
            allowedRates: [48000],
            filters: ['effect_input.eq6', 'remap_input.remap-FL-FR-to-FR-FL'],
            otherStreams: [],
        });

        // 下一次只是读取时刻不同：store 里还是同一个对象，日志不再记。
        const before = engine.store.getState().outputProbe;
        api.probeOutput.mockResolvedValue({ ...probe, at: probe.at + 2000 });
        await engine.probeOutput('local:1#a');
        expect(engine.store.getState().outputProbe).toBe(before);
        expect(vi.mocked(console.info).mock.calls.filter(([line]) => line === '[HiFi] PipeWire reports')).toHaveLength(1);

        // PipeWire 那边变了（切到了 96 kHz）：换上新的，再记一行。
        const switched = fixtureProbe({ deviceRate: 96000 });
        api.probeOutput.mockResolvedValue(switched);
        await engine.probeOutput('local:1#a');
        expect(engine.store.getState().outputProbe).toEqual({ probe: switched, trackKey: 'local:1#a' });
        expect(vi.mocked(console.info).mock.calls.filter(([line]) => line === '[HiFi] PipeWire reports')).toHaveLength(2);
    });

    it('drops a probe that comes back after mpv moved on to another track', async () => {
        const { api, engine, push } = playing();
        let answer: (probe: HifiOutputProbe | null) => void = () => {};
        api.probeOutput.mockReturnValueOnce(new Promise((resolve) => {
            answer = resolve;
        }));

        const pending = engine.probeOutput('local:1#a');
        // 无缝换到下一首。
        push.state?.(engineState({ seq: 3, trackKey: 'local:2#b', songKey: 'local:2' }));
        answer(fixtureProbe());

        expect(await pending).toBeNull();
        expect(engine.store.getState().outputProbe).toBeNull();
    });

    it('drops an older probe that comes back after a newer one', async () => {
        const { api, engine } = playing();
        let answerFirst: (probe: HifiOutputProbe | null) => void = () => {};
        api.probeOutput
            .mockReturnValueOnce(new Promise((resolve) => {
                answerFirst = resolve;
            }))
            .mockResolvedValueOnce(fixtureProbe({ deviceRate: 96000 }));

        const first = engine.probeOutput('local:1#a');
        const second = engine.probeOutput('local:1#a');
        await second;
        answerFirst(fixtureProbe());

        expect(await first).toBeNull();
        expect(engine.store.getState().outputProbe?.probe?.device?.format.rate).toBe(96000);
    });

    it('records no probe when main sends something else, and warns once while the call keeps failing', async () => {
        const { api, engine } = playing();
        api.probeOutput.mockResolvedValueOnce(fixtureProbe());
        await engine.probeOutput('local:1#a');

        api.probeOutput.mockResolvedValueOnce({ backend: 'pulseaudio' } as never);
        expect(await engine.probeOutput('local:1#a')).toBeNull();
        expect(engine.store.getState().outputProbe).toEqual({ probe: null, trackKey: 'local:1#a' });

        const failure = new Error('pw-dump exited with 1');
        api.probeOutput.mockRejectedValue(failure);
        expect(await engine.probeOutput('local:1#a')).toBeNull();
        expect(await engine.probeOutput('local:1#a')).toBeNull();
        expect(vi.mocked(console.warn).mock.calls.filter(([line]) => line === '[HiFi] output probe failed')).toEqual([
            ['[HiFi] output probe failed', failure],
        ]);
        expect(engine.store.getState().outputProbe).toEqual({ probe: null, trackKey: 'local:1#a' });

        // 好了之后再失败，又记一次。
        api.probeOutput.mockResolvedValueOnce(fixtureProbe());
        await engine.probeOutput('local:1#a');
        await engine.probeOutput('local:1#a');
        expect(vi.mocked(console.warn).mock.calls.filter(([line]) => line === '[HiFi] output probe failed')).toHaveLength(2);
    });

    it('is null without the engine interface, or with a preload that has no probe yet', async () => {
        expect(await createHifiEngine(() => undefined).probeOutput('local:1#a')).toBeNull();

        const { api } = makeApi();
        const { probeOutput: _missing, ...olderApi } = api;
        const engine = createHifiEngine(() => olderApi as unknown as HifiApi);
        expect(await engine.probeOutput('local:1#a')).toBeNull();
        expect(engine.store.getState().outputProbe).toBeNull();
        expect(console.warn).not.toHaveBeenCalled();
    });
});

describe('PipeWire probe rules', () => {
    it('looks at PipeWire for the pipewire and pulse outputs only', () => {
        expect(['pipewire', 'pulse', ' PipeWire ', 'alsa', 'jack', 'wasapi', null, undefined].map(isPipewireOutputDriver)).toEqual([
            true, true, true, false, false, false, false, false,
        ]);
    });

    it('takes only a probe of the expected shape', () => {
        expect(isOutputProbe(fixtureProbe())).toBe(true);
        expect(isOutputProbe(fixtureProbe({ device: null }))).toBe(true);
        expect(isOutputProbe(null)).toBe(false);
        expect(isOutputProbe({ ...fixtureProbe(), backend: 'pulseaudio' })).toBe(false);
        expect(isOutputProbe({ ...fixtureProbe(), filters: undefined })).toBe(false);
        expect(isOutputProbe({ ...fixtureProbe(), graph: { clockRate: 48000 } })).toBe(false);
        expect(isOutputProbe({ ...fixtureProbe(), device: { name: 'x' } })).toBe(false);
    });

    it('treats two probes that differ only in when they were read as the same', () => {
        expect(isSameOutputProbe(fixtureProbe({ at: 1 }), fixtureProbe({ at: 2 }))).toBe(true);
        expect(isSameOutputProbe(fixtureProbe(), fixtureProbe({ deviceRate: 96000 }))).toBe(false);
        expect(isSameOutputProbe(null, null)).toBe(true);
        expect(isSameOutputProbe(fixtureProbe(), null)).toBe(false);
    });

    it('logs own streams as such', () => {
        expect(outputProbeLogFields(fixtureProbe({ otherStreams: [{ nodeId: 90, name: 'Folia', own: true }, { nodeId: 91, name: 'Firefox', own: false }] }))?.otherStreams)
            .toEqual(['Folia (own)', 'Firefox']);
        expect(outputProbeLogFields(null)).toBeNull();
    });
});
