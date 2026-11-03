import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// The host owns IPC, OS encryption and media registration; protocol tests live with the npm package.
const require = createRequire(import.meta.url);
const { createQishuiApiBridge } = require('../../../electron/qishui/qishuiApiBridge.cjs');
const { createSessionRepository, SESSION_KEY, DEVICE_KEY } = require('../../../electron/qishui/session.cjs');
const { createQishuiMediaPolicy } = require('../../../electron/qishui/mediaCors.cjs');
const store = () => {
    const values = new Map<string, unknown>();
    return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
};
const cipher = () => ({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain',
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 0xa5)),
    decryptString: (bytes: Buffer) => Buffer.from(bytes.map(byte => byte ^ 0xa5)).toString() });
const account = { userId: 'opaque-account', user: { id: 'opaque-account', nickname: 'Listener' }, ticket: 'fixture-private-ticket',
    guardKey: 'fixture-key', guardCert: 'fixture-certificate', guardTsSign: 'fixture-signature', accessCode: 'fixture-access', expiresAt: Date.now() + 7200000 };

describe('Qishui desktop bridge', () => {
    it('rejects unregistered IPC operations before invoking the package', async () => {
        const request = vi.fn();
        const bridge = createQishuiApiBridge({ store: store(), apiFactory: () => ({ request }) });
        for (const operation of ['fetch', 'constructor', 'playlist_edit']) {
            expect(await bridge.request(operation)).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        }
        expect(request).not.toHaveBeenCalled();
    });
    it('delegates parameter validation to the real package before network access', async () => {
        const fetch = vi.fn();
        const bridge = createQishuiApiBridge({ store: store(), fetch });
        for (const params of [null, [], { query: {} }, { query: 'x', offset: -1 }]) {
            expect(await bridge.request('search', params)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        }
        expect(fetch).not.toHaveBeenCalled();
    });
    it('injects the host dependencies and preserves safe package errors', async () => {
        const result = { ok: false, error: { code: 'auth-required', message: 'Sign in required', stage: 'account' } };
        const apiFactory = vi.fn((_options: unknown) => ({ request: vi.fn().mockResolvedValue(result) }));
        const fetch = vi.fn(), log = vi.fn();
        const bridge = createQishuiApiBridge({ store: store(), apiFactory, fetch, log });
        expect(apiFactory.mock.calls[0][0]).toMatchObject({ deviceId: expect.stringMatching(/^\d{19}$/), fetch: expect.any(Function), log,
            sessions: { get: expect.any(Function), set: expect.any(Function), clear: expect.any(Function) } });
        expect(await bridge.request('login_status')).toEqual(result);
    });
    it('sends every package request without the browser session cookies', async () => {
        // net.fetch sends defaultSession's cookies and stores Set-Cookie there unless credentials are omitted.
        const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response('{}'));
        type Injected = (url: string, options?: RequestInit) => Promise<Response>;
        const apiFactory = vi.fn((_options: { fetch: Injected }) => ({ request: vi.fn() }));
        createQishuiApiBridge({ store: store(), apiFactory, fetch });
        const injected = apiFactory.mock.calls[0][0].fetch;
        await injected('https://open.douyin.com/a', { method: 'POST', body: '{}', credentials: 'include' });
        await injected('https://open.qishui.com/b');
        expect(fetch).toHaveBeenNthCalledWith(1, 'https://open.douyin.com/a', { method: 'POST', body: '{}', credentials: 'omit' });
        expect(fetch).toHaveBeenNthCalledWith(2, 'https://open.qishui.com/b', { credentials: 'omit' });
    });
    it('omits cookies on the real package requests as well', async () => {
        const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ err_no: 0, client_token: 'fixture-token' })));
        const bridge = createQishuiApiBridge({ store: store(), fetch, log: vi.fn(), warn: vi.fn() });
        await bridge.request('search', { query: 'x', limit: 1 });
        expect(fetch).toHaveBeenCalled();
        for (const [, options] of fetch.mock.calls) expect(options?.credentials).toBe('omit');
    });
    it('keeps unexpected exception text out of IPC and hands the error to the main-process log', async () => {
        const thrown = new Error('fixture-private');
        const warn = vi.fn();
        const bridge = createQishuiApiBridge({ store: store(), warn, apiFactory: () => ({ request: () => { throw thrown; } }) });
        const result = await bridge.request('search', { query: 'x' });
        expect(result).toEqual({ ok: false, error: { code: 'invalid-response', message: 'Qishui operation failed' } });
        expect(warn).toHaveBeenCalledExactlyOnceWith('[Qishui] Bridge request failed', { operation: 'search' }, thrown);
    });
    it('logs why a saved account could not be restored, without the decrypted account text', () => {
        const saved = store(), warn = vi.fn();
        // A sealed account that decrypts to text JSON.parse cannot read: its SyntaxError would quote that text.
        saved.set(SESSION_KEY, cipher().encryptString('{"ticket":"fixture-private-ticket"').toString('base64'));
        expect(createSessionRepository({ store: saved, safeStorage: cipher(), warn }).get()).toBeNull();
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0].map(String).join(' ')).not.toContain('fixture-private');
        const failure = new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
        const broken = { ...cipher(), decryptString: () => { throw failure; } };
        const warnAgain = vi.fn();
        expect(createSessionRepository({ store: saved, safeStorage: broken, warn: warnAgain }).get()).toBeNull();
        expect(warnAgain).toHaveBeenCalledExactlyOnceWith('[Qishui] Account could not be restored', failure);
    });
    it('restores existing V1 encrypted sessions and the saved device ID, and clears them on logout', async () => {
        const saved = store(), safeStorage = cipher();
        const previous = createSessionRepository({ store: saved, safeStorage });
        previous.set({ ...account, deviceId: previous.deviceId });
        expect(Buffer.from(String(saved.get(SESSION_KEY)), 'base64').toString()).not.toContain('fixture-private-ticket');
        const restored = createSessionRepository({ store: saved, safeStorage });
        expect(restored.deviceId).toBe(previous.deviceId);
        expect(restored.get()).toMatchObject(account);
        const fetch = vi.fn();
        const bridge = createQishuiApiBridge({ store: saved, safeStorage, fetch, log: vi.fn() });
        expect(await bridge.request('logout')).toEqual({ ok: true, data: null });
        expect(saved.get(SESSION_KEY)).toBeUndefined();
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each([false, true])('keeps sessions in memory when encryption is unavailable/basic_text (%s)', basicText => {
        const saved = store();
        const sessions = createSessionRepository({ store: saved, safeStorage: { ...cipher(), isEncryptionAvailable: () => basicText,
            getSelectedStorageBackend: () => 'basic_text' }, warn: vi.fn() });
        sessions.set(account);
        expect(sessions.get()).toMatchObject(account);
        expect(saved.get(SESSION_KEY)).toBeUndefined();
        expect(createSessionRepository({ store: saved, safeStorage: cipher() }).get()).toBeNull();
    });
    it('uses the package device-ID functions while preserving the published storage key', () => {
        const saved = store();
        saved.set(DEVICE_KEY, 'malformed');
        const sessions = createSessionRepository({ store: saved });
        expect(sessions.deviceId).toMatch(/^\d{19}$/);
        expect(saved.get('QISHUI_DEVICE_ID')).toBe(sessions.deviceId);
    });
    it.each(['video-model', 'player-info'])('registers zjcdn audio resolved by the real package through %s', async format => {
        const policy = createQishuiMediaPolicy(), url = 'https://v3-dy-o.zjcdn.com/audio?fixture=1';
        const playerInfoUrl = 'https://v3-dy-o.zjcdn.com/player-info';
        const fetch = vi.fn(async (raw: string) => {
            const path = new URL(raw).pathname;
            if (path.endsWith('/client/token/get/')) return Response.json({ client_token: 'fixture-client-token' });
            if (raw === playerInfoUrl) return Response.json({ PlayInfoList: [{ MainPlayUrl: url }] });
            expect(path.endsWith('/media/mget/')).toBe(true);
            const video_model_info = format === 'video-model'
                ? { video_model: { video_list: [{ main_url: url }] } }
                : { url_player_info: playerInfoUrl };
            return Response.json({ data: { media_list: [{ media_id: '123', track_entity: {
                player_info: { full: { video_model_info } },
            } }] } });
        });
        const bridge = createQishuiApiBridge({ store: store(), fetch, log: vi.fn(), onAudioSource: policy.register });
        const media = { url, resourceType: 'media', method: 'GET' };
        expect(policy.allows(media)).toBe(false);
        expect(await bridge.request('audio', { id: '123', quality: 'standard' })).toMatchObject({ ok: true, data: { url } });
        expect(policy.allows(media)).toBe(true);
        expect(policy.allows({ ...media, url: 'https://v3-dy-o.zjcdn.com/unissued' })).toBe(false);
    });
    it('registers only successful audio responses with the media policy', async () => {
        const policy = createQishuiMediaPolicy(), url = 'https://v26-default.365yg.com/audio';
        const request = vi.fn().mockResolvedValueOnce({ ok: true, data: { url } }).mockResolvedValueOnce({ ok: false, error: { code: 'network' } });
        const register = vi.fn(policy.register);
        const bridge = createQishuiApiBridge({ store: store(), apiFactory: () => ({ request }), onAudioSource: register });
        await bridge.request('audio', { id: '123', quality: 'standard' });
        await bridge.request('audio', { id: '456', quality: 'standard' });
        expect(register).toHaveBeenCalledExactlyOnceWith(url);
        expect(policy.allows({ url, resourceType: 'media', method: 'GET' })).toBe(true);
        expect(policy.allows({ url: 'https://other.example.test/audio', resourceType: 'media', method: 'GET' })).toBe(false);
    });
});

describe('Qishui media CORS policy', () => {
    const image = (url: string, extra: Record<string, unknown> = {}) => ({ url, resourceType: 'image', method: 'GET', ...extra });
    it('opens the public image CDNs by host suffix only', () => {
        const policy = createQishuiMediaPolicy();
        for (const url of ['https://p3.byteimg.com/cover.jpg', 'https://byteimg.com/cover.jpg', 'https://p3-luna.douyinpic.com/img/x',
            'https://lf.douyinstatic.com/a.png', 'https://p1.pstatp.com/large/x']) {
            expect(policy.allows(image(url))).toBe(true);
        }
        for (const url of ['https://evil-byteimg.com/cover.jpg', 'https://byteimg.com.evil.com/cover.jpg',
            'https://douyinpic.com.evil.test/x', 'https://notdouyinpic.com/x', 'https://open.douyin.com/api']) {
            expect(policy.allows(image(url))).toBe(false);
        }
    });
    it('opens only reads by media, image and xhr requests', () => {
        const policy = createQishuiMediaPolicy();
        const url = 'https://p3.byteimg.com/cover.jpg';
        for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) expect(policy.allows(image(url, { method }))).toBe(false);
        for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(policy.allows(image(url, { method }))).toBe(true);
        for (const resourceType of ['script', 'mainFrame', 'subFrame', 'stylesheet', 'other']) {
            expect(policy.allows(image(url, { resourceType }))).toBe(false);
        }
        // An image host is never opened for media: only the addresses the bridge issued play.
        expect(policy.allows(image(url, { resourceType: 'media' }))).toBe(false);
        policy.register('https://v26-default.365yg.com/audio');
        expect(policy.allows({ url: 'https://v26-default.365yg.com/audio', resourceType: 'media', method: 'POST' })).toBe(false);
        expect(policy.allows({ url: 'https://v26-default.365yg.com/audio', resourceType: 'script', method: 'GET' })).toBe(false);
    });
    it('opens an image host to xhr only for an image response', () => {
        const policy = createQishuiMediaPolicy();
        const xhr = (type?: string, name = 'Content-Type') => ({ url: 'https://p3.byteimg.com/cover', resourceType: 'xhr', method: 'GET',
            ...(type === undefined ? {} : { responseHeaders: { [name]: [type] } }) });
        expect(policy.allows(xhr('image/webp'))).toBe(true);
        expect(policy.allows(xhr('IMAGE/PNG', 'content-type'))).toBe(true);
        expect(policy.allows(xhr())).toBe(false);
        expect(policy.allows(xhr('application/json'))).toBe(false);
        expect(policy.allows(xhr('text/html; note=image/png'))).toBe(false);
    });
    it('opens an issued address for two hours', () => {
        let now = 1_000_000;
        const policy = createQishuiMediaPolicy({ now: () => now });
        const media = { url: 'https://v26-default.365yg.com/audio?sig=1', resourceType: 'media', method: 'GET' };
        expect(policy.allows(media)).toBe(false);
        policy.register(media.url);
        expect(policy.allows(media)).toBe(true);
        expect(policy.allows({ ...media, resourceType: 'xhr' })).toBe(true);
        now += 2 * 3600000 - 1;
        expect(policy.allows(media)).toBe(true);
        now += 1;
        expect(policy.allows(media)).toBe(false);
        expect(policy.allows(media)).toBe(false);
    });
    it('follows a redirect of an issued address, and only of one', () => {
        const policy = createQishuiMediaPolicy();
        const issued = 'https://v26-default.365yg.com/audio', target = 'https://v3-cdn.douyinvod.com/audio.m4a';
        policy.register(issued);
        policy.followRedirect({ url: issued, redirectURL: target, resourceType: 'media', method: 'GET' });
        expect(policy.allows({ url: target, resourceType: 'media', method: 'GET' })).toBe(true);
        policy.followRedirect({ url: 'https://other.example.test/a', redirectURL: 'https://other.example.test/b', resourceType: 'media', method: 'GET' });
        expect(policy.allows({ url: 'https://other.example.test/b', resourceType: 'media', method: 'GET' })).toBe(false);
        // An issued address redirected to plain http or to an address with credentials is not opened.
        for (const redirectURL of ['http://v3-cdn.douyinvod.com/a.m4a', 'https://user:pass@v3-cdn.douyinvod.com/a.m4a']) {
            policy.followRedirect({ url: issued, redirectURL, resourceType: 'media', method: 'GET' });
            expect(policy.allows({ url: redirectURL, resourceType: 'media', method: 'GET' })).toBe(false);
        }
    });
    it('never registers or opens plain http or addresses with a user name or password', () => {
        const policy = createQishuiMediaPolicy();
        for (const url of ['http://v26-default.365yg.com/audio', 'https://user:pass@v26-default.365yg.com/audio',
            'https://user@v26-default.365yg.com/audio', 'not a url']) {
            policy.register(url);
            expect(policy.allows({ url, resourceType: 'media', method: 'GET' })).toBe(false);
        }
        for (const url of ['http://p3.byteimg.com/cover.jpg', 'https://user:pass@p3.byteimg.com/cover.jpg']) {
            expect(policy.allows(image(url))).toBe(false);
        }
    });
});
