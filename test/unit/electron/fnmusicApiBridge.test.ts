import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/fnmusicApiBridge.test.ts — host persistence, parameter validation
// and protocol URL shaping for the fnOS (飞牛) music bridge.

const require = createRequire(import.meta.url);
const { createFnmusicApiBridge, resolveServerCandidates, normalizeBase, buildAuthCookie, FN_MUSIC_SCHEME, FN_MUSIC_PRIVILEGED_SCHEME } = require('../../../electron/fnmusic/fnmusicApiBridge.cjs');
const https = require('node:https');

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

    it('exposes handleProtocolRequest for protocol.handle registration', () => {
        const bridge = createFnmusicApiBridge({ store: seededStore(), safeStorage: cipher() });
        expect(bridge.handleProtocolRequest).toBeTypeOf('function');
    });

    it('reports unconfigured when the store holds no saved config', () => {
        const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
        expect(bridge.getStatus()).toMatchObject({ available: true, configured: false, authenticated: false, base: null });
    });

    describe('FN Connect relay (外网登录)', () => {
        it('maps a bare FN ID to both relay clusters, the 5ddd.com cluster first', () => {
            expect(resolveServerCandidates('mynas')).toEqual(['https://mynas.5ddd.com', 'https://mynas.fnos.net']);
            expect(resolveServerCandidates(' MyNAS-2 ')).toEqual(['https://mynas-2.5ddd.com', 'https://mynas-2.fnos.net']);
        });

        it('normalizes relay addresses to https and the bare host, and rewrites the path-style entry to the subdomain', () => {
            for (const input of ['https://mynas.5ddd.com', 'http://mynas.5ddd.com', 'mynas.5ddd.com', 'https://mynas.5ddd.com/login', 'https://MyNAS.5ddd.com/', 'https://5ddd.com/mynas', '5ddd.com/mynas/', 'https://5ddd.com/MyNAS/p/home', 'https://www.5ddd.com/mynas']) {
                expect(normalizeBase(input)).toBe('https://mynas.5ddd.com');
            }
            for (const input of ['mynas.fnos.net', 'https://fnos.net/mynas', 'http://mynas.fnos.net/music']) {
                expect(normalizeBase(input)).toBe('https://mynas.fnos.net');
            }
        });

        it('leaves other hosts and paths that only look like a relay to direct connection', () => {
            expect(normalizeBase('https://evil.example/5ddd.com')).toBe('https://evil.example/5ddd.com');
            expect(normalizeBase('http://my5ddd.com/mynas')).toBe('http://my5ddd.com/mynas');
            expect(normalizeBase('https://5ddd.com/a@b')).toBe('https://5ddd.com/a@b');
            expect(normalizeBase('192.168.1.10:5666/')).toBe('http://192.168.1.10:5666');
        });

        it('leaves LAN addresses untouched for direct connection', () => {
            expect(resolveServerCandidates('192.168.1.10:5666')).toEqual(['192.168.1.10:5666']);
            expect(resolveServerCandidates('http://192.168.1.10:5666')).toEqual(['http://192.168.1.10:5666']);
            expect(resolveServerCandidates('nas.local:5666')).toEqual(['nas.local:5666']);
            expect(resolveServerCandidates('[::1]:5666')).toEqual(['[::1]:5666']);
        });

        it('keeps single-label LAN hosts direct once a scheme, port or path is written, and never relays localhost', () => {
            for (const input of ['http://mynas', 'https://mynas', 'mynas:5666', 'http://mynas/music', 'localhost', 'LOCALHOST']) {
                expect(resolveServerCandidates(input)).toEqual([input]);
            }
        });

        it('does not build a relay host from anything but DNS label characters', () => {
            for (const input of ['evil#', 'a@b', 'x\\y', 'mynas?x=1', 'nas_1', '-nas', '%2e', '我的nas']) {
                expect(resolveServerCandidates(input)).toEqual([input]);
            }
        });

        it('builds the auth cookie: relay adds mode=relay, token is always included', () => {
            expect(buildAuthCookie({ token: 'tk', relay: true })).toBe('music-token=tk; mode=relay');
            expect(buildAuthCookie({ token: 'tk', relay: false })).toBe('music-token=tk');
            expect(buildAuthCookie({ token: null, relay: true })).toBe('mode=relay');
            expect(buildAuthCookie({ token: null, relay: false })).toBeNull();
        });
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

    it('shapes stream URLs with the custom protocol and the track only (the server sends the original file)', async () => {
        const bridge = createFnmusicApiBridge({ store: seededStore(), safeStorage: cipher() });
        const result = await bridge.stream({ trackId: 'track-42', quality: 'lossless' });
        expect(result.ok).toBe(true);
        const url = new URL(result.data.url);
        expect(url.protocol).toBe('folia-fnmusic:');
        expect(url.hostname).toBe('stream');
        expect(url.searchParams.get('guid')).toBe('track-42');
        expect(url.searchParams.has('quality')).toBe(false);
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

    describe('FN Connect relay requests', () => {
        // 拦下 https.request：记下目标与请求头。answer 决定每个主机的结局：返回字符串当作 Node 的
        // 系统错误码（如 ENOTFOUND）让请求失败，{ raw } 原样作答复正文（如网页），其余对象当作 JSON 答复；
        // 默认以网络错误结束（不真的连公网）。
        type Answer = string | { raw: string } | Record<string, unknown>;
        const captureHttps = (answer: (url: URL) => Answer = () => 'ECONNRESET') => {
            const calls: Array<{ url: URL; headers: Record<string, string>; rejectUnauthorized: boolean }> = [];
            vi.spyOn(https, 'request').mockImplementation(((url: URL, options: { headers: Record<string, string>; rejectUnauthorized: boolean }, onResponse?: (res: EventEmitter & { statusCode: number }) => void) => {
                calls.push({ url, headers: options.headers, rejectUnauthorized: options.rejectUnauthorized });
                const outcome = answer(url);
                const req = Object.assign(new EventEmitter(), {
                    write: () => true,
                    end: () => {
                        queueMicrotask(() => {
                            if (typeof outcome === 'string') {
                                req.emit('error', Object.assign(new Error(`getaddrinfo ${outcome} ${url.hostname}`), { code: outcome }));
                                return;
                            }
                            const res = Object.assign(new EventEmitter(), { statusCode: 200 });
                            onResponse?.(res);
                            res.emit('data', Buffer.from(typeof outcome.raw === 'string' ? outcome.raw : JSON.stringify(outcome)));
                            res.emit('end');
                        });
                    },
                    destroy: () => {},
                    setTimeout: () => {},
                });
                return req;
            }) as never);
            return calls;
        };
        const signedIn = { code: 0, msg: '', data: { userToken: 'relay-token', user: { guid: 'g1', name: 'Alice' } } };
        const relayStore = (base: string) => {
            const store = createStore();
            store.set(CONFIG_STORE_KEY, cipher().encryptString(JSON.stringify({ base, token: 'fixture-token', username: 'u' })).toString('base64'));
            return store;
        };
        afterEach(() => { vi.restoreAllMocks(); });

        it('logs a bare FN ID in through the 5ddd.com cluster first, over strict https without mode=relay', async () => {
            const calls = captureHttps(() => signedIn);
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            await bridge.login({ base: 'mynas', username: 'admin', password: 'secret' });
            expect(calls).toHaveLength(1);
            expect(calls[0].url.href).toBe('https://mynas.5ddd.com/music/api/v1/user/password-login');
            expect(calls[0].headers.Cookie).toBeUndefined();
            expect(calls[0].rejectUnauthorized).toBe(true);
        });

        it('stops at the cluster that answered with an fnOS business error, such as a wrong password', async () => {
            const calls = captureHttps(() => ({ code: 120001, msg: 'bad password', data: null }));
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            const result = await bridge.login({ base: 'mynas', username: 'admin', password: 'secret' });
            expect(calls).toHaveLength(1);
            expect(result).toMatchObject({ ok: false, error: { code: 120001 } });
        });

        it('moves on to fnos.net when 5ddd.com resets the connection or answers with a web page (fake-ip proxies, DNS hijacking)', async () => {
            for (const failure of ['ECONNRESET', { raw: '<!doctype html><html lang="zh-CN"></html>' }] as Answer[]) {
                const calls = captureHttps(url => (url.hostname.endsWith('.5ddd.com') ? failure : signedIn));
                const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
                expect((await bridge.login({ base: 'mynas', username: 'admin', password: 'secret' })).ok).toBe(true);
                expect(calls.map(call => call.url.host)).toEqual(['mynas.5ddd.com', 'mynas.fnos.net']);
                expect(bridge.getStatus()).toMatchObject({ base: 'https://mynas.fnos.net' });
                vi.restoreAllMocks();
            }
        });

        it('falls back to the fnos.net cluster with mode=relay only when 5ddd.com does not resolve the FN ID, and saves that host', async () => {
            const calls = captureHttps(url => (url.hostname.endsWith('.5ddd.com') ? 'ENOTFOUND' : signedIn));
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            const result = await bridge.login({ base: 'mynas', username: 'admin', password: 'secret' });
            expect(result.ok).toBe(true);
            expect(calls.map(call => call.url.host)).toEqual(['mynas.5ddd.com', 'mynas.fnos.net']);
            expect(calls[1].headers.Cookie).toBe('mode=relay');
            expect(bridge.getStatus()).toMatchObject({ base: 'https://mynas.fnos.net', authenticated: true });
        });

        it('saves the 5ddd.com host when the FN ID lives there', async () => {
            const calls = captureHttps(() => signedIn);
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            expect((await bridge.login({ base: 'MyNAS', username: 'admin', password: 'secret' })).ok).toBe(true);
            expect(calls).toHaveLength(1);
            expect(bridge.getStatus()).toMatchObject({ base: 'https://mynas.5ddd.com' });
        });

        it('says neither cluster reached the FN ID when both fail', async () => {
            captureHttps(() => 'ENOTFOUND');
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            const result = await bridge.login({ base: 'mynas', username: 'admin', password: 'secret' });
            expect(result).toMatchObject({ ok: false, error: { code: 'network', errno: 'ENOTFOUND' } });
            expect(result.error.message).toContain('ENOTFOUND');
            expect(result.error.message).toContain('mynas.5ddd.com');
            expect(result.error.message).toContain('mynas.fnos.net');
        });

        it('does not try another cluster for a full relay address', async () => {
            const calls = captureHttps(() => 'ENOTFOUND');
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            await bridge.login({ base: 'https://5ddd.com/mynas', username: 'admin', password: 'secret' });
            expect(calls.map(call => call.url.href)).toEqual(['https://mynas.5ddd.com/music/api/v1/user/password-login']);
        });

        it('upgrades a 5ddd.com host typed without a scheme to https', async () => {
            const calls = captureHttps();
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            await bridge.login({ base: 'mynas.5ddd.com', username: 'admin', password: 'secret' });
            expect(calls[0].url.href).toBe('https://mynas.5ddd.com/music/api/v1/user/password-login');
        });

        it('sends only the token on later requests and streams for a saved 5ddd.com config', async () => {
            const calls = captureHttps();
            const bridge = createFnmusicApiBridge({ store: relayStore('https://mynas.5ddd.com'), safeStorage: cipher() });
            await bridge.request({ path: '/music/api/v1/track/list' });
            await bridge.handleProtocolRequest(new Request('folia-fnmusic://stream?guid=t1'));
            expect(calls.map(call => call.headers.Cookie)).toEqual(['music-token=fixture-token', 'music-token=fixture-token']);
        });

        it('upgrades a relay host typed without https to https', async () => {
            const calls = captureHttps();
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            await bridge.login({ base: 'mynas.fnos.net', username: 'admin', password: 'secret' });
            expect(calls[0].url.href).toBe('https://mynas.fnos.net/music/api/v1/user/password-login');
        });

        it('sends mode=relay with the token on later requests and streams for a saved relay config', async () => {
            const calls = captureHttps();
            const bridge = createFnmusicApiBridge({ store: relayStore('https://mynas.fnos.net'), safeStorage: cipher() });
            await bridge.request({ path: '/music/api/v1/track/list' });
            await bridge.handleProtocolRequest(new Request('folia-fnmusic://stream?guid=t1'));
            expect(calls.map(call => call.headers.Cookie)).toEqual(['music-token=fixture-token; mode=relay', 'music-token=fixture-token; mode=relay']);
        });

        it('judges the relay by host name, not by a path that mentions fnos.net', async () => {
            const calls = captureHttps();
            const bridge = createFnmusicApiBridge({ store: relayStore('https://evil.example/.fnos.net'), safeStorage: cipher() });
            await bridge.request({ path: '/music/api/v1/track/list' });
            expect(calls[0].headers.Cookie).toBe('music-token=fixture-token');
        });
    });

    describe('signing in against a server', () => {
        let server: Server | null = null;
        const seen: Array<{ url: string; body: Record<string, unknown>; cookie?: string }> = [];
        afterEach(async () => {
            seen.length = 0;
            await new Promise<void>(done => (server ? server.close(() => done()) : done()));
            server = null;
        });
        // A stand-in fnOS music server: every sign-in succeeds, every logout too.
        const serve = async (): Promise<string> => {
            server = createServer((request: IncomingMessage, response) => {
                let raw = '';
                request.on('data', chunk => { raw += chunk; });
                request.on('end', () => {
                    seen.push({ url: request.url ?? '', body: raw ? JSON.parse(raw) : {}, cookie: request.headers.cookie });
                    response.setHeader('Content-Type', 'application/json');
                    response.end(JSON.stringify(request.url?.endsWith('/password-login')
                        ? { code: 0, msg: '', data: { userToken: 'fixture-token', user: { guid: 'user-guid-1', name: 'Alice' } } }
                        : { code: 0, msg: '', data: null }));
                });
            });
            await new Promise<void>(done => server!.listen(0, '127.0.0.1', () => done()));
            return `127.0.0.1:${(server!.address() as AddressInfo).port}`;
        };

        it('takes an address without a scheme as http, and saves the NAS user guid and nickname', async () => {
            const host = await serve();
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            const result = await bridge.login({ base: ` ${host}/ `, username: 'admin', password: 'secret' });
            expect(result.ok).toBe(true);
            expect(seen[0].url).toBe('/music/api/v1/user/password-login');
            expect(bridge.getStatus()).toMatchObject({ base: `http://${host}`, username: 'admin', userId: 'user-guid-1', nickname: 'Alice', authenticated: true });
        });

        it('keeps the relay cookie off LAN logins and later LAN requests', async () => {
            const host = await serve();
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            await bridge.login({ base: host, username: 'admin', password: 'secret' });
            await bridge.request({ path: '/music/api/v1/track/list' });
            expect(seen[0].cookie).toBeUndefined();
            expect(seen[1].cookie).toBe('music-token=fixture-token');
            expect(bridge.getStatus()).toMatchObject({ base: `http://${host}`, authenticated: true });
        });

        it('refuses an address that is not an http(s) server before any request', async () => {
            const bridge = createFnmusicApiBridge({ store: createStore(), safeStorage: cipher() });
            for (const base of ['ftp://192.168.1.10', 'http://']) {
                expect(await bridge.login({ base, username: 'admin', password: 'secret' })).toMatchObject({ ok: false, error: { code: 'invalid-base' } });
            }
        });

        it('signs in again after a logout as the same device', async () => {
            const host = await serve();
            const store = createStore();
            const bridge = createFnmusicApiBridge({ store, safeStorage: cipher() });
            await bridge.login({ base: host, username: 'admin', password: 'secret' });
            await bridge.logout();
            expect(store.get(CONFIG_STORE_KEY)).toBeUndefined();
            await bridge.login({ base: host, username: 'admin', password: 'secret' });
            const logins = seen.filter(entry => entry.url.endsWith('/password-login'));
            expect(logins).toHaveLength(2);
            expect(logins[0].body.deviceId).toMatch(/^[0-9a-f]{32}$/);
            expect(logins[1].body.deviceId).toBe(logins[0].body.deviceId);
        });
    });
});
