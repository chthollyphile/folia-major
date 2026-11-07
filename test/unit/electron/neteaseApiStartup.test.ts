import { readFileSync } from 'node:fs';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/neteaseApiStartup.test.ts

const {
    OFFLINE_RETRY_GAP_MS,
    createLoginQrCheck,
    installLoginQrCheck,
    refreshAnonymousToken,
    resolveXeapiPublicKey,
    startsAgainWhenNeeded,
    waitUntilListening,
    withQrNetworkRetry,
    withoutImplicitClientIp,
} = require('../../../electron/netease/neteaseApiStartup.cjs') as {
    OFFLINE_RETRY_GAP_MS: number;
    createLoginQrCheck: (
        createOption: (query: Record<string, unknown>) => Record<string, unknown>,
    ) => (
        query: Record<string, unknown>,
        request: (uri: string, data: unknown, options: Record<string, unknown>) => Promise<any>,
    ) => Promise<unknown>;
    installLoginQrCheck: () => void;
    startsAgainWhenNeeded: (status: Record<string, unknown>, now: number) => boolean;
    waitUntilListening: (server: net.Server, timeoutMs?: number) => Promise<net.Server>;
    withQrNetworkRetry: (
        request: (uri: string, data: any, options: any) => Promise<unknown>,
        options?: Record<string, unknown>,
    ) => (uri: string, data?: any, options?: any) => Promise<unknown>;
    withoutImplicitClientIp: (
        request: (uri: string, data: unknown, options: Record<string, unknown>) => unknown,
    ) => (uri: string, data: unknown, options?: Record<string, unknown>) => unknown;
    refreshAnonymousToken: (options: Record<string, unknown>) => Promise<boolean>;
    resolveXeapiPublicKey: (options: Record<string, unknown>) => Promise<{
        publicKey: Record<string, unknown>;
        refreshed: boolean;
    }>;
};

// 上游 axios 请求没有超时，网络黑洞时会一直挂住；这里用一个永不 settle 的 promise 模拟。
const neverSettles = () => new Promise(() => {});

const quietLogger = {
    warn: vi.fn(),
};

const immediateRetryOptions = () => ({
    sleep: vi.fn().mockResolvedValue(undefined),
    random: () => 0,
});

describe('NetEase API startup recovery', () => {
    it('retries xeapi key refresh with exponential backoff', async () => {
        const getXeapiPublicKey = vi.fn()
            .mockRejectedValueOnce(new Error('temporary one'))
            .mockResolvedValueOnce({ version: 'invalid-response' })
            .mockResolvedValue({ sk: 'fresh-key', version: '2' });
        const retryOptions = immediateRetryOptions();

        const result = await resolveXeapiPublicKey({
            currentPublicKey: { sk: 'cached-key', version: '1' },
            deviceId: 'device-id',
            getXeapiPublicKey,
            logger: quietLogger,
            retryOptions,
        });

        expect(result).toEqual({
            publicKey: { sk: 'fresh-key', version: '2' },
            refreshed: true,
        });
        expect(getXeapiPublicKey).toHaveBeenCalledTimes(3);
        expect(retryOptions.sleep).toHaveBeenNthCalledWith(1, 250);
        expect(retryOptions.sleep).toHaveBeenNthCalledWith(2, 500);
    });

    it('uses a valid cached xeapi key after refresh attempts fail', async () => {
        const cachedKey = { sk: 'cached-key', version: '1' };
        const getXeapiPublicKey = vi.fn().mockRejectedValue(new Error('offline'));

        const result = await resolveXeapiPublicKey({
            currentPublicKey: cachedKey,
            deviceId: 'device-id',
            getXeapiPublicKey,
            logger: quietLogger,
            retryOptions: immediateRetryOptions(),
        });

        expect(result).toEqual({ publicKey: cachedKey, refreshed: false });
        expect(getXeapiPublicKey).toHaveBeenCalledTimes(3);
    });

    it('still rejects when refresh fails and no usable cached xeapi key exists', async () => {
        const getXeapiPublicKey = vi.fn().mockRejectedValue(new Error('offline'));

        await expect(resolveXeapiPublicKey({
            currentPublicKey: { version: '1' },
            deviceId: 'device-id',
            getXeapiPublicKey,
            logger: quietLogger,
            retryOptions: immediateRetryOptions(),
        })).rejects.toThrow('offline');
        expect(getXeapiPublicKey).toHaveBeenCalledTimes(3);
    });

    // First start with no stored key: only the network's failure is marked, and only it starts again
    // when a request needs it, no sooner than the gap after the failure.
    it('marks a start as offline only where the request did not get through, and lets startsAgainWhenNeeded allow a start after the gap', async () => {
        const failedWith = (error: unknown) => resolveXeapiPublicKey({
            currentPublicKey: {}, deviceId: 'device-id', logger: quietLogger, retryOptions: immediateRetryOptions(),
            getXeapiPublicKey: vi.fn().mockRejectedValue(error),
        }).catch((thrown: unknown) => thrown);
        // What axios 1.20.0 rejects with, as measured under Node: a name that does not resolve, and its own timeout.
        const axiosError = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(code), { isAxiosError: true, code, ...extra });
        expect(await failedWith(axiosError('ENOTFOUND'))).toMatchObject({ offline: true });
        expect(await failedWith(axiosError('ECONNABORTED'))).toMatchObject({ offline: true });
        // NetEase answered, with an error; a request cancelled; an answer that could not be used: not the network.
        expect(await failedWith(axiosError('ERR_BAD_RESPONSE', { response: { status: 500 } }))).not.toHaveProperty('offline');
        // An answer came back before the line broke: the request did get through.
        expect(await failedWith(axiosError('ECONNRESET', { response: { status: 200 } }))).not.toHaveProperty('offline');
        expect(await failedWith(axiosError('ERR_CANCELED'))).not.toHaveProperty('offline');
        expect(await failedWith(new Error('xeapi public key response signature mismatch'))).not.toHaveProperty('offline');

        const failedAt = 1_000_000;
        const down = { status: 'error', port: null, error: 'getaddrinfo ENOTFOUND interface.music.163.com', offline: true, updatedAt: failedAt };
        expect(startsAgainWhenNeeded(down, failedAt + OFFLINE_RETRY_GAP_MS - 1)).toBe(false);
        expect(startsAgainWhenNeeded(down, failedAt + OFFLINE_RETRY_GAP_MS)).toBe(true);
        expect(startsAgainWhenNeeded({ ...down, offline: false }, failedAt + 10 * OFFLINE_RETRY_GAP_MS)).toBe(false);
        expect(startsAgainWhenNeeded({ ...down, status: 'starting' }, failedAt + 10 * OFFLINE_RETRY_GAP_MS)).toBe(false);
    });

    it('retries anonymous registration and persists a valid token', async () => {
        const registerAnonymous = vi.fn()
            .mockRejectedValueOnce(new Error('temporary'))
            .mockResolvedValue({ body: { cookie: 'MUSIC_A=anonymous-token' } });
        const persistToken = vi.fn();

        const refreshed = await refreshAnonymousToken({
            registerAnonymous,
            cookieToJson: () => ({ MUSIC_A: 'anonymous-token' }),
            persistToken,
            logger: quietLogger,
            retryOptions: immediateRetryOptions(),
        });

        expect(refreshed).toBe(true);
        expect(registerAnonymous).toHaveBeenCalledTimes(2);
        expect(persistToken).toHaveBeenCalledWith('anonymous-token');
    });

    it('accepts anonymous cookies returned in the top-level cookie array', async () => {
        const registerAnonymous = vi.fn().mockResolvedValue({
            status: 200,
            body: { code: 200 },
            cookie: ['MUSIC_A=anonymous-token', '__csrf=csrf-token'],
        });
        const cookieToJson = vi.fn().mockReturnValue({ MUSIC_A: 'anonymous-token' });
        const persistToken = vi.fn();

        const refreshed = await refreshAnonymousToken({
            registerAnonymous,
            cookieToJson,
            persistToken,
            logger: quietLogger,
            retryOptions: immediateRetryOptions(),
        });

        expect(refreshed).toBe(true);
        expect(cookieToJson).toHaveBeenCalledWith(
            'MUSIC_A=anonymous-token;__csrf=csrf-token',
        );
        expect(persistToken).toHaveBeenCalledWith('anonymous-token');
    });

    it('includes the upstream response status when anonymous registration fails', async () => {
        const logger = { warn: vi.fn() };
        const registerAnonymous = vi.fn().mockResolvedValue({
            status: 503,
            body: { code: 503, msg: 'service unavailable' },
            cookie: [],
        });

        const refreshed = await refreshAnonymousToken({
            registerAnonymous,
            cookieToJson: vi.fn(),
            persistToken: vi.fn(),
            logger,
            retryOptions: immediateRetryOptions(),
        });

        expect(refreshed).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining(
                'status=503, code=503, message=service unavailable',
            ),
        );
    });

    it('keeps the existing anonymous token when all refresh attempts fail', async () => {
        const registerAnonymous = vi.fn().mockRejectedValue(new Error('offline'));
        const persistToken = vi.fn();

        const refreshed = await refreshAnonymousToken({
            registerAnonymous,
            cookieToJson: vi.fn(),
            persistToken,
            logger: quietLogger,
            retryOptions: immediateRetryOptions(),
        });

        expect(refreshed).toBe(false);
        expect(registerAnonymous).toHaveBeenCalledTimes(3);
        expect(persistToken).not.toHaveBeenCalled();
    });

    it('times out a hung xeapi refresh instead of stalling startup', async () => {
        const cachedKey = { sk: 'cached-key', version: '1' };
        const getXeapiPublicKey = vi.fn(neverSettles);

        const result = await resolveXeapiPublicKey({
            currentPublicKey: cachedKey,
            deviceId: 'device-id',
            getXeapiPublicKey,
            logger: quietLogger,
            retryOptions: immediateRetryOptions(),
            timeoutMs: 5,
        });

        expect(result).toEqual({ publicKey: cachedKey, refreshed: false });
        expect(getXeapiPublicKey).toHaveBeenCalledTimes(3);
    });

    it('times out a hung anonymous registration instead of stalling startup', async () => {
        const registerAnonymous = vi.fn(neverSettles);
        const persistToken = vi.fn();

        const refreshed = await refreshAnonymousToken({
            registerAnonymous,
            cookieToJson: vi.fn(),
            persistToken,
            logger: quietLogger,
            retryOptions: immediateRetryOptions(),
            timeoutMs: 5,
        });

        expect(refreshed).toBe(false);
        expect(registerAnonymous).toHaveBeenCalledTimes(3);
        expect(persistToken).not.toHaveBeenCalled();
    });
});

describe('NetEase API listen wait', () => {
    const servers: net.Server[] = [];
    // A real server on this machine's loopback address; closed after the test.
    const createServer = () => {
        const server = net.createServer();
        servers.push(server);
        return server;
    };

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
            if (server.listening) server.close(resolve);
            else resolve(undefined);
        })));
    });

    it('resolves once a server on a free port listens, and leaves no listener behind', async () => {
        const server = createServer();
        server.listen(0, '127.0.0.1');
        expect(server.listening).toBe(false);

        await expect(waitUntilListening(server)).resolves.toBe(server);
        expect(server.listening).toBe(true);
        expect(server.listenerCount('error') + server.listenerCount('listening')).toBe(0);
    });

    it('rejects with EADDRINUSE when another server holds the port', async () => {
        const holder = createServer();
        holder.listen(0, '127.0.0.1');
        await waitUntilListening(holder);
        const { port } = holder.address() as net.AddressInfo;

        const server = createServer();
        server.listen(port, '127.0.0.1');

        await expect(waitUntilListening(server)).rejects.toMatchObject({ code: 'EADDRINUSE' });
        expect(server.listening).toBe(false);
    });

    it('resolves at once for a server that already listens', async () => {
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

        await expect(waitUntilListening(server)).resolves.toBe(server);
    });

    it('fails instead of waiting for ever when the server never says how the listen went', async () => {
        // Never told to listen: neither event comes.
        const server = createServer();

        await expect(waitUntilListening(server, 5)).rejects.toThrow('timed out after 5ms');
    });
});

describe('NetEase API client IP policy', () => {
    it('drops the implicit client IP so NetEase sees the real egress address', () => {
        const request = vi.fn();
        withoutImplicitClientIp(request)('/api/login/qrcode/client/login', { key: 'k' }, { ip: '116.1.2.3', cookie: 'c' });
        expect(request).toHaveBeenCalledWith('/api/login/qrcode/client/login', { key: 'k' }, { ip: '', cookie: 'c' });
    });

    it('keeps the random CN IP when a request opts into randomCNIP', () => {
        const request = vi.fn();
        const options = { ip: '116.1.2.3', randomCNIP: true };
        withoutImplicitClientIp(request)('/api/song/enhance/player/url/v1', {}, options);
        expect(request).toHaveBeenCalledWith('/api/song/enhance/player/url/v1', {}, options);
    });
});

describe('NetEase QR check module', () => {
    const createOption = (query: Record<string, unknown>) => ({ cookie: query.cookie });
    const upstreamLoginQrCheck = require('@neteasecloudmusicapienhanced/api/module/login_qr_check') as (
        query: Record<string, unknown>,
        request: (uri: string, data: unknown, options: Record<string, unknown>) => Promise<any>,
    ) => Promise<unknown>;
    const upstreamCreateOption = require('@neteasecloudmusicapienhanced/api/util/option') as (
        query: Record<string, unknown>,
    ) => Record<string, unknown>;

    // 上游一旦修好这个 bug，这条会失败：届时删掉 installLoginQrCheck 和 createLoginQrCheck。
    it('is still needed: the upstream module throws a ReferenceError on a rejected poll', async () => {
        const request = vi.fn().mockRejectedValue({ status: 502, body: { code: 502, msg: 'read ECONNRESET' }, cookie: [] });
        await expect(upstreamLoginQrCheck({ key: 'k' }, request)).rejects.toBeInstanceOf(ReferenceError);
    });

    it('matches the upstream module on success', async () => {
        const answer = { status: 200, body: { code: 802, message: '授权中' }, cookie: ['NMTID=b'] };
        const upstreamRequest = vi.fn().mockResolvedValue(answer);
        const ownRequest = vi.fn().mockResolvedValue(answer);
        const query = { key: 'k', cookie: 'os=pc', timestamp: '1' };

        await expect(createLoginQrCheck(upstreamCreateOption)(query, ownRequest))
            .resolves.toEqual(await upstreamLoginQrCheck(query, upstreamRequest));
        expect(ownRequest.mock.calls).toEqual(upstreamRequest.mock.calls);
    });

    it('returns the poll result with the cookie joined into the body', async () => {
        const request = vi.fn().mockResolvedValue({ status: 200, body: { code: 803, message: 'ok' }, cookie: ['MUSIC_U=a', 'NMTID=b'] });
        await expect(createLoginQrCheck(createOption)({ key: 'k', cookie: 'c' }, request)).resolves.toEqual({
            status: 200,
            body: { code: 803, message: 'ok', cookie: 'MUSIC_U=a;NMTID=b' },
            cookie: ['MUSIC_U=a', 'NMTID=b'],
        });
        expect(request).toHaveBeenCalledWith('/api/login/qrcode/client/login', { key: 'k', type: 3 }, { cookie: 'c' });
    });

    // 上游原版在这里抛 ReferenceError，server 只能回 404；现在 server 拿到的是 request 的 answer。
    it.each([
        { status: 502, body: { code: 502, msg: 'read ECONNRESET' }, cookie: [] },
        { status: 400, body: { code: 8821, message: '需要行为验证码验证' }, cookie: [] },
    ])('rethrows the rejected answer $body.code so the server can relay it', async answer => {
        const request = vi.fn().mockRejectedValue(answer);
        await expect(createLoginQrCheck(createOption)({ key: 'k' }, request)).rejects.toBe(answer);
    });
});

describe('NetEase QR network retry', () => {
    const RESET = { status: 502, body: { code: 502, msg: 'read ECONNRESET' }, cookie: [] };
    const retryOptions = () => ({ sleep: vi.fn().mockResolvedValue(undefined), logger: { warn: vi.fn() } });

    it.each(['/api/login/qrcode/unikey', '/api/login/qrcode/client/login'])('sends %s once more after a network-level failure', async (uri) => {
        const ok = { status: 200, body: { code: 801 }, cookie: [] };
        const request = vi.fn().mockRejectedValueOnce(RESET).mockResolvedValueOnce(ok);
        const options = retryOptions();

        await expect(withQrNetworkRetry(request, options)(uri, { key: 'k' }, { cookie: { os: 'pc' } })).resolves.toBe(ok);

        expect(request).toHaveBeenCalledTimes(2);
        expect(options.sleep).toHaveBeenCalledWith(300);
        // 每次都是新的 data / cookie 对象：上游会往 data 上写字段，重发不能带着上一次的改动。
        const [[, firstData, firstOptions], [, secondData, secondOptions]] = request.mock.calls;
        expect(secondData).toEqual({ key: 'k' });
        expect(secondData).not.toBe(firstData);
        expect(secondOptions.cookie).not.toBe(firstOptions.cookie);
    });

    it('gives up after the second failure and hands back that answer', async () => {
        const second = { status: 502, body: { code: 502, msg: 'connect ETIMEDOUT 59.111.181.35:443' }, cookie: [] };
        const request = vi.fn().mockRejectedValueOnce(RESET).mockRejectedValueOnce(second);

        await expect(withQrNetworkRetry(request, retryOptions())('/api/login/qrcode/client/login')).rejects.toBe(second);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('does not retry a NetEase rejection or a request outside the QR flow', async () => {
        const riskControl = { status: 400, body: { code: 8821, message: '需要行为验证码验证' }, cookie: [] };
        const rejected = vi.fn().mockRejectedValue(riskControl);
        await expect(withQrNetworkRetry(rejected, retryOptions())('/api/login/qrcode/client/login')).rejects.toBe(riskControl);
        expect(rejected).toHaveBeenCalledTimes(1);

        const other = vi.fn().mockRejectedValue(RESET);
        await expect(withQrNetworkRetry(other, retryOptions())('/api/song/enhance/player/url/v1')).rejects.toBe(RESET);
        expect(other).toHaveBeenCalledTimes(1);
    });

    // 2026-10-26：启动后第一次问「谁登录着」会撞上上游一次连接级别的超时（实测两次 ETIMEDOUT 共 42 秒，之后
    // 同一条链路 81ms 就通）。读接口重发一次没有副作用，之前不重试的话 UI 直接看到 502、账号区停在「问不到」。
    it.each(['/api/w/nuser/account/get', '/api/nuser/account/get'])('sends the read-only account route %s once more after a network-level failure', async (uri) => {
        const ok = { status: 200, body: { code: 200, account: null, profile: null }, cookie: [] };
        const request = vi.fn().mockRejectedValueOnce(RESET).mockResolvedValueOnce(ok);
        const options = retryOptions();

        await expect(withQrNetworkRetry(request, options)(uri)).resolves.toBe(ok);

        expect(request).toHaveBeenCalledTimes(2);
        expect(options.sleep).toHaveBeenCalledWith(300);
    });
});

describe('NetEase API sign-in check module', () => {
    it('is the app\'s own once installed, and the worker installs it before the package\'s main and server load', async () => {
        installLoginQrCheck();
        // The path server.js requires when it reads its module folder.
        const check = require('@neteasecloudmusicapienhanced/api/module/login_qr_check.js') as (
            query: Record<string, unknown>, request: () => Promise<unknown>,
        ) => Promise<unknown>;
        // util/request.js's answer when NetEase is not reached. The package's own module throws a ReferenceError here.
        const notThrough = { status: 502, body: { code: 502, msg: 'getaddrinfo ENOTFOUND interfacepc.music.163.com' }, cookie: [] };
        await expect(check({ key: 'qr-key', cookie: {} }, () => Promise.reject(notThrough))).rejects.toBe(notThrough);

        const worker = readFileSync(new URL('../../../electron/netease/neteaseApiWorker.cjs', import.meta.url), 'utf8');
        const installedAt = worker.indexOf('installLoginQrCheck();');
        expect(installedAt).toBeGreaterThan(-1);
        expect(installedAt).toBeLessThan(worker.indexOf('require(`${NCM_PACKAGE}/main`)'));
        expect(installedAt).toBeLessThan(worker.indexOf('require(`${NCM_PACKAGE}/server`)'));
    });
});
