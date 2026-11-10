import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import type {
    HifiClockUpdate,
    HifiEngineState,
    HifiErrorEvent,
    HifiLoadRequest,
    HifiReadRequest,
    HifiRuntimeStatus,
} from '@/types/hifi';
import type { HifiApi } from '@/services/hifi/hifiEngine';

// test/unit/hifi/hifiGapless.test.ts
// 无缝接播的服务一侧（hifiGapless + beginHifiTrack 的认领）：预载请求的形状和前提、主进程不肯排时、撤掉、预载和撤掉一个接一个发、
// mpv 接上时换成当前曲目（上一首不报 ended、文件撤掉）、playSong 认领它不重新载入、换了别的歌照常载入、预载着时按了下一首，
// 以及接管上一个窗口的那一首时撤掉它排着的下一首。

vi.mock('@/stores/useAudioSettingsStore', () => ({ useAudioSettingsStore: { getState: () => ({ loopMode: 'off' }) } }));
vi.mock('@/services/hifi/sourceSpec', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/hifi/sourceSpec')>()),
    readLocalSourceSpec: vi.fn(async () => null),
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

const playbackSong = (id: string) => ({ id, name: id, isLocal: true, localRef: { songId: id }, sourceRef: { kind: 'local', mediaId: id } }) as unknown as SongResult;
const sourceFor = (id: string, bytes = [1, 2, 3]) => ({
    kind: 'local' as const,
    localSong: { id, fileName: `${id}.flac`, filePath: `Music/${id}.flac`, mimeType: 'audio/flac' } as LocalSong,
    file: new Blob([new Uint8Array(bytes)], { type: 'audio/flac' }),
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

const makeApi = () => {
    const push: {
        state?: (state: HifiEngineState) => void;
        clock?: (update: HifiClockUpdate) => void;
        error?: (event: HifiErrorEvent) => void;
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
        getRuntimeStatus: vi.fn<HifiApi['getRuntimeStatus']>(async () => runtimeStatus),
        detectRuntime: vi.fn(async () => runtimeStatus),
        pickRuntimePath: vi.fn(async () => null),
        installRuntime: vi.fn<HifiApi['installRuntime']>(async () => ({ ok: true, errorCode: null, status: runtimeStatus })),
        cancelInstall: vi.fn(async () => undefined),
        configure: vi.fn<HifiApi['configure']>(async () => undefined),
        listDevices: vi.fn(async () => []),
        load: vi.fn<HifiApi['load']>(async (request: HifiLoadRequest) => ({
            ok: true,
            state: engineState({
                status: 'paused',
                trackKey: request.trackKey,
                songKey: request.songKey,
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
        preloadNext: vi.fn<HifiApi['preloadNext']>(async () => true),
        clearNext: vi.fn<HifiApi['clearNext']>(async () => undefined),
        getSnapshot: vi.fn<HifiApi['getSnapshot']>(async () => engineState({ status: 'idle', seq: 1 })),
        probeOutput: vi.fn<HifiApi['probeOutput']>(async () => null),
        respondRead: vi.fn<HifiApi['respondRead']>(async () => undefined),
        onState: subscribe('state'),
        onClock: subscribe('clock'),
        onError: subscribe('error'),
        onInstallProgress: vi.fn(() => () => {}),
        onReadRequest: subscribe('read'),
    } satisfies HifiApi;
    return { api, push, nextSeq };
};

let shims: Array<{ reset: () => void }> = [];

const setup = async () => {
    vi.resetModules();
    const sourceSpec = await import('@/services/hifi/sourceSpec');
    const [playback, engineModule, shimModule, playbackStore] = await Promise.all([
        import('@/services/hifi/hifiPlayback'),
        import('@/services/hifi/hifiEngine'),
        import('@/services/hifi/hifiMediaShim'),
        import('@/stores/usePlaybackStore'),
    ]);
    const fake = makeApi();
    vi.stubGlobal('window', { electron: { hifi: fake.api } });
    playback.installHifiPlayback();
    shims.push(shimModule.hifiMediaShim);
    const track = () => playback.useHifiTrackStore.getState();

    /** 起播一首并让主进程报它在放。 */
    const startPlaying = async (id: string) => {
        await playback.beginHifiTrack({ song: playbackSong(id), source: sourceFor(id), startSec: 0 });
        const current = track().current!;
        fake.push.state?.(engineState({
            status: 'playing', paused: false, trackKey: current.trackKey, songKey: current.songKey,
            localSourceKey: current.localSourceKey, durationSec: 180, positionSec: 170, seq: fake.nextSeq(),
        }));
        return current;
    };

    /** 主进程报 mpv 接上了排着的那一首。 */
    const pushSwitchTo = (trackKey: string, songKey: string, localSourceKey: string | null) => {
        fake.push.state?.(engineState({
            status: 'playing', paused: false, trackKey, songKey, localSourceKey, durationSec: 200, positionSec: 0.1, seq: fake.nextSeq(),
        }));
    };

    return {
        ...fake,
        playback,
        engine: engineModule.hifiEngine,
        shim: shimModule.hifiMediaShim,
        playbackStore: playbackStore.usePlaybackStore,
        readSpec: sourceSpec.readLocalSourceSpec as Mock<typeof sourceSpec.readLocalSourceSpec>,
        track,
        startPlaying,
        pushSwitchTo,
    };
};

const record = (target: EventTarget) => {
    const events: string[] = [];
    for (const type of ['play', 'playing', 'pause', 'ended', 'loadedmetadata', 'durationchange']) {
        target.addEventListener(type, () => events.push(type));
    }
    return events;
};

beforeAll(async () => {
    await import('@/services/hifi/sourceSpec');
    await import('@/services/hifi/hifiPlayback');
}, 60_000);

beforeEach(() => {
    shims = [];
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    shims.forEach(shim => shim.reset());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('preloadNextHifiTrack', () => {
    it('registers the next file under its own sourceKey and asks main to append it after the current track', async () => {
        const { playback, api, engine, track, startPlaying } = await setup();
        await startPlaying('a');
        const source = sourceFor('b', [9, 9, 9, 9]);

        expect(await playback.preloadNextHifiTrack({ song: playbackSong('b'), source })).toBe(true);

        const next = track().next!;
        expect(next).toMatchObject({ songKey: 'local:b', origin: 'local', source });
        expect(next.trackKey).toMatch(/^local:b#[0-9a-f]{12}$/);
        expect(next.localSourceKey).toMatch(/^[0-9a-f]{32}$/);
        expect(api.preloadNext).toHaveBeenCalledWith({
            trackKey: next.trackKey,
            songKey: 'local:b',
            source: { kind: 'local', sourceKey: next.localSourceKey, size: 4, mimeType: 'audio/flac', fileName: 'b.flac' },
            startSec: 0,
            paused: false,
            loopFile: false,
        });
        expect(engine.responder.has(next.localSourceKey!)).toBe(true);
        // The current track stays what it was; the next one only waits.
        expect(track().current?.songKey).toBe('local:a');

        // The same song again is already queued: no second request.
        expect(await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') })).toBe(true);
        expect(api.preloadNext).toHaveBeenCalledTimes(1);
    });

    it('queues nothing while the current track is not ready, off the HiFi route, or for the song that is playing', async () => {
        const { playback, api, playbackStore, track, startPlaying } = await setup();
        expect(await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') })).toBe(false);

        const load = deferred<Awaited<ReturnType<HifiApi['load']>>>();
        api.load.mockReturnValueOnce(load.promise);
        void playback.beginHifiTrack({ song: playbackSong('a'), source: sourceFor('a'), startSec: 0 });
        expect(track().loadState).toBe('loading');
        expect(await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') })).toBe(false);
        load.resolve({ ok: false, errorCode: 'LOAD_FAILED', detail: 'superseded' });
        await flush();

        await startPlaying('a');
        expect(await playback.preloadNextHifiTrack({ song: playbackSong('a'), source: sourceFor('a') })).toBe(false);

        playbackStore.setState({ audioSrc: 'blob:web' });
        expect(await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') })).toBe(false);
        expect(api.preloadNext).not.toHaveBeenCalled();
    });

    it('does not queue behind a track that changed while the request waited its turn', async () => {
        const { playback, api, track, startPlaying } = await setup();
        await startPlaying('a');
        const firstAnswer = deferred<boolean>();
        api.preloadNext.mockReturnValueOnce(firstAnswer.promise);
        const first = playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') });
        // Asked for behind 'a'; it waits for the request before it.
        const asked = playback.preloadNextHifiTrack({ song: playbackSong('c'), source: sourceFor('c') });
        await flush();
        // 'x' takes the place of 'a' and is ready before the queued request runs.
        await startPlaying('x');
        firstAnswer.resolve(true);
        expect(await first).toBe(false);
        expect(await asked).toBe(false);
        expect(api.preloadNext).toHaveBeenCalledTimes(1);
        expect(track().next).toBeNull();
    });

    it('forgets a song main would not queue, unregisters its file and does not ask again behind the same track', async () => {
        const { playback, api, engine, track, startPlaying } = await setup();
        await startPlaying('a');
        api.preloadNext.mockResolvedValueOnce(false);
        const registered = vi.spyOn(engine.responder, 'register');

        expect(await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') })).toBe(false);
        const sourceKey = registered.mock.calls[0][0];
        expect(track().next).toBeNull();
        expect(engine.responder.has(sourceKey)).toBe(false);

        expect(await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') })).toBe(false);
        expect(api.preloadNext).toHaveBeenCalledTimes(1);
        // Another song is another question.
        expect(await playback.preloadNextHifiTrack({ song: playbackSong('c'), source: sourceFor('c') })).toBe(true);
    });

    it('replaces a queued song by clearing it first', async () => {
        const { playback, api, engine, track, startPlaying } = await setup();
        await startPlaying('a');
        await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') });
        const queuedB = track().next!;

        expect(await playback.preloadNextHifiTrack({ song: playbackSong('c'), source: sourceFor('c') })).toBe(true);
        expect(api.clearNext).toHaveBeenCalledTimes(1);
        expect(api.clearNext.mock.invocationCallOrder[0]).toBeLessThan(api.preloadNext.mock.invocationCallOrder[1]);
        expect(engine.responder.has(queuedB.localSourceKey!)).toBe(false);
        expect(track().next?.songKey).toBe('local:c');
    });
});

describe('clearNextHifiTrack', () => {
    it('asks main to drop the queued song and unregisters its file; a late state for it switches nothing', async () => {
        const { playback, api, engine, track, startPlaying, pushSwitchTo } = await setup();
        const a = await startPlaying('a');
        await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') });
        const next = track().next!;

        await playback.clearNextHifiTrack();
        expect(api.clearNext).toHaveBeenCalledTimes(1);
        expect(track().next).toBeNull();
        expect(engine.responder.has(next.localSourceKey!)).toBe(false);

        pushSwitchTo(next.trackKey, next.songKey, next.localSourceKey);
        expect(track().current?.trackKey).toBe(a.trackKey);
        // Nothing queued: nothing to clear.
        await playback.clearNextHifiTrack();
        expect(api.clearNext).toHaveBeenCalledTimes(1);
    });

    it('still switches when mpv moved on to the song before the clear reached main, and keeps its file', async () => {
        const { playback, api, engine, track, startPlaying, pushSwitchTo } = await setup();
        await startPlaying('a');
        await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') });
        const next = track().next!;
        const cleared = deferred<void>();
        api.clearNext.mockReturnValueOnce(cleared.promise);

        const clearing = playback.clearNextHifiTrack();
        await flush();
        pushSwitchTo(next.trackKey, next.songKey, next.localSourceKey);
        expect(track().current).toMatchObject({ trackKey: next.trackKey, promotedByGapless: true });
        cleared.resolve();
        await clearing;
        expect(engine.responder.has(next.localSourceKey!)).toBe(true);
    });

    it('waits for a preload still on its way before it asks main to clear', async () => {
        const { playback, api, track, startPlaying } = await setup();
        await startPlaying('a');
        const answer = deferred<boolean>();
        api.preloadNext.mockReturnValueOnce(answer.promise);

        const preloading = playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') });
        const clearing = playback.clearNextHifiTrack();
        await flush();
        expect(api.preloadNext).toHaveBeenCalledTimes(1);
        expect(api.clearNext).not.toHaveBeenCalled();

        answer.resolve(true);
        expect(await preloading).toBe(true);
        await clearing;
        expect(api.clearNext).toHaveBeenCalledTimes(1);
        expect(track().next).toBeNull();
    });
});

describe('the gapless switch', () => {
    it('makes the queued song current when mpv starts it: no ended for the previous one, its file goes, the clock follows', async () => {
        const { playback, engine, shim, track, readSpec, startPlaying, pushSwitchTo } = await setup();
        const a = await startPlaying('a');
        const source = sourceFor('b');
        await playback.preloadNextHifiTrack({ song: playbackSong('b'), source });
        const next = track().next!;
        const events = record(shim);

        pushSwitchTo(next.trackKey, next.songKey, next.localSourceKey);

        expect(track()).toMatchObject({
            loadState: 'ready',
            next: null,
            current: { trackKey: next.trackKey, songKey: 'local:b', localSourceKey: next.localSourceKey, promotedByGapless: true },
        });
        expect(events).not.toContain('ended');
        expect(events).toEqual(expect.arrayContaining(['play', 'playing', 'loadedmetadata']));
        expect(shim).toMatchObject({ currentSrc: `hifi:${next.trackKey}`, paused: false, ended: false, duration: 200 });
        expect(playback.getHifiPosition()).toBeGreaterThanOrEqual(0.1);
        expect(playback.getHifiPosition()).toBeLessThan(1);
        expect(engine.responder.has(a.localSourceKey!)).toBe(false);
        expect(engine.responder.has(next.localSourceKey!)).toBe(true);
        expect(readSpec).toHaveBeenLastCalledWith(source.file, 'b.flac');
        // A track waiting for its play to take it over gets nothing queued behind it.
        expect(await playback.preloadNextHifiTrack({ song: playbackSong('c'), source: sourceFor('c') })).toBe(false);
    });

    it('is adopted by the play that lands on its song: no load, the play\'s song object and its stillWanted', async () => {
        const { playback, api, track, startPlaying, pushSwitchTo } = await setup();
        await startPlaying('a');
        await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') });
        const next = track().next!;
        pushSwitchTo(next.trackKey, next.songKey, next.localSourceKey);
        const unified = { ...playbackSong('b'), name: 'B, as playSong built it' } as SongResult;
        const stillWanted = () => true;

        const outcome = playback.beginHifiTrack({ song: unified, source: sourceFor('b'), startSec: 0, stillWanted });
        // Settled before the first await: onPlay* writes the player state right after this call.
        expect(track().current).toMatchObject({ trackKey: next.trackKey, promotedByGapless: false, song: unified });
        expect(await outcome).toBe('adopted');
        expect(track().current?.stillWanted).toBe(stillWanted);
        expect(track().loadState).toBe('ready');
        expect(api.load).toHaveBeenCalledTimes(1);
    });

    it('is replaced by an ordinary load when the play lands on another song', async () => {
        const { playback, api, engine, track, startPlaying, pushSwitchTo } = await setup();
        await startPlaying('a');
        await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') });
        const next = track().next!;
        pushSwitchTo(next.trackKey, next.songKey, next.localSourceKey);

        expect(await playback.beginHifiTrack({ song: playbackSong('c'), source: sourceFor('c'), startSec: 0 })).toBe('ready');
        expect(api.load).toHaveBeenCalledTimes(2);
        expect(api.load.mock.calls[1][0]).toMatchObject({ songKey: 'local:c' });
        expect(track().current).toMatchObject({ songKey: 'local:c' });
        expect(track().current?.promotedByGapless).toBeUndefined();
        expect(engine.responder.has(next.localSourceKey!)).toBe(false);
    });

    it('a user next while a song is queued loads it afresh and drops the queued entry on both sides', async () => {
        const { playback, api, engine, track, startPlaying, pushSwitchTo } = await setup();
        await startPlaying('a');
        await playback.preloadNextHifiTrack({ song: playbackSong('b'), source: sourceFor('b') });
        const queued = track().next!;

        expect(await playback.beginHifiTrack({ song: playbackSong('b'), source: sourceFor('b'), startSec: 0 })).toBe('ready');
        const loaded = api.load.mock.calls[1][0];
        expect(loaded.songKey).toBe('local:b');
        expect(loaded.trackKey).not.toBe(queued.trackKey);
        expect(track().next).toBeNull();
        // The load (replace) dropped main's queued entry; the renderer's file for it goes once that load settled.
        expect(engine.responder.has(queued.localSourceKey!)).toBe(false);
        // A late state for the dropped entry is nobody's.
        pushSwitchTo(queued.trackKey, queued.songKey, queued.localSourceKey);
        expect(track().current?.trackKey).toBe(loaded.trackKey);
    });

    it('a window that takes over a running track drops the next song an earlier window queued', async () => {
        const { playback, api, track } = await setup();
        api.getSnapshot.mockResolvedValueOnce(engineState({
            status: 'playing',
            paused: false,
            trackKey: 'local:a#before',
            songKey: 'local:a',
            localSourceKey: 'a'.repeat(32),
            next: { trackKey: 'local:b#before', songKey: 'local:b' },
            seq: 50,
        }));

        expect(await playback.beginHifiTrack({ song: playbackSong('a'), source: sourceFor('a'), startSec: 0, adoptRunning: true })).toBe('adopted');
        expect(api.clearNext).toHaveBeenCalledTimes(1);
        expect(track().next).toBeNull();
    });
});
