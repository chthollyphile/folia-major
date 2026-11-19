import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/kugou/kugouMain.test.ts
// 酷狗音源模组的 main 入口（sources/kugou/main/index.ts）：迁之前 main.cjs 里的桥、kugou-api-request 通道与 CORS 名单，
// 现在接在宿主给的 api.* 上。这里用一个替身 api 驱动它，KuGouMusicApi 换成假的包（vi.mock），不问酷狗。
// 桥本身（会话、凭据、设备号）在 test/unit/electron/kugouApiBridge.test.ts。

// What `import('kugoumusicapi')` gives the next launch: this package, or a load failure while it is null. vi.doMock
// with vi.resetModules each launch, so every launch loads the package anew.
const kugouPackage = { value: null as Record<string, unknown> | null };

const SESSION_KEYS = new Set(['KUGOU_API_SESSION_V1', 'KUGOU_API_SESSION_V2']);

const launch = async (respond: (url: string) => Response | Promise<Response> = () => new Response('{}')) => {
    vi.resetModules();
    const given = kugouPackage.value;
    vi.doMock('kugoumusicapi', () => {
        if (!given) throw new Error("Cannot find module 'kugoumusicapi'");
        return { default: given };
    });
    const { default: activate } = await import('../../../sources/kugou/main/index');
    const values = new Map<string, unknown>();
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const fetches: Array<{ url: string; init?: Record<string, unknown> }> = [];
    const allowed: unknown[] = [];
    const claimed = (key: string) => {
        if (!SESSION_KEYS.has(key)) throw new Error(`legacy-key-not-claimed:${key}`);
    };
    const api = {
        legacy: { store: {
            get: (key: string) => { claimed(key); return values.get(key); },
            set: (key: string, value: unknown) => { claimed(key); values.set(key, value); },
            has: (key: string) => { claimed(key); return values.has(key); },
            delete: (key: string) => { claimed(key); values.delete(key); },
        } },
        // api.seal's shape (base64 of the sealed bytes); the stand-in seals nothing.
        seal: {
            available: () => true,
            seal: (text: string) => Buffer.from(text, 'utf8').toString('base64'),
            open: (sealed: string) => Buffer.from(sealed, 'base64').toString('utf8'),
        },
        net: { fetch: async (url: string, init?: Record<string, unknown>) => { fetches.push({ url, init }); return respond(url); } },
        media: { allow: (rule: unknown) => { allowed.push(rule); return () => { }; } },
        rpc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => { handlers.set(name, handler); } },
    };
    activate(api as never);
    return { handlers, fetches, allowed, values };
};

afterEach(() => {
    kugouPackage.value = null;
    vi.doUnmock('kugoumusicapi');
    delete process.env.platform;
});

describe('KuGou main entry (source mod)', () => {
    it('lets KuGou\'s own hosts\' media through and answers three calls', async () => {
        const { handlers, allowed } = await launch();
        expect(allowed).toEqual([{ hosts: ['kugou.com', '*.kugou.com'] }]);
        expect([...handlers.keys()].sort()).toEqual(['anonymousSearch', 'legacyPlayInfo', 'request']);
    });

    it('loads KuGouMusicApi as the lite client and hands back what the bridge answers', async () => {
        const search = vi.fn(async () => ({ body: { data: { lists: [{ FileHash: 'HASH' }] } }, cookie: [] }));
        kugouPackage.value = {
            register_dev: async () => ({ body: { status: 1 }, cookie: ['dfid=device'] }),
            search,
        };
        const { handlers } = await launch();
        expect(await handlers.get('request')!('search', { keywords: 'x' })).toEqual({
            ok: true, data: { data: { lists: [{ FileHash: 'HASH' }] } },
        });
        expect(process.env.platform).toBe('lite');
        expect(search).toHaveBeenCalledTimes(1);
    });

    it('answers the bridge\'s line when KuGou refuses, and `api=unloaded` when the package does not load', async () => {
        kugouPackage.value = {
            register_dev: async () => ({ body: { status: 1 }, cookie: ['dfid=device'] }),
            search: async () => { throw { status: 502, body: { error_code: 20028, msg: 'verify' } }; },
        };
        let { handlers } = await launch();
        const refused = await handlers.get('request')!('search', {}) as { ok: boolean; message: string };
        expect(refused.ok).toBe(false);
        expect(refused.message).toBe('KuGouApi[operation=search status=502 error_code=20028]: verify');

        kugouPackage.value = null;
        ({ handlers } = await launch());
        expect(await handlers.get('request')!('search', {})).toEqual({ ok: false, message: expect.stringContaining('api=unloaded') });
        // An operation outside the bridge's list is refused by the bridge too.
        expect(await handlers.get('request')!('anything', {})).toMatchObject({ ok: false });
    });

    it('asks only the two addresses it builds itself, without the default session\'s cookies', async () => {
        const { handlers, fetches } = await launch(() => new Response('{"status":1}', { status: 200 }));
        expect(await handlers.get('anonymousSearch')!('song', 2, 30)).toEqual({ status: 200, bodyText: '{"status":1}' });
        const search = new URL(fetches[0].url);
        expect(search.origin + search.pathname).toBe('http://complexsearch.kugou.com/v2/search/song');
        expect(search.searchParams.get('keyword')).toBe('song');
        expect(search.searchParams.get('page')).toBe('2');
        expect(search.searchParams.get('pagesize')).toBe('30');
        expect(search.searchParams.get('signature')).toMatch(/^[0-9a-f]{32}$/);
        expect(fetches[0].init).toMatchObject({ method: 'GET', credentials: 'omit' });

        expect(await handlers.get('legacyPlayInfo')!('ABCDEF0123')).toEqual({ status: 200, bodyText: '{"status":1}' });
        const playInfo = new URL(fetches[1].url);
        expect(playInfo.origin + playInfo.pathname).toBe('https://m.kugou.com/app/i/getSongInfo.php');
        expect(playInfo.searchParams.get('hash')).toBe('ABCDEF0123');
        expect(fetches[1].init).toMatchObject({ method: 'GET', credentials: 'omit' });
    });

    it('refuses what is not a keyword and page numbers, or not a track hash, before asking anything', async () => {
        const { handlers, fetches } = await launch();
        const anonymousSearch = handlers.get('anonymousSearch')!;
        await expect(anonymousSearch(42, 1, 30)).rejects.toThrow(TypeError);
        await expect(anonymousSearch('song', 0, 30)).rejects.toThrow(TypeError);
        await expect(anonymousSearch('song', 1, 101)).rejects.toThrow(TypeError);
        await expect(anonymousSearch('song', 1.5, 30)).rejects.toThrow(TypeError);
        const legacyPlayInfo = handlers.get('legacyPlayInfo')!;
        await expect(legacyPlayInfo('https://elsewhere.test/')).rejects.toThrow(TypeError);
        await expect(legacyPlayInfo('')).rejects.toThrow(TypeError);
        await expect(legacyPlayInfo(7)).rejects.toThrow(TypeError);
        expect(fetches).toEqual([]);
    });

    it('cuts an over-long keyword to 200 characters instead of refusing it, as before the move', async () => {
        const { handlers, fetches } = await launch(() => new Response('{"status":1}', { status: 200 }));
        await handlers.get('anonymousSearch')!('x'.repeat(260), 1, 30);
        expect(new URL(fetches[0].url).searchParams.get('keyword')).toBe('x'.repeat(200));
    });

    it('says KuGou could not be asked when the fetch fails, and hands a non-2xx status through', async () => {
        let { handlers } = await launch(() => { throw new Error('getaddrinfo ENOTFOUND'); });
        expect(await handlers.get('legacyPlayInfo')!('ABC')).toEqual({ unreachable: true, message: 'getaddrinfo ENOTFOUND' });
        ({ handlers } = await launch(() => new Response('busy', { status: 429 })));
        expect(await handlers.get('anonymousSearch')!('song', 1, 30)).toEqual({ status: 429, bodyText: 'busy' });
    });
});
