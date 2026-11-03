import { spawn, spawnSync } from 'child_process';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { Duplex } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 钉住 mpv JSON IPC 客户端（分行缓冲、配对、超时、断线、属性分发）和命名管道重试；本机有 mpv 时再对真进程跑一遍。

type MpvMessage = Record<string, unknown>;
type CloseInfo = { intentional: boolean; error: Error | null };

interface MpvIpcClient {
    command: (args: unknown[]) => Promise<unknown>;
    observeProperty: (name: string) => Promise<number>;
    onEvent: (listener: (message: MpvMessage) => void) => () => void;
    onPropertyChange: (name: string, listener: (value: unknown) => void) => () => void;
    onClose: (listener: (info: CloseInfo) => void) => () => void;
    close: () => void;
    isClosed: () => boolean;
}

interface ClientOptions {
    socket: Duplex;
    requestTimeoutMs?: number;
    logWarn?: (...args: unknown[]) => void;
}

interface FakeNetSocket extends EventEmitter {
    destroy: () => void;
}

interface ConnectOptions {
    netModule: { connect: (path: string) => FakeNetSocket };
    attempts?: number;
    delayMs?: number;
    setTimeoutFn?: typeof setTimeout;
    signal?: AbortSignal | null;
}

const require = createRequire(import.meta.url);
const { parseMpvLine, encodeMpvCommand, createMpvIpcClient, connectNamedPipe } = require('../../../electron/hifi/mpvIpcClient.cjs') as {
    parseMpvLine: (line: unknown) => MpvMessage | null;
    encodeMpvCommand: (args: unknown[], requestId: number) => string;
    createMpvIpcClient: (options: ClientOptions) => MpvIpcClient;
    connectNamedPipe: (path: string, options: ConnectOptions) => Promise<FakeNetSocket>;
};
const { buildMpvArgs } = require('../../../electron/hifi/mpvArgs.cjs') as {
    buildMpvArgs: (options: Record<string, unknown>) => string[];
};

// 连接的 mpv 一端：客户端写的每一行记下来，mpv 发来的字节从 feed 推进去。
class FakeMpvSocket extends Duplex {
    written = '';

    _read() {}

    _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.written += chunk.toString();
        callback();
    }

    requests(): Array<{ command: unknown[]; request_id: number }> {
        return this.written.split('\n').filter(Boolean).map(line => JSON.parse(line));
    }

    lastRequestId(): number {
        const requests = this.requests();
        return requests[requests.length - 1].request_id;
    }

    feed(data: string | Buffer) {
        this.push(typeof data === 'string' ? Buffer.from(data) : data);
    }

    reply(requestId: number, fields: MpvMessage = { error: 'success' }) {
        this.feed(`${JSON.stringify({ request_id: requestId, ...fields })}\n`);
    }

    hangUp() {
        this.push(null);
    }
}

// 计时器是假的，setImmediate 留真的：一轮 setImmediate 把流的 nextTick 和微任务都走完。
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function createHarness(options: Partial<ClientOptions> = {}) {
    const socket = new FakeMpvSocket();
    const logWarn = vi.fn();
    const client = createMpvIpcClient({ socket, logWarn, ...options });
    return { socket, client, logWarn };
}

describe('parseMpvLine and encodeMpvCommand', () => {
    it('parses one JSON object per line and rejects everything else', () => {
        expect(parseMpvLine('{"event":"idle"}')).toEqual({ event: 'idle' });
        expect(parseMpvLine('  {"request_id":1,"error":"success"}\r')).toEqual({ request_id: 1, error: 'success' });
        expect(parseMpvLine('')).toBeNull();
        expect(parseMpvLine('not json')).toBeNull();
        expect(parseMpvLine('[1,2]')).toBeNull();
        expect(parseMpvLine('null')).toBeNull();
        expect(parseMpvLine('42')).toBeNull();
        expect(parseMpvLine(undefined)).toBeNull();
    });

    it('encodes a command as one newline-terminated line, even with newlines in its arguments', () => {
        const line = encodeMpvCommand(['loadfile', 'http://127.0.0.1:1/a\nb.flac', 'replace'], 7);
        expect(line.endsWith('\n')).toBe(true);
        expect(line.indexOf('\n')).toBe(line.length - 1);
        expect(JSON.parse(line)).toEqual({ command: ['loadfile', 'http://127.0.0.1:1/a\nb.flac', 'replace'], request_id: 7 });
    });
});

describe('createMpvIpcClient', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('matches replies to requests by request_id, in any order', async () => {
        const { socket, client } = createHarness();
        const first = client.command(['get_property', 'pause']);
        const second = client.command(['get_property', 'volume']);
        await flush();
        expect(socket.requests()).toEqual([
            { command: ['get_property', 'pause'], request_id: 1 },
            { command: ['get_property', 'volume'], request_id: 2 },
        ]);
        socket.reply(2, { error: 'success', data: 100 });
        socket.reply(1, { error: 'success', data: false });
        await expect(first).resolves.toBe(false);
        await expect(second).resolves.toBe(100);
    });

    it('resolves commands without data to undefined', async () => {
        const { socket, client } = createHarness();
        const pending = client.command(['set_property', 'pause', true]);
        await flush();
        socket.reply(socket.lastRequestId());
        await expect(pending).resolves.toBeUndefined();
    });

    it('reassembles lines split across chunks, including a split UTF-8 character', async () => {
        const { socket, client } = createHarness();
        const events: MpvMessage[] = [];
        client.onEvent(message => events.push(message));
        const pending = client.command(['get_property', 'media-title']);
        await flush();
        const bytes = Buffer.from('{"request_id":1,"error":"success","data":"音乐"}\n');
        const splitAt = bytes.indexOf(Buffer.from('音')) + 1;
        socket.feed(bytes.subarray(0, 5));
        socket.feed(bytes.subarray(5, splitAt));
        await flush();
        socket.feed(bytes.subarray(splitAt));
        await expect(pending).resolves.toBe('音乐');
        expect(events).toEqual([]);
    });

    it('handles several messages in one chunk', async () => {
        const { socket, client } = createHarness();
        const events: MpvMessage[] = [];
        client.onEvent(message => events.push(message));
        const first = client.command(['get_property', 'pause']);
        const second = client.command(['get_property', 'duration']);
        await flush();
        socket.feed([
            '{"request_id":1,"error":"success","data":true}',
            '{"event":"start-file","playlist_entry_id":1}',
            '{"request_id":2,"error":"success","data":245.3}',
            '',
        ].join('\n'));
        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(245.3);
        expect(events).toEqual([{ event: 'start-file', playlist_entry_id: 1 }]);
    });

    it('ignores malformed lines and keeps going', async () => {
        const { socket, client, logWarn } = createHarness();
        const pending = client.command(['get_property', 'pause']);
        await flush();
        socket.feed('garbage{\n\n{"request_id":1,"error":"success","data":false}\n');
        await expect(pending).resolves.toBe(false);
        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(logWarn.mock.calls[0][0]).toBe('[HiFi] ipc ignored a malformed line');
    });

    it('rejects error replies with the mpv error string', async () => {
        const { socket, client } = createHarness();
        const pending = client.command(['get_property', 'audio-out-params']);
        await flush();
        socket.reply(1, { error: 'property unavailable' });
        await expect(pending).rejects.toMatchObject({ mpvError: 'property unavailable' });
        await expect(pending).rejects.toThrow('mpv get_property failed: property unavailable');
    });

    it('ignores replies to unknown or already settled requests', async () => {
        const { socket, client } = createHarness();
        const pending = client.command(['get_property', 'pause']);
        await flush();
        socket.reply(99, { error: 'success', data: 'stray' });
        socket.reply(1, { error: 'success', data: true });
        socket.reply(1, { error: 'success', data: false });
        await expect(pending).resolves.toBe(true);
        expect(client.isClosed()).toBe(false);
    });

    it('times out a request with IPC_TIMEOUT and drops its late reply', async () => {
        const { socket, client, logWarn } = createHarness();
        const pending = client.command(['seek', 10, 'absolute']);
        const outcome = pending.catch((error: unknown) => error);
        vi.advanceTimersByTime(4999);
        await flush();
        socket.reply(2, { error: 'success' });
        vi.advanceTimersByTime(1);
        const error = await outcome;
        expect(error).toMatchObject({ code: 'IPC_TIMEOUT' });
        expect(logWarn).toHaveBeenCalledWith('[HiFi] ipc seek timed out after 5000 ms');
        socket.reply(1, { error: 'success' });
        await flush();
        expect(client.isClosed()).toBe(false);
    });

    it('uses the injected timeout', async () => {
        const { client } = createHarness({ requestTimeoutMs: 50 });
        const outcome = client.command(['quit']).catch((error: unknown) => error);
        vi.advanceTimersByTime(50);
        await expect(outcome).resolves.toMatchObject({ code: 'IPC_TIMEOUT' });
    });

    it('rejects every pending request with MPV_CRASHED when mpv hangs up, and fires onClose once', async () => {
        const { socket, client } = createHarness();
        const onClose = vi.fn();
        client.onClose(onClose);
        const first = client.command(['get_property', 'pause']).catch((error: unknown) => error);
        const second = client.observeProperty('time-pos').catch((error: unknown) => error);
        await flush();
        socket.hangUp();
        await flush();
        await expect(first).resolves.toMatchObject({ code: 'MPV_CRASHED' });
        await expect(second).resolves.toMatchObject({ code: 'MPV_CRASHED' });
        socket.destroy();
        await flush();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledWith({ intentional: false, error: null });
        expect(client.isClosed()).toBe(true);
    });

    it('treats a socket error as a crash and keeps swallowing later errors', async () => {
        const { socket, client, logWarn } = createHarness();
        const onClose = vi.fn();
        client.onClose(onClose);
        const pending = client.command(['get_property', 'pause']).catch((error: unknown) => error);
        await flush();
        const failure = new Error('read ECONNRESET');
        socket.destroy(failure);
        await flush();
        await expect(pending).resolves.toMatchObject({ code: 'MPV_CRASHED', hifiDetail: 'read ECONNRESET' });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledWith({ intentional: false, error: failure });
        expect(logWarn).toHaveBeenCalledWith('[HiFi] ipc socket error', failure);
        expect(() => socket.emit('error', new Error('write EPIPE'))).not.toThrow();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('rejects writes after close', async () => {
        const { socket, client } = createHarness();
        socket.hangUp();
        await flush();
        await expect(client.command(['get_property', 'pause'])).rejects.toMatchObject({ code: 'MPV_CRASHED' });
        await expect(client.observeProperty('pause')).rejects.toMatchObject({ code: 'MPV_CRASHED' });
        expect(socket.written).toBe('');
    });

    it('closes on request: rejects pending, reports it as intentional and ends the socket', async () => {
        const { socket, client } = createHarness();
        const onClose = vi.fn();
        const unsubscribed = vi.fn();
        client.onClose(onClose);
        client.onClose(unsubscribed)();
        const pending = client.command(['get_property', 'pause']).catch((error: unknown) => error);
        await flush();
        client.close();
        client.close();
        await expect(pending).resolves.toMatchObject({ code: 'MPV_CRASHED' });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledWith({ intentional: true, error: null });
        expect(unsubscribed).not.toHaveBeenCalled();
        expect(socket.writableEnded).toBe(true);
        await flush();
        expect(socket.destroyed).toBe(true);
    });

    it('still tells a late onClose listener that the connection is gone', async () => {
        const { client } = createHarness();
        client.close();
        const late = vi.fn();
        client.onClose(late);
        expect(late).not.toHaveBeenCalled();
        await flush();
        expect(late).toHaveBeenCalledWith({ intentional: true, error: null });
    });

    it('assigns increasing observe ids and routes property changes by id', async () => {
        const { socket, client } = createHarness();
        const pauseValues: unknown[] = [];
        const timeValues: unknown[] = [];
        const events: MpvMessage[] = [];
        client.onPropertyChange('pause', value => pauseValues.push(value));
        const stopTime = client.onPropertyChange('time-pos', value => timeValues.push(value));
        client.onEvent(message => events.push(message));

        const pauseId = client.observeProperty('pause');
        const timeId = client.observeProperty('time-pos');
        await flush();
        expect(socket.requests().map(request => request.command)).toEqual([
            ['observe_property', 1, 'pause'],
            ['observe_property', 2, 'time-pos'],
        ]);
        // mpv 订阅后马上推一次当前值，可能比回复先到。
        socket.feed('{"event":"property-change","id":2,"name":"time-pos","data":1.5}\n');
        socket.reply(1);
        socket.reply(2);
        await expect(pauseId).resolves.toBe(1);
        await expect(timeId).resolves.toBe(2);

        socket.feed([
            '{"event":"property-change","id":1,"name":"pause"}',
            '{"event":"property-change","id":1,"name":"pause","data":true}',
            '{"event":"property-change","id":9,"name":"pause","data":false}',
            '',
        ].join('\n'));
        await flush();
        expect(timeValues).toEqual([1.5]);
        expect(pauseValues).toEqual([undefined, true]);
        expect(events.map(message => message.id)).toEqual([2, 1, 1, 9]);

        stopTime();
        socket.feed('{"event":"property-change","id":2,"name":"time-pos","data":2}\n');
        await flush();
        expect(timeValues).toEqual([1.5]);
    });

    it('observes a property only once', async () => {
        const { socket, client } = createHarness();
        const first = client.observeProperty('volume');
        const again = client.observeProperty('volume');
        await flush();
        expect(socket.requests()).toHaveLength(1);
        socket.reply(1);
        await expect(first).resolves.toBe(1);
        await expect(again).resolves.toBe(1);
    });

    it('lets a failed observe be retried with a new id', async () => {
        const { socket, client } = createHarness();
        const failed = client.observeProperty('volume').catch((error: unknown) => error);
        await flush();
        socket.reply(1, { error: 'invalid parameter' });
        await expect(failed).resolves.toMatchObject({ mpvError: 'invalid parameter' });
        const retried = client.observeProperty('volume');
        await flush();
        expect(socket.requests()[1].command).toEqual(['observe_property', 2, 'volume']);
        socket.reply(2);
        await expect(retried).resolves.toBe(2);
    });

    it('keeps delivering when one listener throws, and stops after unsubscribe', async () => {
        const { socket, client, logWarn } = createHarness();
        const thrown = new Error('listener bug');
        client.onEvent(() => {
            throw thrown;
        });
        const seen: MpvMessage[] = [];
        const stop = client.onEvent(message => seen.push(message));
        socket.feed('{"event":"idle"}\n');
        await flush();
        stop();
        socket.feed('{"event":"seek"}\n');
        await flush();
        expect(seen).toEqual([{ event: 'idle' }]);
        expect(logWarn).toHaveBeenCalledWith('[HiFi] ipc listener threw', thrown);
    });
});

describe('connectNamedPipe', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // net.connect 的替身：前 failures 次在下一个微任务里报 ENOENT（管道还没建），之后连上。
    function createFakeNet(failures: number) {
        const sockets: FakeNetSocket[] = [];
        const paths: string[] = [];
        const connect = vi.fn((path: string) => {
            const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() }) as FakeNetSocket;
            const index = sockets.length;
            sockets.push(socket);
            paths.push(path);
            queueMicrotask(() => {
                if (index < failures) socket.emit('error', Object.assign(new Error('connect ENOENT'), { code: 'ENOENT' }));
                else socket.emit('connect');
            });
            return socket;
        });
        return { netModule: { connect }, sockets, paths };
    }

    const pipePath = '\\\\.\\pipe\\folia-hifi-abc123';

    it('retries until the pipe accepts the connection', async () => {
        const net = createFakeNet(2);
        const connecting = connectNamedPipe(pipePath, { netModule: net.netModule, delayMs: 100 });
        await vi.advanceTimersByTimeAsync(99);
        expect(net.netModule.connect).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(net.netModule.connect).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(100);
        await expect(connecting).resolves.toBe(net.sockets[2]);
        expect(net.paths).toEqual([pipePath, pipePath, pipePath]);
        expect(net.sockets[0].destroy).toHaveBeenCalled();
        expect(net.sockets[1].destroy).toHaveBeenCalled();
        expect(net.sockets[2].destroy).not.toHaveBeenCalled();
        expect(net.sockets[2].listenerCount('error')).toBe(0);
    });

    it('gives up after the last attempt with MPV_SPAWN_FAILED', async () => {
        const net = createFakeNet(Infinity);
        const outcome = connectNamedPipe(pipePath, { netModule: net.netModule, attempts: 3, delayMs: 10 }).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(100);
        expect(net.netModule.connect).toHaveBeenCalledTimes(3);
        await expect(outcome).resolves.toMatchObject({ code: 'MPV_SPAWN_FAILED', hifiDetail: 'connect ENOENT' });
    });

    it('survives a connect call that throws', async () => {
        const net = createFakeNet(0);
        net.netModule.connect.mockImplementationOnce(() => {
            throw new Error('EINVAL');
        });
        const connecting = connectNamedPipe(pipePath, { netModule: net.netModule, delayMs: 5 });
        await vi.advanceTimersByTimeAsync(5);
        await expect(connecting).resolves.toBe(net.sockets[0]);
    });

    it('stops retrying once aborted', async () => {
        const net = createFakeNet(Infinity);
        const controller = new AbortController();
        const outcome = connectNamedPipe(pipePath, { netModule: net.netModule, delayMs: 100, signal: controller.signal }).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        await vi.advanceTimersByTimeAsync(1000);
        expect(net.netModule.connect).toHaveBeenCalledTimes(1);
        await expect(outcome).resolves.toMatchObject({ code: 'MPV_SPAWN_FAILED', hifiDetail: 'pipe connect aborted' });
    });
});

// 本机装了 mpv 时对真进程走一遍：fd 3 的 socketpair、取版本、订阅属性、关连接后 mpv 自己退出。
const mpvExecutable = ['mpv', '/usr/bin/mpv'].find(candidate => {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 8000 });
    return probe.status === 0;
}) ?? null;
const hasMpv = mpvExecutable !== null && process.platform !== 'win32';

describe.skipIf(!hasMpv)('mpv IPC against a real mpv process', () => {
    it('talks JSON IPC over fd 3 and exits when the client closes', async () => {
        const args = buildMpvArgs({
            platform: process.platform,
            ipc: { kind: 'fd' },
            audioDevice: 'auto',
            exclusive: false,
            dsdMode: 'pcm',
            ao: 'null',
        });
        const child = spawn(mpvExecutable!, args, { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
        const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
        try {
            const client = createMpvIpcClient({ socket: child.stdio[3] as Duplex });
            const version = await client.command(['get_property', 'mpv-version']);
            expect(version).toMatch(/^mpv /);

            const pauseValue = new Promise<unknown>(resolve => client.onPropertyChange('pause', resolve));
            await expect(client.observeProperty('pause')).resolves.toBe(1);
            await expect(pauseValue).resolves.toBe(false);

            const closed = new Promise<CloseInfo>(resolve => client.onClose(resolve));
            client.close();
            await expect(closed).resolves.toMatchObject({ intentional: true });
            await expect(exited).resolves.toBe(0);
        } finally {
            if (child.exitCode === null && child.signalCode === null) child.kill();
        }
    }, 15000);
});
