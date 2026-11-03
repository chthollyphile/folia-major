import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import type {
    HifiClockUpdate,
    HifiEngineState,
    HifiErrorEvent,
    HifiInstallProgress,
    HifiLoadRequest,
    HifiLoadResult,
    HifiReadRequest,
    HifiRuntimeStatus,
    HifiSourceSpec,
} from '@/types/hifi';
import type { NavidromeSong } from '@/types/navidrome';
import type { HifiApi } from '@/services/hifi/hifiEngine';

// test/unit/hifi/hifiPlayback.test.ts
// HiFi 路线的数据流：路由判定、起播的请求形状（本地 / Navidrome）、被顶替的起播不写 store、失败和取消、接管窗口重建前
// 还在放的那首、路由守卫在同一次 setState 里停掉 mpv，以及按推送驱动时钟和 shim。
// 后半是停着的恢复先不载入、刚离开 Web 引擎时 DEVICE_BUSY 的重试、曲目带着起播的 stillWanted，以及上一个窗口留下、
// 这个窗口没接管的那一首什么时候停掉。

const audio = vi.hoisted(() => ({ state: { loopMode: 'off' as 'off' | 'all' | 'one' } }));
vi.mock('@/stores/useAudioSettingsStore', () => ({ useAudioSettingsStore: { getState: () => audio.state } }));
vi.mock('@/services/hifi/sourceSpec', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/hifi/sourceSpec')>()),
    readLocalSourceSpec: vi.fn(),
}));

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

const localSong = { id: 'song-1', fileName: 'song.flac', filePath: 'Music/song.flac', mimeType: 'audio/flac' } as LocalSong;
const localPlaybackSong = (id = 'song-1') => ({ id, name: id, sourceRef: { kind: 'local', mediaId: id } }) as unknown as SongResult;
const localSource = (bytes = [1, 2, 3, 4, 5]) => ({
    kind: 'local' as const,
    localSong,
    file: new Blob([new Uint8Array(bytes)], { type: 'audio/flac' }),
});

const STREAM_URL = 'https://navi.example.com/rest/stream?id=nd-7&format=raw&u=lia&t=secret-token&s=salt';
const navidromeCarrier = {
    id: 'nd-7',
    name: 'Remote',
    isNavidrome: true,
    sourceRef: { kind: 'navidrome', mediaId: 'nd-7' },
    navidromeData: {
        id: 'nd-7',
        streamUrl: 'https://navi.example.com/rest/stream?id=nd-7',
        albumId: 'al-1',
        artistId: 'ar-1',
        path: 'a/b.flac',
        suffix: 'flac',
        contentType: 'audio/flac',
        bitRate: 2304,
        bitDepth: 24,
        samplingRate: 96000,
        channelCount: 2,
    },
} as unknown as NavidromeSong;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

/** 一份假的 window.electron.hifi：onX 的回调存进 push 里由测试代主进程推送；load 默认成功，状态带着请求的 trackKey。 */
const makeApi = () => {
    const push: {
        state?: (state: HifiEngineState) => void;
        clock?: (update: HifiClockUpdate) => void;
        error?: (event: HifiErrorEvent) => void;
        installProgress?: (progress: HifiInstallProgress) => void;
        read?: (request: HifiReadRequest) => void;
    } = {};
    let seq = 1;
    const nextSeq = () => {
        seq += 1;
        return seq;
    };
    const subscribe = (key: keyof typeof push) => vi.fn((callback: unknown) => {
        (push as Record<string, unknown>)[key] = callback;
        return () => {};
    });
    const api = {
        getRuntimeStatus: vi.fn<HifiApi['getRuntimeStatus']>(async () => runtimeStatus()),
        detectRuntime: vi.fn(async () => runtimeStatus()),
        pickRuntimePath: vi.fn(async () => null),
        installRuntime: vi.fn<HifiApi['installRuntime']>(async () => ({ ok: true, errorCode: null, status: runtimeStatus() })),
        cancelInstall: vi.fn(async () => undefined),
        configure: vi.fn<HifiApi['configure']>(async () => undefined),
        listDevices: vi.fn(async () => []),
        load: vi.fn<HifiApi['load']>(async (request: HifiLoadRequest) => ({
            ok: true,
            state: engineState({
                trackKey: request.trackKey,
                songKey: request.songKey,
                sourceKind: request.source.kind,
                localSourceKey: request.source.kind === 'local' ? request.source.sourceKey : null,
                positionSec: request.startSec,
                seq: nextSeq(),
            }),
        })),
        play: vi.fn(async () => undefined),
        pause: vi.fn(async () => undefined),
        seek: vi.fn(async (_positionSec: number) => undefined),
        stop: vi.fn(async () => undefined),
        setLoopFile: vi.fn(async (_loop: boolean) => undefined),
        preloadNext: vi.fn(async (_request: HifiLoadRequest) => true),
        clearNext: vi.fn(async () => undefined),
        getSnapshot: vi.fn<HifiApi['getSnapshot']>(async () => engineState({ status: 'idle', seq: 1 })),
        probeOutput: vi.fn<HifiApi['probeOutput']>(async () => null),
        respondRead: vi.fn<HifiApi['respondRead']>(async () => undefined),
        onState: subscribe('state'),
        onClock: subscribe('clock'),
        onError: subscribe('error'),
        onInstallProgress: subscribe('installProgress'),
        onReadRequest: subscribe('read'),
    } satisfies HifiApi;
    return { api, push, nextSeq };
};

/** 每个用例一套新的模块单例（播放 store、引擎、shim、曲目 store），再装上假的 window.electron.hifi。 */
const setup = async ({ install = true } = {}) => {
    vi.resetModules();
    // 先单独载入被 mock 的模块：异步的 mock 工厂和并行的动态 import 一起跑时，别的模块可能拿到原版。
    const sourceSpec = await import('@/services/hifi/sourceSpec');
    const [playback, engineModule, shimModule, playbackStore, settings] = await Promise.all([
        import('@/services/hifi/hifiPlayback'),
        import('@/services/hifi/hifiEngine'),
        import('@/services/hifi/hifiMediaShim'),
        import('@/stores/usePlaybackStore'),
        import('@/stores/useHifiSettingsStore'),
    ]);
    const fake = makeApi();
    vi.stubGlobal('window', { electron: { hifi: fake.api } });
    const readSpec = sourceSpec.readLocalSourceSpec as Mock<typeof sourceSpec.readLocalSourceSpec>;
    readSpec.mockImplementation(async () => specOf({ origin: 'local', codec: 'FLAC' }));
    if (install) playback.installHifiPlayback();
    shims.push(shimModule.hifiMediaShim);
    return {
        ...fake,
        playback,
        engine: engineModule.hifiEngine,
        engineStore: engineModule.useHifiEngineStore,
        shim: shimModule.hifiMediaShim,
        playbackStore: playbackStore.usePlaybackStore,
        settings: settings.useHifiSettingsStore,
        readSpec,
        track: () => playback.useHifiTrackStore.getState(),
    };
};

const specOf = (overrides: Partial<HifiSourceSpec>): HifiSourceSpec => ({
    origin: 'local',
    codec: null,
    container: null,
    bitDepth: null,
    sampleRate: null,
    channels: null,
    lossless: null,
    isDsd: false,
    dsdRate: null,
    bitrate: null,
    ...overrides,
});

const record = (target: EventTarget) => {
    const events: string[] = [];
    for (const type of ['play', 'playing', 'pause', 'seeked', 'ended', 'loadedmetadata', 'durationchange']) {
        target.addEventListener(type, () => events.push(type));
    }
    return events;
};

let shims: Array<{ reset: () => void }> = [];

// 第一次 import 这串模块（music-metadata 最重）要转译好几秒：整套并行跑时第一个用例会撞上 5 秒的超时。先在这里热一遍，
// 之后每个用例 resetModules 再 import 时只是重新求值。
beforeAll(async () => {
    await import('@/services/hifi/sourceSpec');
    await import('@/services/hifi/hifiPlayback');
}, 60_000);

beforeEach(() => {
    audio.state.loopMode = 'off';
    shims = [];
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    shims.forEach(shim => shim.reset());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('hifiRouteFor', () => {
    it('routes local and Navidrome songs to mpv only when every gate allows it', async () => {
        const { playback, settings, engineStore, engine } = await setup();
        await flush();
        const route = (kind: 'local' | 'navidrome', songKey = `${kind}:1`) => playback.hifiRouteFor(kind, songKey);

        expect(route('local')).toBe('web');

        settings.setState({ enabled: true, navidrome: true });
        expect(engineStore.getState()).toMatchObject({ supported: true, runtime: { available: true } });
        expect(route('local')).toBe('hifi');
        expect(route('navidrome')).toBe('hifi');

        settings.setState({ navidrome: false });
        expect(route('navidrome')).toBe('web');
        expect(route('local')).toBe('hifi');
        settings.setState({ navidrome: true });

        engine.markSongForcedWeb('local:1');
        expect(route('local', 'local:1')).toBe('web');
        expect(route('local', 'local:2')).toBe('hifi');

        engineStore.setState({ runtime: runtimeStatus({ available: false, errorCode: 'MPV_NOT_FOUND' }) });
        expect(route('local', 'local:2')).toBe('web');
        engineStore.setState({ runtime: null });
        expect(route('local', 'local:2')).toBe('web');
        engineStore.setState({ runtime: runtimeStatus() });

        engineStore.setState({ circuitOpen: true });
        expect(route('local', 'local:2')).toBe('web');
        engineStore.setState({ circuitOpen: false, supported: false });
        expect(route('local', 'local:2')).toBe('web');
    });
});

describe('beginHifiTrack', () => {
    it('clears the Web source, flips the route and loads a local file paused with its sourceKey registered', async () => {
        const { playback, playbackStore, api, push, engine, readSpec, track } = await setup();
        playbackStore.setState({ audioSrc: 'blob:previous' });
        const spec = deferred<HifiSourceSpec>();
        readSpec.mockReturnValueOnce(spec.promise);
        const source = localSource();

        const outcome = playback.beginHifiTrack({ song: localPlaybackSong(), source, startSec: 12.5 });

        expect(playbackStore.getState()).toMatchObject({ audioSrc: null, playbackRoute: 'hifi' });
        const current = track().current!;
        expect(current).toMatchObject({ songKey: 'local:song-1', origin: 'local' });
        expect(current.trackKey).toMatch(/^local:song-1#[0-9a-f]{12}$/);
        expect(current.localSourceKey).toMatch(/^[0-9a-f]{32}$/);
        expect(track().loadState).toBe('loading');
        expect(playback.getHifiPosition()).toBe(12.5);
        expect(api.load).toHaveBeenCalledWith({
            trackKey: current.trackKey,
            songKey: 'local:song-1',
            source: { kind: 'local', sourceKey: current.localSourceKey, size: 5, mimeType: 'audio/flac', fileName: 'song.flac' },
            startSec: 12.5,
            paused: true,
            loopFile: false,
        });
        expect(engine.responder.has(current.localSourceKey!)).toBe(true);
        expect(readSpec).toHaveBeenCalledWith(source.file, 'song.flac');

        expect(await outcome).toBe('ready');
        expect(track()).toMatchObject({ loadState: 'ready', loadError: null, sourceSpec: null });
        expect(api.stop).not.toHaveBeenCalled();

        spec.resolve(specOf({ origin: 'local', codec: 'FLAC', bitDepth: 24 }));
        await flush();
        expect(track().sourceSpec).toMatchObject({ codec: 'FLAC', bitDepth: 24 });

        // 主进程按块来要字节，responder 从登记的文件里切出来回送。
        push.read?.({ readId: 'read-1', sourceKey: current.localSourceKey!, offset: 1, length: 3 });
        await flush();
        expect(api.respondRead).toHaveBeenCalledWith('read-1', { status: 'ok', data: new Uint8Array([2, 3, 4]) });
    });

    it('loads from the top a start within half a second of the song\'s length, and anywhere else where asked', async () => {
        const { playback, api } = await setup();
        const song = { ...localPlaybackSong(), durationMs: 20_004 } as SongResult;
        await playback.beginHifiTrack({ song, source: localSource(), startSec: 20 });
        expect(api.load.mock.calls.at(-1)?.[0].startSec).toBe(0);
        expect(playback.getHifiPosition()).toBe(0);

        await playback.beginHifiTrack({ song, source: localSource(), startSec: 19.4 });
        expect(api.load.mock.calls.at(-1)?.[0].startSec).toBe(19.4);
        // A song with no length of its own starts where it was asked.
        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 20 });
        expect(api.load.mock.calls.at(-1)?.[0].startSec).toBe(20);
    });

    it('asks mpv to loop the file only in loop-one outside Personal FM', async () => {
        const { playback, playbackStore, api } = await setup();
        audio.state.loopMode = 'one';
        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });
        expect(api.load.mock.calls.at(-1)?.[0].loopFile).toBe(true);

        playbackStore.setState({ isFmMode: true });
        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });
        expect(api.load.mock.calls.at(-1)?.[0].loopFile).toBe(false);
    });

    it('hands the raw Navidrome stream URL to main only, never to a log line', async () => {
        const { playback, api, track } = await setup();

        expect(await playback.beginHifiTrack({
            song: navidromeCarrier,
            source: { kind: 'navidrome', carrier: navidromeCarrier, streamUrl: STREAM_URL },
            startSec: 3,
        })).toBe('ready');

        expect(api.load).toHaveBeenCalledWith(expect.objectContaining({
            songKey: 'navidrome:nd-7',
            source: { kind: 'navidrome', url: STREAM_URL, fileName: 'nd-7.flac' },
            startSec: 3,
            paused: true,
        }));
        expect(track().current).toMatchObject({ origin: 'navidrome', localSourceKey: null });
        expect(track().sourceSpec).toMatchObject({ origin: 'navidrome', codec: 'FLAC', bitDepth: 24, sampleRate: 96000, channels: 2 });
        const logged = JSON.stringify([...(console.info as Mock).mock.calls, ...(console.warn as Mock).mock.calls]);
        expect(logged).not.toContain('secret-token');
        expect(logged).not.toContain('navi.example.com');
    });

    it('writes nothing when a newer begin supersedes it, not even its late source spec', async () => {
        const { playback, api, readSpec, track } = await setup();
        const firstLoad = deferred<HifiLoadResult>();
        api.load.mockImplementationOnce(() => firstLoad.promise);
        const firstSpec = deferred<HifiSourceSpec>();
        readSpec.mockReturnValueOnce(firstSpec.promise);

        const first = playback.beginHifiTrack({ song: localPlaybackSong('a'), source: localSource(), startSec: 0 });
        const second = playback.beginHifiTrack({ song: localPlaybackSong('b'), source: localSource(), startSec: 0 });
        expect(await second).toBe('ready');
        const after = track();

        firstLoad.resolve({ ok: false, errorCode: 'FORMAT_UNSUPPORTED' });
        firstSpec.resolve(specOf({ codec: 'stale' }));
        expect(await first).toBe('superseded');
        await flush();
        expect(track()).toBe(after);
        expect(track()).toMatchObject({ current: { songKey: 'local:b' }, loadState: 'ready', loadError: null });
        expect(track().sourceSpec?.codec).toBe('FLAC');
    });

    it('marks the track failed with the load error code, and a cancelled load as idle', async () => {
        const { playback, api, track } = await setup();
        api.load.mockResolvedValueOnce({ ok: false, errorCode: 'DEVICE_BUSY', detail: 'busy' });

        expect(await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 })).toBe('failed');
        expect(track()).toMatchObject({ loadState: 'failed', loadError: 'DEVICE_BUSY', current: { songKey: 'local:song-1' } });

        api.load.mockResolvedValueOnce({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
        expect(await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 })).toBe('cancelled');
        expect(track()).toMatchObject({ loadState: 'idle', loadError: null });
    });

    it('adopts the track main is still playing for the same song, re-registering the file under its sourceKey', async () => {
        const { playback, api, engine, shim, track } = await setup();
        api.getSnapshot.mockResolvedValueOnce(engineState({
            status: 'playing',
            paused: false,
            trackKey: 'local:song-1#before',
            songKey: 'local:song-1',
            localSourceKey: 'a'.repeat(32),
            positionSec: 42,
            durationSec: 200,
            seq: 9,
        }));
        const source = localSource();

        expect(await playback.beginHifiTrack({ song: localPlaybackSong(), source, startSec: 5, adoptRunning: true })).toBe('adopted');

        expect(api.load).not.toHaveBeenCalled();
        expect(track()).toMatchObject({
            loadState: 'ready',
            current: { trackKey: 'local:song-1#before', songKey: 'local:song-1', localSourceKey: 'a'.repeat(32) },
        });
        expect(engine.responder.has('a'.repeat(32))).toBe(true);
        expect(playback.getHifiPosition()).toBeGreaterThanOrEqual(42);
        expect(playback.getHifiPosition()).toBeLessThan(43);
        expect(shim).toMatchObject({ paused: false, duration: 200, currentSrc: 'hifi:local:song-1#before' });
    });

    it('loads afresh when the running track is another song, or main has nothing playing', async () => {
        const { playback, api, track } = await setup();
        const running = { status: 'playing' as const, paused: false, trackKey: 'local:other#x', localSourceKey: 'b'.repeat(32), seq: 9 };
        api.getSnapshot.mockResolvedValueOnce(engineState({ ...running, songKey: 'local:other' }));

        expect(await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 5, adoptRunning: true })).toBe('ready');
        expect(api.load).toHaveBeenCalledTimes(1);
        expect(api.load.mock.calls[0][0].startSec).toBe(5);
        expect(track().current?.trackKey).not.toBe('local:other#x');

        api.getSnapshot.mockResolvedValueOnce(engineState({ ...running, songKey: 'local:song-1', status: 'idle', seq: 10 }));
        expect(await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0, adoptRunning: true })).toBe('ready');
        expect(api.load).toHaveBeenCalledTimes(2);
    });
});

describe('route guard', () => {
    it('stops mpv inside the setState that hands playback to the Web engine', async () => {
        const { playback, playbackStore, api, engine, shim, track } = await setup();
        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });
        const sourceKey = track().current!.localSourceKey!;
        const seenByLaterSubscriber: Array<{ route: string; stopped: boolean }> = [];
        playbackStore.subscribe((state) => {
            if (state.audioSrc) seenByLaterSubscriber.push({ route: state.playbackRoute, stopped: api.stop.mock.calls.length > 0 });
        });

        playbackStore.getState().setAudioSrc('blob:web-song');

        expect(api.stop).toHaveBeenCalledTimes(1);
        expect(playbackStore.getState()).toMatchObject({ playbackRoute: 'web', audioSrc: 'blob:web-song' });
        expect(seenByLaterSubscriber.length).toBeGreaterThan(0);
        expect(seenByLaterSubscriber.every(seen => seen.route === 'web' && seen.stopped)).toBe(true);
        expect(track()).toMatchObject({ current: null, loadState: 'idle' });
        expect(shim.currentSrc).toBe('');
        expect(engine.responder.has(sourceKey)).toBe(false);

        expect(playback.leaveHifiRoute()).toBe(false);
        expect(api.stop).toHaveBeenCalledTimes(1);
    });

    it('leaves the route when Stage takes over, or when someone sets the route back to web', async () => {
        const { playback, playbackStore, api, track } = await setup();
        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });

        playbackStore.getState().setActivePlaybackContext('stage');
        expect(api.stop).toHaveBeenCalledTimes(1);
        expect(playbackStore.getState().playbackRoute).toBe('web');
        expect(track().current).toBeNull();

        playbackStore.setState({ activePlaybackContext: 'main' });
        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });
        playbackStore.getState().setPlaybackRoute('web');
        expect(api.stop).toHaveBeenCalledTimes(2);
        expect(track().current).toBeNull();
    });

    it('cancels a begin still waiting on its load', async () => {
        const { playback, playbackStore, api, track } = await setup();
        const load = deferred<HifiLoadResult>();
        api.load.mockImplementationOnce(() => load.promise);

        const outcome = playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });
        playbackStore.getState().setAudioSrc('blob:web-song');
        load.resolve({ ok: true, state: engineState({ trackKey: 'local:song-1#late', seq: 5 }) });

        expect(await outcome).toBe('superseded');
        expect(track()).toMatchObject({ current: null, loadState: 'idle' });
        expect(playbackStore.getState().playbackRoute).toBe('web');
    });

    it('leaveHifiRoute releases mpv once and is idempotent', async () => {
        const { playback, playbackStore, api } = await setup();
        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });

        expect(playback.leaveHifiRoute()).toBe(true);
        expect(playback.leaveHifiRoute()).toBe(false);
        expect(api.stop).toHaveBeenCalledTimes(1);
        expect(playbackStore.getState()).toMatchObject({ playbackRoute: 'web', audioSrc: null });
        expect(playback.isHifiRoute()).toBe(false);
    });
});

describe('clock and shim driving', () => {
    it('installs once and reads the shim time from the playback clock', async () => {
        const { playback, api, shim } = await setup();
        playback.installHifiPlayback();
        await playback.whenHifiRuntimeKnown();
        expect(api.onState).toHaveBeenCalledTimes(1);
        expect(api.getRuntimeStatus).toHaveBeenCalledTimes(1);

        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 30 });
        expect(shim.currentTime).toBe(30);
    });

    it('follows pushed state and clock for the current track only', async () => {
        const { playback, push, nextSeq, shim, track } = await setup();
        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });
        const trackKey = track().current!.trackKey;
        const events = record(shim);
        const state = (overrides: Partial<HifiEngineState>) => engineState({ trackKey, songKey: 'local:song-1', seq: nextSeq(), ...overrides });

        push.state?.(state({ status: 'playing', paused: false, durationSec: 180 }));
        expect(events).toEqual(['durationchange', 'loadedmetadata', 'play', 'playing']);
        expect(shim).toMatchObject({ paused: false, duration: 180, readyState: 1 });

        push.clock?.({ trackKey, positionSec: 10, paused: false, reason: 'tick', seq: 2, sampledAtMs: Date.now() });
        expect(playback.getHifiPosition()).toBeGreaterThanOrEqual(10);
        expect(playback.getHifiPosition()).toBeLessThan(11);

        // 主进程 400 ms 前读到的 10.2 s：补上路上的 400 ms，不把画面拉回 10.2。
        push.clock?.({ trackKey, positionSec: 10.2, paused: false, reason: 'tick', seq: 3, sampledAtMs: Date.now() - 400 });
        expect(playback.getHifiPosition()).toBeGreaterThanOrEqual(10.6);
        expect(playback.getHifiPosition()).toBeLessThan(10.7);

        push.clock?.({ trackKey, positionSec: 60, paused: true, reason: 'seek', seq: 3, sampledAtMs: Date.now() });
        // 还在放：和 <audio> 一样跳完再补一次 playing。
        expect(events.slice(-2)).toEqual(['seeked', 'playing']);
        expect(playback.getHifiPosition()).toBe(60);

        // 被换下的那首（这里冒充成主进程的预载项）推来的状态和时钟都不理。
        push.state?.(state({ trackKey: 'local:other#x', next: { trackKey, songKey: 'local:song-1' }, status: 'paused' }));
        push.clock?.({ trackKey: 'local:other#x', positionSec: 5, paused: true, reason: 'seek', seq: 4, sampledAtMs: Date.now() });
        expect(shim.paused).toBe(false);
        expect(playback.getHifiPosition()).toBe(60);

        push.state?.(state({ status: 'paused', paused: true, durationSec: 180 }));
        expect(events.at(-1)).toBe('pause');

        push.state?.(state({ status: 'ended', paused: true, durationSec: 180 }));
        expect(events.at(-1)).toBe('ended');
        expect(shim.ended).toBe(true);
        expect(playback.getHifiPosition()).toBe(180);
    });

    it('updates the shim and clock optimistically on transport calls and does not repeat events on the echo', async () => {
        const { playback, push, nextSeq, api, shim, track } = await setup();
        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });
        const trackKey = track().current!.trackKey;
        const events = record(shim);

        expect(playback.hifiTransport.isPaused()).toBe(true);
        await playback.hifiTransport.resume();
        expect(api.play).toHaveBeenCalledTimes(1);
        expect(playback.hifiTransport.isPaused()).toBe(false);
        push.state?.(engineState({ trackKey, status: 'playing', paused: false, seq: nextSeq() }));
        expect(events).toEqual(['play', 'playing']);

        void playback.hifiTransport.seek(90);
        expect(api.seek).toHaveBeenCalledWith(90);
        expect(playback.hifiPlaybackClock.state()).toMatchObject({ baseSec: 90, paused: true });
        push.clock?.({ trackKey, positionSec: 90, paused: false, reason: 'resume', seq: 5, sampledAtMs: Date.now() });
        expect(playback.hifiPlaybackClock.state()).toMatchObject({ baseSec: 90, paused: false });

        await playback.hifiTransport.pause();
        expect(api.pause).toHaveBeenCalledTimes(1);
        expect(playback.hifiPlaybackClock.state().paused).toBe(true);
        push.state?.(engineState({ trackKey, status: 'paused', paused: true, seq: nextSeq() }));
        expect(events.filter(type => type === 'pause')).toHaveLength(1);
    });

    it('does nothing off the HiFi route', async () => {
        const { playback, api } = await setup();
        await playback.hifiTransport.resume();
        await playback.hifiTransport.pause();
        await playback.hifiTransport.seek(10);
        expect(api.play).not.toHaveBeenCalled();
        expect(api.pause).not.toHaveBeenCalled();
        expect(api.seek).not.toHaveBeenCalled();
        expect(playback.hifiTransport.isPaused()).toBe(true);
    });
});

describe('a restore without a play intent (deferLoad)', () => {
    const restoredSong = () => ({ ...localPlaybackSong(), durationMs: 200_000 }) as SongResult;

    it('shows the track at the restore position without loading it, then loads where the clock is on the first call', async () => {
        const { playback, api, shim, track } = await setup();

        expect(await playback.beginHifiTrack({
            song: restoredSong(), source: localSource(), startSec: 42, adoptRunning: true, deferLoad: true,
        })).toBe('deferred');

        expect(api.load).not.toHaveBeenCalled();
        const current = track().current!;
        expect(track()).toMatchObject({ loadState: 'deferred', current: { songKey: 'local:song-1' } });
        expect(playback.getHifiPosition()).toBe(42);
        expect(shim).toMatchObject({ paused: true, duration: 200, readyState: 1, currentSrc: `hifi:${current.trackKey}` });
        // Nothing of another song was held by mpv (the snapshot is idle): nothing to stop.
        expect(api.stop).not.toHaveBeenCalled();

        // A seek before the first play moves the clock; the load starts there.
        playback.hifiPlaybackClock.sync({ positionSec: 90, paused: true });
        const outcome = playback.loadDeferredHifiTrack();
        expect(track().loadState).toBe('loading');
        expect(api.load).toHaveBeenCalledWith(expect.objectContaining({
            trackKey: current.trackKey,
            source: expect.objectContaining({ kind: 'local', sourceKey: current.localSourceKey }),
            startSec: 90,
            paused: true,
        }));
        expect(await outcome).toBe('ready');
        expect(track()).toMatchObject({ loadState: 'ready', current: { trackKey: current.trackKey } });

        expect(await playback.loadDeferredHifiTrack()).toBeNull();
        expect(api.load).toHaveBeenCalledTimes(1);
    });

    it('stops what mpv still holds of another song, and its load is dropped by a newer begin or a route leave', async () => {
        const { playback, playbackStore, api, track } = await setup();
        api.getSnapshot.mockResolvedValueOnce(engineState({ status: 'ended', trackKey: 'local:other#x', songKey: 'local:other', seq: 9 }));

        expect(await playback.beginHifiTrack({
            song: restoredSong(), source: localSource(), startSec: 0, adoptRunning: true, deferLoad: true,
        })).toBe('deferred');
        expect(api.stop).toHaveBeenCalledTimes(1);

        await playback.beginHifiTrack({ song: localPlaybackSong('b'), source: localSource(), startSec: 0 });
        expect(await playback.loadDeferredHifiTrack()).toBeNull();
        expect(api.load).toHaveBeenCalledTimes(1);
        expect(track().current?.songKey).toBe('local:b');

        await playback.beginHifiTrack({ song: restoredSong(), source: localSource(), startSec: 0, deferLoad: true });
        playbackStore.getState().setAudioSrc('blob:web-song');
        expect(await playback.loadDeferredHifiTrack()).toBeNull();
        expect(api.load).toHaveBeenCalledTimes(1);
    });

    it('still takes over the same song when mpv plays it', async () => {
        const { playback, api, track } = await setup();
        api.getSnapshot.mockResolvedValueOnce(engineState({
            status: 'paused', trackKey: 'local:song-1#before', songKey: 'local:song-1', localSourceKey: 'a'.repeat(32), seq: 9,
        }));

        expect(await playback.beginHifiTrack({
            song: restoredSong(), source: localSource(), startSec: 3, adoptRunning: true, deferLoad: true,
        })).toBe('adopted');
        expect(track()).toMatchObject({ loadState: 'ready', current: { trackKey: 'local:song-1#before' } });
        expect(api.stop).not.toHaveBeenCalled();
    });
});

describe('DEVICE_BUSY right after the Web engine', () => {
    const busy: HifiLoadResult = { ok: false, errorCode: 'DEVICE_BUSY', detail: 'busy' };
    const fromTheWeb = async () => {
        const context = await setup();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        context.playbackStore.setState({ playbackRoute: 'web', audioSrc: 'blob:web-song' });
        return context;
    };

    it('loads again up to three times, 1.5 s apart, while the attempt is current', async () => {
        const { playback, api, track } = await fromTheWeb();
        api.load.mockResolvedValueOnce(busy).mockResolvedValueOnce(busy);

        const outcome = playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 4 });
        await vi.advanceTimersByTimeAsync(0);
        expect(api.load).toHaveBeenCalledTimes(1);
        expect(track().loadState).toBe('loading');
        await vi.advanceTimersByTimeAsync(1499);
        expect(api.load).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(api.load).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1500);
        expect(api.load).toHaveBeenCalledTimes(3);

        expect(await outcome).toBe('ready');
        const trackKey = track().current!.trackKey;
        expect(api.load.mock.calls.map(([request]) => [request.trackKey, request.startSec])).toEqual([
            [trackKey, 4], [trackKey, 4], [trackKey, 4],
        ]);
        expect(track()).toMatchObject({ loadState: 'ready', loadError: null });
    });

    it('fails with DEVICE_BUSY after the third retry', async () => {
        const { playback, api, track } = await fromTheWeb();
        api.load.mockResolvedValue(busy);

        const outcome = playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });
        await vi.advanceTimersByTimeAsync(4500);
        expect(await outcome).toBe('failed');
        expect(api.load).toHaveBeenCalledTimes(4);
        expect(track()).toMatchObject({ loadState: 'failed', loadError: 'DEVICE_BUSY' });
    });

    it('does not retry other failures, a busy device long after the Web engine, or one that never followed it', async () => {
        const { playback, playbackStore, api } = await fromTheWeb();
        api.load.mockResolvedValueOnce({ ok: false, errorCode: 'DEVICE_UNAVAILABLE' });
        expect(await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 })).toBe('failed');
        expect(api.load).toHaveBeenCalledTimes(1);

        // The answer comes 7 s after the route left the Web source.
        playbackStore.setState({ playbackRoute: 'web', audioSrc: 'blob:web-song' });
        api.load.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(busy), 7000)));
        const late = playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });
        await vi.advanceTimersByTimeAsync(7000);
        expect(await late).toBe('failed');
        expect(api.load).toHaveBeenCalledTimes(2);

        // From HiFi to HiFi: no Web engine had the device.
        api.load.mockResolvedValueOnce(busy);
        const hifiToHifi = playback.beginHifiTrack({ song: localPlaybackSong('b'), source: localSource(), startSec: 0 });
        await vi.advanceTimersByTimeAsync(0);
        expect(await hifiToHifi).toBe('failed');
        expect(api.load).toHaveBeenCalledTimes(3);
    });

    it('stops retrying once the route leaves HiFi', async () => {
        const { playback, playbackStore, api, track } = await fromTheWeb();
        api.load.mockResolvedValue(busy);

        const outcome = playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0 });
        await vi.advanceTimersByTimeAsync(0);
        playbackStore.getState().setAudioSrc('blob:another-web-song');
        await vi.advanceTimersByTimeAsync(4500);
        expect(await outcome).toBe('superseded');
        expect(api.load).toHaveBeenCalledTimes(1);
        expect(track().current).toBeNull();
    });
});

describe('the track keeps its play\'s answer to "still wanted"', () => {
    it('on a fresh load and on an adopted track', async () => {
        const { playback, api, track } = await setup();
        const stillWanted = () => false;
        await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0, stillWanted });
        expect(track().current?.stillWanted).toBe(stillWanted);

        api.getSnapshot.mockResolvedValueOnce(engineState({
            status: 'playing', paused: false, trackKey: 'local:song-1#before', songKey: 'local:song-1', localSourceKey: 'a'.repeat(32), seq: 9,
        }));
        const restoreWanted = () => true;
        expect(await playback.beginHifiTrack({
            song: localPlaybackSong(), source: localSource(), startSec: 0, adoptRunning: true, stillWanted: restoreWanted,
        })).toBe('adopted');
        expect(track().current?.stillWanted).toBe(restoreWanted);
    });
});

describe('a track an earlier window left playing', () => {
    const leftPlaying = (overrides: Partial<HifiEngineState> = {}) => engineState({
        status: 'playing', paused: false, trackKey: 'local:song-1#old', songKey: 'local:song-1', localSourceKey: 'a'.repeat(32), seq: 7, ...overrides,
    });

    it('is stopped when this window starts a Web source instead, once', async () => {
        const { playback, playbackStore, api } = await setup({ install: false });
        api.getSnapshot.mockResolvedValueOnce(leftPlaying());
        playback.installHifiPlayback();
        await flush();
        expect(api.stop).not.toHaveBeenCalled();

        playbackStore.getState().setAudioSrc('blob:web-song');
        expect(api.stop).toHaveBeenCalledTimes(1);
        playbackStore.getState().setAudioSrc('blob:next-web-song');
        expect(api.stop).toHaveBeenCalledTimes(1);
    });

    it('is stopped as soon as the snapshot comes when the Web source came first', async () => {
        const { playback, playbackStore, api } = await setup({ install: false });
        const snapshot = deferred<HifiEngineState>();
        api.getSnapshot.mockReturnValueOnce(snapshot.promise);
        playback.installHifiPlayback();
        playbackStore.getState().setAudioSrc('blob:web-song');
        expect(api.stop).not.toHaveBeenCalled();

        snapshot.resolve(leftPlaying({ status: 'ended' }));
        await flush();
        expect(api.stop).toHaveBeenCalledTimes(1);
    });

    it('is stopped by releaseUnclaimedHifiTrack after a restore that took nothing over', async () => {
        const { playback, api } = await setup({ install: false });
        api.getSnapshot.mockResolvedValueOnce(leftPlaying());
        playback.installHifiPlayback();
        await flush();

        expect(playback.releaseUnclaimedHifiTrack('restore failed')).toBe(true);
        expect(api.stop).toHaveBeenCalledTimes(1);
        expect(playback.releaseUnclaimedHifiTrack('restore failed')).toBe(false);
        expect(api.stop).toHaveBeenCalledTimes(1);
    });

    it('is left alone once this window took it over', async () => {
        const { playback, api } = await setup({ install: false });
        api.getSnapshot.mockResolvedValue(leftPlaying());
        playback.installHifiPlayback();
        await flush();

        expect(await playback.beginHifiTrack({ song: localPlaybackSong(), source: localSource(), startSec: 0, adoptRunning: true })).toBe('adopted');
        expect(playback.releaseUnclaimedHifiTrack('restore stale')).toBe(false);
        expect(api.stop).not.toHaveBeenCalled();
    });

    it('is forgotten once mpv moved on from it', async () => {
        const { playback, api, push, nextSeq } = await setup({ install: false });
        api.getSnapshot.mockResolvedValueOnce(leftPlaying());
        playback.installHifiPlayback();
        await flush();

        push.state?.(engineState({ status: 'idle', trackKey: null, seq: nextSeq() + 10 }));
        expect(playback.releaseUnclaimedHifiTrack('restore failed')).toBe(false);
        expect(api.stop).not.toHaveBeenCalled();
    });
});
