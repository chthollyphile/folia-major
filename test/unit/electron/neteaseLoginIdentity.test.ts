import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/neteaseLoginIdentity.test.ts

type Request = (uri: string, data: unknown, options: Record<string, unknown>) => Promise<unknown>;
type Identity = {
    processStartedAt: number;
    deviceId: string | null;
    connectionResets: number;
    rotations: number;
    lastRotatedAt: number | null;
    lastTokenRenewed: boolean | null;
    pendingRotation: boolean;
};

const { createNeteaseLoginIdentity } = require('../../../electron/netease/neteaseLoginIdentity.cjs') as {
    createNeteaseLoginIdentity: (options: Record<string, unknown>) => {
        wrapRequest: (request: Request) => (uri: string, data: unknown, options?: Record<string, unknown>) => Promise<unknown>;
        describe: () => Identity;
    };
};

const RESET = { status: 502, body: { code: 502, msg: 'read ECONNRESET' }, cookie: [] };
const QR_KEY = '/api/login/qrcode/unikey';
const QR_CHECK = '/api/login/qrcode/client/login';

const setup = (tokens: Array<string | Error> = ['fresh-token\n']) => {
    let clock = 1_000;
    let devices = 0;
    let currentDeviceId = 'device-at-load';
    const setDeviceId = vi.fn((deviceId: string) => { currentDeviceId = deviceId; });
    // 依次返回给定的 token 文件内容；用完后重复最后一个。
    let reads = 0;
    const readAnonymousToken = () => {
        const value = tokens[Math.min(reads++, tokens.length - 1)];
        if (value instanceof Error) throw value;
        return value;
    };
    const identity = createNeteaseLoginIdentity({
        generateDeviceId: () => `device-${++devices}`,
        readAnonymousToken,
        initialAnonymousToken: 'token-at-load\n',
        setDeviceId,
        getDeviceId: () => currentDeviceId,
        now: () => clock,
        logger: { warn: vi.fn() },
    });
    return { identity, setDeviceId, tick: (ms: number) => { clock += ms; } };
};

describe('NetEase login identity rotation', () => {
    it('leaves requests untouched until a QR request is reset', async () => {
        const { identity } = setup();
        const request = vi.fn<Request>().mockResolvedValue({ status: 200 });
        const options = { crypto: '' };
        await identity.wrapRequest(request)(QR_CHECK, {}, options);
        expect(request).toHaveBeenCalledWith(QR_CHECK, {}, options);
        expect(identity.describe()).toEqual({
            processStartedAt: 1_000, deviceId: 'device-at-load', connectionResets: 0, rotations: 0,
            lastRotatedAt: null, lastTokenRenewed: null, pendingRotation: false,
        });
    });

    it('waits for the next QR key request before renewing the device id and the anonymous token', async () => {
        const { identity, setDeviceId, tick } = setup();
        const request = vi.fn<Request>().mockRejectedValueOnce(RESET).mockResolvedValue({ status: 200 });
        const wrapped = identity.wrapRequest(request);

        await expect(wrapped(QR_CHECK, {}, {})).rejects.toBe(RESET);
        expect(identity.describe()).toMatchObject({ connectionResets: 1, rotations: 0, pendingRotation: true });

        // 被重置之后、下一次要码之前的请求（例如上一轮还在路上的轮询）不换身份。
        await wrapped(QR_CHECK, {}, {});
        expect(setDeviceId).not.toHaveBeenCalled();
        expect(request).toHaveBeenLastCalledWith(QR_CHECK, {}, {});

        tick(500);
        await wrapped(QR_KEY, {}, {});
        expect(setDeviceId).toHaveBeenCalledWith('device-1');
        expect(request).toHaveBeenLastCalledWith(QR_KEY, {}, { cookie: { MUSIC_A: 'fresh-token' } });
        expect(identity.describe()).toMatchObject({
            deviceId: 'device-1', connectionResets: 1, rotations: 1, lastRotatedAt: 1_500, lastTokenRenewed: true, pendingRotation: false,
        });

        // 同一轮之后的请求沿用新身份，不再轮换。
        await wrapped(QR_CHECK, {}, { cookie: 'os=pc' });
        expect(request).toHaveBeenLastCalledWith(QR_CHECK, {}, { cookie: 'os=pc; MUSIC_A=fresh-token' });
        await wrapped(QR_KEY, {}, {});
        expect(setDeviceId).toHaveBeenCalledTimes(1);

        // 已登录（MUSIC_U）或自带匿名 cookie 的请求不动。
        for (const cookie of ['MUSIC_U=u', 'MUSIC_A=renderer', { MUSIC_U: 'u' }]) {
            await wrapped('/api/song/detail', {}, { cookie });
            expect(request).toHaveBeenLastCalledWith('/api/song/detail', {}, { cookie });
        }
    });

    it('counts every reset but rotates once per QR key request', async () => {
        const { identity, setDeviceId } = setup();
        const request = vi.fn<Request>().mockRejectedValueOnce(RESET).mockRejectedValueOnce(RESET).mockResolvedValue({ status: 200 });
        const wrapped = identity.wrapRequest(request);
        await expect(wrapped(QR_CHECK, {}, {})).rejects.toBe(RESET);
        await expect(wrapped(QR_CHECK, {}, {})).rejects.toBe(RESET);
        await wrapped(QR_KEY, {}, {});
        expect(setDeviceId).toHaveBeenCalledTimes(1);
        expect(identity.describe()).toMatchObject({ connectionResets: 2, rotations: 1, pendingRotation: false });
    });

    it('reports when a later rotation finds no newer token, and keeps the last good one when the file cannot be read', async () => {
        const { identity } = setup(['fresh-token', 'fresh-token', new Error('ENOENT')]);
        const request = vi.fn<Request>().mockResolvedValue({ status: 200 });
        const failing = vi.fn<Request>().mockRejectedValue(RESET);
        const rotateOnce = async () => {
            await expect(identity.wrapRequest(failing)(QR_CHECK, {}, {})).rejects.toBe(RESET);
            await identity.wrapRequest(request)(QR_KEY, {}, {});
        };

        await rotateOnce();
        expect(identity.describe().lastTokenRenewed).toBe(true);
        await rotateOnce();
        expect(identity.describe()).toMatchObject({ rotations: 2, lastTokenRenewed: false });
        await rotateOnce();
        expect(identity.describe()).toMatchObject({ rotations: 3, lastTokenRenewed: false });
        expect(request).toHaveBeenLastCalledWith(QR_KEY, {}, { cookie: { MUSIC_A: 'fresh-token' } });
    });

    it('does not count the token read at load as new', async () => {
        const { identity } = setup(['token-at-load']);
        await expect(identity.wrapRequest(vi.fn<Request>().mockRejectedValue(RESET))(QR_CHECK, {}, {})).rejects.toBe(RESET);
        await identity.wrapRequest(vi.fn<Request>().mockResolvedValue({ status: 200 }))(QR_KEY, {}, {});
        expect(identity.describe()).toMatchObject({ rotations: 1, lastTokenRenewed: false });
    });

    it.each([
        ['a reset outside QR login', '/api/song/detail', RESET],
        ['another network error', QR_CHECK, { status: 502, body: { code: 502, msg: 'timeout of 0ms exceeded' } }],
        ['an upstream rejection', QR_CHECK, { status: 400, body: { code: 8821, message: '需要行为验证码验证' } }],
    ])('keeps the identity on %s', async (_label, uri, error) => {
        const { identity, setDeviceId } = setup();
        await expect(identity.wrapRequest(vi.fn<Request>().mockRejectedValue(error))(uri as string, {}, {})).rejects.toBe(error);
        await identity.wrapRequest(vi.fn<Request>().mockResolvedValue({ status: 200 }))(QR_KEY, {}, {});
        expect(setDeviceId).not.toHaveBeenCalled();
        expect(identity.describe()).toMatchObject({ connectionResets: 0, rotations: 0, pendingRotation: false });
    });
});
