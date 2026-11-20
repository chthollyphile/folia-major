import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FoliumSourceDef } from '@folia/folium';

// test/unit/netease/neteaseClient.test.ts
// 网易云音乐音源模组的 client 入口（sources/netease/client/index.ts）：folium 是替身。钉住的是
//   - 它交回 disposer：模组停用时，core 记着的端口与后端状态跟着丢掉，不再往已经关掉的端口发请求；
//   - 启动和问一首歌能不能放都不去问 main 入口（只用于匹配时 main 入口要等到真用到才加载，提早问就提早拉起了服务）；
//   - main 入口推来的状态（rpc.on('status')）直接用：运行中的端口不再问一次；
//   - 登录 cookie 与匿名 cookie 在页面存储 netease 的 cookie / anonymous_cookie 下（宿主把更早的旧名搬到这里）。

interface FakeFolium {
    folium: unknown;
    calls: unknown[][];
    defs: FoliumSourceDef[];
    page: Map<string, string>;
    pageStoresAsked: string[];
    push: (status: unknown) => void;
}

const fakeFolium = (): FakeFolium => {
    const calls: unknown[][] = [];
    const defs: FoliumSourceDef[] = [];
    const page = new Map<string, string>();
    const pageStoresAsked: string[] = [];
    let listener: ((payload: unknown) => void) | null = null;
    const folium = {
        modId: 'netease',
        rpc: {
            call: vi.fn(async (...args: unknown[]) => {
                calls.push(args);
                return { status: 'running', port: 41000, error: null, updatedAt: 1 };
            }),
            on: (name: string, handler: (payload: unknown) => void) => {
                if (name === 'status') listener = handler;
                return () => { listener = null; };
            },
        },
        i18n: { key: (key: string) => ({ i18nKey: key }), text: (key: string) => key },
        sources: {
            register: (def: FoliumSourceDef) => {
                defs.push(def);
                return { notify: () => undefined, unregister: () => undefined };
            },
            error: (code: string, message: string) => Object.assign(new Error(message), { code }),
            pageStore: (sourceId: string) => {
                pageStoresAsked.push(sourceId);
                return {
                    get: (key: string) => page.get(key) ?? null,
                    set: (key: string, value: string | null) => {
                        if (value === null) page.delete(key);
                        else page.set(key, value);
                    },
                    keys: () => [...page.keys()],
                };
            },
        },
        lyrics: { isPureMusicText: () => false },
    };
    return { folium, calls, defs, page, pageStoresAsked, push: (status) => listener?.(status) };
};

const searchOf = (def: FoliumSourceDef) => (def.capabilities['search@1'] as { searchSongs: (query: string, limit: number, offset: number) => Promise<unknown> });

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('NetEase client entry', () => {
    it('asks the main entry nothing to start, nor to say whether a song can play', async () => {
        vi.resetModules();
        const { default: activate } = await import('../../../sources/netease/client/index');
        const fake = fakeFolium();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const dispose = activate(fake.folium as never);
        expect(dispose).toBeTypeOf('function');
        expect(fake.defs).toHaveLength(1);
        const [def] = fake.defs;
        expect(def.id).toBe('netease');

        const songs = def.capabilities['songs@1'] as { getAvailability: (song: unknown) => unknown };
        const song = { id: '42', title: 'Song', artists: [{ id: '1', name: 'Artist' }], data: { fee: 1, privilege: { st: 0, fee: 1, pl: 0 } } };
        songs.getAvailability(song);
        expect(fake.calls).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
        dispose();
    });

    it('uses the port the main entry pushed, and forgets it with the state once disposed', async () => {
        vi.resetModules();
        const { default: activate } = await import('../../../sources/netease/client/index');
        const fake = fakeFolium();
        fake.page.set('cookie', 'MUSIC_U=opaque');
        const fetchMock = vi.fn(async () => Response.json({ code: 200, result: { songs: [] } }));
        vi.stubGlobal('fetch', fetchMock);
        const dispose = activate(fake.folium as never);
        const [def] = fake.defs;

        fake.push({ status: 'running', port: 35001, error: null, updatedAt: 2 });
        await searchOf(def).searchSongs('hello', 5, 0);
        expect(fake.calls).toEqual([]);
        const [url] = fetchMock.mock.calls[0] as unknown as [string];
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:35001\/cloudsearch\?/);
        // The sign-in's cookie, from the page store of `netease`.
        expect(url).toContain(`cookie=${encodeURIComponent('MUSIC_U=opaque')}`);
        expect(fake.pageStoresAsked.every(id => id === 'netease')).toBe(true);

        dispose();
        // Made again (enabled again): the old port is not used; the main entry is asked.
        activate(fake.folium as never);
        await searchOf(fake.defs[1]).searchSongs('hello', 5, 0);
        expect(fake.calls).toEqual([['status']]);
        const [again] = fetchMock.mock.calls[1] as unknown as [string];
        expect(again).toMatch(/^http:\/\/127\.0\.0\.1:41000\//);
    });

    it('keeps the anonymous cookie it is given under anonymous_cookie', async () => {
        vi.resetModules();
        const { default: activate } = await import('../../../sources/netease/client/index');
        const fake = fakeFolium();
        const fetchMock = vi.fn(async (url: string) => (url.includes('/register/anonimous')
            ? Response.json({ code: 200, cookie: 'MUSIC_A=anon' })
            : Response.json({ code: 200, result: { songs: [] } })));
        vi.stubGlobal('fetch', fetchMock);
        activate(fake.folium as never);
        fake.push({ status: 'running', port: 35001, error: null, updatedAt: 2 });
        await searchOf(fake.defs[0]).searchSongs('hello', 5, 0);
        expect(fake.page.get('anonymous_cookie')).toBe('MUSIC_A=anon');
        expect(fake.page.has('cookie')).toBe(false);
        const last = String(fetchMock.mock.calls.at(-1)?.[0]);
        expect(last).toContain(`cookie=${encodeURIComponent('MUSIC_A=anon')}`);
    });
});
