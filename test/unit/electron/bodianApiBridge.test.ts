import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/bodianApiBridge.test.ts — host persistence and IPC; protocol tests live in the API repository.

const require = createRequire(import.meta.url);
const { createBodianApiBridge } = require('../../../electron/bodian/bodianApiBridge.cjs');
const { createSessionRepository, SESSION_KEY } = require('../../../electron/bodian/session.cjs');
const { createBodianMediaPolicy } = require('../../../electron/bodian/mediaCors.cjs');
const { createWire } = require('../../helpers/bodianWire.cjs');
const createStore = () => {
    const values = new Map<string, unknown>();
    return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
};
const cipher = () => ({ isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 0xa5)),
    decryptString: (data: Buffer) => Buffer.from(data.map(byte => byte ^ 0xa5)).toString() });
const account = { uid: '123', token: 'fixture-private', user: { id: '123', nickname: 'Fixture', avatarUrl: '' } };

describe('Bodian desktop bridge', () => {
    it('rejects unregistered IPC operations before calling the package', async () => {
        const request = vi.fn();
        const bridge = createBodianApiBridge({ store: createStore(), apiFactory: () => ({ request }) });
        for (const [operation, params] of [['fetch', {}], ['constructor', {}], ['subscribe_playlist', {}]]) {
            expect(await bridge.request(operation, params)).toMatchObject({ ok: false });
        }
        expect(request).not.toHaveBeenCalled();
    });
    it('delegates parameter validation to the package before any network request', async () => {
        const requestFactory = vi.fn();
        const bridge = createBodianApiBridge({ store: createStore(), requestFactory });
        for (const params of [null, [], { query: {} }, { query: 'x', limit: {} }]) {
            expect(await bridge.request('search', params)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        }
        expect(requestFactory).not.toHaveBeenCalled();
    });
    it('injects the host dependencies and preserves package errors', async () => {
        const result = { ok: false, error: { code: 'auth-required', message: 'Sign in required' } };
        const apiFactory = vi.fn((_options: unknown) => ({ request: vi.fn().mockResolvedValue(result) }));
        const requestFactory = vi.fn();
        const bridge = createBodianApiBridge({ store: createStore(), apiFactory, requestFactory });
        expect(apiFactory.mock.calls[0][0]).toMatchObject({ deviceId: expect.stringMatching(/^[a-f0-9]{32}$/), requestFactory });
        expect(await bridge.request('user_albums')).toEqual(result);
    });
    it('sanitizes unexpected exceptions', async () => {
        const bridge = createBodianApiBridge({ store: createStore(), apiFactory: () => ({ request: () => { throw new Error('fixture-private'); } }) });
        const result = await bridge.request('search', { query: 'test' });
        expect(result.ok).toBe(false);
        expect(JSON.stringify(result)).not.toContain('fixture-private');
    });
    it('retains V2 encrypted sessions and the device identifier across recreation', async () => {
        const store = createStore(), safeStorage = cipher();
        const saved = createSessionRepository({ store, safeStorage }); saved.set(account);
        expect(Buffer.from(String(store.get(SESSION_KEY)), 'base64').toString()).not.toContain('fixture-private');
        const requestFactory = vi.fn();
        const bridge = createBodianApiBridge({ store, safeStorage, requestFactory });
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: account.user });
        expect(createSessionRepository({ store, safeStorage }).deviceId).toBe(saved.deviceId);
        expect(requestFactory).not.toHaveBeenCalled();
        await bridge.request('logout');
        expect(store.get(SESSION_KEY)).toBeUndefined();
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
    });
    it.each([false, true])('keeps credentials in memory for unavailable/basic_text encryption (%s)', basicText => {
        const store = createStore();
        const repository = createSessionRepository({ store, safeStorage: { ...cipher(), isEncryptionAvailable: () => basicText,
            getSelectedStorageBackend: () => 'basic_text' }, warn: vi.fn() });
        repository.set(account);
        expect(repository.get().token).toBe('fixture-private');
        expect(store.get(SESSION_KEY)).toBeUndefined();
    });
    it('replaces what is stored where a new login cannot be sealed, and leaves it where it cannot be written', () => {
        const store = createStore();
        createSessionRepository({ store, safeStorage: cipher() }).set(account);
        const sealed = store.get(SESSION_KEY);
        const warn = vi.fn();
        const unsealed = createSessionRepository({ store, safeStorage: { ...cipher(), isEncryptionAvailable: () => false }, warn });
        unsealed.set({ ...account, token: 'fixture-other' });
        unsealed.set({ ...account, token: 'fixture-third' });
        expect(store.get(SESSION_KEY)).toBeUndefined();
        store.set(SESSION_KEY, sealed);
        expect(unsealed.get().token).toBe('fixture-third');
        expect(warn).toHaveBeenCalledTimes(1);
        const locked = { ...store, set: () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); } };
        const lockedWarn = vi.fn();
        createSessionRepository({ store: locked, safeStorage: cipher(), warn: lockedWarn }).set({ ...account, token: 'fixture-other' });
        expect(store.get(SESSION_KEY)).toBe(sealed);
        expect(lockedWarn).toHaveBeenLastCalledWith('[BodianSession] Login could not be stored; what is stored stays as it was', expect.objectContaining({ code: 'EPERM' }));
        // Another account's login that cannot be written: the one stored before goes, so it does not come back at a later start.
        createSessionRepository({ store: locked, safeStorage: cipher(), warn: lockedWarn }).set({ uid: '456', token: 'fixture-another', user: { ...account.user, id: '456' } });
        expect(store.get(SESSION_KEY)).toBeUndefined();
        expect(lockedWarn).toHaveBeenLastCalledWith('[BodianSession] Login could not be stored; the one of another account stored before was removed', expect.objectContaining({ code: 'EPERM' }));
    });
    it('uses the package to clear a rejected persisted session', async () => {
        const store = createStore(), safeStorage = cipher();
        createSessionRepository({ store, safeStorage }).set(account);
        const wire = createWire(() => ({ code: 11012, data: { token: 'fixture-private' } }));
        const bridge = createBodianApiBridge({ store, safeStorage, requestFactory: wire.factory });
        const result = await bridge.request('user_albums');
        expect(result).toMatchObject({ ok: false, error: { code: 'auth-required' } });
        expect(JSON.stringify(result)).not.toContain('fixture-private');
        expect(store.get(SESSION_KEY)).toBeUndefined();
    });
    it.each([
        ['without OS encryption', { isEncryptionAvailable: () => false }],
        ['on the plaintext Linux backend', { getSelectedStorageBackend: () => 'basic_text' }],
    ])('keeps a stored session this run could not read %s when a request is refused, and removes it on a sign-out', async (_case, locked) => {
        const store = createStore(), safeStorage = cipher();
        createSessionRepository({ store, safeStorage }).set(account);
        const sealed = store.get(SESSION_KEY);
        const requestFactory = vi.fn();
        const bridge = createBodianApiBridge({ store, safeStorage: { ...cipher(), ...locked }, requestFactory, warn: vi.fn() });
        expect(await bridge.request('user_albums')).toMatchObject({ ok: false, error: { code: 'auth-required' } });
        expect(store.get(SESSION_KEY)).toBe(sealed);
        expect(requestFactory).not.toHaveBeenCalled();
        await bridge.request('logout');
        expect(store.get(SESSION_KEY)).toBeUndefined();
    });
    it.each([
        ['without OS encryption', { isEncryptionAvailable: () => false }],
        ['on the plaintext Linux backend', { getSelectedStorageBackend: () => 'basic_text' }],
    ])('does not answer a stored session it cannot read %s as nobody, and nobody once signed out', async (_case, locked) => {
        const store = createStore();
        createSessionRepository({ store, safeStorage: cipher() }).set(account);
        const bridge = createBodianApiBridge({ store, safeStorage: { ...cipher(), ...locked }, requestFactory: vi.fn(), warn: vi.fn() });
        const unknown = { ok: false, error: { code: 'unavailable', message: 'The stored Bodian sign-in cannot be read now' } };
        expect(await bridge.request('login_status')).toEqual(unknown);
        await bridge.request('user_albums');
        expect(await bridge.request('login_status')).toEqual(unknown);
        await bridge.request('logout');
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
    });
    it('treats a stored session the keychain will not unseal while encryption works as nothing stored', async () => {
        const store = createStore();
        createSessionRepository({ store, safeStorage: cipher() }).set(account);
        const refused = { ...cipher(), decryptString: () => { throw new Error('refused'); } };
        const bridge = createBodianApiBridge({ store, safeStorage: refused, requestFactory: vi.fn(), warn: vi.fn() });
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
        expect(await bridge.request('user_albums')).toMatchObject({ ok: false, error: { code: 'auth-required' } });
        expect(store.get(SESSION_KEY)).toBeUndefined();
    });
    it('preserves the package region restriction and encrypted session through the bridge', async () => {
        const store = createStore(), safeStorage = cipher();
        createSessionRepository({ store, safeStorage }).set(account);
        const sealed = store.get(SESSION_KEY);
        const wire = createWire(({ url }: { url: URL }) => url.pathname.endsWith('/checkRight')
            ? { code: 200, data: { status: 1 } }
            : { code: 407, msg: '由于版权保护，该资源仅限中国大陆地区使用' });
        const bridge = createBodianApiBridge({ store, safeStorage, requestFactory: wire.factory });
        expect(await bridge.request('audio', { id: '123' })).toEqual({ ok: false, error: {
            code: 'region-restricted', message: '由于版权保护，该资源仅限中国大陆地区使用',
        } });
        expect(store.get(SESSION_KEY)).toBe(sealed);
    });
    it('registers only successful audio results with the media policy', async () => {
        const policy = createBodianMediaPolicy(), url = 'https://audio.example.test/full.mp3';
        const request = vi.fn().mockResolvedValueOnce({ ok: true, data: { url } }).mockResolvedValueOnce({ ok: false, error: { code: 'network' } });
        const register = vi.fn(policy.register);
        const bridge = createBodianApiBridge({ store: createStore(), apiFactory: () => ({ request }), onAudioSource: register });
        await bridge.request('audio', { id: '123' }); await bridge.request('audio', { id: '456' });
        expect(register).toHaveBeenCalledTimes(1);
        expect(policy.allows({ url, resourceType: 'media', method: 'GET' })).toBe(true);
        expect(policy.allows({ url: 'https://other.example.test/full.mp3', resourceType: 'media', method: 'GET' })).toBe(false);
    });

    it.each(['https://img4.kuwo.cn/star/cover.jpg', 'http://img1.kwcdn.kuwo.cn/star/userpl2015/cover.jpg'])(
        'allows cross-origin image and canvas loads for %s', url => {
            const policy = createBodianMediaPolicy();
            for (const resourceType of ['image', 'xhr']) {
                expect(policy.allows({ url, resourceType, method: 'GET' })).toBe(true);
                expect(policy.allows({ url, resourceType, method: 'POST' })).toBe(false);
            }
        },
    );
    it('does not expand cover CORS to unrelated hosts, scripts or API responses', () => {
        const policy = createBodianMediaPolicy();
        for (const url of ['https://kuwo.cn/account', 'https://bd-api.kuwo.cn/api/user',
            'https://img1.kuwo.cn.evil.test/cover.jpg', 'https://img1.kuwo.cn/script.js']) {
            expect(policy.allows({ url, resourceType: 'xhr', method: 'GET' })).toBe(false);
        }
        expect(policy.allows({ url: 'https://img1.kuwo.cn/cover.jpg', resourceType: 'script', method: 'GET' })).toBe(false);
    });
});
