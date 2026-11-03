import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/neteaseLoginDiagnostics.test.ts

const require = createRequire(import.meta.url);
const { createNeteaseLoginDiagnostics } = require('../../../electron/netease/neteaseLoginDiagnostics.cjs') as {
    createNeteaseLoginDiagnostics: (options?: Record<string, unknown>) => {
        wrapRequest: (request: (...args: any[]) => Promise<unknown>) => (uri: string, data: unknown, options?: Record<string, unknown>) => Promise<unknown>;
        noteStartup: (patch: Record<string, unknown>) => void;
        snapshot: () => any;
    };
};
const { withoutImplicitClientIp } = require('../../../electron/netease/neteaseApiStartup.cjs') as {
    withoutImplicitClientIp: (request: (...args: any[]) => unknown) => (uri: string, data: unknown, options?: Record<string, unknown>) => Promise<unknown>;
};

const createDiagnostics = (overrides: Record<string, unknown> = {}) => {
    let clock = 1_000;
    return createNeteaseLoginDiagnostics({
        now: () => (clock += 25),
        getDefaultDeviceId: () => 'GLOBALDEVICE123456',
        networkInterfaces: () => ({}),
        logger: { info: vi.fn(), warn: vi.fn() },
        ...overrides,
    });
};

describe('NetEase login diagnostics', () => {
    it('records the NetEase code that the upstream QR check would swallow into a 404', async () => {
        const diagnostics = createDiagnostics();
        const request = vi.fn().mockRejectedValue({ status: 400, body: { code: 8821, message: '需要行为验证码验证' } });
        const wrapped = withoutImplicitClientIp(diagnostics.wrapRequest(request));

        await expect(wrapped('/api/login/qrcode/client/login', { key: 'k' }, {
            ip: '116.1.2.3',
            cookie: { deviceId: 'COOKIEDEVICEABCDEF', MUSIC_A: 'anon' },
        })).rejects.toMatchObject({ body: { code: 8821 } });

        const [record] = diagnostics.snapshot().requests;
        expect(record).toMatchObject({
            uri: '/api/login/qrcode/client/login',
            // 包在来源 IP 策略里面，看到的是最终发出去的请求：隐式 IP 已被去掉。
            ipHeader: 'none',
            deviceIdTail: 'CEABCDEF',
            hasMusicU: false,
            hasMusicA: true,
            durationMs: 25,
            outcome: { settled: 'rejected', status: 400, code: 8821, message: '需要行为验证码验证' },
        });
    });

    it('keeps the error text as the upstream wrote it', async () => {
        const diagnostics = createDiagnostics();
        const request = vi.fn().mockRejectedValue({ status: 502, body: { code: 502, msg: 'connect ECONNREFUSED 127.0.0.1:7890' } });

        await expect(diagnostics.wrapRequest(request)('/api/login/qrcode/unikey', {}, {})).rejects.toBeDefined();

        expect(diagnostics.snapshot().requests[0].outcome.message).toBe('connect ECONNREFUSED 127.0.0.1:7890');
    });

    it('ignores requests that have nothing to do with signing in', async () => {
        const diagnostics = createDiagnostics();
        const request = vi.fn().mockResolvedValue({ status: 200, body: { code: 200 } });

        await diagnostics.wrapRequest(request)('/api/song/enhance/player/url/v1', {}, { randomCNIP: true, ip: '116.1.2.3' });

        expect(request).toHaveBeenCalledOnce();
        expect(diagnostics.snapshot().requests).toEqual([]);
    });

    it('never keeps cookie values, only whether a credential was present', async () => {
        const diagnostics = createDiagnostics();
        const request = vi.fn().mockResolvedValue({ status: 200, body: { code: 803, message: '授权登陆成功', cookie: 'MUSIC_U=secret' } });

        await diagnostics.wrapRequest(request)('/api/login/qrcode/client/login', {}, { cookie: 'MUSIC_U=secret; os=pc' });

        const snapshot = JSON.stringify(diagnostics.snapshot());
        expect(snapshot).not.toContain('secret');
        expect(diagnostics.snapshot().requests[0]).toMatchObject({
            hasMusicU: true,
            deviceIdTail: 'CE123456',
            outcome: { settled: 'resolved', code: 803 },
        });
    });

    it('lists every external interface with its addresses', () => {
        const diagnostics = createDiagnostics({
            networkInterfaces: () => ({
                lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
                'Wi-Fi': [
                    { address: '192.168.1.5', family: 'IPv4', internal: false },
                    { address: 'fe80::1', family: 'IPv6', internal: false, scopeid: 11 },
                    { address: '2408:8000::1', family: 'IPv6', internal: false },
                ],
                Clash: [{ address: '198.18.0.1', family: 'IPv4', internal: false }],
            }),
        });

        expect(diagnostics.snapshot().network).toEqual({
            interfaces: [
                {
                    name: 'Wi-Fi',
                    addresses: [
                        { address: '192.168.1.5', family: 4 },
                        { address: 'fe80::1', family: 6, scopeId: 11 },
                        { address: '2408:8000::1', family: 6 },
                    ],
                },
                { name: 'Clash', addresses: [{ address: '198.18.0.1', family: 4 }] },
            ],
        });
    });

    it('attaches the connections that this very request opened, matched by its recorder tag', async () => {
        const tags: string[] = [];
        const connection = {
            host: 'interfacepc.music.163.com', path: '/eapi/login/qrcode/client/login', dns: [], attempts: [],
            remote: { address: '240e::1', family: 6 }, reusedSocket: false, connectMs: 30, tlsMs: null,
            responseMs: null, totalMs: 95, status: null, error: { code: 'ECONNRESET', message: 'read ECONNRESET', phase: 'tls' },
        };
        const networkRecorder = {
            run: (tag: string, fn: () => unknown) => {
                tags.push(tag);
                return fn();
            },
            entriesForTag: (tag: string) => (tag === tags[0] ? [connection] : []),
        };
        const diagnostics = createDiagnostics({ networkRecorder });
        const request = vi.fn().mockRejectedValue({ status: 502, body: { code: 502, msg: 'read ECONNRESET' } });

        await expect(diagnostics.wrapRequest(request)('/api/login/qrcode/client/login', {}, {})).rejects.toBeDefined();

        expect(tags).toHaveLength(1);
        expect(diagnostics.snapshot().requests[0].connections).toEqual([
            expect.objectContaining({ remote: { address: '240e::1', family: 6 }, error: { code: 'ECONNRESET', message: 'read ECONNRESET', phase: 'tls' } }),
        ]);
    });
});
