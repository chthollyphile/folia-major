import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { KUGOU_OPERATIONS } from '../../../src/services/onlineMusic/kugouTransport';

// test/unit/electron/kugouApiBridge.test.ts

const require = createRequire(import.meta.url);
const { createKugouApiBridge, OPERATION_MODULES } = require('../../../electron/kugouApiBridge.cjs');

const createStore = () => {
    const values = new Map<string, unknown>();
    return {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
    };
};

describe('Electron KuGou API bridge', () => {
    it('absorbs credentials, returns the raw body, and reuses the session', async () => {
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
        expect(login).toEqual({ data: { status: 4, token: 'secret-token', userid: '123' } });
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
        const bridge = createKugouApiBridge({
            store,
            apiLoader: () => ({ register_dev: registerDev, song_url: songUrl }),
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
    });

    it('rejects operations outside the fixed allowlist', async () => {
        const bridge = createKugouApiBridge({ store: createStore(), apiLoader: () => ({}) });
        await expect(bridge.request('arbitrary_url', {})).rejects.toThrow('Unsupported KuGou operation');
    });

    it('keeps Electron and renderer operation allowlists aligned', () => {
        expect(Object.keys(OPERATION_MODULES).sort()).toEqual([...KUGOU_OPERATIONS].sort());
    });

    it('routes KRM catalog metadata through the authenticated bridge session', async () => {
        const store = createStore();
        store.set('KUGOU_API_SESSION_V1', { dfid: 'device', token: 'token', userid: '9' });
        const krmAudio = vi.fn(async () => ({ body: { data: [{ base: { album_id: 7 } }] }, cookie: [] }));
        const bridge = createKugouApiBridge({
            store,
            apiLoader: () => ({ krm_audio: krmAudio }),
        });

        await expect(bridge.request('krm_audio', {
            album_audio_id: '42', fields: 'album_info,authors.base,base,audio_info',
        })).resolves.toEqual({ data: [{ base: { album_id: 7 } }] });
        expect(krmAudio).toHaveBeenCalledWith(expect.objectContaining({
            album_audio_id: '42',
            cookie: expect.objectContaining({ dfid: 'device', token: 'token', userid: '9' }),
        }));
    });

});
