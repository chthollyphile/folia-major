import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/fnmusicApiBridge.test.ts — host persistence, parameter validation
// and protocol URL shaping for the fnOS (飞牛) music bridge.

const require = createRequire(import.meta.url);
const { createFnmusicApiBridge, FN_MUSIC_SCHEME, FN_MUSIC_PRIVILEGED_SCHEME } = require('../../../electron/fnmusic/fnmusicApiBridge.cjs');

const CONFIG_STORE_KEY = 'fnmusic-config';

const createStore = () => {
    const values = new Map<string, unknown>();
    return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
};

const cipher = () => ({
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome-libsecret',
    encryptString: (text: string) => Buffer.from(Buffer.from(text, 'utf8').map(byte => byte ^ 0xa5)),
    decryptString: (data: Buffer) => Buffer.from(data.map(byte => byte ^ 0xa5)).toString('utf8'),
});

const noEncryptionCipher = () => ({
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
});

const seededStore = () => {
    const store = createStore();
    store.set(CONFIG_STORE_KEY, cipher().encryptString(JSON.stringify({ base: 'http://192.168.2.57:5666', token: 'fixture-private-token', username: 'fixture-user' })).toString('base64'));
    return store;
};

describe('FnMusic desktop bridge', () => {
    it('exposes the folia-fnmusic protocol scheme', () => {
        expect(FN_MUSIC_SCHEME).toBe('folia-fnmusic');
        expect(FN_MUSIC_PRIVILEGED_SCHEME).toBeTypeOf('object');
    });

    it('reports unconfigured when the store holds no saved config', () => {
        const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
        expect(bridge.getStatus()).toMatchObject({ available: true, configured: false, authenticated: false, base: null });
    });

    it('rejects login with missing parameters before any network request', async () => {
        const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
        for (const params of [{}, { base: 'http://x' }, { base: 'http://x', username: 'u' }, { username: 'u', password: 'p' }]) {
            const result = await bridge.login(params);
            expect(result).toMatchObject({ ok: false, error: { code: 'invalid-params' } });
        }
    });

    it('recovers the saved encrypted config and reports authenticated', () => {
        const bridge = createFnmusicApiBridge({ store: seededStore(), safeStorage: cipher() });
        const status = bridge.getStatus();
        expect(status).toMatchObject({ configured: true, authenticated: true, base: 'http://192.168.2.57:5666', username: 'fixture-user' });
    });

    it('refuses to read persisted config when system encryption is unavailable', () => {
        // 加密不可用时与 qishui/session.cjs 一致：不落盘、不读盘，只在本次运行内保存。
        const bridge = createFnmusicApiBridge({ store: seededStore(), safeStorage: noEncryptionCipher() });
        expect(bridge.getStatus()).toMatchObject({ configured: false });
    });

    it('returns unconfigured errors for stream/coverUrl before config exists', async () => {
        const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
        expect(await bridge.stream({ trackId: 'abc' })).toMatchObject({ ok: false, error: { code: 'unconfigured' } });
        expect(await bridge.coverUrl({ coverId: 'abc' })).toMatchObject({ ok: false, error: { code: 'unconfigured' } });
    });

    it('shapes stream URLs with the custom protocol and keeps trackId/quality', async () => {
        const bridge = createFnmusicApiBridge({ store: seededStore(), safeStorage: cipher() });
        const result = await bridge.stream({ trackId: 'track-42', quality: 'lossless' });
        expect(result.ok).toBe(true);
        const url = new URL(result.data.url);
        expect(url.protocol).toBe('folia-fnmusic:');
        expect(url.hostname).toBe('stream');
        expect(url.searchParams.get('guid')).toBe('track-42');
        expect(url.searchParams.get('quality')).toBe('lossless');
    });

    it('shapes cover URLs with coverId and size', async () => {
        const bridge = createFnmusicApiBridge({ store: seededStore(), safeStorage: cipher() });
        const result = await bridge.coverUrl({ coverId: 'cover-7', size: 'webp' });
        expect(result.ok).toBe(true);
        const url = new URL(result.data.url);
        expect(url.protocol).toBe('folia-fnmusic:');
        expect(url.hostname).toBe('cover');
        expect(url.searchParams.get('coverId')).toBe('cover-7');
        expect(url.searchParams.get('size')).toBe('webp');
    });

    it('clears config on logout and reports unconfigured afterwards', async () => {
        // 未配置时登出不应触发任何网络请求，直接清状态。
        const emptyBridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
        await emptyBridge.logout();
        expect(emptyBridge.getStatus()).toMatchObject({ configured: false, authenticated: false });
        // 已配置时登出即使 NAS 不可达也要清掉本地配置（网络错误被吞掉，不阻塞登出）。
        const store = createStore();
        store.set(CONFIG_STORE_KEY, cipher().encryptString(JSON.stringify({ base: 'http://127.0.0.1:1', token: 'fixture-private-token', username: 'fixture-user' })).toString('base64'));
        const bridge = createFnmusicApiBridge({ store, safeStorage: cipher() });
        await bridge.logout();
        expect(store.get(CONFIG_STORE_KEY)).toBeUndefined();
        expect(bridge.getStatus()).toMatchObject({ configured: false, authenticated: false });
    });
});
