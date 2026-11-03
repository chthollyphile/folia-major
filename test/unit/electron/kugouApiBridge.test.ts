import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { KUGOU_OPERATIONS } from '../../../src/services/onlineMusic/kugou/kugouTransport';

// test/unit/electron/kugouApiBridge.test.ts

const require = createRequire(import.meta.url);
const {
    LEGACY_SESSION_KEY,
    SESSION_KEY,
    createKugouApiBridge,
    OPERATION_MODULES,
} = require('../../../electron/kugou/kugouApiBridge.cjs');

const createStore = () => {
    const values = new Map<string, unknown>();
    return {
        values,
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
        delete: (key: string) => values.delete(key),
    };
};

// Reversible test cipher: only the fake safeStorage sees plaintext; electron-store receives bytes
// transformed before base64 encoding, matching the real ownership boundary without OS key access.
const createSafeStorage = (backend = 'dpapi') => ({
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => backend),
    encryptString: vi.fn((plaintext: string): Buffer =>
        Buffer.from(Buffer.from(plaintext, 'utf8').map(byte => byte ^ 0xa5))),
    decryptString: vi.fn((ciphertext: Buffer) =>
        Buffer.from(Buffer.from(ciphertext).map(byte => byte ^ 0xa5)).toString('utf8')),
});

const readEncryptedCookies = (store: ReturnType<typeof createStore>, safeStorage: ReturnType<typeof createSafeStorage>) => {
    const encoded = store.get(SESSION_KEY);
    const plaintext = safeStorage.decryptString(Buffer.from(String(encoded), 'base64'));
    return JSON.parse(plaintext).cookies as Record<string, string>;
};

const seedEncryptedCookies = (
    store: ReturnType<typeof createStore>,
    safeStorage: ReturnType<typeof createSafeStorage>,
    cookies: Record<string, string>,
) => {
    const encrypted = safeStorage.encryptString(JSON.stringify({ version: 2, cookies }));
    store.set(SESSION_KEY, encrypted.toString('base64'));
};

describe('Electron KuGou API bridge', () => {
    it('absorbs credentials, returns a sanitized body, and reuses the session', async () => {
        const store = createStore();
        const safeStorage = createSafeStorage();
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
        const bridge = createKugouApiBridge({ store, safeStorage, apiLoader: () => api });

        const login = await bridge.request('login_qr_check', { key: 'qr' });
        expect(login).toEqual({ data: { status: 4, userid: '123' } });
        const profile = await bridge.request('user_detail', { userid: 'renderer-user-id' });
        expect(profile).toEqual({ data: { nickname: 'Kugou User', userid: '123' } });
        expect(userDetail.mock.calls[0][0].userid).toBe('123');
        expect(userDetail.mock.calls[0][0].cookie).toEqual(expect.objectContaining({
            token: 'secret-token', userid: '123', dfid: 'device-dfid',
        }));
        const persisted = store.get(SESSION_KEY);
        expect(persisted).toEqual(expect.any(String));
        expect(persisted).not.toContain('secret-token');
        expect(readEncryptedCookies(store, safeStorage)).toEqual(expect.objectContaining({
            token: 'secret-token', userid: '123', dfid: 'device-dfid',
        }));
    });

    it('clears account credentials without deleting the device identity', async () => {
        const store = createStore();
        const safeStorage = createSafeStorage();
        const bridge = createKugouApiBridge({ store, safeStorage, apiLoader: () => ({
            register_dev: async () => ({ body: {}, cookie: ['dfid=device'] }),
            login_qr_check: async () => ({ body: { data: { status: 4 } }, cookie: ['token=secret', 'userid=9'] }),
        }) });
        await bridge.request('login_qr_check', {});
        await expect(bridge.request('logout')).resolves.toEqual({ code: 200 });
        const stored = readEncryptedCookies(store, safeStorage);
        expect(stored.token).toBeUndefined();
        expect(stored.userid).toBeUndefined();
        expect(stored.KUGOU_API_GUID).toBeTruthy();
    });

    it('refreshes an invalid dfid and retries an audio URL request once', async () => {
        const store = createStore();
        const safeStorage = createSafeStorage();
        store.set(LEGACY_SESSION_KEY, { dfid: 'stale-dfid', token: 'token', userid: '9' });
        const registerDev = vi.fn(async () => ({ body: { status: 1 }, cookie: ['dfid=fresh-dfid'] }));
        const songUrl = vi.fn(async (params: any) => (
            params.cookie.dfid === 'fresh-dfid'
                ? { body: { status: 1, url: ['https://example.test/song.mp3'] }, cookie: [] }
                : { body: { status: 0, errcode: 20028, error: '本次请求需要验证' }, cookie: [] }
        ));
        const bridge = createKugouApiBridge({
            store,
            safeStorage,
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
        expect(store.get(LEGACY_SESSION_KEY)).toBeUndefined();
        expect(store.get(SESSION_KEY)).toEqual(expect.any(String));
    });

    it('rejects operations outside the fixed allowlist', async () => {
        const bridge = createKugouApiBridge({
            store: createStore(), safeStorage: createSafeStorage(), apiLoader: () => ({}),
        });
        await expect(bridge.request('arbitrary_url', {})).rejects.toThrow('Unsupported KuGou operation');
    });

    it('keeps Electron and renderer operation allowlists aligned', () => {
        expect(Object.keys(OPERATION_MODULES).sort()).toEqual([...KUGOU_OPERATIONS].sort());
    });

    it('routes KRM catalog metadata through the authenticated bridge session', async () => {
        const store = createStore();
        const safeStorage = createSafeStorage();
        seedEncryptedCookies(store, safeStorage, { dfid: 'device', token: 'token', userid: '9' });
        const krmAudio = vi.fn(async () => ({ body: { data: [{ base: { album_id: 7 } }] }, cookie: [] }));
        const bridge = createKugouApiBridge({
            store,
            safeStorage,
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

    it('restores an encrypted account session after the bridge is recreated', async () => {
        const store = createStore();
        const safeStorage = createSafeStorage();
        seedEncryptedCookies(store, safeStorage, {
            dfid: 'device', token: 'secret-token', userid: '9',
        });
        const userDetail = vi.fn(async () => ({ body: { data: { nickname: 'Restored User' } }, cookie: [] }));

        const restarted = createKugouApiBridge({
            store,
            safeStorage,
            apiLoader: () => ({ user_detail: userDetail }),
        });

        await expect(restarted.request('user_detail', {})).resolves.toEqual({
            data: { nickname: 'Restored User', userid: '9' },
        });
        expect(userDetail).toHaveBeenCalledWith(expect.objectContaining({
            token: 'secret-token',
            userid: '9',
            cookie: expect.objectContaining({ token: 'secret-token', userid: '9' }),
        }));
        expect(restarted.getStatus()).toEqual({ available: true, authenticated: true, error: null });
    });

    it('does not let an empty account cookie in an answer blank the stored one', async () => {
        const store = createStore();
        const safeStorage = createSafeStorage();
        seedEncryptedCookies(store, safeStorage, { dfid: 'device', token: 'secret-token', userid: '9' });
        const bridge = createKugouApiBridge({ store, safeStorage, apiLoader: () => ({
            user_detail: async () => ({ body: { data: { nickname: 'Kept User' } }, cookie: ['token=; Path=/', 'userid=', 'dfid=', 'other='] }),
        }) });
        await bridge.request('user_detail', {});
        expect(readEncryptedCookies(store, safeStorage)).toMatchObject({ dfid: 'device', token: 'secret-token', userid: '9', other: '' });
        expect(bridge.getStatus()).toMatchObject({ authenticated: true });
    });

    it('keeps a stored session it cannot load for want of OS encryption until a sign-in of this run replaces it', async () => {
        const store = createStore();
        const safeStorage = createSafeStorage();
        seedEncryptedCookies(store, safeStorage, { dfid: 'device', token: 'secret-token', userid: '9' });
        const sealed = store.get(SESSION_KEY);
        safeStorage.isEncryptionAvailable.mockReturnValue(false);
        const bridge = createKugouApiBridge({ store, safeStorage, warn: vi.fn(), apiLoader: () => ({
            register_dev: async () => ({ body: {}, cookie: ['dfid=fresh-device'] }),
            login_qr_check: async () => ({ body: { data: { status: 4 } }, cookie: ['token=new-token', 'userid=10'] }),
        }) });
        expect(bridge.getStatus()).toMatchObject({ available: true, authenticated: false });
        // Who is signed in is not known: the login check is not answered as nobody.
        await expect(bridge.request('user_detail', {})).rejects.toThrow('KuGouApi[operation=user_detail session=unreadable]');
        // The keyring comes up later in the run: the stored session is still not written over.
        safeStorage.isEncryptionAvailable.mockReturnValue(true);
        await bridge.request('register_dev', {});
        expect(store.get(SESSION_KEY)).toBe(sealed);
        await bridge.request('login_qr_check', {});
        expect(readEncryptedCookies(store, createSafeStorage())).toMatchObject({ dfid: 'fresh-device', token: 'new-token', userid: '10' });
    });

    it.each([
        ['a V2 session it cannot load without OS encryption', (store: ReturnType<typeof createStore>) => {
            seedEncryptedCookies(store, createSafeStorage(), { dfid: 'device', token: 'secret-token', userid: '9' });
        }],
        ['the old plaintext session on the plaintext Linux backend', (store: ReturnType<typeof createStore>) => {
            store.set(LEGACY_SESSION_KEY, { dfid: 'device', token: 'secret-token', userid: '9' });
        }],
    ])('removes %s at a sign-out, so the next start is signed out', async (_case, seed) => {
        const store = createStore();
        seed(store);
        const safeStorage = createSafeStorage('basic_text');
        const bridge = createKugouApiBridge({ store, safeStorage, platform: 'linux', warn: vi.fn(), apiLoader: () => ({}) });
        await bridge.request('logout');
        expect(store.get(SESSION_KEY)).toBeUndefined();
        expect(store.get(LEGACY_SESSION_KEY)).toBeUndefined();
        const next = createKugouApiBridge({ store, safeStorage: createSafeStorage(), warn: vi.fn(), apiLoader: () => ({}) });
        expect(next.getStatus()).toMatchObject({ authenticated: false });
    });

    it('removes legacy plaintext beside a V2 session it cannot load without OS encryption, keeping the V2 one', () => {
        const store = createStore();
        seedEncryptedCookies(store, createSafeStorage(), { dfid: 'device', token: 'sealed-token', userid: '9' });
        const sealed = store.get(SESSION_KEY);
        store.set(LEGACY_SESSION_KEY, { dfid: 'device', token: 'plain-token', userid: '9' });
        const bridge = createKugouApiBridge({ store, safeStorage: createSafeStorage('basic_text'), platform: 'linux', warn: vi.fn(), apiLoader: () => ({}) });
        bridge.getStatus();
        expect(store.get(LEGACY_SESSION_KEY)).toBeUndefined();
        expect(store.get(SESSION_KEY)).toBe(sealed);
    });

    it('lets a sign-in without OS encryption replace the stored session of an earlier one, so it cannot come back', async () => {
        const store = createStore();
        seedEncryptedCookies(store, createSafeStorage(), { dfid: 'device', token: 'old-token', userid: '9' });
        const bridge = createKugouApiBridge({ store, safeStorage: createSafeStorage('basic_text'), platform: 'linux', warn: vi.fn(), apiLoader: () => ({
            register_dev: async () => ({ body: {}, cookie: ['dfid=fresh-device'] }),
            login_qr_check: async () => ({ body: { data: { status: 4 } }, cookie: ['token=new-token', 'userid=10'] }),
        }) });
        await bridge.request('login_qr_check', {});
        expect(bridge.getStatus()).toMatchObject({ authenticated: true });
        expect(store.get(SESSION_KEY)).toBeUndefined();
        const next = createKugouApiBridge({ store, safeStorage: createSafeStorage(), warn: vi.fn(), apiLoader: () => ({}) });
        expect(next.getStatus()).toMatchObject({ authenticated: false });
    });

    // 每次删除都要把整份配置文件读一遍、写一遍：没有系统加密时，存着的只在这次运行第一次存不下时删一次，不是每个请求都删。
    it('removes what is stored once a run where nothing can be sealed, not at every request', async () => {
        const store = createStore();
        const remove = vi.spyOn(store, 'delete');
        const bridge = createKugouApiBridge({ store, safeStorage: createSafeStorage('basic_text'), platform: 'linux', warn: vi.fn(), apiLoader: () => ({
            register_dev: async () => ({ body: {}, cookie: ['dfid=device'] }),
            search: async () => ({ body: { data: { lists: [] } }, cookie: [] }),
        }) });
        for (const keyword of ['a', 'b', 'c']) await bridge.request('search', { keyword });
        expect(remove.mock.calls.map(([key]) => key)).toEqual([SESSION_KEY, LEGACY_SESSION_KEY]);
    });

    it('goes on with the request when the store cannot remove what it holds either', async () => {
        const store = createStore();
        const locked = { ...store, delete: () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); } };
        const warn = vi.fn();
        const bridge = createKugouApiBridge({ store: locked, safeStorage: createSafeStorage('basic_text'), platform: 'linux', warn, apiLoader: () => ({
            register_dev: async () => ({ body: {}, cookie: ['dfid=device'] }),
            search: async () => ({ body: { data: { lists: [] } }, cookie: [] }),
        }) });
        await expect(bridge.request('search', { keyword: 'a' })).resolves.toEqual({ data: { lists: [] } });
        expect(warn).toHaveBeenCalledWith('[KuGouSession] remove-failed', { name: 'Error' });
    });

    // 只是这一次写不进去时存着的留着，等下一次存；可这次登录的是另一个账号时，存着的那个删掉，下次启动不会回到它。
    it('removes the stored session of another account when only the write of a new sign-in failed', async () => {
        const store = createStore();
        const safeStorage = createSafeStorage();
        seedEncryptedCookies(store, safeStorage, { dfid: 'device', token: 'old-token', userid: '9' });
        const locked = { ...store, set: (key: string, value: unknown) => {
            if (key === SESSION_KEY) throw Object.assign(new Error('locked'), { code: 'EPERM' });
            return store.set(key, value);
        } };
        const bridge = createKugouApiBridge({ store: locked, safeStorage, platform: 'win32', warn: vi.fn(), apiLoader: () => ({
            login_qr_check: async () => ({ body: { data: { status: 4 } }, cookie: ['token=new-token', 'userid=10'] }),
        }) });
        await bridge.request('login_qr_check', {});
        expect(bridge.getStatus()).toMatchObject({ authenticated: true });
        expect(store.get(SESSION_KEY)).toBeUndefined();
    });

    it('treats a stored session the keychain will not unseal while encryption works as nothing stored', async () => {
        const store = createStore();
        const safeStorage = createSafeStorage();
        seedEncryptedCookies(store, safeStorage, { dfid: 'device', token: 'secret-token', userid: '9' });
        safeStorage.decryptString.mockImplementationOnce(() => { throw new Error('refused'); });
        const bridge = createKugouApiBridge({ store, safeStorage, warn: vi.fn(), apiLoader: () => ({}) });
        expect(bridge.getStatus()).toMatchObject({ available: true, authenticated: false });
        expect(readEncryptedCookies(store, safeStorage)).not.toHaveProperty('token');
    });

    it('keeps legacy plaintext where only the write of V2 failed, for the next save to write', async () => {
        const store = createStore();
        store.set(LEGACY_SESSION_KEY, { dfid: 'device', token: 'secret-token', userid: '9' });
        const locked = { ...store, set: (key: string, value: unknown) => {
            if (key === SESSION_KEY) throw Object.assign(new Error('locked'), { code: 'EPERM' });
            return store.set(key, value);
        } };
        const userDetail = vi.fn(async () => ({ body: { data: { nickname: 'Memory User' } }, cookie: [] }));
        const bridge = createKugouApiBridge({
            store: locked,
            safeStorage: createSafeStorage(),
            platform: 'win32',
            warn: vi.fn(),
            apiLoader: () => ({ user_detail: userDetail }),
        });

        await expect(bridge.request('user_detail', {})).resolves.toMatchObject({ data: { userid: '9' } });
        expect(store.get(LEGACY_SESSION_KEY)).toEqual({ dfid: 'device', token: 'secret-token', userid: '9' });
        expect(store.get(SESSION_KEY)).toBeUndefined();
    });

    it('removes legacy plaintext when Linux only offers basic_text, keeping it in memory for this run', async () => {
        const store = createStore();
        store.set(LEGACY_SESSION_KEY, { dfid: 'device', token: 'secret-token', userid: '9' });
        const safeStorage = createSafeStorage('basic_text');
        const warn = vi.fn();
        const userDetail = vi.fn(async () => ({ body: { data: { nickname: 'Memory User' } }, cookie: [] }));
        const bridge = createKugouApiBridge({
            store,
            safeStorage,
            platform: 'linux',
            warn,
            apiLoader: () => ({ user_detail: userDetail }),
        });

        // The migrated session remains usable for this run, but no credential stays on disk unencrypted.
        await expect(bridge.request('user_detail', {})).resolves.toMatchObject({
            data: { nickname: 'Memory User', userid: '9' },
        });
        expect(store.get(LEGACY_SESSION_KEY)).toBeUndefined();
        expect(store.get(SESSION_KEY)).toBeUndefined();
        expect(warn).toHaveBeenCalledWith('[KuGouSession] save-failed', { name: 'Error' });
    });

    describe('error normalization', () => {
        const createBridge = (api: Record<string, (...args: any[]) => Promise<unknown>>) => createKugouApiBridge({
            store: createStore(),
            safeStorage: createSafeStorage(),
            apiLoader: () => ({ register_dev: async () => ({ body: { status: 1 }, cookie: ['dfid=d'] }), ...api }),
        });

        it('turns the library answer-object rejection into an Error carrying operation, status and error_code', async () => {
            const bridge = createBridge({
                user_detail: async () => {
                    // Shape produced by kugoumusicapi's createRequest on an upstream failure.
                    throw {
                        status: 502,
                        body: { status: 0, error_code: 20028, msg: 'upstream busy', token: 'must-not-leak' },
                        cookie: ['token=must-not-leak'],
                        headers: {},
                    };
                },
            });

            const error = await bridge.request('user_detail', {}).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe('KuGouApi[operation=user_detail status=502 error_code=20028]: upstream busy');
            expect(error).toMatchObject({ operation: 'user_detail', status: 502, errorCode: 20028 });
            expect((error as Error).message).not.toContain('[object Object]');
            expect((error as Error).message).not.toContain('must-not-leak');
        });

        it('reports a network-level failure (status 502, no error_code) with its error code instead of [object Object]', async () => {
            const networkError = Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:443'), { code: 'ETIMEDOUT' });
            const bridge = createBridge({
                user_detail: async () => {
                    throw { status: 502, body: { status: 0, msg: networkError }, cookie: [], headers: {} };
                },
            });

            const error = await bridge.request('user_detail', {}).catch((caught: unknown) => caught);

            expect((error as Error).message).toContain('operation=user_detail');
            expect((error as Error).message).toContain('status=502');
            expect((error as Error).message).not.toContain('error_code');
            expect((error as Error).message).toContain('ETIMEDOUT');
            expect((error as Error).message).not.toContain('[object Object]');
        });

        it('keeps the message of an ordinary Error and tags it with the operation', async () => {
            const bridge = createBridge({
                user_detail: async () => { throw new Error('boom'); },
            });

            const error = await bridge.request('user_detail', {}).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe('KuGouApi[operation=user_detail]: boom');
        });

        it('normalizes unsupported operations too', async () => {
            const bridge = createBridge({});

            const error = await bridge.request('not_an_operation', {}).catch((caught: unknown) => caught);

            expect((error as Error).message).toContain('Unsupported KuGou operation');
            expect((error as Error).message).toContain('operation=not_an_operation');
        });
    });
});
