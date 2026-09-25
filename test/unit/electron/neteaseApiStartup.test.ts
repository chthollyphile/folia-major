import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/neteaseApiStartup.test.ts

const {
    refreshAnonymousToken,
    resolveXeapiPublicKey,
    withoutImplicitClientIp,
} = require('../../../electron/neteaseApiStartup.cjs') as {
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
