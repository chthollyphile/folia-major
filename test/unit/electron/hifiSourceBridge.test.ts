import { createHash, randomBytes } from 'crypto';
import http from 'http';
import { createRequire } from 'module';
import { inspect } from 'util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HifiErrorCode, HifiReadResponse } from '../../../src/types/hifi';

// 用真的 127.0.0.1 服务器驱动 HiFi 来源桥：Range、本地分块拉取和背压、窗口重建时的重试，以及 Navidrome 转发和日志去敏。

type ReadRequest = { sourceKey: string; offset: number; length: number };
type RequestRead = (ownerId: number, request: ReadRequest) => Promise<HifiReadResponse>;
type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; redirect: string; signal: AbortSignal }) => Promise<Response>;
type SourceBridge = {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    port: () => number | null;
    registerLocal: (source: { sourceKey: string; size: number; mimeType: string; fileName: string; ownerId: number }) => { token: string; url: string };
    registerRemote: (source: { url: string; fileName: string }) => { token: string; url: string };
    revoke: (token: string) => void;
    revokeAll: () => void;
    getSourceError: (token: string) => HifiErrorCode | null;
};
type BridgeOptions = {
    fetchFn?: FetchFn;
    requestRead?: RequestRead;
    chunkSize?: number;
    unknownSourceRetryMs?: number;
    unknownSourceGiveUpMs?: number;
    logInfo?: (...args: unknown[]) => void;
    logWarn?: (...args: unknown[]) => void;
};
/** status 为 0 表示连响应头都没等到，连接就断了。 */
type Reply = { status: number; headers: http.IncomingHttpHeaders; body: Buffer; complete: boolean };

const require = createRequire(import.meta.url);
const { createSourceBridge, parseRangeHeader } = require('../../../electron/hifi/sourceBridge.cjs') as {
    createSourceBridge: (options: BridgeOptions) => SourceBridge;
    parseRangeHeader: (value: string | undefined, size: number) => { start: number; end: number } | { unsatisfiable: true } | null;
};

const OWNER_ID = 7;
const SIZE = 10_000;
const REMOTE_URL = 'https://music.example.com:4533/rest/stream?u=alice&t=26719a1196d2a940705a59634eb18eab&s=c19b2d&f=json&v=1.16.1&c=folia&id=song-1&format=raw';
const SECRETS = ['?u=', 'alice', '26719a1196d2a940705a59634eb18eab', 'c19b2d', 'id=song-1'];

const bridges: SourceBridge[] = [];

afterEach(async () => {
    await Promise.all(bridges.splice(0).map(bridge => bridge.stop()));
});

const patternBytes = (size: number) => {
    const bytes = Buffer.alloc(size);
    for (let index = 0; index < size; index += 1) bytes[index] = (index * 31 + 7) & 0xff;
    return bytes;
};

const readerFor = (bytes: Buffer) => vi.fn<RequestRead>(async (_ownerId, request) => ({
    status: 'ok',
    data: bytes.subarray(request.offset, request.offset + request.length),
}));

const startBridge = async (options: BridgeOptions = {}) => {
    const logInfo = vi.fn();
    const logWarn = vi.fn();
    const bridge = createSourceBridge({ logInfo, logWarn, ...options });
    bridges.push(bridge);
    await bridge.start();
    return { bridge, logInfo, logWarn };
};

const registerLocal = (bridge: SourceBridge, size = SIZE, fileName = 'track.flac') => bridge.registerLocal({
    sourceKey: 'source-1',
    size,
    mimeType: 'audio/flac',
    fileName,
    ownerId: OWNER_ID,
});

const send = (url: string, options: { method?: string; headers?: Record<string, string> } = {}) => new Promise<Reply>(resolve => {
    const req = http.request(url, { method: options.method ?? 'GET', headers: options.headers, agent: false }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', () => {});
        res.on('close', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), complete: res.complete }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), complete: false }));
    req.end();
});

const expectContiguousReads = (requestRead: ReturnType<typeof readerFor>, start: number, endExclusive: number, chunkSize: number) => {
    let position = start;
    for (const [ownerId, request] of requestRead.mock.calls) {
        expect(ownerId).toBe(OWNER_ID);
        expect(request.sourceKey).toBe('source-1');
        expect(request.offset).toBe(position);
        expect(request.length).toBeGreaterThan(0);
        expect(request.length).toBeLessThanOrEqual(chunkSize);
        position += request.length;
    }
    expect(position).toBe(endExclusive);
};

const loggedText = (...spies: ReturnType<typeof vi.fn>[]) => spies
    .flatMap(spy => spy.mock.calls)
    .map(args => args.map(arg => (typeof arg === 'string' ? arg : inspect(arg))).join(' '))
    .join('\n');

const expectNoCredentials = (...spies: ReturnType<typeof vi.fn>[]) => {
    const text = loggedText(...spies);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('parseRangeHeader', () => {
    it('reads a single a-b, a- and -n range and clamps the end to the source', () => {
        expect(parseRangeHeader('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
        expect(parseRangeHeader('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
        expect(parseRangeHeader('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
        expect(parseRangeHeader('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
        expect(parseRangeHeader('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    });

    it('marks ranges past the end unsatisfiable', () => {
        expect(parseRangeHeader('bytes=100-', 100)).toEqual({ unsatisfiable: true });
        expect(parseRangeHeader('bytes=-0', 100)).toEqual({ unsatisfiable: true });
        expect(parseRangeHeader('bytes=0-', 0)).toEqual({ unsatisfiable: true });
    });

    it('ignores missing, multi-range and malformed headers', () => {
        expect(parseRangeHeader(undefined, 100)).toBeNull();
        expect(parseRangeHeader('bytes=0-1,5-6', 100)).toBeNull();
        expect(parseRangeHeader('bytes=9-3', 100)).toBeNull();
        expect(parseRangeHeader('bytes=-', 100)).toBeNull();
        expect(parseRangeHeader('items=0-1', 100)).toBeNull();
    });
});

describe('source bridge: local sources', () => {
    it('serves the whole file with 200 and the file name in the URL', async () => {
        const bytes = patternBytes(SIZE);
        const requestRead = readerFor(bytes);
        const { bridge } = await startBridge({ requestRead });
        const { token, url } = registerLocal(bridge, SIZE, '01 夜曲.flac');

        expect(token).toMatch(/^[a-f0-9]{32}$/);
        expect(url).toBe(`http://127.0.0.1:${bridge.port()}/${token}/${encodeURIComponent('01 夜曲.flac')}`);

        const reply = await send(url);
        expect(reply.status).toBe(200);
        expect(reply.headers['accept-ranges']).toBe('bytes');
        expect(reply.headers['content-type']).toBe('audio/flac');
        expect(reply.headers['content-length']).toBe(String(SIZE));
        expect(reply.headers['content-range']).toBeUndefined();
        expect(reply.complete).toBe(true);
        expect(reply.body.equals(bytes)).toBe(true);
        expect(bridge.getSourceError(token)).toBeNull();
    });

    it.each([
        ['bytes=100-199', 100, 199],
        ['bytes=9000-', 9000, 9999],
        ['bytes=-500', 9500, 9999],
        ['bytes=9990-20000', 9990, 9999],
    ])('answers %s with 206 and the matching Content-Range', async (range, start, end) => {
        const bytes = patternBytes(SIZE);
        const { bridge } = await startBridge({ requestRead: readerFor(bytes) });
        const { url } = registerLocal(bridge);

        const reply = await send(url, { headers: { Range: range } });
        expect(reply.status).toBe(206);
        expect(reply.headers['content-range']).toBe(`bytes ${start}-${end}/${SIZE}`);
        expect(reply.headers['content-length']).toBe(String(end - start + 1));
        expect(reply.body.equals(bytes.subarray(start, end + 1))).toBe(true);
    });

    it('answers an unsatisfiable range with 416 and reads nothing', async () => {
        const requestRead = readerFor(patternBytes(SIZE));
        const { bridge } = await startBridge({ requestRead });
        const { url } = registerLocal(bridge);

        const reply = await send(url, { headers: { Range: `bytes=${SIZE}-` } });
        expect(reply.status).toBe(416);
        expect(reply.headers['content-range']).toBe(`bytes */${SIZE}`);
        expect(requestRead).not.toHaveBeenCalled();
    });

    it('ignores a multi-range request and serves the whole file', async () => {
        const bytes = patternBytes(SIZE);
        const { bridge } = await startBridge({ requestRead: readerFor(bytes) });
        const { url } = registerLocal(bridge);

        const reply = await send(url, { headers: { Range: 'bytes=0-9,20-29' } });
        expect(reply.status).toBe(200);
        expect(reply.body.equals(bytes)).toBe(true);
    });

    it('answers HEAD with headers only', async () => {
        const requestRead = readerFor(patternBytes(SIZE));
        const { bridge } = await startBridge({ requestRead });
        const { url } = registerLocal(bridge);

        const whole = await send(url, { method: 'HEAD' });
        expect(whole.status).toBe(200);
        expect(whole.headers['content-length']).toBe(String(SIZE));
        expect(whole.headers['accept-ranges']).toBe('bytes');
        expect(whole.body.byteLength).toBe(0);

        const ranged = await send(url, { method: 'HEAD', headers: { Range: 'bytes=10-19' } });
        expect(ranged.status).toBe(206);
        expect(ranged.headers['content-range']).toBe(`bytes 10-19/${SIZE}`);
        expect(ranged.headers['content-length']).toBe('10');
        expect(requestRead).not.toHaveBeenCalled();
    });

    it('answers 404 for a revoked token, an unknown token and a path without one', async () => {
        const { bridge } = await startBridge({ requestRead: readerFor(patternBytes(SIZE)) });
        const { token, url } = registerLocal(bridge);
        const origin = `http://127.0.0.1:${bridge.port()}`;

        expect((await send(url)).status).toBe(200);
        bridge.revoke(token);
        expect((await send(url)).status).toBe(404);
        expect((await send(`${origin}/${'f'.repeat(32)}/track.flac`)).status).toBe(404);
        expect((await send(`${origin}/`)).status).toBe(404);
    });

    it('answers 405 for anything but GET and HEAD', async () => {
        const requestRead = readerFor(patternBytes(SIZE));
        const { bridge } = await startBridge({ requestRead });
        const { url } = registerLocal(bridge);

        const reply = await send(url, { method: 'POST' });
        expect(reply.status).toBe(405);
        expect(reply.headers.allow).toBe('GET, HEAD');
        expect(requestRead).not.toHaveBeenCalled();
    });

    it('asks the renderer in chunks that never exceed chunkSize and cover the range exactly', async () => {
        const bytes = patternBytes(SIZE);
        const requestRead = readerFor(bytes);
        const { bridge } = await startBridge({ requestRead, chunkSize: 1024 });
        const { url } = registerLocal(bridge);

        const reply = await send(url, { headers: { Range: 'bytes=100-5000' } });
        expect(reply.body.equals(bytes.subarray(100, 5001))).toBe(true);
        expect(requestRead).toHaveBeenCalledTimes(5);
        expectContiguousReads(requestRead, 100, 5001, 1024);
    });

    it('carries on after a short read from where it stopped', async () => {
        const bytes = patternBytes(SIZE);
        const requestRead = vi.fn<RequestRead>(async (_ownerId, request) => ({
            status: 'ok',
            data: bytes.subarray(request.offset, request.offset + Math.min(request.length, 300)),
        }));
        const { bridge } = await startBridge({ requestRead, chunkSize: 1024 });
        const { url } = registerLocal(bridge);

        const reply = await send(url);
        expect(reply.complete).toBe(true);
        expect(reply.body.equals(bytes)).toBe(true);
        expect(requestRead).toHaveBeenCalledTimes(Math.ceil(SIZE / 300));
    });

    it('stops asking for chunks while mpv is not reading', async () => {
        const size = 64 * 1024 * 1024;
        const chunkSize = 64 * 1024;
        const bytes = randomBytes(size);
        const requestRead = readerFor(bytes);
        const { bridge } = await startBridge({ requestRead, chunkSize });
        const { url } = registerLocal(bridge, size);

        const reply = await new Promise<{ body: Buffer; readsWhilePaused: number }>((resolve, reject) => {
            const req = http.get(url, { agent: false }, res => {
                const chunks: Buffer[] = [];
                let readsWhilePaused = 0;
                res.pause();
                setTimeout(() => {
                    readsWhilePaused = requestRead.mock.calls.length;
                    res.on('data', (chunk: Buffer) => chunks.push(chunk));
                    res.on('end', () => resolve({ body: Buffer.concat(chunks), readsWhilePaused }));
                    res.resume();
                }, 300);
            });
            req.on('error', reject);
        });

        expect(reply.readsWhilePaused).toBeLessThan(size / chunkSize / 2);
        expect(sha256(reply.body)).toBe(sha256(bytes));
        expectContiguousReads(requestRead, 0, size, chunkSize);
    });

    it('stops pulling once mpv drops the connection', async () => {
        const size = 64 * 1024 * 1024;
        const chunkSize = 64 * 1024;
        const requestRead = readerFor(randomBytes(size));
        const { bridge, logWarn } = await startBridge({ requestRead, chunkSize });
        const { token, url } = registerLocal(bridge, size);

        await new Promise<void>((resolve, reject) => {
            const req = http.get(url, { agent: false }, res => {
                res.once('data', () => {
                    req.destroy();
                    resolve();
                });
            });
            req.on('error', () => {});
            req.on('close', () => resolve());
            setTimeout(() => reject(new Error('no data')), 2000);
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        const readsAfterClose = requestRead.mock.calls.length;
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(requestRead.mock.calls.length).toBe(readsAfterClose);
        expect(readsAfterClose).toBeLessThan(size / chunkSize);
        expect(bridge.getSourceError(token)).toBeNull();
        expect(logWarn).not.toHaveBeenCalled();
    });

    it('retries an unknown source until the renderer registers it again', async () => {
        const bytes = patternBytes(SIZE);
        let unknownLeft = 3;
        const requestRead = vi.fn<RequestRead>(async (_ownerId, request) => {
            if (unknownLeft > 0) {
                unknownLeft -= 1;
                return { status: 'unknown-source' };
            }
            return { status: 'ok', data: bytes.subarray(request.offset, request.offset + request.length) };
        });
        const { bridge } = await startBridge({ requestRead, unknownSourceRetryMs: 10, unknownSourceGiveUpMs: 2000 });
        const { token, url } = registerLocal(bridge);

        const reply = await send(url);
        expect(reply.complete).toBe(true);
        expect(reply.body.equals(bytes)).toBe(true);
        expect(requestRead).toHaveBeenCalledTimes(4);
        expect(requestRead.mock.calls.every(([, request]) => request.offset === 0)).toBe(true);
        expect(bridge.getSourceError(token)).toBeNull();
    });

    it('gives up on an unknown source after unknownSourceGiveUpMs and records SOURCE_UNREACHABLE', async () => {
        const requestRead = vi.fn<RequestRead>(async () => ({ status: 'unknown-source' }));
        const { bridge, logWarn } = await startBridge({ requestRead, unknownSourceRetryMs: 10, unknownSourceGiveUpMs: 80 });
        const { token, url } = registerLocal(bridge);

        const startedAt = Date.now();
        const reply = await send(url);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(70);
        expect(reply.complete).toBe(false);
        expect(reply.body.byteLength).toBe(0);
        expect(requestRead.mock.calls.length).toBeGreaterThan(2);
        expect(bridge.getSourceError(token)).toBe('SOURCE_UNREACHABLE');
        expect(logWarn).toHaveBeenCalled();
    });

    it.each([
        ['a failed read', { status: 'failed' } as HifiReadResponse],
        ['an empty read before the end', { status: 'ok', data: new Uint8Array(0) } as HifiReadResponse],
    ])('drops the connection on %s and records SOURCE_UNREACHABLE', async (_label, response) => {
        const requestRead = vi.fn<RequestRead>(async () => response);
        const { bridge } = await startBridge({ requestRead });
        const { token, url } = registerLocal(bridge);

        const reply = await send(url);
        expect(reply.complete).toBe(false);
        expect(reply.body.byteLength).toBe(0);
        expect(requestRead).toHaveBeenCalledTimes(1);
        expect(bridge.getSourceError(token)).toBe('SOURCE_UNREACHABLE');
    });

    it('truncates the body when a read fails after the headers went out', async () => {
        const bytes = patternBytes(SIZE);
        // 第二块像真的 IPC 一样隔一轮事件循环才回，第一块已经发出去了
        const requestRead = vi.fn<RequestRead>(async (_ownerId, request) => {
            if (request.offset === 0) return { status: 'ok', data: bytes.subarray(0, request.length) };
            await new Promise(resolve => setTimeout(resolve, 5));
            return { status: 'failed' };
        });
        const { bridge } = await startBridge({ requestRead, chunkSize: 1024 });
        const { token, url } = registerLocal(bridge);

        const reply = await send(url);
        expect(reply.status).toBe(200);
        expect(reply.headers['content-length']).toBe(String(SIZE));
        expect(reply.complete).toBe(false);
        expect(reply.body.equals(bytes.subarray(0, 1024))).toBe(true);
        expect(bridge.getSourceError(token)).toBe('SOURCE_UNREACHABLE');
    });

    it('drops the recorded error once a reconnect serves its whole range, not while one is cut short', async () => {
        const bytes = patternBytes(SIZE);
        let failNext = true;
        const requestRead = vi.fn<RequestRead>(async (_ownerId, request) => {
            if (request.offset === 1024 && failNext) {
                failNext = false;
                return { status: 'failed' };
            }
            return { status: 'ok', data: bytes.subarray(request.offset, request.offset + request.length) };
        });
        const { bridge, logInfo } = await startBridge({ requestRead, chunkSize: 1024 });
        const { token, url } = registerLocal(bridge);

        expect((await send(url)).complete).toBe(false);
        expect(bridge.getSourceError(token)).toBe('SOURCE_UNREACHABLE');
        // HEAD 什么都没送，不算恢复。
        await send(url, { method: 'HEAD' });
        expect(bridge.getSourceError(token)).toBe('SOURCE_UNREACHABLE');

        // ffmpeg 从断开的地方重连，这次一直送到了头。
        const reconnect = await send(url, { headers: { Range: 'bytes=1024-' } });
        expect(reconnect.status).toBe(206);
        expect(reconnect.complete).toBe(true);
        expect(reconnect.body.equals(bytes.subarray(1024))).toBe(true);
        await vi.waitFor(() => expect(bridge.getSourceError(token)).toBeNull());
        expect(loggedText(logInfo)).toContain('dropping the earlier error');
    });

    it('cuts a streaming connection off when its token is revoked', async () => {
        const bytes = patternBytes(SIZE);
        let release: () => void = () => {};
        const requestRead = vi.fn<RequestRead>(async (_ownerId, request) => {
            if (request.offset > 0) await new Promise<void>(resolve => { release = resolve; });
            return { status: 'ok', data: bytes.subarray(request.offset, request.offset + request.length) };
        });
        const { bridge } = await startBridge({ requestRead, chunkSize: 1024 });
        const { token, url } = registerLocal(bridge);

        const pending = send(url);
        await vi.waitFor(() => expect(requestRead).toHaveBeenCalledTimes(2));
        bridge.revoke(token);
        release();
        const reply = await pending;
        expect(reply.complete).toBe(false);
        expect(requestRead).toHaveBeenCalledTimes(2);
        expect(bridge.getSourceError(token)).toBeNull();
    });

    it('refuses to register before it listens and forgets everything on stop', async () => {
        const bridge = createSourceBridge({ requestRead: readerFor(patternBytes(SIZE)), logInfo: vi.fn(), logWarn: vi.fn() });
        bridges.push(bridge);
        expect(bridge.port()).toBeNull();
        expect(() => registerLocal(bridge)).toThrow(expect.objectContaining({ code: 'LOAD_FAILED' }));

        await bridge.start();
        const firstPort = bridge.port();
        expect(firstPort).toBeGreaterThan(0);
        const { url } = registerLocal(bridge);
        await bridge.stop();
        expect(bridge.port()).toBeNull();

        await bridge.start();
        expect((await send(url.replace(`:${firstPort}/`, `:${bridge.port()}/`))).status).toBe(404);
    });
});

describe('source bridge: remote sources', () => {
    const audioResponse = (body: BodyInit | null, status: number, headers: Record<string, string>) => new Response(body, { status, headers });

    it('passes a 206 through with its range headers and forwards only Range', async () => {
        const fetchFn = vi.fn<FetchFn>(async () => audioResponse('abcdef', 206, {
            'Content-Type': 'audio/flac',
            'Content-Length': '6',
            'Content-Range': 'bytes 10-15/100',
            'Accept-Ranges': 'bytes',
            'X-Upstream-Only': 'yes',
        }));
        const { bridge, logInfo, logWarn } = await startBridge({ fetchFn });
        const { token, url } = bridge.registerRemote({ url: REMOTE_URL, fileName: 'song-1.flac' });

        const reply = await send(url, { headers: { Range: 'bytes=10-15', 'X-Client-Only': 'yes' } });
        expect(reply.status).toBe(206);
        expect(reply.body.toString()).toBe('abcdef');
        expect(reply.headers['content-type']).toBe('audio/flac');
        expect(reply.headers['content-length']).toBe('6');
        expect(reply.headers['content-range']).toBe('bytes 10-15/100');
        expect(reply.headers['accept-ranges']).toBe('bytes');
        expect(reply.headers['x-upstream-only']).toBeUndefined();

        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [fetchedUrl, init] = fetchFn.mock.calls[0];
        expect(fetchedUrl).toBe(REMOTE_URL);
        expect(init.method).toBe('GET');
        expect(init.headers).toEqual({ Range: 'bytes=10-15' });
        expect(init.redirect).toBe('follow');
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(bridge.getSourceError(token)).toBeNull();
        expect(loggedText(logInfo)).toContain('host=music.example.com:4533');
        expectNoCredentials(logInfo, logWarn);
    });

    it('sends no Range upstream when mpv asked for the whole file', async () => {
        const fetchFn = vi.fn<FetchFn>(async () => audioResponse('abc', 200, { 'Content-Type': 'audio/mpeg' }));
        const { bridge } = await startBridge({ fetchFn });
        const { url } = bridge.registerRemote({ url: REMOTE_URL, fileName: 'song-1.mp3' });

        const reply = await send(url);
        expect(reply.status).toBe(200);
        expect(reply.body.toString()).toBe('abc');
        expect(fetchFn.mock.calls[0][1].headers).toEqual({});
    });

    it('forwards HEAD as HEAD', async () => {
        const fetchFn = vi.fn<FetchFn>(async () => audioResponse(null, 200, { 'Content-Type': 'audio/flac', 'Content-Length': '1234' }));
        const { bridge } = await startBridge({ fetchFn });
        const { url } = bridge.registerRemote({ url: REMOTE_URL, fileName: 'song-1.flac' });

        const reply = await send(url, { method: 'HEAD' });
        expect(reply.status).toBe(200);
        expect(reply.headers['content-length']).toBe('1234');
        expect(reply.body.byteLength).toBe(0);
        expect(fetchFn.mock.calls[0][1].method).toBe('HEAD');
    });

    it.each([
        'application/json; charset=utf-8',
        'text/xml',
        'text/html',
    ])('rejects a %s answer with 502 and SOURCE_REJECTED', async (contentType) => {
        const fetchFn = vi.fn<FetchFn>(async () => audioResponse('{"subsonic-response":{"status":"failed"}}', 200, { 'Content-Type': contentType }));
        const { bridge, logInfo, logWarn } = await startBridge({ fetchFn });
        const { token, url } = bridge.registerRemote({ url: REMOTE_URL, fileName: 'song-1.flac' });

        const reply = await send(url);
        expect(reply.status).toBe(502);
        expect(reply.body.byteLength).toBe(0);
        expect(bridge.getSourceError(token)).toBe('SOURCE_REJECTED');
        expectNoCredentials(logInfo, logWarn);
    });

    it('mirrors an error status and records SOURCE_UNREACHABLE', async () => {
        const fetchFn = vi.fn<FetchFn>(async () => audioResponse('not here', 404, { 'Content-Type': 'text/plain' }));
        const { bridge, logInfo, logWarn } = await startBridge({ fetchFn });
        const { token, url } = bridge.registerRemote({ url: REMOTE_URL, fileName: 'song-1.flac' });

        const reply = await send(url);
        expect(reply.status).toBe(404);
        expect(bridge.getSourceError(token)).toBe('SOURCE_UNREACHABLE');
        expectNoCredentials(logInfo, logWarn);
    });

    it('drops the recorded error once a later request streams its whole body', async () => {
        const fetchFn = vi.fn<FetchFn>()
            .mockResolvedValueOnce(audioResponse('down', 503, { 'Content-Type': 'text/plain' }))
            .mockResolvedValueOnce(audioResponse('abcdef', 206, { 'Content-Type': 'audio/flac', 'Content-Length': '6', 'Content-Range': 'bytes 10-15/16' }));
        const { bridge, logInfo, logWarn } = await startBridge({ fetchFn });
        const { token, url } = bridge.registerRemote({ url: REMOTE_URL, fileName: 'song-1.flac' });

        expect((await send(url)).status).toBe(503);
        expect(bridge.getSourceError(token)).toBe('SOURCE_UNREACHABLE');
        const retry = await send(url, { headers: { Range: 'bytes=10-' } });
        expect(retry.status).toBe(206);
        expect(retry.body.toString()).toBe('abcdef');
        await vi.waitFor(() => expect(bridge.getSourceError(token)).toBeNull());
        expectNoCredentials(logInfo, logWarn);
    });

    it('answers 502 when the fetch throws, without logging the credentials it carried', async () => {
        const fetchFn = vi.fn<FetchFn>(async () => {
            throw new TypeError(`fetch failed for ${REMOTE_URL} (t=26719a1196d2a940705a59634eb18eab)`);
        });
        const { bridge, logInfo, logWarn } = await startBridge({ fetchFn });
        const { token, url } = bridge.registerRemote({ url: REMOTE_URL, fileName: 'song-1.flac' });

        const reply = await send(url);
        expect(reply.status).toBe(502);
        expect(bridge.getSourceError(token)).toBe('SOURCE_UNREACHABLE');
        expect(logWarn).toHaveBeenCalled();
        expect(loggedText(logWarn)).toContain('music.example.com');
        expectNoCredentials(logInfo, logWarn);
    });

    it('logs a thrown error as is when it carries no credentials', async () => {
        const failure = new TypeError('net::ERR_CONNECTION_REFUSED');
        const fetchFn = vi.fn<FetchFn>(async () => {
            throw failure;
        });
        const { bridge, logWarn } = await startBridge({ fetchFn });
        const { url } = bridge.registerRemote({ url: REMOTE_URL, fileName: 'song-1.flac' });

        await send(url);
        expect(logWarn.mock.calls.some(args => args.includes(failure))).toBe(true);
    });

    it('aborts the upstream fetch when mpv disconnects', async () => {
        let signal: AbortSignal | null = null;
        const fetchFn = vi.fn<FetchFn>(async (_url, init) => {
            signal = init.signal;
            let sent = 0;
            let cancelled = false;
            const body = new ReadableStream<Uint8Array>({
                pull: controller => new Promise<void>(resolve => {
                    setTimeout(() => {
                        if (!cancelled) controller.enqueue(new Uint8Array(4096).fill(sent & 0xff));
                        sent += 1;
                        resolve();
                    }, 5);
                }),
                cancel: () => {
                    cancelled = true;
                },
            });
            return audioResponse(body, 200, { 'Content-Type': 'audio/flac' });
        });
        const { bridge, logInfo, logWarn } = await startBridge({ fetchFn });
        const { token, url } = bridge.registerRemote({ url: REMOTE_URL, fileName: 'song-1.flac' });

        await new Promise<void>(resolve => {
            const req = http.get(url, { agent: false }, res => {
                res.once('data', () => {
                    req.destroy();
                    resolve();
                });
            });
            req.on('error', () => {});
        });

        await vi.waitFor(() => expect(signal?.aborted).toBe(true));
        expect(bridge.getSourceError(token)).toBeNull();
        expect(logWarn).not.toHaveBeenCalled();
        expectNoCredentials(logInfo, logWarn);
    });

    it('accepts only http and https source URLs', async () => {
        const { bridge } = await startBridge({ fetchFn: vi.fn<FetchFn>() });
        expect(() => bridge.registerRemote({ url: 'file:///etc/passwd', fileName: 'x.flac' })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
        expect(() => bridge.registerRemote({ url: 'not a url', fileName: 'x.flac' })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    });
});
