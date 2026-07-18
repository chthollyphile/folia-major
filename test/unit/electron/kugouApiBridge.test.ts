import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/kugouApiBridge.test.ts

const require = createRequire(import.meta.url);
const { createKugouApiBridge } = require('../../../electron/kugouApiBridge.cjs');

const createStore = () => {
    const values = new Map<string, unknown>();
    return {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
    };
};

describe('Electron KuGou API bridge', () => {
    it('absorbs credentials, strips secrets, and reuses the session', async () => {
        const userDetail = vi.fn(async (params: any) => ({
            body: { data: { nickname: 'Kugou User' } },
            cookie: [],
        }));
        const api = {
            register_dev: async () => ({ body: { status: 1 }, cookie: ['dfid=device-dfid'] }),
            login_qr_check: async () => ({
                body: { data: { status: 4, token: 'secret-token', userid: '123' } },
                cookie: ['token=secret-token', 'userid=123'],
            }),
            user_detail: userDetail,
        };
        const bridge = createKugouApiBridge({ store: createStore(), apiLoader: () => api });

        const login = await bridge.request('login_qr_check', { key: 'qr' });
        expect(login).toEqual({ data: { status: 4 } });
        const profile = await bridge.request('user_detail', { userid: 'renderer-user-id' });
        expect(profile).toEqual({ data: { nickname: 'Kugou User', userid: '123' } });
        expect(userDetail.mock.calls[0][0].userid).toBe('123');
        expect(userDetail.mock.calls[0][0].cookie).toEqual(expect.objectContaining({
            token: 'secret-token', userid: '123', dfid: 'device-dfid',
        }));
    });

    it('clears account credentials without deleting the device identity', async () => {
        const store = createStore();
        const bridge = createKugouApiBridge({ store, apiLoader: () => ({
            register_dev: async () => ({ body: {}, cookie: ['dfid=device'] }),
            login_qr_check: async () => ({ body: { data: { status: 4 } }, cookie: ['token=secret', 'userid=9'] }),
        }) });
        await bridge.request('login_qr_check', {});
        await expect(bridge.request('logout')).resolves.toEqual({ code: 200 });
        const stored = store.get('KUGOU_API_SESSION_V1') as Record<string, string>;
        expect(stored.token).toBeUndefined();
        expect(stored.userid).toBeUndefined();
        expect(stored.KUGOU_API_GUID).toBeTruthy();
    });

    it('refreshes an invalid dfid and retries an audio URL request once', async () => {
        const store = createStore();
        store.set('KUGOU_API_SESSION_V1', { dfid: 'stale-dfid', token: 'token', userid: '9' });
        const registerDev = vi.fn(async () => ({ body: { status: 1 }, cookie: ['dfid=fresh-dfid'] }));
        const songUrl = vi.fn(async (params: any) => (
            params.cookie.dfid === 'fresh-dfid'
                ? { body: { status: 1, url: ['https://example.test/song.mp3'] }, cookie: [] }
                : { body: { status: 0, errcode: 20028, error: '本次请求需要验证' }, cookie: [] }
        ));
        const logger = { info: vi.fn(), warn: vi.fn() };
        const bridge = createKugouApiBridge({
            store,
            apiLoader: () => ({ register_dev: registerDev, song_url: songUrl }),
            logger,
        });

        await expect(bridge.request('song_url', { hash: 'HASH', quality: '128' })).resolves.toEqual({
            status: 1,
            url: ['https://example.test/song.mp3'],
        });
        expect(registerDev).toHaveBeenCalledTimes(1);
        expect(songUrl).toHaveBeenCalledTimes(2);
        expect(songUrl.mock.calls[1][0].cookie).toEqual(expect.objectContaining({
            dfid: 'fresh-dfid', token: 'token', userid: '9',
        }));
        expect(logger.warn).toHaveBeenCalledWith('[KuGouApi] song_url:verification-required', expect.objectContaining({
            requestId: 1,
            errorCode: 20028,
        }));
        expect(logger.info).toHaveBeenCalledWith('[KuGouApi] song_url:retry', {
            requestId: 1,
            reason: 'device-verification',
        });
        expect(logger.info).toHaveBeenCalledWith('[KuGouApi] song_url:success', expect.objectContaining({
            requestId: 1,
            audioUrlCandidateCount: 1,
        }));
    });

    it('rejects operations outside the fixed allowlist', async () => {
        const bridge = createKugouApiBridge({ store: createStore(), apiLoader: () => ({}) });
        await expect(bridge.request('arbitrary_url', {})).rejects.toThrow('Unsupported KuGou operation');
    });

});
