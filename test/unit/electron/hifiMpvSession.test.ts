import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    HifiClockUpdate,
    HifiDevice,
    HifiEngineConfig,
    HifiEngineState,
    HifiErrorEvent,
    HifiLoadRequest,
    HifiLoadResult,
} from '../../../src/types/hifi';

// 钉住 mpv 会话的状态机：假 mpv 子进程按 request_id 回话、推事件，覆盖载入落定、走带、时钟节流、无缝接续、停止和退出、崩溃熔断。

type Json = Record<string, unknown>;
type MpvRequest = { command: unknown[]; request_id: number };

interface MpvSession {
    configure: (config: Partial<HifiEngineConfig>) => Promise<void>;
    listDevices: () => Promise<HifiDevice[]>;
    load: (request: HifiLoadRequest, options?: { ownerId?: number | null }) => Promise<HifiLoadResult>;
    play: () => Promise<void>;
    pause: () => Promise<void>;
    seek: (positionSec: number) => Promise<void>;
    stop: () => Promise<void>;
    setLoopFile: (loop: boolean) => Promise<void>;
    preloadNext: (request: HifiLoadRequest, options?: { ownerId?: number | null }) => Promise<boolean>;
    clearNext: () => Promise<void>;
    getSnapshot: () => HifiEngineState;
    dispose: () => Promise<void>;
    killSync: () => void;
}

const require = createRequire(import.meta.url);
const { createMpvSession, OBSERVED_PROPERTIES, listAlsaHwDevices } = require('../../../electron/hifi/mpvSession.cjs') as {
    createMpvSession: (options: Record<string, unknown>) => MpvSession;
    OBSERVED_PROPERTIES: readonly string[];
    listAlsaHwDevices: (cardsText: string, pcmText: string) => HifiDevice[];
};

const OUT_PARAMS = { samplerate: 96000, 'channel-count': 2, channels: 'stereo', 'hr-channels': 'stereo', format: 's32' };
const TRACK_LIST = [{
    id: 1,
    type: 'audio',
    selected: true,
    codec: 'flac',
    'codec-desc': 'FLAC (Free Lossless Audio Codec)',
    decoder: 'flac',
    'demux-samplerate': 96000,
    'demux-channel-count': 2,
    'format-name': 's32',
}];

// mpv 那一端的 IPC 连接：记下会话写来的每条命令，按 request_id 在下一个微任务里回话；事件和属性变化由测试推。
class FakeMpvSocket extends EventEmitter {
    requests: MpvRequest[] = [];
    props: Record<string, unknown> = {};
    /** 这些命令不回话（模拟 mpv 卡死）。 */
    silent = new Set<string>();
    /** 这些命令回 mpv 的错误。 */
    failing = new Set<string>();
    nextEntryId = 1;
    writableFinished = false;
    ended = false;

    write(chunk: string | Buffer, callback?: (error?: Error | null) => void) {
        for (const line of String(chunk).split('\n')) {
            if (!line.trim()) continue;
            const request = JSON.parse(line) as MpvRequest;
            this.requests.push(request);
            if (!this.silent.has(String(request.command[0]))) queueMicrotask(() => this.answer(request));
        }
        callback?.();
        return true;
    }

    end() {
        this.ended = true;
        this.writableFinished = true;
    }

    destroy() {}

    answer({ command, request_id: requestId }: MpvRequest) {
        const [name, ...args] = command;
        if (this.failing.has(String(name))) {
            this.feed({ request_id: requestId, error: 'invalid parameter' });
            return;
        }
        if (name === 'loadfile') {
            this.reply(requestId, { data: { playlist_entry_id: this.nextEntryId++ } });
            return;
        }
        if (name === 'get_property') {
            const value = this.props[String(args[0])];
            this.reply(requestId, value === undefined ? { error: 'property unavailable' } : { data: value });
            return;
        }
        this.reply(requestId, {});
    }

    reply(requestId: number, fields: Json) {
        this.feed({ request_id: requestId, error: 'success', ...fields });
    }

    feed(message: Json) {
        this.emit('data', Buffer.from(`${JSON.stringify(message)}\n`));
    }

    event(name: string, fields: Json = {}) {
        this.feed({ event: name, ...fields });
    }

    prop(name: string, data?: unknown) {
        const observe = this.requests.find(request => request.command[0] === 'observe_property' && request.command[2] === name);
        if (!observe) throw new Error(`${name} is not observed`);
        this.feed({ event: 'property-change', id: observe.command[1], name, ...(data === undefined ? {} : { data }) });
    }

    hangUp() {
        this.emit('end');
        this.emit('close');
    }

    commands(name: string) {
        return this.requests.filter(request => request.command[0] === name).map(request => request.command);
    }
}

class FakeChild extends EventEmitter {
    socket = new FakeMpvSocket();
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    stdio: unknown[] = [null, this.stdout, this.stderr, this.socket];
    pid = 4242;
    killed = false;
    kill = vi.fn(() => {
        this.killed = true;
        return true;
    });

    exit(code: number | null = 0, signal: string | null = null) {
        this.emit('exit', code, signal);
    }
}

const createFakeBridge = () => {
    let counter = 0;
    const errors = new Map<string, string>();
    return {
        errors,
        start: vi.fn(async () => {}),
        registerLocal: vi.fn((source: { fileName: string }) => {
            counter += 1;
            return { token: `tok${counter}`, url: `http://127.0.0.1:9/tok${counter}/${source.fileName}` };
        }),
        registerRemote: vi.fn((source: { fileName: string }) => {
            counter += 1;
            return { token: `tok${counter}`, url: `http://127.0.0.1:9/tok${counter}/${source.fileName}` };
        }),
        revoke: vi.fn(),
        revokeAll: vi.fn(),
        getSourceError: vi.fn((token: string) => errors.get(token) ?? null),
    };
};

const flush = async () => {
    for (let round = 0; round < 60; round += 1) await Promise.resolve();
};

const localRequest = (trackKey: string, overrides: Partial<HifiLoadRequest> = {}): HifiLoadRequest => ({
    trackKey,
    songKey: trackKey.split('#')[0],
    source: { kind: 'local', sourceKey: `key-${trackKey.replace(/[^A-Za-z0-9]/g, '')}`, size: 1000, mimeType: 'audio/flac', fileName: 'song.flac' },
    startSec: 0,
    paused: false,
    loopFile: false,
    ...overrides,
});

type HarnessOptions = Record<string, unknown> & { onSpawn?: (child: FakeChild) => void };

const createHarness = ({ onSpawn, ...overrides }: HarnessOptions = {}) => {
    const children: FakeChild[] = [];
    const spawnFn = vi.fn((_path: string, _args: string[], _options: Json) => {
        const child = new FakeChild();
        children.push(child);
        onSpawn?.(child);
        return child;
    });
    const bridge = createFakeBridge();
    const states: HifiEngineState[] = [];
    const clocks: HifiClockUpdate[] = [];
    const errors: HifiErrorEvent[] = [];
    const resolveRuntime = vi.fn(async () => ({ path: '/usr/bin/mpv', version: '0.41.0' }));
    const session = createMpvSession({
        spawnFn,
        platform: 'linux',
        resolveRuntime,
        bridge,
        onState: (state: HifiEngineState) => states.push(state),
        onClock: (update: HifiClockUpdate) => clocks.push(update),
        onError: (event: HifiErrorEvent) => errors.push(event),
        logInfo: () => {},
        logWarn: () => {},
        // 不碰这台机器真的 /proc/asound：要 ALSA 设备的测试自己给。
        readFileFn: async (file: string) => {
            throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
        },
        ...overrides,
    });
    const child = () => children[children.length - 1];
    const mpv = () => child().socket;
    const lastState = () => states[states.length - 1];
    return { session, children, child, mpv, spawnFn, bridge, states, clocks, errors, lastState, resolveRuntime };
};

type Harness = ReturnType<typeof createHarness>;

// mpv 开始放第 id 项：start-file → file-loaded → playback-restart，输出参数先放进 get_property 的答案里。
const startEntry = async (harness: Harness, id: number, { outParams = OUT_PARAMS as unknown } = {}) => {
    const mpv = harness.mpv();
    mpv.props['audio-params'] = OUT_PARAMS;
    if (outParams === undefined) delete mpv.props['audio-out-params'];
    else mpv.props['audio-out-params'] = outParams;
    mpv.props['track-list'] = TRACK_LIST;
    mpv.event('start-file', { playlist_entry_id: id });
    mpv.event('file-loaded');
    mpv.event('playback-restart');
    await flush();
};

const loadAndStart = async (harness: Harness, request: HifiLoadRequest, id: number) => {
    const result = harness.session.load(request, { ownerId: 7 });
    await flush();
    await startEntry(harness, id);
    return result;
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('mpv session: spawn and load', () => {
    it('spawns mpv on the first load only, with the fd 3 socketpair, log subscription and every observed property', async () => {
        const harness = createHarness();
        expect(harness.spawnFn).not.toHaveBeenCalled();
        const first = await loadAndStart(harness, localRequest('local:a#1'), 1);
        expect((await first).ok).toBe(true);

        expect(harness.spawnFn).toHaveBeenCalledTimes(1);
        const [path, args, options] = harness.spawnFn.mock.calls[0];
        expect(path).toBe('/usr/bin/mpv');
        expect(args).toContain('--input-ipc-client=fd://3');
        expect(args).toContain('--audio-exclusive=no');
        expect(args.some(arg => arg.startsWith('--ao='))).toBe(false);
        expect(options).toEqual({ stdio: ['ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
        expect(harness.mpv().commands('request_log_messages')).toEqual([['request_log_messages', 'warn']]);
        expect(harness.mpv().commands('observe_property').map(command => command[2])).toEqual([...OBSERVED_PROPERTIES]);

        const second = await loadAndStart(harness, localRequest('local:b#2'), 2);
        expect((await second).ok).toBe(true);
        expect(harness.spawnFn).toHaveBeenCalledTimes(1);
    });

    it('registers the source, sets pause and loop-file, then loadfile replace with start=', async () => {
        const harness = createHarness();
        const request = localRequest('local:a#1', { startSec: 12.5, paused: true, loopFile: true });
        const result = harness.session.load(request, { ownerId: 7 });
        await flush();

        expect(harness.bridge.start).toHaveBeenCalled();
        expect(harness.bridge.registerLocal).toHaveBeenCalledWith({
            sourceKey: request.source.kind === 'local' ? request.source.sourceKey : '',
            size: 1000,
            mimeType: 'audio/flac',
            fileName: 'song.flac',
            ownerId: 7,
        });
        const commands = harness.mpv().requests.map(entry => entry.command)
            .filter(command => command[0] !== 'observe_property' && command[0] !== 'request_log_messages');
        expect(commands).toEqual([
            ['set_property', 'pause', true],
            ['set_property', 'loop-file', 'inf'],
            ['loadfile', 'http://127.0.0.1:9/tok1/song.flac', 'replace', -1, 'start=12.5'],
        ]);
        expect(harness.lastState()).toMatchObject({ status: 'loading', trackKey: 'local:a#1', songKey: 'local:a', positionSec: 12.5 });
        await startEntry(harness, 1);
        expect(await result).toMatchObject({ ok: true });
    });

    it('resolves only once audio-out-params is known for this entry, and returns the state', async () => {
        const harness = createHarness();
        let settled: HifiLoadResult | null = null;
        void harness.session.load(localRequest('local:a#1', { paused: true }), { ownerId: 7 }).then(result => {
            settled = result;
        });
        await flush();
        const mpv = harness.mpv();
        mpv.event('start-file', { playlist_entry_id: 1 });
        mpv.event('file-loaded');
        await flush();
        expect(settled).toBeNull();

        // 输出开起来了（换格式时 mpv 会推 audio-out-params）。
        mpv.prop('audio-params', OUT_PARAMS);
        mpv.prop('audio-out-params', OUT_PARAMS);
        await flush();
        expect(settled).toMatchObject({
            ok: true,
            state: {
                status: 'paused',
                trackKey: 'local:a#1',
                sourceKind: 'local',
                localSourceKey: 'key-locala1',
                audioOutParams: { samplerate: 96000, channelCount: 2, channels: 'stereo', format: 's32' },
                paused: true,
            },
        });
    });

    it('same-format replace: reads audio-out-params on playback-restart because mpv does not push it again', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const result = await loadAndStart(harness, localRequest('local:b#2'), 2);
        expect(result).toMatchObject({ ok: true, state: { trackKey: 'local:b#2', status: 'playing' } });
        expect(harness.lastState().track).toMatchObject({ codec: 'flac', demuxSamplerate: 96000 });
    });

    it('end-file error with a busy log line fails the load as DEVICE_BUSY and revokes the token', async () => {
        const harness = createHarness();
        const result = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        const mpv = harness.mpv();
        mpv.event('start-file', { playlist_entry_id: 1 });
        mpv.event('file-loaded');
        mpv.event('playback-restart');
        mpv.event('log-message', { prefix: 'ao/alsa', level: 'error', text: 'Playback open error: Device or resource busy\n' });
        mpv.event('log-message', { prefix: 'cplayer', level: 'error', text: 'Could not open/initialize audio device -> no sound.\n' });
        mpv.event('end-file', { reason: 'error', playlist_entry_id: 1, file_error: 'audio output initialization failed' });
        await flush();

        expect(await result).toEqual({ ok: false, errorCode: 'DEVICE_BUSY', detail: 'audio output initialization failed' });
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok1');
        expect(harness.lastState()).toMatchObject({ status: 'error', errorCode: 'DEVICE_BUSY', trackKey: 'local:a#1', processRunning: true });
        // 载入的失败经结果报，不再另推 hifi:error。
        expect(harness.errors).toEqual([]);
    });

    // 输出开不起来：mpv 先报 playback-restart，再报两行错，最后 end-file error。
    const failToOpenOutput = async (harness: Harness, id: number, busy: boolean) => {
        const mpv = harness.mpv();
        mpv.event('start-file', { playlist_entry_id: id });
        mpv.event('file-loaded');
        mpv.event('playback-restart');
        if (busy) mpv.event('log-message', { prefix: 'ao/wasapi', level: 'error', text: 'Error opening device: AUDCLNT_E_DEVICE_IN_USE\n' });
        mpv.event('log-message', { prefix: 'cplayer', level: 'error', text: 'Could not open/initialize audio device -> no sound.\n' });
        mpv.event('end-file', { reason: 'error', playlist_entry_id: id, file_error: 'audio output initialization failed' });
        await flush();
    };

    it('a quick second load right after DEVICE_BUSY plays, with nothing left over from the failed one', async () => {
        // Windows：渲染端刚从 Web 引擎切过来，Chromium 隔几秒才放开它的共享流，渲染端过一会儿重试同一首。
        const harness = createHarness({ idleExitMs: 1000 });
        const first = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        await failToOpenOutput(harness, 1, true);
        expect(await first).toMatchObject({ ok: false, errorCode: 'DEVICE_BUSY' });
        expect(harness.lastState()).toMatchObject({ status: 'error', audioOutParams: null, processRunning: true });

        await vi.advanceTimersByTimeAsync(500);
        const retry = harness.session.load(localRequest('local:a#2'), { ownerId: 7 });
        await flush();
        expect(harness.lastState()).toMatchObject({ status: 'loading', errorCode: null, trackKey: 'local:a#2', audioOutParams: null });
        expect(harness.mpv().commands('loadfile').map(command => command.slice(0, 3))).toEqual([
            ['loadfile', 'http://127.0.0.1:9/tok1/song.flac', 'replace'],
            ['loadfile', 'http://127.0.0.1:9/tok2/song.flac', 'replace'],
        ]);
        await startEntry(harness, 2);
        expect(await retry).toMatchObject({ ok: true, state: { status: 'playing', trackKey: 'local:a#2', errorCode: null, circuitOpen: false } });
        // 同一个 mpv 接着用；失败不算崩溃，也没另推 hifi:error；失败后起的空闲计时被这次载入取消了。
        expect(harness.spawnFn).toHaveBeenCalledTimes(1);
        expect(harness.errors).toEqual([]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(harness.mpv().commands('quit')).toEqual([]);
        expect(harness.lastState()).toMatchObject({ status: 'playing', trackKey: 'local:a#2' });
    });

    it('the busy log lines of a failed load do not decide the next one', async () => {
        const harness = createHarness();
        const first = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        await failToOpenOutput(harness, 1, true);
        expect(await first).toMatchObject({ errorCode: 'DEVICE_BUSY' });
        const second = harness.session.load(localRequest('local:a#2'), { ownerId: 7 });
        await flush();
        await failToOpenOutput(harness, 2, false);
        expect(await second).toMatchObject({ ok: false, errorCode: 'DEVICE_UNAVAILABLE' });
    });

    it('the loaded line names the output driver even when current-ao has not been pushed yet', async () => {
        const logInfo = vi.fn();
        const harness = createHarness({ logInfo });
        const loadedLines = () => logInfo.mock.calls.map(args => String(args[0])).filter(line => line.startsWith('[HiFi] loaded'));
        const first = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        // mpv 的输出已经开着，只是 current-ao 的变化还没推到。
        harness.mpv().props['current-ao'] = 'pipewire';
        await startEntry(harness, 1);
        expect(await first).toMatchObject({ ok: true });
        await flush();
        expect(loadedLines()).toEqual(['[HiFi] loaded local local:a#1 -> pipewire 96000 Hz s32 stereo']);

        // 已经知道了：照样写，不再问。
        harness.mpv().prop('current-ao', 'pipewire');
        await loadAndStart(harness, localRequest('local:b#2'), 2);
        await flush();
        expect(loadedLines()).toEqual([
            '[HiFi] loaded local local:a#1 -> pipewire 96000 Hz s32 stereo',
            '[HiFi] loaded local local:b#2 -> pipewire 96000 Hz s32 stereo',
        ]);
        expect(harness.mpv().commands('get_property').filter(command => command[1] === 'current-ao')).toHaveLength(1);
    });

    it('the bridge\'s recorded source error wins over mpv\'s file_error', async () => {
        const harness = createHarness();
        const result = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        harness.bridge.errors.set('tok1', 'SOURCE_REJECTED');
        harness.mpv().event('start-file', { playlist_entry_id: 1 });
        harness.mpv().event('end-file', { reason: 'error', playlist_entry_id: 1, file_error: 'loading failed' });
        await flush();
        expect(await result).toMatchObject({ ok: false, errorCode: 'SOURCE_REJECTED' });
    });

    it('a newer load supersedes a pending one', async () => {
        const harness = createHarness();
        const first = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        const second = harness.session.load(localRequest('local:b#2'), { ownerId: 7 });
        expect(await first).toEqual({ ok: false, errorCode: 'LOAD_FAILED', detail: 'superseded' });
        await flush();
        expect(harness.mpv().commands('loadfile').map(command => command[1])).toEqual([
            'http://127.0.0.1:9/tok1/song.flac',
            'http://127.0.0.1:9/tok2/song.flac',
        ]);
        // 旧的那一项开始又被停掉，它的事件不影响新的。
        harness.mpv().event('start-file', { playlist_entry_id: 1 });
        harness.mpv().event('end-file', { reason: 'error', playlist_entry_id: 1, file_error: 'loading failed' });
        await startEntry(harness, 2);
        expect(await second).toMatchObject({ ok: true, state: { trackKey: 'local:b#2' } });
        expect(harness.lastState().errorCode).toBeNull();
    });

    it('times out after loadTimeoutMs, stops mpv and reports LOAD_FAILED', async () => {
        const harness = createHarness();
        const result = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        await vi.advanceTimersByTimeAsync(20000);
        expect(await result).toEqual({ ok: false, errorCode: 'LOAD_FAILED', detail: 'timeout' });
        expect(harness.mpv().commands('stop')).toEqual([['stop']]);
        expect(harness.lastState()).toMatchObject({ status: 'error', errorCode: 'LOAD_FAILED' });
    });

    it('reports MPV_NOT_FOUND without spawning when there is no runtime', async () => {
        const harness = createHarness({ resolveRuntime: async () => null });
        expect(await harness.session.load(localRequest('local:a#1'))).toEqual({ ok: false, errorCode: 'MPV_NOT_FOUND' });
        expect(harness.spawnFn).not.toHaveBeenCalled();
    });

    it('reports MPV_SPAWN_FAILED when the process dies before IPC is up', async () => {
        const harness = createHarness({
            onSpawn: child => {
                child.socket.silent.add('observe_property');
                queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
            },
        });
        const result = harness.session.load(localRequest('local:a#1'));
        expect(await result).toMatchObject({ ok: false, errorCode: 'MPV_SPAWN_FAILED' });
        expect(harness.child().kill).toHaveBeenCalled();
    });

    it('Windows: random pipe name on the command line, then connectPipe', async () => {
        const sockets: FakeMpvSocket[] = [];
        const connectPipe = vi.fn(async () => {
            const socket = new FakeMpvSocket();
            sockets.push(socket);
            return socket;
        });
        const harness = createHarness({
            platform: 'win32',
            connectPipe,
            randomBytes: (size: number) => Buffer.alloc(size, 0xab),
        });
        const result = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        const pipe = `\\\\.\\pipe\\folia-hifi-${'ab'.repeat(16)}`;
        const [, args, options] = harness.spawnFn.mock.calls[0];
        expect(args).toContain(`--input-ipc-server=${pipe}`);
        expect(args).not.toContain('--input-ipc-client=fd://3');
        expect(options).toEqual({ stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        expect(connectPipe).toHaveBeenCalledWith(pipe, expect.objectContaining({ signal: expect.any(AbortSignal) }));
        const socket = sockets[0];
        socket.props['audio-out-params'] = OUT_PARAMS;
        socket.event('start-file', { playlist_entry_id: 1 });
        socket.event('playback-restart');
        await flush();
        expect(await result).toMatchObject({ ok: true });
    });
});

describe('mpv session: transport and clock', () => {
    it('pause / play / seek send the matching commands; seek pushes a stopped clock at once and a running one at playback-restart', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        await harness.session.pause();
        await harness.session.play();
        harness.clocks.length = 0;
        await harness.session.seek(42.5);
        expect(mpv.commands('set_property').slice(-2)).toEqual([['set_property', 'pause', true], ['set_property', 'pause', false]]);
        expect(mpv.commands('seek')).toEqual([['seek', 42.5, 'absolute']]);
        // mpv 还在找位置：时钟按停着报，渲染端不往前外推。
        expect(harness.clocks).toEqual([{ trackKey: 'local:a#1', positionSec: 42.5, paused: true, reason: 'seek', seq: expect.any(Number), sampledAtMs: expect.any(Number) }]);
        // 状态里不算暂停：播放键不该在每次跳转时闪一下。
        await flush();
        expect(harness.lastState()).toMatchObject({ status: 'playing', paused: false });

        await vi.advanceTimersByTimeAsync(400);
        mpv.prop('time-pos', 42.5);
        expect(harness.clocks.at(-1)).toMatchObject({ reason: 'tick', paused: true });
        harness.clocks.length = 0;
        mpv.event('playback-restart');
        expect(harness.clocks).toEqual([{ trackKey: 'local:a#1', positionSec: 42.5, paused: false, reason: 'resume', seq: expect.any(Number), sampledAtMs: expect.any(Number) }]);
        // 跳完的那次已经推过了，下一个 time-pos 照常节流。
        mpv.prop('time-pos', 42.51);
        expect(harness.clocks).toHaveLength(1);
    });

    it('a seek while paused stays paused through playback-restart', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1', { paused: true }), 1);
        harness.mpv().prop('pause', true);
        harness.clocks.length = 0;
        await harness.session.seek(10);
        harness.mpv().event('playback-restart');
        expect(harness.clocks.map(({ reason, paused, positionSec }) => ({ reason, paused, positionSec }))).toEqual([
            { reason: 'seek', paused: true, positionSec: 10 },
            { reason: 'seek', paused: true, positionSec: 10 },
        ]);
    });

    it('a seek mpv refuses releases the clock at once instead of waiting for a playback-restart that never comes', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        harness.mpv().failing.add('seek');
        harness.clocks.length = 0;
        await harness.session.seek(5);
        expect(harness.clocks.map(({ reason, paused }) => ({ reason, paused }))).toEqual([
            { reason: 'seek', paused: true },
            { reason: 'seek', paused: false },
        ]);
    });

    it('reports a paused clock while mpv waits for its cache, without calling it a pause', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        mpv.prop('time-pos', 3);
        harness.clocks.length = 0;
        const statesBefore = harness.states.length;

        mpv.prop('paused-for-cache', true);
        expect(harness.clocks).toEqual([{ trackKey: 'local:a#1', positionSec: 3, paused: true, reason: 'tick', seq: expect.any(Number), sampledAtMs: expect.any(Number) }]);
        // 缓存见底期间推的 tick 也是停着的。
        await vi.advanceTimersByTimeAsync(300);
        mpv.prop('time-pos', 3.01);
        expect(harness.clocks.at(-1)).toMatchObject({ paused: true });

        mpv.prop('paused-for-cache', false);
        expect(harness.clocks.at(-1)).toMatchObject({ reason: 'tick', paused: false });
        await flush();
        expect(harness.states.length).toBe(statesBefore);
        expect(harness.lastState()).toMatchObject({ status: 'playing', paused: false });
    });

    it('stamps each clock push with when its time-pos was read, not when the trailing timer sent it', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        mpv.prop('time-pos', 1);
        harness.clocks.length = 0;

        await vi.advanceTimersByTimeAsync(100);
        const readAt = Date.now();
        mpv.prop('time-pos', 1.1);
        expect(harness.clocks).toEqual([]);
        await vi.advanceTimersByTimeAsync(300);
        expect(harness.clocks).toEqual([expect.objectContaining({ reason: 'tick', positionSec: 1.1, sampledAtMs: readAt })]);
        expect(Date.now()).toBeGreaterThan(readAt);
    });

    it('throttles time-pos to at most 4 pushes a second, but pushes the first value after a restart and pause flips at once', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        harness.clocks.length = 0;
        // 跳转后的第一个 time-pos 不等节流窗口。
        mpv.prop('time-pos', 0.01);
        expect(harness.clocks.map(update => update.reason)).toEqual(['load']);

        harness.clocks.length = 0;
        for (let step = 1; step <= 50; step += 1) {
            await vi.advanceTimersByTimeAsync(20);
            mpv.prop('time-pos', 0.01 + step * 0.02);
        }
        const ticks = harness.clocks.filter(update => update.reason === 'tick');
        expect(ticks.length).toBeGreaterThanOrEqual(3);
        expect(ticks.length).toBeLessThanOrEqual(4);
        // 节流窗口里最后的位置由尾随定时器补上。
        await vi.advanceTimersByTimeAsync(250);
        expect(harness.clocks[harness.clocks.length - 1].positionSec).toBeCloseTo(1.01, 5);

        harness.clocks.length = 0;
        mpv.prop('pause', true);
        expect(harness.clocks).toEqual([expect.objectContaining({ reason: 'pause', paused: true })]);
        mpv.prop('pause', false);
        expect(harness.clocks[1]).toMatchObject({ reason: 'resume', paused: false });

        harness.clocks.length = 0;
        await vi.advanceTimersByTimeAsync(50);
        mpv.event('playback-restart');
        mpv.prop('time-pos', 30);
        expect(harness.clocks).toEqual([expect.objectContaining({ reason: 'seek', positionSec: 30 })]);
    });

    it('coalesces the changes of one batch into a single state push with a rising seq', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const before = harness.states.length;
        const mpv = harness.mpv();
        mpv.prop('duration', 180);
        mpv.prop('volume', 100);
        mpv.prop('current-ao', 'alsa');
        await flush();
        expect(harness.states.length).toBe(before + 1);
        const state = harness.lastState();
        expect(state).toMatchObject({ durationSec: 180, currentAo: 'alsa' });
        expect(state.seq).toBeGreaterThan(harness.states[before - 1].seq);
    });

    it('eof-reached on the last entry reports ended; play then restarts from the top', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        harness.mpv().prop('eof-reached', true);
        await flush();
        expect(harness.lastState().status).toBe('ended');
        await harness.session.play();
        expect(harness.mpv().commands('seek')).toEqual([['seek', 0, 'absolute']]);
        expect(harness.mpv().commands('set_property').at(-1)).toEqual(['set_property', 'pause', false]);
    });

    it('the state reports volume 100 before mpv has said anything', async () => {
        const harness = createHarness();
        expect(harness.session.getSnapshot()).toMatchObject({ status: 'stopped', volume: 100 });
        // 软件音量的值要等 mpv 起来才下发，在那之前 mpv 会是 --volume=100。
        await harness.session.configure({ mpvPath: null, audioDevice: 'auto', exclusive: false, dsdMode: 'pcm', softwareVolume: true, volume: 0 });
        expect(harness.session.getSnapshot().volume).toBe(100);
    });

    it('setLoopFile sets loop-file inf / no', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        await harness.session.setLoopFile(true);
        await harness.session.setLoopFile(false);
        expect(harness.mpv().commands('set_property').slice(-2)).toEqual([
            ['set_property', 'loop-file', 'inf'],
            ['set_property', 'loop-file', 'no'],
        ]);
    });

    it('a loop change made while mpv is still starting wins over the value in the load request', async () => {
        let releaseRuntime: (runtime: { path: string; version: string }) => void = () => {};
        const harness = createHarness({
            resolveRuntime: () => new Promise(resolve => {
                releaseRuntime = resolve;
            }),
        });
        const result = harness.session.load(localRequest('local:a#1', { loopFile: false }), { ownerId: 7 });
        await flush();
        expect(harness.spawnFn).not.toHaveBeenCalled();
        // 用户在 mpv 拉起期间切到单曲循环。
        await harness.session.setLoopFile(true);
        releaseRuntime({ path: '/usr/bin/mpv', version: '0.41.0' });
        await flush();
        expect(harness.mpv().commands('set_property').filter(command => command[1] === 'loop-file')).toEqual([
            ['set_property', 'loop-file', 'inf'],
        ]);
        await startEntry(harness, 1);
        expect(await result).toMatchObject({ ok: true, state: { loopFile: true } });
    });
});

describe('mpv session: the source breaks off mid-play', () => {
    const playAt = async (harness: Harness, positionSec: number, durationSec: number | null) => {
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        if (durationSec !== null) harness.mpv().prop('duration', durationSec);
        harness.mpv().prop('time-pos', positionSec);
        await flush();
    };

    it('eof-reached well short of the duration with a bridge error is a fatal error, not the end', async () => {
        const harness = createHarness();
        await playAt(harness, 7.8, 30);
        harness.bridge.errors.set('tok1', 'SOURCE_UNREACHABLE');
        harness.mpv().prop('eof-reached', true);
        await flush();

        expect(harness.errors).toEqual([{ code: 'SOURCE_UNREACHABLE', trackKey: 'local:a#1', detail: 'source ended early', fatal: true }]);
        expect(harness.states.some(state => state.status === 'ended')).toBe(false);
        expect(harness.lastState()).toMatchObject({ status: 'error', errorCode: 'SOURCE_UNREACHABLE', trackKey: 'local:a#1', paused: true });
        // keep-open 还开着输出：停下，独占的设备放开。
        expect(harness.mpv().commands('stop')).toEqual([['stop']]);
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok1');
        // 失败之后 mpv 迟到的位置不再算进这一首。
        harness.clocks.length = 0;
        harness.mpv().prop('time-pos', 0.2);
        expect(harness.clocks).toEqual([]);
    });

    it('with the duration unknown a bridge error at eof is a failure too', async () => {
        const harness = createHarness();
        await playAt(harness, 12, null);
        harness.bridge.errors.set('tok1', 'SOURCE_REJECTED');
        harness.mpv().prop('eof-reached', true);
        await flush();
        expect(harness.errors).toEqual([expect.objectContaining({ code: 'SOURCE_REJECTED', fatal: true })]);
        expect(harness.lastState().status).toBe('error');
    });

    it('a bridge error with the position at the duration still ends normally', async () => {
        const harness = createHarness();
        await playAt(harness, 29.4, 30);
        harness.bridge.errors.set('tok1', 'SOURCE_UNREACHABLE');
        harness.mpv().prop('eof-reached', true);
        await flush();
        expect(harness.errors).toEqual([]);
        expect(harness.lastState()).toMatchObject({ status: 'ended', errorCode: null });
    });

    it('no bridge error: eof-reached short of the duration is still the end (a seek past the last frame)', async () => {
        const harness = createHarness();
        await playAt(harness, 7.8, 30);
        harness.mpv().prop('eof-reached', true);
        await flush();
        expect(harness.errors).toEqual([]);
        expect(harness.lastState().status).toBe('ended');
    });

    it('end-file eof with a song queued: fails the current one, drops the queued one and stops mpv', async () => {
        const harness = createHarness();
        await playAt(harness, 5, 30);
        expect(await harness.session.preloadNext(localRequest('local:b#2'))).toBe(true);
        harness.bridge.errors.set('tok1', 'SOURCE_UNREACHABLE');
        harness.mpv().event('end-file', { reason: 'eof', playlist_entry_id: 1 });
        // mpv 已经接上了预载项，这次 start-file 不再算数。
        harness.mpv().event('start-file', { playlist_entry_id: 2 });
        await flush();

        expect(harness.errors).toEqual([expect.objectContaining({ code: 'SOURCE_UNREACHABLE', trackKey: 'local:a#1', fatal: true })]);
        expect(harness.lastState()).toMatchObject({ status: 'error', trackKey: 'local:a#1', next: null });
        expect(harness.mpv().commands('stop')).toEqual([['stop']]);
        harness.mpv().event('end-file', { reason: 'stop', playlist_entry_id: 2 });
        await flush();
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok2');
    });

    it('end-file eof without a bridge error is an ordinary gapless switch', async () => {
        const harness = createHarness();
        await playAt(harness, 5, 30);
        await harness.session.preloadNext(localRequest('local:b#2'));
        harness.mpv().event('end-file', { reason: 'eof', playlist_entry_id: 1 });
        harness.mpv().event('start-file', { playlist_entry_id: 2 });
        await flush();
        expect(harness.errors).toEqual([]);
        expect(harness.lastState()).toMatchObject({ status: 'playing', trackKey: 'local:b#2' });
    });

    it('end-file error on the playing song stops mpv from moving on to the queued one', async () => {
        const harness = createHarness();
        await playAt(harness, 5, 30);
        await harness.session.preloadNext(localRequest('local:b#2'));
        harness.mpv().event('end-file', { reason: 'error', playlist_entry_id: 1, file_error: 'loading failed' });
        await flush();
        expect(harness.errors).toEqual([expect.objectContaining({ code: 'SOURCE_UNREACHABLE', trackKey: 'local:a#1', fatal: true })]);
        expect(harness.lastState()).toMatchObject({ status: 'error', next: null });
        expect(harness.mpv().commands('stop')).toEqual([['stop']]);
    });
});

describe('mpv session: gapless', () => {
    it('appends the next song, switches to it on its start-file and revokes the old token on its end-file', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const appended = harness.session.preloadNext(localRequest('local:b#2'), { ownerId: 7 });
        await flush();
        expect(await appended).toBe(true);
        expect(harness.mpv().commands('loadfile').at(-1)).toEqual(['loadfile', 'http://127.0.0.1:9/tok2/song.flac', 'append']);
        expect(harness.lastState()).toMatchObject({ trackKey: 'local:a#1', next: { trackKey: 'local:b#2', songKey: 'local:b' } });

        // 有下一首时放到头不算 ended。
        harness.mpv().prop('eof-reached', true);
        await flush();
        expect(harness.lastState().status).toBe('playing');

        harness.clocks.length = 0;
        harness.mpv().event('end-file', { reason: 'eof', playlist_entry_id: 1 });
        harness.mpv().event('start-file', { playlist_entry_id: 2 });
        await flush();
        expect(harness.lastState()).toMatchObject({ trackKey: 'local:b#2', songKey: 'local:b', next: null, status: 'playing' });
        expect(harness.clocks[0]).toMatchObject({ trackKey: 'local:b#2', reason: 'load', positionSec: 0 });
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok1');
        expect(harness.bridge.revoke).not.toHaveBeenCalledWith('tok2');
    });

    it('the switch does not carry the previous song\'s duration; an equal one mpv does not push again is read on playback-restart', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        mpv.prop('duration', 240);
        await harness.session.preloadNext(localRequest('local:b#2'));
        mpv.event('end-file', { reason: 'eof', playlist_entry_id: 1 });
        mpv.event('start-file', { playlist_entry_id: 2 });
        await flush();
        expect(harness.lastState()).toMatchObject({ trackKey: 'local:b#2', durationSec: null });

        mpv.props.duration = 240;
        mpv.event('playback-restart');
        await flush();
        expect(harness.lastState()).toMatchObject({ trackKey: 'local:b#2', durationSec: 240 });
    });

    it('replacing a queued song removes the old entry by playlist index; clearNext removes and revokes', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        expect(await harness.session.preloadNext(localRequest('local:b#2'))).toBe(true);
        mpv.props.playlist = [{ id: 1, current: true, playing: true }, { id: 2 }];
        expect(await harness.session.preloadNext(localRequest('local:c#3'))).toBe(true);
        await flush();
        expect(mpv.commands('playlist-remove')).toEqual([['playlist-remove', 1]]);
        expect(harness.lastState().next?.trackKey).toBe('local:c#3');

        mpv.props.playlist = [{ id: 1, current: true, playing: true }, { id: 3 }];
        await harness.session.clearNext();
        expect(mpv.commands('playlist-remove')).toEqual([['playlist-remove', 1], ['playlist-remove', 1]]);
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok3');
        await flush();
        expect(harness.lastState().next).toBeNull();
    });

    it('preloadNext needs a loaded current song', async () => {
        const harness = createHarness();
        expect(await harness.session.preloadNext(localRequest('local:b#2'))).toBe(false);
        expect(harness.spawnFn).not.toHaveBeenCalled();
    });

    it('preloadNext refuses once the current song is at its end (keep-open has paused it)', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        harness.mpv().prop('eof-reached', true);
        harness.mpv().prop('pause', true);
        await flush();
        expect(harness.lastState().status).toBe('ended');
        expect(await harness.session.preloadNext(localRequest('local:b#2'))).toBe(false);
        expect(harness.mpv().commands('loadfile')).toHaveLength(1);
        expect(harness.bridge.registerLocal).toHaveBeenCalledTimes(1);
    });

    it('an append that reaches mpv after the end unpauses the song it switches to', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        mpv.silent.add('loadfile');
        const appended = harness.session.preloadNext(localRequest('local:b#2'));
        await flush();
        // append 还在路上，当前这首先到了头：keep-open 把它停在暂停里。
        mpv.prop('eof-reached', true);
        mpv.prop('pause', true);
        const append = mpv.requests.filter(request => request.command[0] === 'loadfile').at(-1)!;
        mpv.answer(append);
        expect(await appended).toBe(true);
        expect(mpv.commands('set_property').at(-1)).toEqual(['set_property', 'pause', false]);
    });

    it('a pause the user pressed while the append was on its way is kept', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        mpv.silent.add('loadfile');
        const appended = harness.session.preloadNext(localRequest('local:b#2'));
        await flush();
        mpv.prop('eof-reached', true);
        await harness.session.pause();
        mpv.answer(mpv.requests.filter(request => request.command[0] === 'loadfile').at(-1)!);
        expect(await appended).toBe(true);
        expect(mpv.commands('set_property').at(-1)).toEqual(['set_property', 'pause', true]);
    });

    it('clearNext racing the switch: mpv starts the entry being removed, the song reports ended and keeps its own clock', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        mpv.prop('duration', 4);
        mpv.prop('time-pos', 3.9);
        expect(await harness.session.preloadNext(localRequest('local:b#2'))).toBe(true);
        mpv.props.playlist = [{ id: 1, current: true, playing: true }, { id: 2 }];
        // The removal is still on its way when mpv moves on: it plays the entry being removed.
        mpv.silent.add('playlist-remove');
        const clearing = harness.session.clearNext();
        await flush();
        harness.clocks.length = 0;
        mpv.event('end-file', { reason: 'eof', playlist_entry_id: 1 });
        mpv.event('start-file', { playlist_entry_id: 2 });
        mpv.prop('duration', 6);
        mpv.prop('time-pos', 0.2);
        await flush();

        expect(harness.lastState()).toMatchObject({ status: 'ended', trackKey: 'local:a#1', next: null, durationSec: 4 });
        expect(harness.clocks.filter(update => update.positionSec < 3.9)).toEqual([]);
        expect(await harness.session.preloadNext(localRequest('local:c#3'))).toBe(false);

        // The removal lands: mpv stops the removed entry and goes idle; the song stays ended.
        mpv.answer(mpv.requests.filter(request => request.command[0] === 'playlist-remove').at(-1)!);
        await clearing;
        mpv.event('end-file', { reason: 'stop', playlist_entry_id: 2 });
        mpv.event('idle');
        await flush();
        expect(harness.lastState()).toMatchObject({ status: 'ended', trackKey: 'local:a#1' });
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok2');
    });

    it('a new load drops the queued song too (replace clears the playlist)', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        await harness.session.preloadNext(localRequest('local:b#2'));
        await loadAndStart(harness, localRequest('local:c#3'), 3);
        expect(harness.lastState()).toMatchObject({ trackKey: 'local:c#3', next: null });
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok1');
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok2');
    });
});

describe('mpv session: stop and exit', () => {
    it('stop closes playback, revokes tokens, goes idle, then quits after idleExitMs and kills after 2 s', async () => {
        const harness = createHarness({ idleExitMs: 60000 });
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        await harness.session.stop();
        await flush();
        expect(harness.mpv().commands('stop')).toEqual([['stop']]);
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok1');
        expect(harness.lastState()).toMatchObject({ status: 'idle', trackKey: null, processRunning: true });

        await vi.advanceTimersByTimeAsync(59999);
        expect(harness.mpv().commands('quit')).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(harness.mpv().commands('quit')).toEqual([['quit']]);
        await flush();
        expect(harness.lastState()).toMatchObject({ status: 'stopped', processRunning: false });
        expect(harness.child().kill).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2000);
        expect(harness.child().kill).toHaveBeenCalledTimes(1);
        // 退出是我们要的，不算崩溃。
        harness.child().exit(0);
        expect(harness.errors).toEqual([]);
    });

    it('does not kill an mpv that quits within the grace period, and spawns a new one for the next load', async () => {
        const harness = createHarness({ idleExitMs: 1000 });
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        await harness.session.stop();
        await vi.advanceTimersByTimeAsync(1000);
        const first = harness.child();
        first.exit(0);
        await vi.advanceTimersByTimeAsync(2000);
        expect(first.kill).not.toHaveBeenCalled();
        const result = await loadAndStart(harness, localRequest('local:b#2'), 1);
        expect((await result).ok).toBe(true);
        expect(harness.spawnFn).toHaveBeenCalledTimes(2);
    });

    it('killSync kills the running and the quitting process at once and settles a pending load', async () => {
        const harness = createHarness({ idleExitMs: 1000 });
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        await harness.session.stop();
        await vi.advanceTimersByTimeAsync(1000);
        const quitting = harness.child();
        const pending = harness.session.load(localRequest('local:b#2'));
        await flush();
        const running = harness.child();
        expect(running).not.toBe(quitting);
        harness.session.killSync();
        expect(quitting.kill).toHaveBeenCalledTimes(1);
        expect(running.kill).toHaveBeenCalledTimes(1);
        expect(await pending).toEqual({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
        running.exit(null, 'SIGTERM');
        expect(harness.errors).toEqual([]);
    });

    it('a load cancelled by stop answers detail stopped, with mpv up and while it is still starting', async () => {
        const harness = createHarness();
        const whileUp = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        await harness.session.stop();
        expect(await whileUp).toEqual({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });

        let release: (runtime: { path: string; version: string }) => void = () => {};
        const slow = createHarness({
            resolveRuntime: () => new Promise(resolve => {
                release = resolve;
            }),
        });
        const whileStarting = slow.session.load(localRequest('local:b#2'), { ownerId: 7 });
        await flush();
        await slow.session.stop();
        expect(await whileStarting).toEqual({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
        release({ path: '/usr/bin/mpv', version: '0.41.0' });
        await flush();
        // 拉起照常落地，但没人要了：不发 loadfile，计空闲。
        expect(slow.mpv().commands('loadfile')).toEqual([]);
        expect(slow.errors).toEqual([]);
    });

    it('after killSync nothing spawns mpv again: load answers stopped, listDevices and preloadNext refuse', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        harness.session.killSync();
        expect(harness.child().kill).toHaveBeenCalledTimes(1);

        expect(await harness.session.load(localRequest('local:b#2'))).toEqual({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
        expect(await harness.session.listDevices()).toEqual([]);
        expect(await harness.session.preloadNext(localRequest('local:c#3'))).toBe(false);
        await flush();
        expect(harness.spawnFn).toHaveBeenCalledTimes(1);
        harness.child().exit(null, 'SIGTERM');
        expect(harness.errors).toEqual([]);
    });

    it('killSync while the runtime is being detected: the spawn never happens', async () => {
        let release: (runtime: { path: string; version: string }) => void = () => {};
        const harness = createHarness({
            resolveRuntime: () => new Promise(resolve => {
                release = resolve;
            }),
        });
        const result = harness.session.load(localRequest('local:a#1'));
        await flush();
        harness.session.killSync();
        expect(await result).toEqual({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
        release({ path: '/usr/bin/mpv', version: '0.41.0' });
        await flush();
        expect(harness.spawnFn).not.toHaveBeenCalled();
    });

    it('killSync while mpv is connecting kills it as soon as it lands and does not count a crash', async () => {
        const harness = createHarness({
            onSpawn: child => child.socket.silent.add('observe_property'),
        });
        const result = harness.session.load(localRequest('local:a#1'));
        await flush();
        const launching = harness.child();
        harness.session.killSync();
        expect(launching.kill).toHaveBeenCalledTimes(1);
        expect(await result).toEqual({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
        await flush();
        launching.exit(null, 'SIGTERM');
        expect(launching.kill).toHaveBeenCalledTimes(1);
        expect(harness.errors).toEqual([]);
        expect(harness.session.getSnapshot().circuitOpen).toBe(false);
    });

    it('killSync while the Windows pipe is being connected aborts the connect', async () => {
        let connectSignal: AbortSignal | null = null;
        const harness = createHarness({
            platform: 'win32',
            randomBytes: (size: number) => Buffer.alloc(size, 0xcd),
            connectPipe: vi.fn((_path: string, { signal }: { signal: AbortSignal }) => {
                connectSignal = signal;
                return new Promise(() => {});
            }),
        });
        const result = harness.session.load(localRequest('local:a#1'));
        await flush();
        harness.session.killSync();
        expect(connectSignal!.aborted).toBe(true);
        expect(harness.child().kill).toHaveBeenCalledTimes(1);
        expect(await result).toEqual({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
    });

    it('dispose asks mpv to quit', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const disposed = harness.session.dispose();
        expect(harness.mpv().commands('quit')).toEqual([['quit']]);
        harness.child().exit(0);
        await disposed;
        expect(harness.child().kill).not.toHaveBeenCalled();
    });
});

describe('mpv session: crashes', () => {
    it('an unexpected exit reports MPV_CRASHED, and the next load respawns', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const first = harness.child();
        first.exit(139, null);
        await flush();
        expect(harness.errors).toEqual([expect.objectContaining({ code: 'MPV_CRASHED', trackKey: 'local:a#1', fatal: true })]);
        expect(harness.lastState()).toMatchObject({ status: 'error', errorCode: 'MPV_CRASHED', processRunning: false });
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok1');

        const result = await loadAndStart(harness, localRequest('local:b#2'), 1);
        expect((await result).ok).toBe(true);
        expect(harness.spawnFn).toHaveBeenCalledTimes(2);
        expect(harness.lastState()).toMatchObject({ status: 'playing', errorCode: null });

        // 旧进程迟到的事件进不来。
        first.socket.prop('pause', true);
        first.socket.event('end-file', { reason: 'error', playlist_entry_id: 1, file_error: 'loading failed' });
        first.exit(1);
        await flush();
        expect(harness.lastState()).toMatchObject({ status: 'playing', trackKey: 'local:b#2', errorCode: null });
        expect(harness.errors).toHaveLength(1);
    });

    it('an IPC hang-up during a pending load fails it with MPV_CRASHED', async () => {
        const harness = createHarness();
        const result = harness.session.load(localRequest('local:a#1'));
        await flush();
        harness.mpv().hangUp();
        expect(await result).toMatchObject({ ok: false, errorCode: 'MPV_CRASHED' });
        expect(harness.errors[0]).toMatchObject({ code: 'MPV_CRASHED', trackKey: 'local:a#1' });
    });

    it('a command that times out kills the wedged mpv and counts as a crash', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        harness.mpv().silent.add('set_property');
        const paused = harness.session.pause();
        await vi.advanceTimersByTimeAsync(5000);
        await paused;
        expect(harness.child().kill).toHaveBeenCalled();
        expect(harness.errors).toEqual([expect.objectContaining({ code: 'IPC_TIMEOUT', fatal: true })]);
        expect(harness.lastState()).toMatchObject({ status: 'error', errorCode: 'IPC_TIMEOUT', processRunning: false });
    });

    it('opens the circuit after 3 crashes within 60 s', async () => {
        const harness = createHarness();
        for (let round = 1; round <= 3; round += 1) {
            await loadAndStart(harness, localRequest(`local:a#${round}`), 1);
            harness.child().exit(1);
            await flush();
            await vi.advanceTimersByTimeAsync(10000);
        }
        expect(harness.lastState().circuitOpen).toBe(true);
        expect(await harness.session.load(localRequest('local:b#9'))).toEqual({ ok: false, errorCode: 'CIRCUIT_OPEN' });
        expect(harness.spawnFn).toHaveBeenCalledTimes(3);
    });

    it('crashes spread over more than 60 s do not open the circuit', async () => {
        const harness = createHarness();
        for (let round = 1; round <= 3; round += 1) {
            await loadAndStart(harness, localRequest(`local:a#${round}`), 1);
            harness.child().exit(1);
            await flush();
            await vi.advanceTimersByTimeAsync(31000);
        }
        expect(harness.lastState().circuitOpen).toBe(false);
        const result = await loadAndStart(harness, localRequest('local:b#9'), 1);
        expect((await result).ok).toBe(true);
    });
});

describe('mpv session: configure and devices', () => {
    it('puts the config on the command line before the first spawn, with the device on auto', async () => {
        const harness = createHarness({ platform: 'darwin' });
        await harness.session.configure({ mpvPath: null, audioDevice: 'auto', exclusive: true, dsdMode: 'dop', softwareVolume: false, volume: 40 });
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const [, args] = harness.spawnFn.mock.calls[0];
        expect(args).toEqual(expect.arrayContaining(['--audio-device=auto', '--audio-exclusive=yes', '--audio-spdif=dsd', '--volume=100']));
        // 软件音量关着：不发 volume。
        expect(harness.mpv().commands('set_property').filter(command => command[1] === 'volume')).toEqual([]);
        expect(harness.lastState()).toMatchObject({ exclusive: true, spdif: 'dsd', volume: 100 });
    });

    it('applies changes live with set_property, only for what changed; volume is 100 unless software volume is on', async () => {
        const harness = createHarness({
            platform: 'darwin',
            onSpawn: child => {
                child.socket.props['audio-device-list'] = [
                    { name: 'auto', description: 'Autoselect device' },
                    { name: 'coreaudio/AppleUSBAudioEngine:D10', description: 'D10' },
                ];
            },
        });
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        const device = 'coreaudio/AppleUSBAudioEngine:D10';
        const before = mpv.commands('set_property').length;
        await harness.session.configure({ mpvPath: null, audioDevice: device, exclusive: true, dsdMode: 'dop', softwareVolume: false, volume: 30 });
        expect(mpv.commands('set_property').slice(before)).toEqual([
            ['set_property', 'audio-device', device],
            ['set_property', 'audio-exclusive', true],
            ['set_property', 'audio-spdif', 'dsd'],
        ]);
        await harness.session.configure({ mpvPath: null, audioDevice: device, exclusive: true, dsdMode: 'pcm', softwareVolume: true, volume: 30 });
        expect(mpv.commands('set_property').slice(before + 3)).toEqual([
            ['set_property', 'audio-spdif', ''],
            ['set_property', 'volume', 30],
        ]);
        await harness.session.configure({ mpvPath: null, audioDevice: device, exclusive: true, dsdMode: 'pcm', softwareVolume: false, volume: 30 });
        expect(mpv.commands('set_property').slice(before + 5)).toEqual([['set_property', 'volume', 100]]);
        await harness.session.configure({ mpvPath: null, audioDevice: device, exclusive: true, dsdMode: 'pcm', softwareVolume: false, volume: 70 });
        expect(mpv.commands('set_property').length).toBe(before + 6);
        // 设备没换：之后的设置不再读设备表。
        expect(mpv.commands('get_property').filter(command => command[1] === 'audio-device-list')).toHaveLength(1);
    });

    it('Linux: exclusive is never asked of mpv, on the command line or live', async () => {
        const harness = createHarness();
        await harness.session.configure({ mpvPath: null, audioDevice: 'auto', exclusive: true, dsdMode: 'pcm', softwareVolume: false, volume: 100 });
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const [, args] = harness.spawnFn.mock.calls[0];
        expect(args).toContain('--audio-exclusive=no');
        await harness.session.configure({ mpvPath: null, audioDevice: 'auto', exclusive: false, dsdMode: 'pcm', softwareVolume: false, volume: 100 });
        await harness.session.configure({ mpvPath: null, audioDevice: 'auto', exclusive: true, dsdMode: 'pcm', softwareVolume: false, volume: 100 });
        expect(harness.mpv().commands('set_property').filter(command => command[1] === 'audio-exclusive')).toEqual([]);
        expect(harness.lastState().exclusive).toBe(false);
    });

    it('lists devices from audio-device-list and marks only Linux hw: devices as direct (plughw converts behind mpv)', async () => {
        const harness = createHarness({
            idleExitMs: 1000,
            onSpawn: child => {
                child.socket.props['audio-device-list'] = [
                    { name: 'auto', description: 'Autoselect device' },
                    { name: 'pipewire', description: 'Default (pipewire)' },
                    { name: 'alsa/hw:CARD=D10,DEV=0', description: 'D10, USB Audio' },
                    { name: 'alsa/plughw:CARD=D10,DEV=0', description: 'D10, USB Audio (plug)' },
                ];
            },
        });
        expect(await harness.session.listDevices()).toEqual([
            { name: 'auto', description: 'Autoselect device', driver: 'auto', direct: false },
            { name: 'pipewire', description: 'Default (pipewire)', driver: 'pipewire', direct: false },
            { name: 'alsa/hw:CARD=D10,DEV=0', description: 'D10, USB Audio', driver: 'alsa', direct: true },
            { name: 'alsa/plughw:CARD=D10,DEV=0', description: 'D10, USB Audio (plug)', driver: 'alsa', direct: false },
        ]);
        // 只为列设备拉起的进程空闲后退出。
        await vi.advanceTimersByTimeAsync(1000);
        expect(harness.mpv().commands('quit')).toEqual([['quit']]);
    });

    it('sends the app\'s mute to mpv after spawn and live, whatever software volume says, and leaves volume at 100', async () => {
        const harness = createHarness();
        const config = { mpvPath: null, audioDevice: 'auto', exclusive: false, dsdMode: 'pcm' as const, softwareVolume: false, volume: 40 };
        await harness.session.configure({ ...config, muted: true });
        const result = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        // 启动参数里没有静音：拉起后头一条 set_property 就是它，排在 loadfile 前面。
        const sent = harness.mpv().requests.map(entry => entry.command)
            .filter(command => command[0] === 'set_property' || command[0] === 'loadfile');
        expect(sent[0]).toEqual(['set_property', 'mute', true]);
        expect(sent.at(-1)?.[0]).toBe('loadfile');
        expect(sent.filter(command => command[1] === 'volume')).toEqual([]);
        await startEntry(harness, 1);
        await result;

        const mpv = harness.mpv();
        const before = mpv.commands('set_property').length;
        await harness.session.configure({ ...config, muted: false });
        expect(mpv.commands('set_property').slice(before)).toEqual([['set_property', 'mute', false]]);
        await harness.session.configure({ ...config, softwareVolume: true, muted: true });
        expect(mpv.commands('set_property').slice(before + 1)).toEqual([
            ['set_property', 'volume', 40],
            ['set_property', 'mute', true],
        ]);
        await harness.session.configure({ ...config, softwareVolume: true, muted: true });
        expect(mpv.commands('set_property').length).toBe(before + 3);
    });
});

describe('mpv session: only devices mpv lists reach it', () => {
    const LIST = [
        { name: 'auto', description: 'Autoselect device' },
        { name: 'pipewire', description: 'Default (pipewire)' },
        { name: 'pipewire/alsa_output.usb-Topping_D10-00.analog-stereo', description: 'Topping D10' },
        { name: 'alsa/plughw:CARD=D10,DEV=0', description: 'Topping D10, USB Audio' },
    ];
    const config = (audioDevice: string, overrides: Partial<HifiEngineConfig> = {}) => ({
        mpvPath: null, audioDevice, exclusive: false, dsdMode: 'pcm' as const, softwareVolume: false, volume: 100, muted: false, ...overrides,
    });
    const deviceHarness = (list: Json[] = LIST) => {
        const logWarn = vi.fn();
        const harness = createHarness({
            logWarn,
            onSpawn: child => {
                child.socket.props['audio-device-list'] = list;
            },
            readFileFn: async (file: string) => {
                if (file === '/proc/asound/cards') return ALSA_CARDS;
                if (file === '/proc/asound/pcm') return ALSA_PCM;
                throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
            },
        });
        return { ...harness, logWarn };
    };
    const sentCommands = (harness: Harness) => harness.mpv().requests.map(request => request.command);
    const deviceListReads = (harness: Harness) => harness.mpv().commands('get_property').filter(command => command[1] === 'audio-device-list');

    it('spawns on auto, reads the device list, and switches to the configured device before the loadfile', async () => {
        const harness = deviceHarness();
        // hw: 设备 mpv 不列，是主进程从 /proc/asound 补的：也算表里有。
        for (const device of ['pipewire/alsa_output.usb-Topping_D10-00.analog-stereo', 'alsa/hw:CARD=D10,DEV=0']) {
            const run = deviceHarness();
            await run.session.configure(config(device));
            const result = run.session.load(localRequest('local:a#1'), { ownerId: 7 });
            await flush();
            const [, args] = run.spawnFn.mock.calls[0];
            expect(args.filter(arg => arg.startsWith('--audio-device='))).toEqual(['--audio-device=auto']);
            const sent = sentCommands(run).map(command => JSON.stringify(command));
            const listAt = sent.indexOf(JSON.stringify(['get_property', 'audio-device-list']));
            const setAt = sent.indexOf(JSON.stringify(['set_property', 'audio-device', device]));
            const loadAt = sent.findIndex(command => command.startsWith('["loadfile"'));
            expect(listAt, device).toBeGreaterThan(-1);
            expect(setAt, device).toBeGreaterThan(listAt);
            expect(loadAt, device).toBeGreaterThan(setAt);
            run.mpv().prop('audio-device', device);
            await startEntry(run, 1);
            expect((await result).ok).toBe(true);
            expect(run.lastState().audioDevice).toBe(device);
        }
        expect(harness.spawnFn).not.toHaveBeenCalled();
    });

    it('a device that is not in the list stays on auto and is logged; playback still starts', async () => {
        const harness = deviceHarness();
        await harness.session.configure(config('alsa/plughw:CARD=Gone,DEV=0'));
        const result = await loadAndStart(harness, localRequest('local:a#1'), 1);
        expect((await result).ok).toBe(true);
        expect(harness.mpv().commands('set_property').filter(command => command[1] === 'audio-device')).toEqual([]);
        expect(deviceListReads(harness)).toHaveLength(1);
        expect(harness.logWarn).toHaveBeenCalledWith('[HiFi] ignoring an audio device that is not in the device list: "alsa/plughw:CARD=Gone,DEV=0"');
        expect(harness.lastState().audioDevice).toBe('auto');
    });

    it('a load that arrives while mpv is still being configured waits for the device, so no loadfile reaches mpv before it', async () => {
        const device = 'pipewire/alsa_output.usb-Topping_D10-00.analog-stereo';
        // 拉起后读设备表那一问先不回：第二次载入正好落在“进程有了、设备还没发”的那一下。
        const harness = createHarness({
            onSpawn: child => {
                child.socket.props['audio-device-list'] = LIST;
                child.socket.silent.add('get_property');
            },
        });
        await harness.session.configure(config(device));
        const first = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        expect(deviceListReads(harness)).toHaveLength(1);
        const second = harness.session.load(localRequest('local:b#2'), { ownerId: 7 });
        await flush();
        const mpv = harness.mpv();
        mpv.silent.delete('get_property');
        mpv.requests.filter(request => request.command[0] === 'get_property').forEach(request => mpv.answer(request));
        await flush();
        const sent = sentCommands(harness).map(command => JSON.stringify(command));
        const setAt = sent.indexOf(JSON.stringify(['set_property', 'audio-device', device]));
        const loadAts = sent.flatMap((command, index) => (command.startsWith('["loadfile"') ? [index] : []));
        expect(setAt).toBeGreaterThan(-1);
        expect(loadAts.length).toBeGreaterThan(0);
        expect(loadAts.every(index => index > setAt)).toBe(true);
        mpv.prop('audio-device', device);
        // 先到的那次被后到的顶掉，可能连 loadfile 都没发：mpv 的条目号按实际发出的 loadfile 数。
        await startEntry(harness, loadAts.length);
        expect((await second).ok).toBe(true);
        expect(await first).toMatchObject({ ok: false });
    });

    it('a device that was missing is picked up by a later load once it is listed, without re-reading the list on every load', async () => {
        const harness = deviceHarness();
        const device = 'alsa/plughw:CARD=Gone,DEV=0';
        await harness.session.configure(config(device));
        expect((await loadAndStart(harness, localRequest('local:a#1'), 1)).ok).toBe(true);
        expect(deviceListReads(harness)).toHaveLength(1);
        // 刚读过：紧接着的载入不再读。
        expect((await loadAndStart(harness, localRequest('local:b#2'), 2)).ok).toBe(true);
        expect(deviceListReads(harness)).toHaveLength(1);
        // DAC 插上了，过一会儿再载入：重读设备表，换到它，然后才 loadfile。
        harness.mpv().props['audio-device-list'] = [...LIST, { name: device, description: 'Topping D10 again' }];
        vi.advanceTimersByTime(6000);
        const third = harness.session.load(localRequest('local:c#3'), { ownerId: 7 });
        await flush();
        expect(deviceListReads(harness)).toHaveLength(2);
        const sent = sentCommands(harness).map(command => JSON.stringify(command));
        const setAt = sent.indexOf(JSON.stringify(['set_property', 'audio-device', device]));
        const lastLoadAt = sent.map((command, index) => (command.startsWith('["loadfile"') ? index : -1)).reduce((a, b) => Math.max(a, b), -1);
        expect(setAt).toBeGreaterThan(-1);
        expect(lastLoadAt).toBeGreaterThan(setAt);
        harness.mpv().prop('audio-device', device);
        await startEntry(harness, 3);
        expect((await third).ok).toBe(true);
    });

    it('a hostile ALSA name never reaches mpv, on the command line or by set_property', async () => {
        const hostile = 'alsa/file:|touch /tmp/x,raw';
        // mpv 的表里就算有这个名字（不会有），设置也先被清成 auto。
        const harness = deviceHarness([...LIST, { name: hostile, description: 'evil' }]);
        await harness.session.configure(config(hostile));
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        await harness.session.configure(config(hostile, { volume: 50 }));
        await harness.session.configure(config('alsa/tee:hw,/tmp/x'));
        const [, args] = harness.spawnFn.mock.calls[0];
        expect(args.some(arg => arg.includes('|') || arg.includes('file:') || arg.includes('tee:'))).toBe(false);
        expect(JSON.stringify(harness.mpv().requests)).not.toMatch(/\||file:|tee:/);
        expect(harness.mpv().commands('set_property').filter(command => command[1] === 'audio-device')).toEqual([]);
    });

    it('live: a device missing from the cached list is read again once; the same device is not checked again', async () => {
        const list: Json[] = LIST.filter(device => !device.name.includes('Topping'));
        const harness = deviceHarness(list);
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        await harness.session.listDevices();
        expect(deviceListReads(harness)).toHaveLength(1);
        // DAC 刚插上：缓存的表里还没有它。
        harness.mpv().props['audio-device-list'] = LIST;
        const dac = 'pipewire/alsa_output.usb-Topping_D10-00.analog-stereo';
        await harness.session.configure(config(dac));
        expect(deviceListReads(harness)).toHaveLength(2);
        expect(harness.mpv().commands('set_property').filter(command => command[1] === 'audio-device')).toEqual([['set_property', 'audio-device', dac]]);
        // 只改了音量：不再读设备表。
        await harness.session.configure(config(dac, { softwareVolume: true, volume: 50 }));
        expect(deviceListReads(harness)).toHaveLength(2);
        // 换成一个读两遍都没有的设备：回到 auto。
        await harness.session.configure(config('pipewire/gone'));
        expect(deviceListReads(harness)).toHaveLength(3);
        expect(harness.mpv().commands('set_property').filter(command => command[1] === 'audio-device').at(-1)).toEqual(['set_property', 'audio-device', 'auto']);
        expect(harness.logWarn).toHaveBeenCalledWith('[HiFi] ignoring an audio device that is not in the device list: "pipewire/gone"');
    });

    it('a device change made while the list is being read is not overwritten by the slower check', async () => {
        const harness = deviceHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        const mpv = harness.mpv();
        const first = harness.session.configure(config('pipewire/alsa_output.usb-Topping_D10-00.analog-stereo'));
        const second = harness.session.configure(config('auto'));
        await Promise.all([first, second]);
        await flush();
        expect(mpv.commands('set_property').filter(command => command[1] === 'audio-device')).toEqual([]);
    });
});

describe('mpv session: a PipeWire / PulseAudio stream that cannot reach its output', () => {
    const lostLine = { prefix: 'ao/pipewire', level: 'warn', text: 'Stream in error state, trying to reload...\n' };

    it('fails the playing song as DEVICE_BUSY and stops mpv instead of letting the dropped frames end it', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        harness.mpv().prop('duration', 30);
        harness.mpv().prop('time-pos', 0.2);
        harness.mpv().event('log-message', lostLine);
        harness.mpv().event('log-message', { prefix: 'ao/pipewire', level: 'warn', text: 'Error during playback: No such file or directory, no target node available\n' });
        await flush();
        expect(harness.errors).toEqual([{ code: 'DEVICE_BUSY', trackKey: 'local:a#1', detail: expect.stringContaining('Stream in error state'), fatal: true }]);
        expect(harness.mpv().commands('stop')).toEqual([['stop']]);
        expect(harness.bridge.revoke).toHaveBeenCalledWith('tok1');
        // mpv 丢着帧快进到了结尾：不是放完。
        harness.mpv().prop('eof-reached', true);
        await flush();
        expect(harness.states.some(state => state.status === 'ended')).toBe(false);
        expect(harness.lastState()).toMatchObject({ status: 'error', errorCode: 'DEVICE_BUSY' });
    });

    it('fails a load that has not opened its output yet', async () => {
        const harness = createHarness();
        const result = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        await startEntry(harness, 1, { outParams: null });
        harness.mpv().event('log-message', { prefix: 'ao', level: 'warn', text: 'dropping frame due to pin disconnect\n' });
        await flush();
        expect(await result).toMatchObject({ ok: false, errorCode: 'DEVICE_BUSY' });
        expect(harness.mpv().commands('stop')).toEqual([['stop']]);
    });

    it('a line from another module, or before the song started, changes nothing', async () => {
        const harness = createHarness();
        const result = harness.session.load(localRequest('local:a#1'), { ownerId: 7 });
        await flush();
        // 上一首的输出撤下时的那几行：这一首还没 start-file。
        harness.mpv().event('log-message', lostLine);
        harness.mpv().event('log-message', { prefix: 'ffmpeg', level: 'warn', text: 'Stream in error state\n' });
        await startEntry(harness, 1);
        expect((await result).ok).toBe(true);
        expect(harness.errors).toEqual([]);
        expect(harness.lastState().status).toBe('playing');
    });
});

describe('mpv session: play at the end of a song', () => {
    // 暂停着载入到末尾（窗口重建或交接后恢复出来的位置等于时长）：mpv 不推 eof-reached，问它才答 true。
    const loadPausedAtEnd = async (harness: Harness, { duration = 20.004093 as number | null, timePos = 20 as number | null } = {}) => {
        await loadAndStart(harness, localRequest('local:dsd#1', { startSec: 20, paused: true }), 1);
        const mpv = harness.mpv();
        mpv.prop('pause', true);
        if (duration !== null) mpv.prop('duration', duration);
        if (timePos !== null) mpv.prop('time-pos', timePos);
        mpv.props['eof-reached'] = true;
        await flush();
        return mpv;
    };
    const transport = (harness: Harness) => harness.mpv().requests
        .map(request => request.command)
        .filter(command => command[0] === 'seek' || (command[0] === 'set_property' && command[1] === 'pause'));

    it('at the duration: seeks to 0 before unpausing, as <audio> does for an ended element', async () => {
        const harness = createHarness();
        await loadPausedAtEnd(harness);
        const before = transport(harness).length;
        await harness.session.play();
        expect(transport(harness).slice(before)).toEqual([['seek', 0, 'absolute'], ['set_property', 'pause', false]]);
    });

    it('with no position or duration to go by: asks mpv for eof-reached', async () => {
        const harness = createHarness();
        await loadPausedAtEnd(harness, { duration: null, timePos: null });
        const before = transport(harness).length;
        await harness.session.play();
        expect(harness.mpv().commands('get_property')).toContainEqual(['get_property', 'eof-reached']);
        expect(transport(harness).slice(before)).toEqual([['seek', 0, 'absolute'], ['set_property', 'pause', false]]);
    });

    it('mid-song: just unpauses', async () => {
        const harness = createHarness();
        await loadPausedAtEnd(harness, { duration: 30, timePos: 5 });
        harness.mpv().props['eof-reached'] = false;
        const before = transport(harness).length;
        await harness.session.play();
        expect(transport(harness).slice(before)).toEqual([['set_property', 'pause', false]]);
    });

    it('mpv pausing itself again at the end after an unpause reports ended', async () => {
        const harness = createHarness();
        await loadPausedAtEnd(harness, { duration: null, timePos: null });
        // play 时 mpv 还说没到头（它还没真的放过）。
        harness.mpv().props['eof-reached'] = false;
        await harness.session.play();
        expect(harness.mpv().commands('seek')).toEqual([]);
        harness.mpv().prop('pause', false);
        await flush();
        expect(harness.lastState().status).toBe('playing');
        // keep-open 马上又停下，eof-reached 却不推。
        harness.mpv().props['eof-reached'] = true;
        harness.mpv().prop('pause', true);
        await flush();
        expect(harness.lastState()).toMatchObject({ status: 'ended', trackKey: 'local:dsd#1' });
    });

    it('a pause the user pressed mid-song stays a pause', async () => {
        const harness = createHarness();
        await loadAndStart(harness, localRequest('local:a#1'), 1);
        harness.mpv().props['eof-reached'] = false;
        await harness.session.pause();
        harness.mpv().prop('pause', true);
        await flush();
        expect(harness.lastState().status).toBe('paused');
    });

    it('a pause pressed while play is asking mpv wins; a seek made meanwhile replaces the seek to 0', async () => {
        const paused = createHarness();
        await loadPausedAtEnd(paused, { duration: null, timePos: null });
        const before = transport(paused).length;
        const playing = paused.session.play();
        await paused.session.pause();
        await playing;
        expect(transport(paused).slice(before)).toEqual([['set_property', 'pause', true]]);

        const sought = createHarness();
        await loadPausedAtEnd(sought, { duration: null, timePos: null });
        const from = transport(sought).length;
        const resumed = sought.session.play();
        await sought.session.seek(10);
        await resumed;
        expect(transport(sought).slice(from)).toEqual([['seek', 10, 'absolute'], ['set_property', 'pause', false]]);
    });
});

// 这台机器（Linux，HDA NVidia + SOF）上的 /proc/asound 原样，外加一块 USB DAC。
const ALSA_CARDS = [
    ' 0 [NVidia         ]: HDA-Intel - HDA NVidia',
    '                      HDA NVidia at 0x84080000 irq 17',
    ' 1 [sofhdadsp      ]: sof-hda-dsp - sof-hda-dsp',
    '                      Razer-Blade152022_RZ09_0421-8.04-CH580',
    ' 2 [D10            ]: USB-Audio - Topping D10',
    '                      Topping D10 at usb-0000:00:14.0-2, high speed',
    '',
].join('\n');
const ALSA_PCM = [
    '00-03: HDMI 0 : HDMI 0 : playback 1',
    '00-07: HDMI 1 : HDMI 1 : playback 1',
    '01-00: HDA Analog (*) :  : playback 1 : capture 1',
    '01-03: HDMI1 (*) : HDMI 1 : playback 1',
    '01-06: DMIC (*) :  : capture 1',
    '02-00: USB Audio : USB Audio : playback 1',
    '',
].join('\n');

describe('mpv session: ALSA hw: devices on Linux', () => {
    const hw = (name: string, description: string) => ({ name, description, driver: 'alsa', direct: true });

    it('reads the playback PCMs of /proc/asound into direct alsa/hw: devices named after card and PCM', () => {
        expect(listAlsaHwDevices(ALSA_CARDS, ALSA_PCM)).toEqual([
            hw('alsa/hw:CARD=NVidia,DEV=3', 'HDA NVidia, HDMI 0'),
            hw('alsa/hw:CARD=NVidia,DEV=7', 'HDA NVidia, HDMI 1'),
            hw('alsa/hw:CARD=sofhdadsp,DEV=0', 'sof-hda-dsp, HDA Analog'),
            hw('alsa/hw:CARD=sofhdadsp,DEV=3', 'sof-hda-dsp, HDMI 1'),
            hw('alsa/hw:CARD=D10,DEV=0', 'Topping D10, USB Audio'),
        ]);
        expect(listAlsaHwDevices('', ALSA_PCM)).toEqual([]);
        expect(listAlsaHwDevices(' 0 [bad id!]: x - y\n', '00-00: a : b : playback 1\n')).toEqual([]);
    });

    const MPV_LIST = [
        { name: 'auto', description: 'Autoselect device' },
        { name: 'pipewire', description: 'Default (pipewire)' },
        { name: 'alsa/plughw:CARD=D10,DEV=0', description: 'Topping D10, USB Audio/Hardware device with all software conversions' },
        { name: 'alsa/hw:CARD=D10,DEV=0', description: 'Topping D10, USB Audio/Direct hardware device without any conversions' },
    ];

    const harnessWith = (files: Record<string, string> | null, list: Json[] = MPV_LIST, platform = 'linux') => {
        const readFileFn = vi.fn(async (file: string) => {
            if (!files || !(file in files)) throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
            return files[file];
        });
        const logWarn = vi.fn();
        const harness = createHarness({
            platform,
            readFileFn,
            logWarn,
            onSpawn: child => {
                child.socket.props['audio-device-list'] = list;
            },
        });
        return { ...harness, readFileFn, logWarn };
    };

    it('adds them right after auto and skips the ones mpv listed itself', async () => {
        const harness = harnessWith({ '/proc/asound/cards': ALSA_CARDS, '/proc/asound/pcm': ALSA_PCM });
        expect((await harness.session.listDevices()).map(device => [device.name, device.direct])).toEqual([
            ['auto', false],
            ['alsa/hw:CARD=NVidia,DEV=3', true],
            ['alsa/hw:CARD=NVidia,DEV=7', true],
            ['alsa/hw:CARD=sofhdadsp,DEV=0', true],
            ['alsa/hw:CARD=sofhdadsp,DEV=3', true],
            ['pipewire', false],
            ['alsa/plughw:CARD=D10,DEV=0', false],
            ['alsa/hw:CARD=D10,DEV=0', true],
        ]);
        expect(harness.readFileFn.mock.calls.map(([file]) => file).sort()).toEqual(['/proc/asound/cards', '/proc/asound/pcm']);
    });

    it('unreadable /proc/asound leaves mpv\'s own list', async () => {
        const harness = harnessWith(null);
        expect((await harness.session.listDevices()).map(device => device.name)).toEqual(MPV_LIST.map(device => device.name));
        expect(harness.logWarn).toHaveBeenCalledWith(expect.stringMatching(/^\[HiFi\] could not read the ALSA devices/), expect.any(Error));
    });

    it('adds nothing when mpv lists no ALSA device at all (no ALSA output in this mpv), nor off Linux', async () => {
        const files = { '/proc/asound/cards': ALSA_CARDS, '/proc/asound/pcm': ALSA_PCM };
        const withoutAlsa = [{ name: 'auto', description: 'Autoselect device' }, { name: 'pipewire', description: 'Default (pipewire)' }];
        expect((await harnessWith(files, withoutAlsa).session.listDevices()).map(device => device.name)).toEqual(['auto', 'pipewire']);
        const mac = harnessWith(files, [{ name: 'auto', description: 'Autoselect device' }, { name: 'coreaudio/BuiltIn', description: 'Speakers' }], 'darwin');
        expect((await mac.session.listDevices()).map(device => device.name)).toEqual(['auto', 'coreaudio/BuiltIn']);
        expect(mac.readFileFn).not.toHaveBeenCalled();
    });
});
