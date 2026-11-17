import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/huaweiApiBridge.test.ts
// 华为音乐主进程桥的边界：只认白名单操作，搜索按签名头匿名发，播放要有会话，
// 歌词只读放行过的域名。网络答复用替身，不碰真实华为服务。

const require = createRequire(import.meta.url);
const { createHuaweiApiBridge } = require('../../../electron/huawei/huaweiApiBridge.cjs');
const { createSessionRepository, SESSION_KEY } = require('../../../electron/huawei/session.cjs');

const store = () => {
    const values = new Map<string, unknown>();
    return {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
        delete: (key: string) => values.delete(key),
    };
};

const cipher = () => ({
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 0xa5)),
    decryptString: (bytes: Buffer) => Buffer.from(bytes.map(byte => byte ^ 0xa5)).toString(),
});

type FetchLike = (url: string, options?: RequestInit) => Promise<Response>;

const bridgeOf = (fetch: FetchLike, warn = vi.fn(), saved = store()) => createHuaweiApiBridge({
    store: saved,
    safeStorage: cipher(),
    fetch,
    BrowserWindow: function BrowserWindow() {
        throw new Error('the login window is not opened in this test');
    },
    session: { fromPartition: () => ({ clearStorageData: async () => {} }) },
    parentWindow: () => null,
    warn,
});

const envelope = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.useRealTimers());

// Keep the OAuth exchange pending while a real window lifecycle event invalidates it.
const loginHarness = () => {
    const windows: LoginWindow[] = [];
    class LoginWindow extends EventEmitter {
        webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
        url = '';
        destroyed = false;
        constructor(readonly options: { title: string }) { super(); windows.push(this); }
        async loadURL(url: string) { this.url = url; }
        isDestroyed() { return this.destroyed; }
        destroy() { this.destroyed = true; this.emit('closed'); }
        show() {}
        focus() {}
    }
    let release!: (response: Response) => void;
    const delayed = new Promise<Response>(resolve => { release = resolve; });
    const fetch = vi.fn(async (url: string) => {
        if (url.includes('/oauth2/v3/token')) return delayed;
        if (url.includes('/userinfo/loginex')) return envelope({ token: 'fixture-token', snsUserID: 'fixture-user' });
        return envelope({ result: { resultCode: '000000' } });
    });
    const saved = store();
    const bridge = createHuaweiApiBridge({
        store: saved, safeStorage: cipher(), fetch, BrowserWindow: LoginWindow,
        session: { fromPartition: () => ({ clearStorageData: async () => {} }) },
        language: () => 'en',
    });
    const begin = async () => {
        const { data: { key } } = await bridge.request('login_start');
        await bridge.request('login_open', { key });
        const win = windows[windows.length - 1];
        const state = new URL(win.url).searchParams.get('state');
        win.webContents.emit('will-redirect', { preventDefault: vi.fn() }, `hms://redirect_uri?state=${state}&code=fixture-code`);
        return { key, win };
    };
    return { bridge, saved, begin, release, fetch };
};

describe('Huawei Music desktop bridge', () => {
    it.each(['20261117000000', '20261116000000'])('removes an expired persisted session (%s) before any request', async expireTime => {
        vi.useFakeTimers({ now: Date.UTC(2026, 10, 17) });
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher() }).set({ token: 'old', userId: 'old-user', expireTime });
        const fetch = vi.fn();
        const bridge = bridgeOf(fetch, vi.fn(), saved);
        expect(await bridge.request('audio', { id: 'song' })).toMatchObject({ ok: false, sessionEnded: true });
        expect(saved.get(SESSION_KEY)).toBeUndefined();
        expect(await bridgeOf(fetch, vi.fn(), saved).request('login_status')).toEqual({ ok: true, data: null });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('expires an already loaded session exactly at the UTC deadline', () => {
        let now = Date.UTC(2026, 10, 17) - 1;
        const saved = store();
        const sessions = createSessionRepository({ store: saved, safeStorage: cipher(), now: () => now });
        sessions.set({ token: 'old', userId: 'old-user', expireTime: '20261117000000' });
        expect(sessions.get()).not.toBeNull();
        now += 1;
        expect(sessions.peek()).toBeNull();
        expect(saved.get(SESSION_KEY)).toBeUndefined();
    });

    it.each(['later', '', '20260230000000', '20261117240000'])('does not invent expiry for %s', expireTime => {
        const sessions = createSessionRepository({ store: store(), safeStorage: cipher(), now: () => Date.UTC(2030, 0, 1) });
        sessions.set({ token: 'old', userId: 'old-user', expireTime });
        expect(sessions.get()).not.toBeNull();
    });

    it.each(['401', 'token expired', 'session invalid'])('clears confirmed rejection %s on disk and in status', async rejection => {
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher() }).set({ token: 'old', userId: 'old-user' });
        const fetch = vi.fn(async () => rejection === '401'
            ? new Response('{"error":"unauthorized"}', { status: 401 })
            : envelope({ result: { resultCode: 'refused', resultMessage: rejection } }));
        const bridge = bridgeOf(fetch, vi.fn(), saved);
        expect(await bridge.request('library_albums')).toMatchObject({ ok: false, sessionEnded: true, error: { code: 'auth-required' } });
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
        expect(saved.get(SESSION_KEY)).toBeUndefined();
        expect(await bridgeOf(fetch, vi.fn(), saved).request('login_status')).toEqual({ ok: true, data: null });
    });

    it.each(['network', '503', '403', 'system', 'empty', 'malformed'])('retains the session after %s validation', async mode => {
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher() }).set({ token: 'old', userId: 'old-user' });
        const fetch = vi.fn(async () => {
            if (mode === 'network') throw new Error('offline');
            if (mode === '503' || mode === '403') return new Response('', { status: Number(mode) });
            if (mode === 'system') return envelope({ result: { resultCode: 'unknown', resultMessage: 'System error!' } });
            if (mode === 'malformed') return envelope({});
            return envelope({ result: { resultCode: '000000' }, favoriteInfos: [] });
        });
        const answer = await bridgeOf(fetch, vi.fn(), saved).request('login_status');
        expect(answer.ok).toBe(mode === 'empty');
        expect(saved.get(SESSION_KEY)).toBeDefined();
        expect(createSessionRepository({ store: saved, safeStorage: cipher() }).get()?.userId).toBe('old-user');
    });

    it.each(['library_albums', 'login_status'])('does not let a late %s refusal remove a new sign-in', async operation => {
        const harness = loginHarness();
        createSessionRepository({ store: harness.saved, safeStorage: cipher() }).set({ token: 'old', userId: 'old-user' });
        let refuse!: (response: Response) => void;
        harness.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { refuse = resolve; }));
        const old = harness.bridge.request(operation);
        await harness.begin();
        harness.release(envelope({ access_token: 'fixture-access' }));
        await setImmediate();
        refuse(new Response('', { status: 401 }));
        expect((await old).sessionEnded).toBeUndefined();
        expect(await harness.bridge.request('login_status')).toMatchObject({ ok: true, data: { id: 'fixture-user' } });
    });

    it('signals expiry even when lyrics successfully fall back', async () => {
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher() }).set({ token: 'old', userId: 'old-user' });
        const bridge = bridgeOf(async url => url.includes('lyric.tingmall.com')
            ? new Response('[00:01]fallback') : new Response('', { status: 401 }), vi.fn(), saved);
        expect(await bridge.request('lyrics', { id: 'song', lyricUrl: 'https://lyric.tingmall.com/song.lrc' }))
            .toMatchObject({ ok: true, sessionEnded: true, data: { lrc: '[00:01]fallback' } });
    });

    it.each(['search', 'album', 'library_albums', 'playlist_tracks'])('advances %s past offset 1000 without repeating the previous page', async operation => {
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher(), warn: vi.fn() }).set({
            token: 'fixture-token', userId: 'fixture-user',
        });
        const rows = Array.from({ length: 1100 }, (_, i) => ({ contentID: String(i), contentName: `Track ${i}` }));
        const fetch = vi.fn(async (url: string, options?: RequestInit) => {
            const params = options?.body ? JSON.parse(String(options.body)) : Object.fromEntries(new URL(url).searchParams);
            const page = rows.slice(Number(params.start), Number(params.start) + Number(params.limit));
            return envelope({
                songSimpleInfos: page, totalNum: '1100', hasNextPage: '0', favoriteInfos: page,
                albumInfoEx: { albumInfo: { contentName: 'Album', totalCount: '1100' }, songSimpleInfos: page },
                musicListInfoEx: { musicListDetail: { totalCount: '1100' }, songSimpleInfos: page },
            });
        });
        const result = await bridgeOf(fetch, vi.fn(), saved).request(operation, {
            id: 'list', query: 'song', kind: 'collected', offset: 1050, limit: 50,
        });
        expect(result).toMatchObject({ ok: true, data: { nextOffset: 1100 } });
        expect(result.data.items).toHaveLength(50);
        expect(result.data.items[0].contentID ?? result.data.items[0].id).toBe('1050');
    });

    it('reads the account playlist page after the first 50 entries', async () => {
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher(), warn: vi.fn() }).set({
            token: 'fixture-token', userId: 'fixture-user',
        });
        const rows = Array.from({ length: 51 }, (_, i) => ({ contentID: String(i), contentName: `List ${i}`, contentType: '4' }));
        const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
            const { start, limit } = JSON.parse(String(options?.body));
            return envelope({ favoriteInfos: rows.slice(start, start + limit) });
        });
        const bridge = bridgeOf(fetch, vi.fn(), saved);
        expect(await bridge.request('library_playlists', { limit: 50, offset: 0 }))
            .toMatchObject({ ok: true, data: { hasMore: true, nextOffset: 50 } });
        expect(await bridge.request('library_playlists', { limit: 50, offset: 50 }))
            .toMatchObject({ ok: true, data: { hasMore: false, nextOffset: 51, items: [{ id: '50' }] } });
    });

    it.each([
        ['search', 25000],
        ['lyrics', 8000],
    ] as const)('aborts a stalled %s response body at its deadline', async (operation, timeout) => {
        vi.useFakeTimers();
        let signal: AbortSignal | null | undefined;
        const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
            signal = options?.signal;
            return new Response(new ReadableStream({
                start(controller) {
                    signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
                },
            }));
        });
        const pending = bridgeOf(fetch).request(operation, { query: 'song', id: '1', lyricUrl: 'https://lyric.tingmall.com/song.lrc' });
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(timeout);
        expect(signal?.aborted).toBe(true);
        expect(await pending).toMatchObject(operation === 'search'
            ? { ok: false, error: { code: 'network' } }
            : { ok: true, data: { lrc: '', hmrc: '' } });
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([[503, 'network'], [429, 'unavailable']] as const)('preserves HTTP %s for shared failure handling', async (status, code) => {
        const bridge = bridgeOf(async () => new Response('', { status }));
        expect(await bridge.request('search', { query: 'song' })).toMatchObject({
            ok: false, error: { code, httpStatus: status },
        });
    });

    it.each(['cancel', 'logout', 'replace', 'close'])('does not install a late login after %s', async action => {
        const { bridge, saved, begin, release } = loginHarness();
        const { key, win } = await begin();
        if (action === 'cancel') await bridge.request('login_cancel', { key });
        if (action === 'logout') await bridge.request('logout');
        if (action === 'replace') await bridge.request('login_start');
        if (action === 'close') win.destroy();
        release(envelope({ access_token: 'fixture-access' }));
        await setImmediate();
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
        expect(saved.get(SESSION_KEY)).toBeUndefined();
    });

    it('uses the application language for the login window and its close error', async () => {
        const { bridge, begin, release } = loginHarness();
        const { key, win } = await begin();
        expect(win.options.title).toBe('Sign in to Huawei Music');
        expect(new URL(win.url).searchParams.get('ui_locales')).toBe('en');
        win.destroy();
        expect(await bridge.request('login_check', { key })).toMatchObject({
            ok: false, error: { message: 'The sign-in window was closed' },
        });
        release(envelope({ access_token: 'fixture-access' }));
        await setImmediate();
    });

    it('still confirms an active login', async () => {
        const { bridge, begin, release } = loginHarness();
        const { key } = await begin();
        release(envelope({ access_token: 'fixture-access' }));
        await setImmediate();
        expect(await bridge.request('login_check', { key })).toMatchObject({ ok: true, data: { state: 'confirmed' } });
        expect(await bridge.request('login_status')).toEqual({
            ok: true, data: { id: 'fixture-user', nickname: 'Huawei Music account' },
        });
    });

    it('reads consecutive public playlist pages without slicing the server page again', async () => {
        const rows = Array.from({ length: 5 }, (_, i) => ({ contentID: String(i), contentName: `Track ${i}` }));
        const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
            const { start, limit } = JSON.parse(String(options?.body));
            return envelope({ musicListInfoEx: {
                musicListDetail: { totalCount: '5' },
                songSimpleInfos: rows.slice(Number(start), Number(start) + Number(limit)),
            } });
        });
        const bridge = bridgeOf(fetch);
        for (const offset of [0, 2, 4]) {
            expect(await bridge.request('playlist_tracks', { id: 'public-list', kind: 'collected', offset, limit: 2 }))
                .toMatchObject({ ok: true, data: {
                    items: rows.slice(offset, offset + 2), total: 5, hasMore: offset < 4, nextOffset: Math.min(offset + 2, 5),
                } });
        }
    });
    it('rejects an operation outside the table before any network read', async () => {
        const fetch = vi.fn();
        const bridge = bridgeOf(fetch);
        for (const operation of ['login', 'playlist', 'constructor']) {
            expect(await bridge.request(operation)).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it('sends an anonymous signed search and maps paging', async () => {
        const fetch = vi.fn(async () => envelope({
            result: { resultCode: '000000', resultMessage: 'Success!' },
            totalNum: '200',
            hasNextPage: '1',
            songSimpleInfos: [{ contentID: '1092974', contentName: '晴天' }],
        }));
        const bridge = bridgeOf(fetch);
        const result = await bridge.request('search', { query: '晴天', limit: 1, offset: 0 });
        expect(result).toMatchObject({
            ok: true,
            data: { total: 200, hasMore: true, nextOffset: 1, items: [{ contentID: '1092974', contentName: '晴天' }] },
        });
        const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        const headers = options.headers as Record<string, string>;
        expect(headers.Authorization).toMatch(/^Digest username=app-music-baseline, nonce=/);
        expect(headers.Authorization).not.toContain('token=');
        expect(JSON.parse(String(options.body))).toMatchObject({
            contentType: '1', correct: '1', queryWord: '晴天', start: '0', limit: '1',
        });
    });

    it('searches albums and playlists through the response field of each kind', async () => {
        const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
            const body = JSON.parse(String(options?.body));
            return envelope({
                result: { resultCode: '000000', resultMessage: 'Success!' },
                hasNextPage: '0',
                totalNum: '1',
                ...(body.contentType === '2'
                    ? { albumSimpleInfos: [{ contentID: '35239276', contentName: '太阳之子' }] }
                    : { musicListSimpleInfos: [{ contentID: '112927', contentName: '周杰伦精选' }] }),
            });
        });
        const bridge = bridgeOf(fetch);
        expect(await bridge.request('search', { query: '周杰伦', limit: 1, offset: 0, kind: 'album' }))
            .toMatchObject({ ok: true, data: { items: [{ contentID: '35239276' }] } });
        expect(await bridge.request('search', { query: '周杰伦', limit: 1, offset: 0, kind: 'playlist' }))
            .toMatchObject({ ok: true, data: { items: [{ contentID: '112927' }] } });
    });

    it('reads an album detail without an account', async () => {
        const fetch = vi.fn(async () => envelope({
            result: { resultCode: '000000', resultMessage: 'Success!' },
            albumInfoEx: {
                albumInfo: {
                    contentID: '101447',
                    contentName: '叶惠美',
                    totalCount: '11',
                    picture: { bigImgURL: 'https://contentcenter-drcn.dbankcdn.cn/cover.webp' },
                },
                songSimpleInfos: [{ contentID: '1092931', contentName: '以父之名' }],
            },
        }));
        const bridge = bridgeOf(fetch);
        const result = await bridge.request('album', { id: '101447', limit: 1, offset: 0 });
        expect(result).toMatchObject({
            ok: true,
            data: { id: '101447', name: '叶惠美', totalCount: 11, hasMore: true, nextOffset: 1 },
        });
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('refuses playback without a session, and never asks the network', async () => {
        const fetch = vi.fn();
        const bridge = bridgeOf(fetch);
        expect(await bridge.request('audio', { id: '1092974', quality: 'standard' })).toMatchObject({
            ok: false,
            error: { code: 'auth-required' },
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('maps a VIP refusal to subscription-required', async () => {
        const fetch = vi.fn(async () => envelope({ result: { resultCode: '142400', resultMessage: 'Only vip user can play or download the content!' } }));
        const bridge = bridgeOf(fetch);
        // The same result envelope is read on a public path, where no session is needed.
        const result = await bridge.request('search', { query: 'x', limit: 1, offset: 0 });
        expect(result).toMatchObject({ ok: false, error: { code: 'subscription-required', upstreamCode: '142400' } });
    });

    it('reads lyrics only from the allowed lyric hosts', async () => {
        const fetch = vi.fn();
        const bridge = bridgeOf(fetch);
        const result = await bridge.request('lyrics', { id: '1092974', lyricUrl: 'https://evil.example/song.lrc' });
        expect(result).toMatchObject({ ok: true, data: { lrc: '', hmrc: '' } });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('reads the account favorite albums', async () => {
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher(), warn: vi.fn() }).set({
            token: 'fixture-token', userId: 'fixture-user', expireTime: 'later', nickname: 'Listener',
        });
        const fetch = vi.fn(async () => envelope({
            result: { resultCode: '000000', resultMessage: 'Success!' },
            favoriteInfos: [
                { contentID: '101447', contentName: '叶惠美', artistName: '周杰伦', totalCount: '11', picture: { bigImgURL: 'https://cdn/album.webp' } },
            ],
        }));
        const bridge = bridgeOf(fetch, vi.fn(), saved);
        expect(await bridge.request('library_albums', { limit: 2, offset: 0 })).toMatchObject({
            ok: true,
            data: { items: [{ id: '101447', name: '叶惠美', kind: 'album', artistName: '周杰伦', trackCount: 11, coverUrl: 'https://cdn/album.webp' }], hasMore: false, nextOffset: 1 },
        });
        const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(String(options.body))).toMatchObject({ contentTypes: [2], start: 0, limit: 2 });
    });

    it("lists the account's playlists and reads an owned playlist without the full list", async () => {
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher(), warn: vi.fn() }).set({
            token: 'fixture-token', userId: 'fixture-user', expireTime: 'later', nickname: 'Listener',
        });
        const fetch = vi.fn(async (url: string) => {
            if (String(url).includes('/favorite/simple/all')) {
                return envelope({
                    result: { resultCode: '000000', resultMessage: 'Success!' },
                    favoriteInfos: [
                        { contentID: 'u.liked', contentName: '我喜欢的音乐', contentType: '5', totalCount: '174', picture: { bigImgURL: 'https://cdn/a.webp' } },
                        { contentID: 'LV.collected', contentName: '古风', contentType: '4', totalCount: '20' },
                        { contentID: 'chart', contentName: '榜单', contentType: '7' },
                    ],
                });
            }
            return envelope({
                result: { resultCode: '000000', resultMessage: 'Success!' },
                playListInfoEx: { playListSongInfoList: [
                    { contentID: '1092974', contentName: '晴天' },
                    { contentID: '1092975', contentName: '雨天' },
                    { contentID: '1092976', contentName: '阴天' },
                ] },
            });
        });
        const bridge = bridgeOf(fetch, vi.fn(), saved);
        const lists = await bridge.request('library_playlists');
        expect(lists).toMatchObject({ ok: true, data: { items: [
            { id: 'u.liked', name: '我喜欢的音乐', kind: 'owned', trackCount: 174, coverUrl: 'https://cdn/a.webp' },
            { id: 'LV.collected', name: '古风', kind: 'collected', trackCount: 20 },
        ] } });
        expect(await bridge.request('playlist_tracks', { id: 'u.liked', kind: 'owned', limit: 2, offset: 1 })).toMatchObject({
            ok: true,
            data: { total: 3, hasMore: false, nextOffset: 3, items: [{ contentName: '雨天' }, { contentName: '阴天' }] },
        });
    });

    it('refuses an unsupported playlist kind or a playlist without a session', async () => {
        const fetch = vi.fn();
        expect(await bridgeOf(fetch).request('playlist_tracks', { id: 'x', kind: 'owned', limit: 1, offset: 0 }))
            .toMatchObject({ ok: false, error: { code: 'auth-required' } });
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher(), warn: vi.fn() }).set({
            token: 'fixture-token', userId: 'fixture-user', expireTime: 'later', nickname: 'Listener',
        });
        expect(await bridgeOf(fetch, vi.fn(), saved).request('playlist_tracks', { id: 'x', kind: 'chart', limit: 1, offset: 0 }))
            .toMatchObject({ ok: false, error: { code: 'unsupported' } });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('seals the session with the OS store and refuses an unreadable one', () => {
        const saved = store();
        const sessions = createSessionRepository({ store: saved, safeStorage: cipher(), warn: vi.fn() });
        sessions.set({ token: 'fixture-token', userId: 'fixture-user', expireTime: 'later', nickname: 'Listener' });
        expect(sessions.get()).toMatchObject({ token: 'fixture-token', userId: 'fixture-user' });
        expect(saved.get(SESSION_KEY)).toMatch(/^[A-Za-z0-9+/=]+$/);
        expect(String(saved.get(SESSION_KEY))).not.toContain('fixture-token');
        const unavailable = createSessionRepository({
            store: saved,
            safeStorage: { ...cipher(), isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text' },
            warn: vi.fn(),
        });
        expect(unavailable.get()).toBeNull();
        expect(unavailable.unreadable()).toBe(true);
    });
});
