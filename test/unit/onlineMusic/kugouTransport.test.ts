import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import md5 from 'blueimp-md5';
import type { FoliumSourcePageStore } from '@folia/folium';
import { createFoliumSourceError } from '@/mods/folium/sources/errors';
import { createDesktopKugouTransport, createWebKugouTransport, type KugouTransport } from '../../../sources/kugou/core/kugouTransport';
import { describeKugouFailure, isKugouTimeout } from '../../../sources/kugou/core/kugouFailure';

// test/unit/onlineMusic/kugouTransport.test.ts
// 酷狗音源模组的两条 transport（sources/kugou/core/kugouTransport.ts），直接拿 createDesktopKugouTransport /
// createWebKugouTransport 测：桌面版的 env.call 是到 main 入口的 rpc（这里由 bridge() 照 main/index.ts 的样子答
// { ok, data } 或 { ok: false, message }），网页版直接 fetch 配好的 KuGouMusicApi。页面存储用一张表，键和宿主的
// pageStore 一样（online_provider:kugou:<key>），错用宿主真的 createFoliumSourceError。

const storage = new Map<string, string>();
const pageStore = (sourceId: string): FoliumSourcePageStore => {
    const at = (key: string) => `online_provider:${sourceId}:${key}`;
    return {
        get: key => storage.get(at(key)) ?? null,
        set: (key, value) => {
            if (value === null) storage.delete(at(key));
            else storage.set(at(key), value);
        },
        keys: () => [...storage.keys()].filter(key => key.startsWith(at(''))).map(key => key.slice(at('').length)),
    };
};

type Handler = (...args: any[]) => unknown;

/** The main entry's `request` as main/index.ts answers it: what `handle` gives, or the line it throws. */
const bridge = (handle: Handler): Handler => async (...args: unknown[]) => {
    try {
        return { ok: true, data: await handle(...args) };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
};

/** The desktop transport over fake rpc handlers (results go through JSON, as the real rpc's do). */
const desktop = (handlers: Record<string, Handler> = {}) => {
    const call = vi.fn(async (name: string, ...args: unknown[]) => {
        const handler = handlers[name];
        if (!handler) throw new Error(`no rpc handler ${name}`);
        return JSON.parse(JSON.stringify(await handler(...args)) ?? 'null');
    });
    const transport = createDesktopKugouTransport({ call: call as never, error: createFoliumSourceError, pageStore });
    return { transport, call };
};

const relayUrl = (url: string) => `/api/lyric-proxy?url=${encodeURIComponent(url)}`;
const web = (apiBase = 'https://kugou.example.test'): KugouTransport => createWebKugouTransport(
    { call: () => Promise.reject(new Error('the web build has no main entry')), error: createFoliumSourceError, pageStore },
    { apiBase, md5: text => md5(text), relayUrl },
);

describe('KuGou transports', () => {
    beforeEach(() => {
        storage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('sends desktop requests to the main entry without copying credentials into the page store', async () => {
        storage.set('online_provider:kugou:cookie', 'token=legacy;userid=7;dfid=legacy-device');
        storage.set('online_provider:kugou:token', 'legacy');
        storage.set('online_provider:kugou:userid', '7');
        storage.set('online_provider:kugou:dfid', 'legacy-device');
        const request = vi.fn().mockResolvedValue({
            data: { status: 4, token: 'must-not-persist', userid: '123', dfid: 'private-device' },
        });
        const { transport, call } = desktop({ request: bridge(request) });

        await expect(transport.request('login_qr_check', {
            key: 'qr', token: 'legacy-param', dfid: 'legacy-device',
        })).resolves.toEqual({
            data: { status: 4, token: 'must-not-persist', userid: '123', dfid: 'private-device' },
        });
        expect(call).toHaveBeenCalledWith('request', 'login_qr_check', { key: 'qr' });
        expect(storage.get('online_provider:kugou:cookie')).toBeUndefined();
        expect(storage.get('online_provider:kugou:token')).toBeUndefined();
        expect(storage.get('online_provider:kugou:dfid')).toBeUndefined();
        expect(storage.get('online_provider:kugou:userid')).toBe('123');
    });

    it('keeps the web sign-in persistence', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            data: { status: 4, token: 'web-token', userid: '9', dfid: 'web-device' },
            cookie: ['token=web-token', 'userid=9', 'dfid=web-device'],
        }));
        vi.stubGlobal('fetch', fetchMock);

        await web().request('login_qr_check', { key: 'qr' });

        expect(storage.get('online_provider:kugou:token')).toBe('web-token');
        expect(storage.get('online_provider:kugou:userid')).toBe('9');
        expect(storage.get('online_provider:kugou:dfid')).toBe('web-device');
        expect(storage.get('online_provider:kugou:cookie')).toBe('token=web-token; userid=9; dfid=web-device');
    });

    it('keeps the desktop account hint when a public playlist answers with its creator\'s userid (#1101)', async () => {
        storage.set('online_provider:kugou:userid', 'user-a');
        const { transport } = desktop({
            request: bridge(async (operation: string) => (operation === 'user_detail'
                ? { data: { nickname: 'A', userid: 'user-a2' } }
                : { data: { userid: 'user-b', name: 'B list' } })),
        });

        await transport.request('playlist_detail', { ids: 'list' });
        expect(storage.get('online_provider:kugou:userid')).toBe('user-a');
        await transport.request('login_qr_check', { key: 'qr' });
        expect(storage.get('online_provider:kugou:userid')).toBe('user-a');
        // The profile answer carries the session's own account id (the bridge writes it in).
        await transport.request('user_detail', {});
        expect(storage.get('online_provider:kugou:userid')).toBe('user-a2');
    });

    it('drops the desktop account hint on a sign-out', async () => {
        storage.set('online_provider:kugou:userid', 'user-a');
        const { transport } = desktop({ request: bridge(async () => ({ status: 1 })) });

        await transport.request('logout', {});

        expect(storage.get('online_provider:kugou:userid')).toBeUndefined();
    });

    it('keeps the web account when a public playlist answers with its creator\'s userid (#1101)', async () => {
        storage.set('online_provider:kugou:token', 'token-a');
        storage.set('online_provider:kugou:userid', 'user-a');
        storage.set('online_provider:kugou:dfid', 'device');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(Response.json({ data: { userid: 'user-b', token: 'token-b', name: 'B list' }, cookie: ['userid=user-b', 'token=token-b', 'kg_mid=mid'] }))
            .mockResolvedValueOnce(Response.json({ data: { status: 4, token: 'token-x' } }));
        vi.stubGlobal('fetch', fetchMock);
        const transport = web();

        await transport.request('playlist_detail', { ids: 'list' });
        await transport.request('login_qr_check', { key: 'qr' });

        expect(storage.get('online_provider:kugou:token')).toBe('token-a');
        expect(storage.get('online_provider:kugou:userid')).toBe('user-a');
        expect(storage.get('online_provider:kugou:cookie')).toBe('kg_mid=mid');
    });

    it('forgets the whole web session, and only the hint on the desktop', () => {
        for (const key of ['cookie', 'token', 'userid', 'dfid']) storage.set(`online_provider:kugou:${key}`, key);
        web().forgetAccount();
        expect([...storage.keys()]).toEqual([]);

        storage.set('online_provider:kugou:userid', '9');
        storage.set('online_provider:kugou:token', 'legacy');
        desktop().transport.forgetAccount();
        expect([...storage.keys()]).toEqual([]);
    });

    it('registers a fresh dfid and retries when an audio URL request requires verification', async () => {
        storage.set('online_provider:kugou:dfid', 'stale-dfid');
        storage.set('online_provider:kugou:token', 'token');
        storage.set('online_provider:kugou:userid', '9');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(Response.json({ status: 0, errcode: 20028, error: '本次请求需要验证' }))
            .mockResolvedValueOnce(Response.json({ status: 1, data: { dfid: 'fresh-dfid' } }))
            .mockResolvedValueOnce(Response.json({ status: 1, url: ['https://example.test/song.mp3'] }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(web().request('song_url', { hash: 'HASH' })).resolves.toEqual({
            status: 1,
            url: ['https://example.test/song.mp3'],
        });

        expect(new URL(fetchMock.mock.calls[1][0]).pathname).toBe('/register/dev');
        const retriedUrl = new URL(fetchMock.mock.calls[2][0]);
        expect(retriedUrl.pathname).toBe('/song/url');
        expect(retriedUrl.searchParams.get('cookie')).toBe('dfid=fresh-dfid;token=token;userid=9');
    });

    it.each([
        ['krm_audio', { album_audio_id: '42', fields: 'album_info,authors.base,base,audio_info' }, '/krm/audio', ['album_audio_id', '42']],
        ['top_card_youth', { card_id: 3006, pagesize: 30 }, '/top/card/youth', ['card_id', '3006']],
        ['song_climax', { hash: 'HASH' }, '/song/climax', ['hash', 'HASH']],
    ] as const)('routes %s to its documented web endpoint', async (operation, params, pathname, [key, value]) => {
        storage.set('online_provider:kugou:dfid', 'device');
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 1, data: [] }));
        vi.stubGlobal('fetch', fetchMock);

        await web().request(operation, params);

        const requestUrl = new URL(fetchMock.mock.calls[0][0]);
        expect(requestUrl.pathname).toBe(pathname);
        expect(requestUrl.searchParams.get(key)).toBe(value);
    });

    it('requires token, userid, and dfid before using authenticated search on the web', () => {
        const transport = web();
        storage.set('online_provider:kugou:dfid', 'device');
        expect(transport.hasAuthenticatedSearchSession()).toBe(false);
        storage.set('online_provider:kugou:token', 'token');
        storage.set('online_provider:kugou:userid', '9');
        expect(transport.hasAuthenticatedSearchSession()).toBe(true);
        expect(transport.sessionToken()).toBe('token');
    });

    it('uses only the non-secret account id as the desktop authenticated-search hint', () => {
        const { transport } = desktop();
        storage.set('online_provider:kugou:userid', '9');

        expect(transport.hasAuthenticatedSearchSession()).toBe(true);
        expect(transport.sessionToken()).toBeUndefined();
        expect(storage.get('online_provider:kugou:token')).toBeUndefined();
    });

    it('says whether the privileged URL endpoint is worth asking: a signed-in desktop account, a web VIP credential', () => {
        const { transport: desktopTransport } = desktop();
        expect(desktopTransport.hasVipSession()).toBe(false);
        storage.set('online_provider:kugou:userid', '9');
        expect(desktopTransport.hasVipSession()).toBe(true);

        const webTransport = web();
        expect(webTransport.hasVipSession()).toBe(false);
        storage.set('online_provider:kugou:cookie', 'vip_token=;dfid=device');
        expect(webTransport.hasVipSession()).toBe(false);
        storage.set('online_provider:kugou:cookie', 'vip_token=secret;dfid=device');
        expect(webTransport.hasVipSession()).toBe(true);
    });

    it('keeps VIP credentials out of what the desktop sends main', async () => {
        const request = vi.fn(() => ({ data: {} }));
        const { transport } = desktop({ request: bridge(request) });

        await transport.request('song_url_new', { hash: 'abc', vip_token: 'forged', vip_type: 6, token: 'old' });

        expect(request).toHaveBeenCalledWith('song_url_new', { hash: 'abc' });
    });

    it('sends the web anonymous signed search through the lyric proxy without provider cookies', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ error_code: 0, data: { lists: [] } }));
        vi.stubGlobal('fetch', fetchMock);

        await web().anonymousSearch('爱河', 1, 50);

        const proxyUrl = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
        const targetUrl = new URL(proxyUrl.searchParams.get('url') || '');
        expect(targetUrl.hostname).toBe('complexsearch.kugou.com');
        expect(targetUrl.pathname).toBe('/v2/search/song');
        expect(targetUrl.searchParams.get('keyword')).toBe('爱河');
        expect(targetUrl.searchParams.get('pagesize')).toBe('50');
        expect(targetUrl.searchParams.get('token')).toBe('');
        expect(targetUrl.searchParams.get('signature')).toMatch(/^[a-f0-9]{32}$/);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
    });

    it('asks the main entry for the desktop anonymous search and reads its answer', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const anonymousSearch = vi.fn().mockResolvedValue({ status: 200, bodyText: JSON.stringify({ error_code: 0, data: { lists: [] } }) });
        const { transport, call } = desktop({ anonymousSearch });

        await expect(transport.anonymousSearch('爱河', 1, 50)).resolves.toEqual({ error_code: 0, data: { lists: [] } });
        expect(call).toHaveBeenCalledWith('anonymousSearch', '爱河', 1, 50);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['KuGou\'s error code', { status: 200, bodyText: JSON.stringify({ error_code: 1001 }) }, 'network'],
        ['a non-2xx answer', { status: 503, bodyText: '' }, 'network'],
        ['an unreadable body', { status: 200, bodyText: '<html>' }, 'invalid-response'],
        ['main not reaching it', { unreachable: true, message: 'ENOTFOUND' }, 'network'],
    ])('fails the desktop anonymous search on %s', async (_label, answer, code) => {
        const { transport } = desktop({ anonymousSearch: async () => answer });

        await expect(transport.anonymousSearch('song', 1, 30)).rejects.toMatchObject({ code });
    });

    it('sends the web legacy mobile playInfo through the lyric proxy', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            status: 1,
            url: 'https://example.test/song.mp3',
            backup_url: 'https://example.test/backup.mp3',
        }));
        vi.stubGlobal('fetch', fetchMock);

        const body = await web().legacyPlayInfo('B18B946D9B510FC72AB848FA17D06AFB');

        expect(body).toMatchObject({ status: 1, url: 'https://example.test/song.mp3' });
        const proxyUrl = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
        const targetUrl = new URL(proxyUrl.searchParams.get('url') || '');
        expect(targetUrl.hostname).toBe('m.kugou.com');
        expect(targetUrl.pathname).toBe('/app/i/getSongInfo.php');
        expect(targetUrl.searchParams.get('cmd')).toBe('playInfo');
        expect(targetUrl.searchParams.get('hash')).toBe('B18B946D9B510FC72AB848FA17D06AFB');
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
    });

    it('asks the main entry for the desktop legacy mobile playInfo', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const legacyPlayInfo = vi.fn().mockResolvedValue({ status: 200, bodyText: JSON.stringify({ status: 1, url: 'https://example.test/song.mp3' }) });
        const { transport, call } = desktop({ legacyPlayInfo });

        await expect(transport.legacyPlayInfo('HASH')).resolves.toMatchObject({ status: 1, url: 'https://example.test/song.mp3' });
        expect(call).toHaveBeenCalledWith('legacyPlayInfo', 'HASH');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not fall back to the web after the main entry is not reached', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { transport } = desktop({});

        const error = await transport.request('search', { keywords: 'song' }).catch((caught: unknown) => caught);

        expect(error).toMatchObject({ name: 'OnlineProviderError', code: 'network' });
        expect((error as Error).message).toContain('operation=search');
        // The rpc failing is the main entry not running: the bridge's own `api=unloaded`.
        expect(describeKugouFailure('audio', error)).toEqual({ case: 'local-service-stopped' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reads the bridge\'s line into a network error', async () => {
        const { transport } = desktop({
            request: bridge(async () => { throw new Error('KuGouApi[operation=user_detail status=502 error_code=20028]: upstream busy'); }),
        });

        const error = (await transport.request('user_detail', {}).catch((caught: unknown) => caught)) as Error;

        expect(error).toMatchObject({ name: 'OnlineProviderError', code: 'network' });
        expect(error.message).toContain('operation=user_detail');
        expect(error.message).toContain('status=502');
        expect(error.message).toContain('error_code=20028');
        expect(error.message).not.toContain('[object Object]');
    });

    it.each([
        ['an HTTP 401 status', 'KuGouApi[operation=user_detail status=401]: unauthorized'],
        ['an HTTP 403 status', 'KuGouApi[operation=user_detail status=403]'],
        ['the documented missing-credentials error_code 152', 'KuGouApi[operation=search status=502 error_code=152]'],
    ])('maps %s from the bridge to auth-required', async (_label, bridgeMessage) => {
        const { transport } = desktop({ request: bridge(async () => { throw new Error(bridgeMessage); }) });

        await expect(transport.request('user_detail', {})).rejects.toMatchObject({ code: 'auth-required' });
    });

    it('answers a stored session main cannot load now as unavailable, not as a sign-out', async () => {
        const { transport } = desktop({
            request: bridge(async () => {
                throw new Error('KuGouApi[operation=user_detail session=unreadable]: The stored KuGou session cannot be read now');
            }),
        });

        await expect(transport.request('user_detail', {})).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('treats a message-less bridge failure as a network error, not a sign-out', async () => {
        const { transport } = desktop({ request: bridge(async () => { throw new Error('[object Object]'); }) });

        await expect(transport.request('user_detail', {})).rejects.toMatchObject({ code: 'network' });
    });

    it('maps web 401/403 answers to auth-required and other failures to network', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(new Response('{}', { status: 401 }))
            .mockResolvedValueOnce(new Response('{}', { status: 502 })));
        const transport = web();

        await expect(transport.request('user_detail', {})).rejects.toMatchObject({ code: 'auth-required' });
        await expect(transport.request('user_detail', {})).rejects.toMatchObject({ code: 'network' });
    });

    it('reports the web as not configured without an address, a persistent config failure', async () => {
        const transport = web('');

        expect(transport.getAvailability()).toEqual({ configured: false, reason: 'not-configured' });
        const error = await transport.request('song_url', { hash: 'HASH' }).catch((caught: unknown) => caught);
        expect(error).toMatchObject({ code: 'unavailable' });
        expect(describeKugouFailure('audio', error)).toEqual({ case: 'not-configured' });
        expect(desktop().transport.getAvailability()).toEqual({ configured: true });
    });

    describe('desktop failure details', () => {
        const rejectWith = async (bridgeMessage: string) => {
            const { transport } = desktop({ request: bridge(async () => { throw new Error(bridgeMessage); }) });
            const error = await transport.request('song_url', { hash: 'HASH' }).catch((caught: unknown) => caught);
            return { error, said: describeKugouFailure('audio', error), timedOut: isKugouTimeout(error) };
        };

        it.each([
            ['ETIMEDOUT', 'KuGouApi[operation=song_url status=502]: ETIMEDOUT: connect ETIMEDOUT 1.2.3.4:443', 'ETIMEDOUT: connect ETIMEDOUT 1.2.3.4:443'],
            ['ECONNABORTED', 'KuGouApi[operation=song_url status=502]: ECONNABORTED: timeout of 10000ms exceeded', 'ECONNABORTED: timeout of 10000ms exceeded'],
        ])('reads a %s detail without error_code as a request that ran out of time', async (_label, bridgeMessage, detail) => {
            const { error, said, timedOut } = await rejectWith(bridgeMessage);

            expect(error).toMatchObject({ name: 'OnlineProviderError', code: 'network' });
            expect((error as { cause?: Error }).cause?.message).toBe(bridgeMessage);
            expect((error as Error).message).toContain('operation=song_url');
            expect(timedOut).toBe(true);
            expect(said).toEqual({ httpStatus: 502, message: detail });
        });

        it('reads a non-auth error_code as KuGou refusing, with its code', async () => {
            const { said } = await rejectWith('KuGouApi[operation=song_url status=502 error_code=20028]: upstream busy');

            expect(said).toEqual({ case: 'refused', httpStatus: 502, code: '20028', message: 'upstream busy' });
        });

        it('does not treat an error_code with a timeout-looking detail as a timeout', async () => {
            const { said, timedOut } = await rejectWith('KuGouApi[operation=song_url status=502 error_code=20010]: ETIMEDOUT');

            expect(timedOut).toBe(false);
            expect(said).toMatchObject({ case: 'refused', code: '20010' });
        });

        it('keeps other detail-only failures as plain network errors', async () => {
            const { error, said, timedOut } = await rejectWith('KuGouApi[operation=song_url status=502]: ECONNRESET: socket hang up');

            expect(error).toMatchObject({ code: 'network' });
            expect(timedOut).toBe(false);
            expect(said).toEqual({ httpStatus: 502, message: 'ECONNRESET: socket hang up' });
        });

        it('reads a bridge line that never reached KuGou as the local service stopping', async () => {
            const { said } = await rejectWith('KuGouApi[operation=song_url api=unloaded]: Cannot find module');

            expect(said).toEqual({ case: 'local-service-stopped' });
        });
    });

    describe('web failure details', () => {
        const requestWithFetch = async (fetchMock: ReturnType<typeof vi.fn>) => {
            vi.stubGlobal('fetch', fetchMock);
            const error = await web().request('song_url', { hash: 'HASH' }).catch((caught: unknown) => caught);
            return { error, said: describeKugouFailure('audio', error) };
        };

        it('throws the fetch TypeError as it was, which reads as KuGouMusicApi not reached', async () => {
            const fetchError = new TypeError('Failed to fetch');

            const { error, said } = await requestWithFetch(vi.fn().mockRejectedValue(fetchError));

            expect(error).toBe(fetchError);
            expect(said).toEqual({ case: 'unreachable' });
        });

        it('rethrows a non-TypeError fetch failure unchanged', async () => {
            const abortError = new DOMException('aborted', 'AbortError');

            const { error } = await requestWithFetch(vi.fn().mockRejectedValue(abortError));

            expect(error).toBe(abortError);
        });

        it('maps an unreadable 200 body to invalid-response with the parse error as cause', async () => {
            const { error } = await requestWithFetch(vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));

            expect(error).toMatchObject({ code: 'invalid-response' });
            expect((error as { cause?: unknown }).cause).toBeInstanceOf(SyntaxError);
        });

        it('reads the error code in a 502 body as KuGou refusing', async () => {
            const { error, said } = await requestWithFetch(vi.fn().mockResolvedValue(
                Response.json({ status: 0, error_code: 31000 }, { status: 502 }),
            ));

            expect(error).toMatchObject({ code: 'network', httpStatus: 502 });
            expect(said).toEqual({ case: 'refused', httpStatus: 502, code: '31000' });
        });

        // A 152 in the body is not made a sign-in that ended on the web (the web sign-out stays as it is).
        it('keeps error_code 152 in a 502 body as network on the web', async () => {
            const { error, said } = await requestWithFetch(vi.fn().mockResolvedValue(
                Response.json({ status: 0, errcode: 152 }, { status: 502 }),
            ));

            expect(error).toMatchObject({ code: 'network' });
            expect(said).toMatchObject({ code: '152' });
        });

        it('passes non-502 HTTP statuses through', async () => {
            const { error, said } = await requestWithFetch(vi.fn().mockResolvedValue(new Response('busy', { status: 503 })));

            expect(error).toMatchObject({ code: 'network', httpStatus: 503 });
            expect(said).toEqual({ httpStatus: 503 });
        });

        it('converts Retry-After on a 429 into retryAfterMs', async () => {
            const { error } = await requestWithFetch(vi.fn().mockResolvedValue(
                new Response('{}', { status: 429, headers: { 'Retry-After': '25' } }),
            ));

            expect(error).toMatchObject({ code: 'network', httpStatus: 429, retryAfterMs: 25_000 });
        });

        it('keeps a 502 without a readable body as KuGouMusicApi\'s status alone', async () => {
            const { error, said } = await requestWithFetch(vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })));

            expect(error).toMatchObject({ code: 'network' });
            expect(said).toEqual({ httpStatus: 502 });
        });
    });

    describe('legacy playInfo failures', () => {
        const legacyFailure = async (transport: KugouTransport) => {
            const error = await transport.legacyPlayInfo('HASH').catch((caught: unknown) => caught);
            return { error, said: describeKugouFailure('audio', error) };
        };

        it('reads a non-2xx web answer the lyric proxy gave itself as m.kugou.com not reached', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })));

            const { error, said } = await legacyFailure(web());
            expect(error).toMatchObject({ code: 'network' });
            expect(said).toEqual({ case: 'unreachable' });
        });

        it('keeps the status of a real web answer and drops the lyric proxy\'s own 500 / 502', async () => {
            vi.stubGlobal('fetch', vi.fn()
                .mockResolvedValueOnce(new Response('', { status: 404 }))
                .mockResolvedValueOnce(new Response('', { status: 502 })));
            const transport = web();

            const answered = await legacyFailure(transport);
            expect(answered.error).toMatchObject({ code: 'network', httpStatus: 404 });
            expect(answered.said).toEqual({ httpStatus: 404 });
            const proxyFailure = await legacyFailure(transport);
            expect((proxyFailure.error as { httpStatus?: number }).httpStatus).toBeUndefined();
            expect(proxyFailure.said).toEqual({ case: 'unreachable' });
        });

        it('keeps the status main got, which is always m.kugou.com\'s own (500 too)', async () => {
            const statuses = [404, 500];
            const { transport } = desktop({ legacyPlayInfo: async () => ({ status: statuses.shift(), bodyText: '' }) });

            const notFound = await legacyFailure(transport);
            expect(notFound.error).toMatchObject({ code: 'network', httpStatus: 404 });
            expect(notFound.said).toEqual({ httpStatus: 404 });
            await expect(transport.legacyPlayInfo('HASH')).rejects.toMatchObject({ code: 'network', httpStatus: 500 });
        });

        it('reads main not reaching m.kugou.com as unreachable', async () => {
            const { transport } = desktop({ legacyPlayInfo: async () => ({ unreachable: true, message: 'ECONNRESET' }) });

            const { error, said } = await legacyFailure(transport);
            expect(error).toMatchObject({ code: 'network' });
            expect(said).toEqual({ case: 'unreachable' });
        });

        it('maps unreadable bodies to invalid-response on both builds', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
            expect((await legacyFailure(web())).error).toMatchObject({ code: 'invalid-response' });

            const { transport } = desktop({ legacyPlayInfo: async () => ({ status: 200, bodyText: 'not json' }) });
            const { error } = await legacyFailure(transport);
            expect(error).toMatchObject({ code: 'invalid-response' });
            expect((error as { cause?: unknown }).cause).toBeInstanceOf(SyntaxError);
        });
    });
});
