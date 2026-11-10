// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});

// Lyrics parse in the lyrics worker, which jsdom has not: run the same parser inline.
vi.mock('@/utils/lyrics/workerClient', async () => {
    const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
    return {
        parseLyricsAsync: vi.fn(async (
            format: Parameters<typeof parseLyricsByFormat>[0],
            content: string,
            translation: string,
            options: Parameters<typeof parseLyricsByFormat>[3],
            romanization: string,
        ) => parseLyricsByFormat(format, content, translation, options, romanization)),
    };
});

// KuGou's adapter is real; only its request to the backend is replaced.
const requestKugou = vi.hoisted(() => vi.fn());
// Its search without a signed-in session goes to the backend by a request of its own, replaced too.
const requestKugouAnonymousSearch = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/kugou/kugouTransport', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/services/onlineMusic/kugou/kugouTransport')>(),
    requestKugou,
    requestKugouAnonymousSearch,
}));
// QQ Music's adapter is real as well; only its request to the backend is replaced, and the request it sends
// to QQ's musicu directly (a song by its numeric songid, songs many at once).
const requestQq = vi.hoisted(() => vi.fn());
const requestQqMusicu = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/qq/qqTransport', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/services/onlineMusic/qq/qqTransport')>(),
    requestQq,
    requestQqMusicu,
}));

import type { SongResult } from '@/types';
import type { ModRuntimeInfo } from '@/mods/types';
import type { FoliumCollection, FoliumOmniService, FoliumProviderSong, FoliumSong, FoliumOmniProviderDef } from '@/mods/folium/contract';
import { OnlineProviderError } from '@/types/onlineMusic';
import { neteaseApi } from '@/services/onlineMusic/netease/netease';
import { neteaseRaw } from '@/services/onlineMusic/netease/neteaseRaw';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { omni } from '@/services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { createFoliumClientApi } from '@/mods/folium/api';
import { resolveFoliumSongRef, toFoliumSong } from '@/mods/folium/dto';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import '@/mods/folium/experimental';
import { omniProvidersRegistry } from '@/mods/folium/registries/omniProviders';
import { createFoliumPlatformService } from '@/mods/folium/platformRaw';
import { createFoliumRequestGate, resetFoliumRequestQuotasForTest } from '@/mods/folium/omni/requestQuota';
import { registerFoliumOmniSource } from '@/mods/folium/omni/service';
import { installFoliumHostAccount } from '@/mods/runtime/hostAccount';
import { FOLIUM_HOST_OMNI_SOURCE, installFoliumHostOmni } from '@/mods/runtime/omni/hostOmni';
import { clearFoliumResolvedSongsForTest, readFoliumResolvedSong } from '@/mods/runtime/omni/omniResolveCache';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumOmni.test.ts
// Folium 1.7 `folium.omni`: the stable read-only view of the host's online sources. Everything runs on the
// real stores, the real Omni and the real platform adapters; only an adapter's request to its backend
// (`neteaseApi.*`, KuGou's `requestKugou`) and a mod's own source are stand-ins. Covered: the export window,
// the source list, search with the host's cursors and slicing, lookups by { source, id } with the cache,
// describeSong, lyrics without the mods' hooks, albums and artists, abort and the time limits, the shared
// allowance, and the platform's failures as the contract's codes.

installFoliumHostAccount();
installFoliumHostOmni();

const mod = (id = 'mod-a'): ModRuntimeInfo => ({
    id, name: id, version: '1.0.0', author: null, description: null, permissions: ['platform.netease.read'],
    status: 'loaded', error: null, enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false, experimental: [], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null,
});

type ApiOverrides = Parameters<typeof clientApiOptions>[1];
const omniOf = (id = 'mod-a', overrides: ApiOverrides = {}): FoliumOmniService => (
    createFoliumClientApi(mod(id), clientApiOptions('main', overrides)).omni
);

const store = () => useOnlineProviderAccountStore.getState();
const signIn = (providerId: string, id: number) => store().updateAccount(providerId, {
    status: 'authenticated',
    user: { id, nickname: `listener ${id}`, vipType: 11 },
    hydration: 'ready',
    freshness: 'fresh',
});
const flush = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });
const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

/* What a call rejected with: its code, or the error itself when it has none. */
const failureOf = (promise: Promise<unknown>) => promise.then(
    () => { throw new Error('resolved'); },
    (error: { code?: string }) => error.code ?? error,
);

/* A NetEase song as its backend answers it. */
const rawSong = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    name: `song ${id}`,
    ar: [{ id: 7, name: 'Artist' }],
    al: { id: 5, name: 'Album', picUrl: `https://img.example/${id}.jpg` },
    dt: 200_000,
    ...extra,
});
const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index);
const searchAnswer = (offset: number, limit: number, total = 1000) => ({
    code: 200,
    result: { songs: range(offset + 1, Math.max(0, Math.min(limit, total - offset))).map((id) => rawSong(id)), songCount: total },
});

/* NetEase's search answering at once, as the backend would. */
const answerSearches = () => vi.spyOn(neteaseApi, 'cloudSearch').mockImplementation(
    async (_query: string, limit = 30, offset = 0) => searchAnswer(offset, limit) as never,
);

/* NetEase's search holding its answers back, to be let out one by one: `answer(n)` answers the n-th sent. */
const holdSearches = () => {
    const answers: Array<() => void> = [];
    const spy = vi.spyOn(neteaseApi, 'cloudSearch').mockImplementation((_query: string, limit = 30, offset = 0) => (
        new Promise((resolve) => { answers.push(() => resolve(searchAnswer(offset, limit) as never)); })
    ));
    return { spy, answer: (index: number) => answers[index]() };
};

/* A host song, as the queue or a page would hold it. */
const hostSong = (overrides: Partial<SongResult> & { id: string | number }): SongResult => ({
    name: `song ${overrides.id}`,
    artists: [{ id: 7, name: 'Artist' }],
    album: { id: 5, name: 'Album', coverUrl: 'https://img.example/cover.jpg' },
    durationMs: 180_000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(overrides.id) },
    ...overrides,
});
const dtoOf = (song: SongResult): FoliumSong => toFoliumSong(song)!;

/* Registers a mod's own source as mod-a, `folium.mod-a.<id>`. */
const modSource = (def: FoliumOmniProviderDef) => {
    omniProvidersRegistry.register('mod-a', def);
    return `folium.mod-a.${def.id}`;
};
const providerSong = (id: string, extra: Partial<FoliumProviderSong> = {}): FoliumProviderSong => ({ id, title: `mod song ${id}`, artists: ['M'], ...extra });

beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    store().setActiveProviderId('netease');
    store().clearAccount('netease');
    store().clearAccount('kugou');
    await flush();
});

afterEach(() => {
    resetFoliumRequestQuotasForTest();
    clearFoliumResolvedSongsForTest();
    omniProvidersRegistry.unregisterAll('mod-a');
    removeFoliumEventHandlers('mod-b');
    requestKugou.mockReset();
    requestKugouAnonymousSearch.mockReset();
    requestQq.mockReset();
    requestQqMusicu.mockReset();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('folium.omni where it is not there', () => {
    const song = () => dtoOf(hostSong({ id: 1 }));
    const collection = { kind: 'album', source: 'netease', id: '1', name: 'A', ref: 'collection-1' } as FoliumCollection;
    const asyncCalls = (api: FoliumOmniService) => [
        api.searchSongs('q'),
        api.resolveSongs([{ source: 'netease', id: '1' }]),
        api.getLyrics(song()),
        api.getAlbum(song()),
        api.getArtists(song()),
        api.resolveCollection({ source: 'netease', kind: 'album', id: '1' }),
        api.getTracks(collection),
        api.getArtistAlbums(collection),
    ];

    it('throws, and rejects, omni-unavailable-in-export-context without a code in the export window', async () => {
        const api = createFoliumClientApi(mod(), clientApiOptions('export')).omni;
        expect(() => api.listProviders()).toThrow('omni-unavailable-in-export-context');
        expect(() => api.describeSong(song())).toThrow('omni-unavailable-in-export-context');
        for (const call of asyncCalls(api)) {
            const error = await call.then(() => null, (reason: Error & { code?: string }) => reason);
            expect(error?.message).toBe('omni-unavailable-in-export-context');
            expect(error).not.toHaveProperty('code');
        }
    });

    it('refuses the same way in the main window while no source is installed', async () => {
        registerFoliumOmniSource(null);
        try {
            const api = omniOf();
            expect(() => api.listProviders()).toThrow('omni-unavailable-in-main-context');
            for (const call of asyncCalls(api)) {
                const error = await call.then(() => null, (reason: Error & { code?: string }) => reason);
                expect(error?.message).toBe('omni-unavailable-in-main-context');
                expect(error).not.toHaveProperty('code');
            }
        } finally {
            registerFoliumOmniSource(FOLIUM_HOST_OMNI_SOURCE);
        }
        expect(omniOf().listProviders().length).toBeGreaterThan(0);
    });
});

describe('folium.omni.listProviders', () => {
    it('lists the built-in sources in the host order, the selected one marked, nothing of the account', () => {
        signIn('netease', 9_876_543);
        const providers = omniOf().listProviders();
        expect(providers.map((provider) => provider.providerId).slice(0, 6)).toEqual(['netease', 'kugou', 'qq', 'bodian', 'ytm', 'spotify']);
        expect(providers[0]).toEqual({
            providerId: 'netease',
            displayName: 'NetEase Cloud Music',
            shortName: '网易云',
            origin: 'host',
            selected: true,
            configured: true,
            supports: { search: true, resolve: true, lyrics: true, albums: true, artists: true },
        });
        expect(providers.find((provider) => provider.providerId === 'kugou')).toMatchObject({ selected: false, supports: { albums: true } });
        expect(JSON.stringify(providers)).not.toMatch(/9876543|listener|collections|user|vip/);
        expect(Object.isFrozen(providers)).toBe(true);
        expect(Object.isFrozen(providers[0])).toBe(true);
        expect(Object.isFrozen(providers[0].supports)).toBe(true);
    });

    it('says a source is not configured as the source says', () => {
        vi.spyOn(getOnlineMusicProvider('kugou')!, 'getAvailability').mockReturnValue({ configured: false, reason: 'not-configured' });
        expect(omniOf().listProviders().find((provider) => provider.providerId === 'kugou')?.configured).toBe(false);
    });

    it('lists a mod\'s sources as origin mod, resolvable only with getSong and getAudioUrl together', () => {
        const noAudio = modSource({ id: 'no-audio', displayName: 'No audio', search: async () => ({ items: [], hasMore: false }), getSong: async () => null });
        const noSong = modSource({ id: 'no-song', displayName: 'No song', shortName: 'NS', getAudioUrl: async () => null });
        const both = modSource({ id: 'both', displayName: 'Both', getSong: async () => null, getAudioUrl: async () => null });
        const byId = new Map(omniOf().listProviders().map((provider) => [provider.providerId, provider]));
        expect(byId.get(noAudio)).toMatchObject({ origin: 'mod', selected: false, configured: true, supports: { search: true, resolve: false } });
        expect(byId.get(noSong)).toMatchObject({ shortName: 'NS', supports: { search: false, resolve: false, lyrics: false } });
        expect(byId.get(both)?.supports).toEqual({ search: false, resolve: true, lyrics: false, albums: false, artists: false });
    });
});

describe('folium.omni.searchSongs', () => {
    it('reads 30 by default, at most 50, and checks its arguments', async () => {
        const search = answerSearches();
        const api = omniOf();
        await expect(api.searchSongs('  hello  ')).resolves.toMatchObject({ total: 1000 });
        expect(search).toHaveBeenLastCalledWith('hello', 30, 0);
        await api.searchSongs('hello', { limit: 80 });
        expect(search).toHaveBeenLastCalledWith('hello', 50, 0);
        await api.searchSongs('hello', { limit: 7.9 });
        expect(search).toHaveBeenLastCalledWith('hello', 7, 0);
        await api.searchSongs('hello', { limit: -3 });
        expect(search).toHaveBeenLastCalledWith('hello', 1, 0);
        search.mockClear();
        for (const [query, options] of [
            ['hello', { limit: Number.NaN }],
            ['hello', { limit: Number.POSITIVE_INFINITY }],
            ['hello', { limit: '10' }],
            ['', {}],
            ['   ', {}],
            ['x'.repeat(201), {}],
            [42, {}],
            ['hello', { providerId: 7 }],
            ['hello', { signal: {} }],
            ['hello', 'options'],
        ] as const) {
            await expect(api.searchSongs(query as string, options as never), JSON.stringify([query, options])).rejects.toThrow(/^invalid-arguments: /);
        }
        await expect(api.searchSongs('x'.repeat(200))).resolves.toBeTruthy();
        expect(search).toHaveBeenCalledTimes(1);
    });

    it('searches the selected source without providerId, with a session of the mod\'s own', async () => {
        answerSearches();
        const adapter = vi.spyOn(getOnlineMusicProvider('netease')!.search!, 'searchSongs');
        const page = await omniOf().searchSongs('hello', { limit: 3 });
        expect(adapter).toHaveBeenCalledWith('hello', 3, 0, { session: 'folium:mod-a' });
        expect(page.items.map((song) => [song.source, song.id, song.title])).toEqual([['netease', '1', 'song 1'], ['netease', '2', 'song 2'], ['netease', '3', 'song 3']]);
        expect(Object.isFrozen(page)).toBe(true);
        expect(Object.isFrozen(page.items)).toBe(true);
        expect(Object.isFrozen(page.items[0])).toBe(true);
        // The refs work with playSong and enqueue: they resolve to the host songs.
        expect(resolveFoliumSongRef(page.items[0].ref)).toMatchObject({ id: 1, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' } });
    });

    it('searches the source named, a mod\'s included, and rejects unsupported where there is no search', async () => {
        const search = answerSearches();
        const radio = modSource({ id: 'radio', displayName: 'Radio', search: async (query) => ({ items: [providerSong('r1', { title: query })], hasMore: false }) });
        const lyricsOnly = modSource({ id: 'words', displayName: 'Words', getLyrics: async () => null });
        const api = omniOf();
        await expect(api.searchSongs('tune', { providerId: radio })).resolves.toMatchObject({ items: [{ source: radio, id: 'r1', title: 'tune' }], nextCursor: null, total: null });
        await expect(failureOf(api.searchSongs('tune', { providerId: lyricsOnly }))).resolves.toBe('unsupported');
        await expect(failureOf(api.searchSongs('tune', { providerId: 'no-such-source' }))).resolves.toBe('unsupported');
        expect(search).not.toHaveBeenCalled();
    });

    it('drops an answer that comes after the selected source or its account changed', async () => {
        const held = holdSearches();
        const api = omniOf();
        const switched = failureOf(api.searchSongs('hello'));
        await settle();
        store().setActiveProviderId('kugou');
        held.answer(0);
        await expect(switched).resolves.toBe('account-changed');

        signIn('netease', 1);
        const named = failureOf(api.searchSongs('hello', { providerId: 'netease' }));
        await settle();
        signIn('netease', 2);
        held.answer(1);
        await expect(named).resolves.toBe('account-changed');
    });

    it('searches the source selected now, the default one or not', async () => {
        const search = answerSearches();
        store().setActiveProviderId('kugou');
        requestKugouAnonymousSearch.mockResolvedValue({ data: { lists: [{ FileHash: 'k1', SongName: 'K song', Singers: [{ id: 7, name: 'K' }], Duration: 200 }] } });
        const page = await omniOf().searchSongs('hello', { limit: 5 });
        expect(page.items.map((song) => [song.source, song.title])).toEqual([['kugou', 'K song']]);
        expect(requestKugouAnonymousSearch).toHaveBeenCalledTimes(1);
        expect(search).not.toHaveBeenCalled();
    });

    it('rejects account-changed, not a malformed cursor, for a later page once the selection moved on', async () => {
        const search = answerSearches();
        const api = omniOf();
        const first = await api.searchSongs('hello', { limit: 10 });
        store().setActiveProviderId('kugou');
        await expect(failureOf(api.searchSongs('hello', { cursor: first.nextCursor! }))).resolves.toBe('account-changed');
        expect(search).toHaveBeenCalledTimes(1);
        expect(requestKugouAnonymousSearch).not.toHaveBeenCalled();
    });

    it('does not send a search of the selected source that waited for its place while the selection moved on', async () => {
        const held = holdSearches();
        const api = omniOf();
        const named = range(0, 8).map(() => api.searchSongs('hello', { providerId: 'netease' }).catch(() => null));
        await settle();
        const waiting = failureOf(api.searchSongs('tune'));
        await settle();
        expect(held.spy).toHaveBeenCalledTimes(8);
        // The host's switch: the requests under way are written off, then the selection moves.
        omni.invalidateActiveRequests();
        store().setActiveProviderId('kugou');
        held.answer(0);
        await expect(waiting).resolves.toBe('account-changed');
        // Neither the source it was counted against nor the one selected now was asked.
        expect(held.spy).toHaveBeenCalledTimes(8);
        expect(requestKugouAnonymousSearch).not.toHaveBeenCalled();
        expect(requestKugou).not.toHaveBeenCalled();
        range(1, 7).forEach((index) => held.answer(index));
        await Promise.all(named);
    });
});

describe('folium.omni paging', () => {
    it('slices a whole album a source answers at once, asking it once', async () => {
        const getAlbum = vi.spyOn(neteaseApi, 'getAlbum').mockResolvedValue({
            code: 200,
            album: { id: 100, name: 'Whole', type: '专辑', size: 120, artists: [{ id: 7, name: 'Artist' }], picUrl: 'https://img.example/a.jpg' },
            songs: range(1, 120).map((id) => rawSong(id)),
        } as never);
        const api = omniOf();
        const album = (await api.resolveCollection({ source: 'netease', kind: 'album', id: '100' }))!;
        expect(album).toMatchObject({ kind: 'album', name: 'Whole', trackCount: 120, artist: 'Artist' });
        getAlbum.mockClear();
        const first = await api.getTracks(album, { limit: 50 });
        const second = await api.getTracks(album, { cursor: first.nextCursor! });
        const third = await api.getTracks(album, { cursor: second.nextCursor! });
        expect([first, second, third].map((page) => page.items.length)).toEqual([50, 50, 20]);
        expect(third.nextCursor).toBeNull();
        expect([...first.items, ...second.items, ...third.items].map((song) => song.id)).toEqual(range(1, 120).map(String));
        expect(getAlbum).toHaveBeenCalledTimes(1);
        expect(first.total).toBeNull();
    });

    it('hands out all of a whole album past what a cursor keeps of a source with more, asking once, and ends it', async () => {
        const getAlbum = vi.spyOn(neteaseApi, 'getAlbum').mockResolvedValue({
            code: 200,
            album: { id: 101, name: 'Complete', type: '专辑', size: 1200, artists: [{ id: 7, name: 'Artist' }] },
            songs: range(1, 1200).map((id) => rawSong(id)),
        } as never);
        const api = omniOf();
        const album = (await api.resolveCollection({ source: 'netease', kind: 'album', id: '101' }))!;
        getAlbum.mockClear();
        const pages = [await api.getTracks(album, { limit: 50 })];
        while (pages[pages.length - 1].nextCursor && pages.length < 40) {
            pages.push(await api.getTracks(album, { cursor: pages[pages.length - 1].nextCursor! }));
        }
        expect(pages).toHaveLength(24);
        expect(pages[23].nextCursor).toBeNull();
        expect(pages.flatMap((page) => page.items.map((song) => song.id))).toEqual(range(1, 1200).map(String));
        expect(getAlbum).toHaveBeenCalledTimes(1);
    });

    it('asks a source that says it has more for what it gave past what a cursor keeps again, from the first one dropped', async () => {
        const all = range(1, 3000).map((id) => providerSong(`p${id}`));
        const search = vi.fn(async (_query: string, page: { limit: number; offset: number }) => {
            const end = Math.min(page.offset + 2000, all.length);
            return { items: all.slice(page.offset, end), hasMore: end < all.length };
        });
        const big = modSource({ id: 'big', displayName: 'Big', search });
        const api = omniOf();
        const pages = [await api.searchSongs('all', { providerId: big, limit: 50 })];
        while (pages[pages.length - 1].nextCursor && pages.length < 100) {
            pages.push(await api.searchSongs('all', { providerId: big, cursor: pages[pages.length - 1].nextCursor! }));
        }
        expect(pages).toHaveLength(60);
        expect(pages.flatMap((page) => page.items.map((song) => song.id))).toEqual(all.map((song) => song.id));
        // 50 handed out and 1,000 kept of the first 2,000; the rest asked for from the 1,051st on.
        expect(search.mock.calls.map(([, page]) => page.offset)).toEqual([0, 1050]);
    });

    it('follows a source that caps its pages at 30, without overlap', async () => {
        requestKugou.mockImplementation(async (operation: string, params: { page?: number; pagesize?: number }) => {
            if (operation === 'album_detail') return { data: [{ album_id: 9, album_name: 'K Album', singername: 'K' }] };
            if (operation !== 'album_songs') throw new Error(`unexpected ${operation}`);
            const start = ((params.page ?? 1) - 1) * (params.pagesize ?? 30);
            const ids = range(start + 1, Math.max(0, Math.min(params.pagesize ?? 30, 75 - start)));
            return { data: { total: 75, songs: ids.map((id) => ({ hash: `H${id}`, songname: `k ${id}`, album_id: 9 })) } };
        });
        const api = omniOf();
        const album = (await api.resolveCollection({ source: 'kugou', kind: 'album', id: '9' }))!;
        expect(album).toMatchObject({ kind: 'album', source: 'kugou', id: '9', name: 'K Album' });
        const pages = [await api.getTracks(album, { limit: 50 })];
        while (pages[pages.length - 1].nextCursor) pages.push(await api.getTracks(album, { cursor: pages[pages.length - 1].nextCursor! }));
        expect(pages.map((page) => page.items.length)).toEqual([30, 30, 15]);
        const ids = pages.flatMap((page) => page.items.map((song) => song.id));
        expect(new Set(ids).size).toBe(75);
        expect(requestKugou.mock.calls.filter(([operation]) => operation === 'album_songs').map(([, params]) => params))
            .toEqual([1, 2, 3].map((page) => ({ id: '9', page, pagesize: 30 })));
        expect(pages[0].total).toBe(75);
    });

    it('keeps the first page\'s length, and refuses a cursor that is gone or is another list\'s', async () => {
        const search = answerSearches();
        const api = omniOf();
        const first = await api.searchSongs('hello', { limit: 10 });
        const second = await api.searchSongs('hello', { cursor: first.nextCursor!, limit: 40 });
        expect(search).toHaveBeenLastCalledWith('hello', 10, 10);
        expect(second.items.map((song) => song.id)).toEqual(range(11, 10).map(String));
        await expect(failureOf(api.searchSongs('hello', { cursor: 'cursor-gone' }))).resolves.toBe('stale-ref');
        // Another query, another source, another method: the cursor is for another list.
        await expect(api.searchSongs('other', { cursor: first.nextCursor! })).rejects.toThrow('invalid-arguments: cursor is for another list');
        await expect(api.searchSongs('hello', { cursor: first.nextCursor!, providerId: 'netease' })).rejects.toThrow('invalid-arguments: cursor is for another list');
        vi.spyOn(neteaseApi, 'getArtistDetail').mockResolvedValue({ data: { artist: { id: 7, name: 'Artist' } } } as never);
        const artist = (await api.resolveCollection({ source: 'netease', kind: 'artist', id: '7' }))!;
        await expect(api.getTracks(artist, { cursor: first.nextCursor! })).rejects.toThrow('invalid-arguments: cursor is for another list');
        expect(search).toHaveBeenCalledTimes(2);
    });

    // A cursor belongs to the album or the artist (source, kind, id), not to the DTO it was read with: one
    // read again by its key (after its ref ran out, say) goes on with it, from what the first page read.
    it('goes on with another DTO of the same album or artist, and refuses one of another', async () => {
        const getAlbum = vi.spyOn(neteaseApi, 'getAlbum').mockImplementation(async (id: number) => ({
            code: 200,
            album: { id, name: `Album ${id}`, type: '专辑', size: 120 },
            songs: range(1, 120).map((song) => rawSong(id * 1000 + song)),
        }) as never);
        vi.spyOn(neteaseApi, 'getArtistDetail').mockImplementation(async (id: number) => ({ data: { artist: { id, name: `Artist ${id}` } } }) as never);
        vi.spyOn(neteaseApi, 'getArtistSongs').mockImplementation(async (_id: number, limit = 50, offset = 0) => (
            { songs: range(offset + 1, limit).map((id) => rawSong(id)), more: true }
        ) as never);
        vi.spyOn(neteaseApi, 'getArtistAlbums').mockImplementation(async (_id: number, limit = 30, offset = 0) => (
            { hotAlbums: range(offset + 1, limit).map((id) => ({ id, name: `LP ${id}`, type: '专辑' })), more: true }
        ) as never);
        const artistSongs = vi.spyOn(omni, 'getArtistSongs');
        const api = omniOf();
        const albumKey = { source: 'netease', kind: 'album', id: '100' } as const;
        const album = (await api.resolveCollection(albumKey))!;
        const albumAgain = (await api.resolveCollection(albumKey))!;
        expect(albumAgain.ref).not.toBe(album.ref);
        const first = await api.getTracks(album, { limit: 50 });
        getAlbum.mockClear();
        const second = await api.getTracks(albumAgain, { cursor: first.nextCursor! });
        expect(second.items.map((song) => song.id)).toEqual(range(100_051, 50).map(String));
        // Cut from what the first page's answer left over: not asked again.
        expect(getAlbum).not.toHaveBeenCalled();
        const other = (await api.resolveCollection({ source: 'netease', kind: 'album', id: '200' }))!;
        await expect(api.getTracks(other, { cursor: second.nextCursor! })).rejects.toThrow('invalid-arguments: cursor is for another list');

        const artistKey = { source: 'netease', kind: 'artist', id: '7' } as const;
        const artist = (await api.resolveCollection(artistKey))!;
        const artistAgain = (await api.resolveCollection(artistKey))!;
        const songs = await api.getTracks(artist, { limit: 20 });
        const moreSongs = await api.getTracks(artistAgain, { cursor: songs.nextCursor! });
        expect(moreSongs.items.map((song) => song.id)).toEqual(range(21, 20).map(String));
        // The second page is read from the host collection the first one was.
        expect(artistSongs).toHaveBeenCalledTimes(2);
        expect(artistSongs.mock.calls[1][0]).toBe(artistSongs.mock.calls[0][0]);
        expect(artistSongs.mock.calls[1][1]).toEqual({ limit: 20, offset: 20 });
        const albums = await api.getArtistAlbums(artist, { limit: 10 });
        const moreAlbums = await api.getArtistAlbums(artistAgain, { cursor: albums.nextCursor! });
        expect(moreAlbums.items.map((item) => item.id)).toEqual(range(11, 10).map(String));
        // An album's cursor is not an artist's, nor a song list's an album list's.
        await expect(api.getTracks(artistAgain, { cursor: second.nextCursor! })).rejects.toThrow('invalid-arguments: cursor is for another list');
        await expect(api.getArtistAlbums(artistAgain, { cursor: songs.nextCursor! })).rejects.toThrow('invalid-arguments: cursor is for another list');
    });

    it('hands out only a page of what a source answers beyond it, minting refs for that page only', async () => {
        const search = vi.fn(async () => ({ items: range(1, 10_000).map((id) => providerSong(`m${id}`)), hasMore: false, total: 10_000 }));
        const flood = modSource({ id: 'flood', displayName: 'Flood', search });
        const api = omniOf();
        const refNumber = () => Number.parseInt(toFoliumSong(hostSong({ id: `probe-${Math.random()}` }))!.ref!.slice('song-'.length), 36);
        const before = refNumber();
        const first = await api.searchSongs('all', { providerId: flood, limit: 30 });
        // The page's 30 refs, then the probe's own.
        expect(refNumber() - before).toBe(30 + 1);
        expect(first.items).toHaveLength(30);
        expect(first.total).toBe(10_000);
        const second = await api.searchSongs('all', { providerId: flood, cursor: first.nextCursor! });
        expect(second.items.map((song) => song.id)).toEqual(range(31, 30).map((id) => `m${id}`));
        expect(search).toHaveBeenCalledTimes(1);
    });

    it('gives the total only where the source says a finite, non-negative one', async () => {
        const totals: Array<number | undefined> = [undefined, -5, 12];
        const counted = modSource({
            id: 'counted',
            displayName: 'Counted',
            search: async () => ({ items: [providerSong('c1')], hasMore: false, ...(totals[0] === undefined ? {} : { total: totals[0] }) }),
        });
        const api = omniOf();
        const seen: Array<number | null> = [];
        for (let index = 0; index < 3; index += 1) {
            seen.push((await api.searchSongs(`q${index}`, { providerId: counted })).total);
            totals.shift();
        }
        expect(seen).toEqual([null, null, 12]);
    });

    it('hands out an empty page with a cursor when a source answers none but says it has more', async () => {
        const empty = modSource({ id: 'empty', displayName: 'Empty', search: async () => ({ items: [], hasMore: true }) });
        const page = await omniOf().searchSongs('q', { providerId: empty });
        expect(page.items).toEqual([]);
        expect(page.nextCursor).toMatch(/^cursor-/);
    });
});

describe('folium.omni.resolveSongs', () => {
    /* NetEase's song details, many at once, answering the ids in `known`. */
    const answerDetails = (known: number[] = range(1, 100)) => vi.spyOn(neteaseApi, 'getSongDetail').mockImplementation(async (ids: number[] | number) => ({
        code: 200,
        songs: (Array.isArray(ids) ? ids : [ids]).filter((id) => known.includes(id)).map((id) => rawSong(id)),
    }) as never);

    it('finds songs and tells a song the source has not, in the order of the keys, in one request', async () => {
        const details = answerDetails([1, 3]);
        const results = await omniOf().resolveSongs([
            { source: 'netease', id: '3' },
            { source: 'netease', id: '2' },
            { source: 'netease', id: '1' },
            { source: 'netease', id: '3' },
        ]);
        expect(results.map((result) => result.status)).toEqual(['found', 'not-found', 'found', 'found']);
        expect(results[0]).toMatchObject({ song: { source: 'netease', id: '3', title: 'song 3' } });
        expect(results[3]).toEqual(results[0]);
        expect(details).toHaveBeenCalledTimes(1);
        expect(details).toHaveBeenCalledWith([3, 2, 1]);
        expect(Object.isFrozen(results)).toBe(true);
        expect(Object.isFrozen(results[0])).toBe(true);
    });

    it('answers unsupported, without asking, for keys this host cannot look up', async () => {
        const details = answerDetails();
        const noSong = modSource({ id: 'no-song', displayName: 'No song', getAudioUrl: async () => null });
        const noAudio = modSource({ id: 'no-audio', displayName: 'No audio', search: async () => ({ items: [], hasMore: false }), getSong: vi.fn(async () => null) });
        const results = await omniOf().resolveSongs(['folium.mod-z.gone', 'local', 'navidrome', 'stage', noSong, noAudio].map((source) => ({ source, id: '1' })));
        expect(results.map((result) => result.status)).toEqual(Array(6).fill('unsupported'));
        expect(details).not.toHaveBeenCalled();
    });

    it('answers unsupported where the source says it cannot look the song up', async () => {
        vi.spyOn(neteaseApi, 'getSongDetail').mockRejectedValue(new OnlineProviderError('unsupported', 'no', 'netease'));
        await expect(omniOf().resolveSongs([{ source: 'netease', id: '1' }])).resolves.toEqual([{ status: 'unsupported' }]);
    });

    it('answers failed with the code of the source\'s failure, never unsupported', async () => {
        const details = vi.spyOn(neteaseApi, 'getSongDetail');
        const api = omniOf();
        const cases: Array<[unknown, string]> = [
            [new OnlineProviderError('network', 'down', 'netease'), 'network'],
            [new OnlineProviderError('auth-required', 'sign in', 'netease'), 'not-signed-in'],
            [new OnlineProviderError('unavailable', 'stopped', 'netease'), 'unavailable'],
            [new OnlineProviderError('unavailable', 'slow down', 'netease', undefined, 429), 'rate-limited'],
            [new OnlineProviderError('region-restricted', 'away', 'netease'), 'region-restricted'],
            [new Error('anything'), 'network'],
        ];
        for (const [error, code] of cases) {
            details.mockRejectedValueOnce(error);
            await expect(api.resolveSongs([{ source: 'netease', id: '1' }]), code).resolves.toEqual([{ status: 'failed', code }]);
        }
        // A refusal the backend answers with (502 where the local backend cannot reach the platform).
        details.mockResolvedValueOnce({ code: 502 } as never);
        await expect(api.resolveSongs([{ source: 'netease', id: '1' }])).resolves.toEqual([{ status: 'failed', code: 'unavailable' }]);
    });

    it('tells a session that ran out, a paying account, and an account that changed on the way', async () => {
        const details = vi.spyOn(neteaseApi, 'getSongDetail');
        const api = omniOf();
        const keys = [{ source: 'netease', id: '1' }, { source: 'netease', id: '2' }];
        // Signed in when the request went out: the session ran out.
        signIn('netease', 5);
        details.mockRejectedValueOnce(new OnlineProviderError('auth-required', 'sign in again', 'netease'));
        await expect(api.resolveSongs(keys)).resolves.toEqual(Array(2).fill({ status: 'failed', code: 'session-expired' }));
        details.mockRejectedValueOnce(new OnlineProviderError('subscription-required', 'pay', 'netease'));
        await expect(api.resolveSongs(keys)).resolves.toEqual(Array(2).fill({ status: 'failed', code: 'vip-required' }));
        // Another account signs in while the request is under way: its answer is dropped, for every key.
        let answer = () => {};
        details.mockImplementationOnce(() => new Promise((resolve) => {
            answer = () => resolve({ code: 200, songs: [rawSong(1), rawSong(2)] } as never);
        }));
        const changed = api.resolveSongs(keys);
        await settle();
        signIn('netease', 6);
        answer();
        await expect(changed).resolves.toEqual(Array(2).fill({ status: 'failed', code: 'account-changed' }));
        // None of it was kept: asked again, the source is asked again.
        details.mockResolvedValueOnce({ code: 200, songs: [rawSong(1), rawSong(2)] } as never);
        await expect(api.resolveSongs(keys)).resolves.toMatchObject([{ status: 'found' }, { status: 'found' }]);
        expect(details).toHaveBeenCalledTimes(4);
    });

    // QQ Music's song id (`FoliumSong.id`) is the numeric songid; its play key is the songmid. Its adapter looks
    // both up at QQ's musicu, 25 a request, and every request counts once against the mod's allowance.
    describe('QQ Music keys', () => {
        type MusicuRequests = Record<string, { module: string; method: string; param: { song_type: number; song_id?: unknown; song_mid?: unknown } }>;
        const SUNNY_MID = '0039MnYb0qxYhV';
        /* A QQ Music song detail as musicu answers it. */
        const qqTrack = (id: number) => ({
            id,
            mid: id === 97773 ? SUNNY_MID : `00${id}`,
            title: id === 97773 ? '晴天' : `qq ${id}`,
            singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: '周杰伦' }],
            album: { id: 8220, mid: '000MkMni19ClKG', name: '叶惠美' },
            interval: 269,
        });
        const EMPTY_TRACK = { id: 0, mid: '', name: '' };
        /* musicu answering every request: the songs `known` says it has, an empty shell for the others. */
        const answerMusicu = (known: (id: number) => boolean = () => true) => requestQqMusicu.mockImplementation(async (requests: MusicuRequests) => (
            Object.fromEntries(Object.entries(requests).map(([key, { param }]) => {
                const id = param.song_mid === SUNNY_MID ? 97773 : param.song_id;
                if (typeof id === 'number' && known(id)) return [key, { code: 0, data: { track_info: qqTrack(id) } }];
                return [key, { code: param.song_mid !== undefined ? 404 : 0, data: { track_info: EMPTY_TRACK } }];
            }))
        ));
        const sentRequests = (call: number) => Object.values(requestQqMusicu.mock.calls[call][0] as MusicuRequests);
        const keysOf = (ids: number[]) => ids.map((id) => ({ source: 'qq', id: String(id) }));
        const statusOf = (result: { status: string; code?: string }) => (result.status === 'failed' ? `failed ${result.code}` : result.status);
        const gateOf = () => createFoliumRequestGate({ modId: 'mod-a', what: 'omni.test', signal: new AbortController().signal, originOf: () => 'host' });

        it('finds a key by its numeric songid at musicu, keeps it, and answers it again without asking', async () => {
            answerMusicu();
            const api = omniOf();
            const [resolution] = await api.resolveSongs([{ source: 'qq', id: '97773' }]);

            expect(resolution).toMatchObject({ status: 'found', song: { source: 'qq', id: '97773', title: '晴天' } });
            const song = (resolution as { song: FoliumSong }).song;
            expect(resolveFoliumSongRef(song.ref)).toMatchObject({ id: 97773, qqMid: SUNNY_MID });
            expect(requestQqMusicu).toHaveBeenCalledTimes(1);
            expect(sentRequests(0)).toEqual([{
                module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_type: 0, song_id: 97773 },
            }]);
            expect(requestQq).not.toHaveBeenCalled();

            await expect(api.resolveSongs([{ source: 'qq', id: '97773' }])).resolves.toMatchObject([{ status: 'found', song: { id: '97773' } }]);
            expect(requestQqMusicu).toHaveBeenCalledTimes(1);
        });

        it('finds a key by its songmid at musicu too, as the same song with its numeric id', async () => {
            answerMusicu();
            const [resolution] = await omniOf().resolveSongs([{ source: 'qq', id: SUNNY_MID }]);

            expect(resolution).toMatchObject({ status: 'found', song: { source: 'qq', id: '97773', title: '晴天' } });
            expect(requestQqMusicu).toHaveBeenCalledTimes(1);
            const [request] = sentRequests(0);
            expect(request.param.song_mid).toBe(SUNNY_MID);
            expect(request.param).not.toHaveProperty('song_id');
            expect(requestQq).not.toHaveBeenCalled();
        });

        it('asks 50 keys in two requests, which count twice', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
            answerMusicu();
            const gate = gateOf();
            await Promise.all(range(1, 118).map(() => gate.run('netease', () => Promise.resolve())));

            const ids = range(1000, 50);
            const results = await omniOf().resolveSongs(keysOf(ids));

            expect(results.map(statusOf)).toEqual(Array(50).fill('found'));
            expect(results.map((result) => (result as { song: FoliumSong }).song.id)).toEqual(ids.map(String));
            expect(requestQqMusicu).toHaveBeenCalledTimes(2);
            expect([0, 1].map((call) => sentRequests(call).length)).toEqual([25, 25]);
            // 118 and 2: the minute's 120 are used up.
            await expect(failureOf(gate.run('netease', () => Promise.resolve()))).resolves.toBe('rate-limited');
        });

        it('answers the second request\'s keys failed / rate-limited once the minute runs out between them', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
            answerMusicu();
            const gate = gateOf();
            await Promise.all(range(1, 119).map(() => gate.run('netease', () => Promise.resolve())));

            const results = await omniOf().resolveSongs(keysOf(range(1000, 50)));

            expect(results.map(statusOf)).toEqual([...Array(25).fill('found'), ...Array(25).fill('failed rate-limited')]);
            expect(requestQqMusicu).toHaveBeenCalledTimes(1);
        });

        it('answers a song QQ has not not-found and keeps that, and a failed request failed, keeping nothing', async () => {
            answerMusicu((id) => id === 97773);
            const api = omniOf();
            await expect(api.resolveSongs(keysOf([97773, 2000000000]))).resolves.toEqual([
                expect.objectContaining({ status: 'found' }),
                { status: 'not-found' },
            ]);
            expect(readFoliumResolvedSong('qq', '2000000000')).toEqual(expect.objectContaining({ song: null }));
            await expect(api.resolveSongs(keysOf([2000000000]))).resolves.toEqual([{ status: 'not-found' }]);
            expect(requestQqMusicu).toHaveBeenCalledTimes(1);

            requestQqMusicu.mockRejectedValueOnce(new OnlineProviderError('network', 'QQ musicu unreachable: Failed to fetch', 'qq'));
            await expect(api.resolveSongs(keysOf([1, 2]))).resolves.toEqual(Array(2).fill({ status: 'failed', code: 'network' }));
            expect(readFoliumResolvedSong('qq', '1')).toBeUndefined();
            expect(readFoliumResolvedSong('qq', '2')).toBeUndefined();

            requestQqMusicu.mockRejectedValueOnce(new OnlineProviderError('network', 'QQ musicu request failed: 429', 'qq', undefined, 429));
            await expect(api.resolveSongs(keysOf([3]))).resolves.toEqual([{ status: 'failed', code: 'rate-limited' }]);

            // A request QQ refused (another code than 0 or 404): failed, never not-found or unsupported.
            requestQqMusicu.mockResolvedValueOnce({ q0: { code: 2001, data: undefined } });
            await expect(api.resolveSongs(keysOf([4]))).resolves.toEqual([{ status: 'failed', code: 'network' }]);
            expect(readFoliumResolvedSong('qq', '4')).toBeUndefined();
            expect(requestQq).not.toHaveBeenCalled();
        });
    });

    it('asks a source without a lookup of many once per key', async () => {
        const getSong = vi.fn(async (id: string) => (id === 'none' ? null : providerSong(id)));
        const lookup = modSource({ id: 'lookup', displayName: 'Lookup', getSong, getAudioUrl: async () => null });
        const results = await omniOf().resolveSongs([{ source: lookup, id: 'a' }, { source: lookup, id: 'none' }, { source: lookup, id: 'b' }]);
        expect(results.map((result) => result.status)).toEqual(['found', 'not-found', 'found']);
        expect(getSong.mock.calls.map(([id]) => id)).toEqual(['a', 'none', 'b']);
    });

    it('checks its keys: 1 to 50 of { source, id }', async () => {
        const api = omniOf();
        for (const keys of [[], range(1, 51).map((id) => ({ source: 'netease', id: String(id) })), [{ source: 'netease', id: 1 }], [{ source: '', id: '1' }], [null], 'netease:1']) {
            await expect(api.resolveSongs(keys as never)).rejects.toThrow(/^invalid-arguments: /);
        }
    });

    it('answers what it read lately from what it kept, without a request and without counting', async () => {
        const details = answerDetails([1]);
        const api = omniOf();
        await expect(api.resolveSongs([{ source: 'netease', id: '1' }, { source: 'netease', id: '2' }])).resolves.toMatchObject([{ status: 'found' }, { status: 'not-found' }]);
        // Far past the minute's allowance, and never asked again.
        for (let call = 0; call < 130; call += 1) {
            await expect(api.resolveSongs([{ source: 'netease', id: '1' }, { source: 'netease', id: '2' }])).resolves.toMatchObject([{ status: 'found' }, { status: 'not-found' }]);
        }
        expect(details).toHaveBeenCalledTimes(1);
    });

    it('forgets what it kept of a source only when the account signed in to that source changes', async () => {
        const details = answerDetails([1]);
        const api = omniOf();
        const resolveOne = () => api.resolveSongs([{ source: 'netease', id: '1' }]);
        await resolveOne();
        // The account store changes (another reference), the account stays.
        store().updateAccount('netease', { likedSongIds: [1, 2] });
        await flush();
        await resolveOne();
        expect(details).toHaveBeenCalledTimes(1);
        // Another source's account changes.
        signIn('kugou', 3);
        await flush();
        await resolveOne();
        expect(details).toHaveBeenCalledTimes(1);
        // This source's account changes.
        signIn('netease', 4);
        await flush();
        await resolveOne();
        expect(details).toHaveBeenCalledTimes(2);
    });

    it('answers the keys left failed / rate-limited once the minute runs out on the way, and the others as usual', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        const getSong = vi.fn(async (id: string) => providerSong(id));
        const lookup = modSource({ id: 'lookup', displayName: 'Lookup', getSong, getAudioUrl: async () => null });
        const gate = createFoliumRequestGate({ modId: 'mod-a', what: 'omni.test', signal: new AbortController().signal, originOf: () => 'host' });
        await Promise.all(range(1, 118).map(() => gate.run('netease', () => Promise.resolve())));
        const results = await omniOf().resolveSongs(['a', 'b', 'c', 'd'].map((id) => ({ source: lookup, id })));
        expect(results.map((result) => result.status === 'failed' ? `failed ${result.code}` : result.status))
            .toEqual(['found', 'found', 'failed rate-limited', 'failed rate-limited']);
        expect(getSong).toHaveBeenCalledTimes(2);
    });

    it('hands out new refs for a song the queue holds too: compare source and id, not refs', async () => {
        answerDetails([42]);
        const queued = hostSong({ id: 42 });
        const fromQueue = dtoOf(queued);
        const [resolution] = await omniOf().resolveSongs([{ source: fromQueue.source!, id: fromQueue.id! }]);
        expect(resolution.status).toBe('found');
        const resolved = (resolution as { song: FoliumSong }).song;
        expect(resolved.ref).not.toBe(fromQueue.ref);
        expect([resolved.source, resolved.id]).toEqual([fromQueue.source, fromQueue.id]);
        expect(resolveFoliumSongRef(resolved.ref)).not.toBe(queued);
    });
});

describe('folium.omni.describeSong', () => {
    it('says what the host knows of a song without asking its source', () => {
        const api = omniOf();
        expect(api.describeSong(dtoOf(hostSong({ id: 11 })))).toEqual({
            durationMs: 180_000,
            coverUrl: 'https://img.example/cover.jpg',
            availability: 'playable',
            pageUrl: 'https://music.163.com/#/song?id=11',
        });
        expect(api.describeSong(dtoOf(hostSong({ id: 12, privilege: { st: -200, pl: 0 } })))?.availability).toBe('taken-down');
        expect(api.describeSong(dtoOf(hostSong({ id: 13, privilege: { st: -1, pl: 128000 } })))?.availability).toBe('restricted');
        const noDetails = api.describeSong(dtoOf(hostSong({ id: 14, durationMs: 0, album: { id: 1, name: 'A', coverUrl: '  ' } })));
        expect(noDetails).toMatchObject({ durationMs: null, coverUrl: null });
        expect(Object.isFrozen(noDetails)).toBe(true);
    });

    it('reads a mod\'s song as unknown, with no duration, cover or page', async () => {
        const radio = modSource({ id: 'radio', displayName: 'Radio', search: async () => ({ items: [providerSong('r1')], hasMore: false }) });
        const api = omniOf();
        const [song] = (await api.searchSongs('q', { providerId: radio })).items;
        expect(api.describeSong(song)).toEqual({ durationMs: null, coverUrl: null, availability: 'unknown', pageUrl: null });
    });

    it('is null for a song that is not online and for a ref that no longer resolves; a DTO without a ref is malformed', () => {
        const api = omniOf();
        expect(api.describeSong(dtoOf(hostSong({ id: 'l1', sourceRef: { kind: 'local', mediaId: 'l1' } })))).toBeNull();
        expect(api.describeSong({ ...dtoOf(hostSong({ id: 15 })), ref: 'song-gone' })).toBeNull();
        expect(() => api.describeSong({ ...dtoOf(hostSong({ id: 16 })), ref: null })).toThrow('invalid-arguments: pass a song DTO that came from the host');
    });
});

describe('folium.omni.getLyrics', () => {
    it('reads the source\'s lyrics as lines, without running the mods\' omni.lyricsResolved hooks', async () => {
        const hook = vi.fn();
        addFoliumEventHandler('mod-b', 'omni.lyricsResolved', hook);
        const words = modSource({
            id: 'words',
            displayName: 'Words',
            search: async () => ({ items: [providerSong('w1')], hasMore: false }),
            getLyrics: async () => ({ main: { format: 'lrc', text: '[00:01.00]one\n[00:05.00]two\n[00:09.00]three' }, chorusRanges: [{ startTime: 5, endTime: 8 }] }),
        });
        const api = omniOf();
        const [song] = (await api.searchSongs('q', { providerId: words })).items;
        const lyrics = await api.getLyrics(song);
        expect(Object.keys(lyrics).sort()).toEqual(['isPureMusic', 'isWordByWord', 'lines']);
        expect(lyrics.lines.map((line) => line.fullText)).toEqual(['one', 'two', 'three']);
        expect(lyrics.lines.map((line) => line.isChorus === true)).toEqual([false, true, false]);
        expect(lyrics).toMatchObject({ isWordByWord: false, isPureMusic: false });
        expect(Object.isFrozen(lyrics)).toBe(true);
        expect(hook).not.toHaveBeenCalled();
        // The hook is live: the host's own read runs it.
        await omni.getLyrics(resolveFoliumSongRef(song.ref)!);
        expect(hook).toHaveBeenCalledTimes(1);
    });

    it('tells word-timed lyrics, and a song its source marks as instrumental', async () => {
        vi.spyOn(neteaseApi, 'getChorus').mockResolvedValue({ code: 200 } as never);
        vi.spyOn(neteaseApi, 'getLyric')
            .mockResolvedValueOnce({ code: 200, lrc: { lyric: '[00:01.00]Hello\n' }, yrc: { lyric: '[1000,1000](1000,500,0)Hel(1500,500,0)lo\n' } } as never)
            .mockResolvedValueOnce({ code: 200, lrc: { lyric: '[00:00.00]纯音乐，请欣赏\n' } } as never);
        const api = omniOf();
        const worded = await api.getLyrics(dtoOf(hostSong({ id: 901 })));
        expect(worded.lines.map((line) => line.fullText)).toEqual(['Hello']);
        expect(worded.isWordByWord).toBe(true);
        const instrumental = await api.getLyrics(dtoOf(hostSong({ id: 902 })));
        expect(instrumental).toEqual({ lines: [], isWordByWord: false, isPureMusic: true });
    });

    it('rejects unsupported for a song that is not online or whose source has no lyrics, stale-ref for a ref gone', async () => {
        const radio = modSource({ id: 'radio', displayName: 'Radio', search: async () => ({ items: [providerSong('r1')], hasMore: false }) });
        const api = omniOf();
        const [song] = (await api.searchSongs('q', { providerId: radio })).items;
        await expect(failureOf(api.getLyrics(song))).resolves.toBe('unsupported');
        await expect(failureOf(api.getLyrics(dtoOf(hostSong({ id: 'l1', sourceRef: { kind: 'local', mediaId: 'l1' } }))))).resolves.toBe('unsupported');
        await expect(failureOf(api.getLyrics({ ...song, ref: 'song-gone' }))).resolves.toBe('stale-ref');
        await expect(api.getLyrics({ ...song, ref: null })).rejects.toThrow('invalid-arguments: pass a song DTO that came from the host');
    });
});

describe('folium.omni albums and artists', () => {
    const CONTRACT_KEYS = ['albumCount', 'artist', 'coverUrl', 'description', 'id', 'kind', 'name', 'publishedAt', 'ref', 'source', 'trackCount'];

    it('reads a song\'s album and artists off the song where its source needs no lookup', async () => {
        const getAlbum = vi.spyOn(neteaseApi, 'getAlbum');
        const song = dtoOf(hostSong({ id: 21, artists: [{ id: 7, name: 'Artist' }, { id: 8, name: 'Guest' }] }));
        const api = omniOf();
        const album = await api.getAlbum(song);
        expect(album).toEqual({
            kind: 'album', source: 'netease', id: '5', name: 'Album', artist: '', coverUrl: 'https://img.example/cover.jpg',
            description: null, trackCount: null, albumCount: null, publishedAt: null, ref: expect.stringMatching(/^collection-/),
        });
        const artists = await api.getArtists(song);
        expect(artists.map((artist) => [artist.kind, artist.id, artist.name, artist.coverUrl])).toEqual([['artist', '7', 'Artist', null], ['artist', '8', 'Guest', null]]);
        expect(Object.isFrozen(artists)).toBe(true);
        expect(Object.isFrozen(album)).toBe(true);
        expect(getAlbum).not.toHaveBeenCalled();
    });

    it('rejects unsupported, without asking, for a song whose source has no albums or artists, or that is not online', async () => {
        const radio = modSource({ id: 'radio', displayName: 'Radio', search: async () => ({ items: [providerSong('r1')], hasMore: false }) });
        const api = omniOf();
        const [song] = (await api.searchSongs('q', { providerId: radio })).items;
        await expect(failureOf(api.getAlbum(song))).resolves.toBe('unsupported');
        await expect(failureOf(api.getArtists(song))).resolves.toBe('unsupported');
        const local = dtoOf(hostSong({ id: 'l1', sourceRef: { kind: 'local', mediaId: 'l1' } }));
        await expect(failureOf(api.getAlbum(local))).resolves.toBe('unsupported');
        await expect(failureOf(api.getArtists(local))).resolves.toBe('unsupported');
    });

    it('resolves an album or an artist by its key, and none where the source has none or answers it nameless', async () => {
        vi.spyOn(neteaseApi, 'getAlbum')
            .mockResolvedValueOnce({ code: 200, album: { id: 31, name: 'Found', type: '专辑', size: 9, publishTime: 1_600_000_000_000, description: 'About', creator: { userId: 1 } }, songs: [] } as never)
            .mockResolvedValueOnce({ code: 200 } as never);
        vi.spyOn(neteaseApi, 'getArtistDetail')
            .mockResolvedValueOnce({ data: { artist: { id: 7, name: 'Artist', cover: 'https://img.example/p.jpg', musicSize: 50, albumSize: 3, briefDesc: 'Bio' } } } as never)
            .mockResolvedValueOnce({ data: { artist: { id: 8, name: '  ' } } } as never)
            .mockResolvedValueOnce({} as never);
        const api = omniOf();
        const album = (await api.resolveCollection({ source: 'netease', kind: 'album', id: '31' }))!;
        expect(Object.keys(album).sort()).toEqual(CONTRACT_KEYS);
        expect(album).toMatchObject({ kind: 'album', id: '31', name: 'Found', trackCount: 9, publishedAt: 1_600_000_000_000, description: 'About', albumCount: null });
        await expect(api.resolveCollection({ source: 'netease', kind: 'album', id: '32' })).resolves.toBeNull();
        const artist = (await api.resolveCollection({ source: 'netease', kind: 'artist', id: '7' }))!;
        expect(Object.keys(artist).sort()).toEqual(CONTRACT_KEYS);
        expect(artist).toMatchObject({ kind: 'artist', id: '7', name: 'Artist', artist: '', albumCount: 3, trackCount: null, coverUrl: 'https://img.example/p.jpg' });
        expect(JSON.stringify(artist)).not.toMatch(/musicSize|providerData|creator/);
        await expect(api.resolveCollection({ source: 'netease', kind: 'artist', id: '8' })).resolves.toBeNull();
        await expect(api.resolveCollection({ source: 'netease', kind: 'artist', id: '9' })).resolves.toBeNull();
        for (const key of [{ source: 'netease', kind: 'playlist', id: '1' }, { source: 'netease', kind: 'album', id: 1 }, { source: '', kind: 'album', id: '1' }]) {
            await expect(api.resolveCollection(key as never)).rejects.toThrow(/^invalid-arguments: /);
        }
        await expect(failureOf(api.resolveCollection({ source: 'no-such-source', kind: 'album', id: '1' }))).resolves.toBe('unsupported');
    });

    // A refusing answer says nothing of whether the album or the artist is there: the call fails, it
    // does not resolve null ("the source has none"), which a mod would take for gone.
    it('rejects, rather than answering none, where the source refuses the album or the artist', async () => {
        const refusals = [{ code: -462, message: '绑定手机号后才能继续操作' }, { code: 502, msg: 'getaddrinfo ENOTFOUND interfacepc.music.163.com' }];
        const getAlbum = vi.spyOn(neteaseApi, 'getAlbum');
        const getArtistDetail = vi.spyOn(neteaseApi, 'getArtistDetail');
        const api = omniOf();
        for (const refusal of refusals) {
            getAlbum.mockResolvedValueOnce(refusal as never);
            getArtistDetail.mockResolvedValueOnce(refusal as never);
            await expect(failureOf(api.resolveCollection({ source: 'netease', kind: 'album', id: '123' })), String(refusal.code)).resolves.toBe('unavailable');
            await expect(failureOf(api.resolveCollection({ source: 'netease', kind: 'artist', id: '7' })), String(refusal.code)).resolves.toBe('unavailable');
        }
        // Not signed in, as NetEase says it.
        getAlbum.mockResolvedValueOnce({ code: 301 } as never);
        await expect(failureOf(api.resolveCollection({ source: 'netease', kind: 'album', id: '123' }))).resolves.toBe('not-signed-in');
    });

    it('reads an album\'s songs and an artist\'s songs each through their own Omni read', async () => {
        vi.spyOn(neteaseApi, 'getAlbum').mockResolvedValue({ code: 200, album: { id: 41, name: 'Album 41' }, songs: [rawSong(1), rawSong(2)] } as never);
        vi.spyOn(neteaseApi, 'getArtistDetail').mockResolvedValue({ data: { artist: { id: 7, name: 'Artist' } } } as never);
        const artistSongs = vi.spyOn(neteaseApi, 'getArtistSongs').mockResolvedValue({ songs: [rawSong(3)], more: true } as never);
        const api = omniOf();
        const album = (await api.resolveCollection({ source: 'netease', kind: 'album', id: '41' }))!;
        const artist = (await api.resolveCollection({ source: 'netease', kind: 'artist', id: '7' }))!;
        await expect(api.getTracks(album)).resolves.toMatchObject({ items: [{ id: '1' }, { id: '2' }], nextCursor: null });
        const songs = await api.getTracks(artist, { limit: 20 });
        expect(songs.items.map((song) => song.id)).toEqual(['3']);
        expect(songs.nextCursor).toMatch(/^cursor-/);
        expect(artistSongs).toHaveBeenCalledWith(7, 20, 0);
    });

    it('reads an artist\'s albums as albums only, and takes only an artist', async () => {
        vi.spyOn(neteaseApi, 'getArtistDetail').mockResolvedValue({ data: { artist: { id: 7, name: 'Artist' } } } as never);
        vi.spyOn(neteaseApi, 'getArtistAlbums').mockResolvedValue({
            hotAlbums: [{ id: 51, name: 'LP', type: '专辑', size: 10 }, { id: 52, name: '' }, { id: 53, name: 'Single', type: 'EP/Single' }],
            more: false,
        } as never);
        const api = omniOf();
        const artist = (await api.resolveCollection({ source: 'netease', kind: 'artist', id: '7' }))!;
        const albums = await api.getArtistAlbums(artist);
        expect(albums.items.map((album) => [album.kind, album.id, album.name])).toEqual([['album', '51', 'LP'], ['album', '53', 'Single']]);
        expect(albums.nextCursor).toBeNull();
        await expect(api.getArtistAlbums(albums.items[0])).rejects.toThrow('invalid-arguments: getArtistAlbums takes artist');
    });

    it('rejects stale-ref for a collection ref that no longer resolves', async () => {
        const api = omniOf();
        const gone = { kind: 'album', source: 'netease', id: '1', name: 'A', ref: 'collection-gone' } as FoliumCollection;
        await expect(failureOf(api.getTracks(gone))).resolves.toBe('stale-ref');
        await expect(failureOf(api.getArtistAlbums({ ...gone, kind: 'artist' }))).resolves.toBe('stale-ref');
        await expect(api.getTracks({ ...gone, ref: '' })).rejects.toThrow('invalid-arguments: pass a collection DTO that came from the host');
    });

    it('refuses a collection where a song goes, and a song where a collection goes, as malformed rather than stale', async () => {
        vi.spyOn(neteaseApi, 'getAlbum').mockResolvedValue({ code: 200, album: { id: 61, name: 'Album 61' }, songs: [] } as never);
        const api = omniOf();
        const album = (await api.resolveCollection({ source: 'netease', kind: 'album', id: '61' }))!;
        const asSong = album as unknown as FoliumSong;
        const asCollection = dtoOf(hostSong({ id: 62 })) as unknown as FoliumCollection;
        expect(() => api.describeSong(asSong)).toThrow(new TypeError('invalid-arguments: pass a song DTO that came from the host'));
        for (const call of [api.getLyrics(asSong), api.getAlbum(asSong), api.getArtists(asSong)]) {
            await expect(call).rejects.toThrow(new TypeError('invalid-arguments: pass a song DTO that came from the host'));
        }
        for (const call of [api.getTracks(asCollection), api.getArtistAlbums(asCollection)]) {
            await expect(call).rejects.toThrow(new TypeError('invalid-arguments: pass a collection DTO that came from the host'));
        }
    });
});

describe('folium.omni abort and time limits', () => {
    it('rejects aborted at once, and gives the place back only once the request has ended', async () => {
        const held = holdSearches();
        const api = omniOf();
        const callers = range(0, 8).map(() => new AbortController());
        const aborted = callers.map((caller) => failureOf(api.searchSongs('hello', { signal: caller.signal })));
        await settle();
        expect(held.spy).toHaveBeenCalledTimes(8);
        callers.forEach((caller) => caller.abort());
        await expect(Promise.all(aborted)).resolves.toEqual(Array(8).fill('aborted'));
        // The eight are still under way at the backend: a ninth waits.
        const next = api.searchSongs('hello');
        await settle();
        expect(held.spy).toHaveBeenCalledTimes(8);
        held.answer(2);
        await settle();
        expect(held.spy).toHaveBeenCalledTimes(9);
        held.answer(8);
        await expect(next).resolves.toMatchObject({ items: expect.any(Array) });
        // An aborted signal is refused before anything is asked.
        const before = new AbortController();
        before.abort();
        await expect(failureOf(api.searchSongs('hello', { signal: before.signal }))).resolves.toBe('aborted');
        expect(held.spy).toHaveBeenCalledTimes(9);
    });

    it('aborts the calls under way and waiting when the mod stops, and refuses calls after', async () => {
        const held = holdSearches();
        const releases: Array<() => void> = [];
        let stopped = false;
        const api = omniOf('mod-a', { onRelease: (release) => releases.push(release), stopped: () => stopped });
        const calls = range(0, 10).map(() => failureOf(api.searchSongs('hello')));
        await settle();
        expect(held.spy).toHaveBeenCalledTimes(8);
        stopped = true;
        releases.forEach((release) => release());
        await expect(Promise.all(calls)).resolves.toEqual(Array(10).fill('aborted'));
        await expect(failureOf(api.searchSongs('hello'))).resolves.toBe('aborted');
        await expect(failureOf(api.resolveSongs([{ source: 'netease', id: '1' }]))).resolves.toBe('aborted');
        // The two that waited were never sent.
        expect(held.spy).toHaveBeenCalledTimes(8);
    });

    it('rejects network when no answer comes in 30 s, and gives the place back with a warning at 120 s', async () => {
        vi.useFakeTimers();
        const search = vi.spyOn(neteaseApi, 'cloudSearch').mockImplementation(() => new Promise(() => {}));
        const api = omniOf();
        const hung = failureOf(api.searchSongs('hello'));
        await vi.advanceTimersByTimeAsync(29_999);
        await vi.advanceTimersByTimeAsync(1);
        await expect(hung).resolves.toBe('network');
        // Its place is still taken: seven more fill the eight, and one more waits.
        range(0, 7).forEach(() => { void api.searchSongs('hello').catch(() => {}); });
        await vi.advanceTimersByTimeAsync(89_999);
        void api.searchSongs('hello').catch(() => {});
        await vi.advanceTimersByTimeAsync(0);
        expect(search).toHaveBeenCalledTimes(8);
        // 120 s after the first was sent its places are given back, and the waiting one goes.
        await vi.advanceTimersByTimeAsync(1);
        expect(vi.mocked(console.warn).mock.calls.map(([line]) => String(line))).toContain(
            '[Folium:mod-a] omni.searchSongs netease: still under way 120 s after it was sent; its places are given back, though it may still be running',
        );
        expect(search).toHaveBeenCalledTimes(9);
    });
});

describe('folium.omni allowance', () => {
    it('shares the minute of a mod with platform.raw', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        answerSearches();
        vi.spyOn(neteaseRaw, 'request').mockResolvedValue({ code: 200 });
        const platform = createFoliumPlatformService(mod());
        await Promise.all(range(1, 119).map(() => platform.request('netease', 'listen_data_total')));
        const api = omniOf();
        await expect(api.searchSongs('hello')).resolves.toBeTruthy();
        await expect(failureOf(api.searchSongs('hello'))).resolves.toBe('rate-limited');
        await expect(failureOf(platform.request('netease', 'listen_data_total'))).resolves.toBe('rate-limited');
        // Another mod has a minute of its own.
        await expect(omniOf('mod-b').searchSongs('hello')).resolves.toBeTruthy();
        vi.setSystemTime(new Date('2026-10-21T12:01:00Z'));
        await expect(api.searchSongs('hello')).resolves.toBeTruthy();
    });

    it('sends eight requests of a mod at once and lets the rest wait their turn', async () => {
        const held = holdSearches();
        const api = omniOf();
        const calls = range(0, 9).map(() => api.searchSongs('hello'));
        await settle();
        expect(held.spy).toHaveBeenCalledTimes(8);
        held.answer(0);
        await settle();
        expect(held.spy).toHaveBeenCalledTimes(9);
        range(1, 8).forEach((index) => held.answer(index));
        await expect(Promise.all(calls)).resolves.toHaveLength(9);
    });

    it('limits the requests to a built-in source across mods, in places and in the minute', async () => {
        const held = holdSearches();
        const radio = modSource({ id: 'radio', displayName: 'Radio', search: async () => ({ items: [providerSong('r1')], hasMore: false }) });
        const a = omniOf('mod-a');
        const b = omniOf('mod-b');
        range(0, 8).forEach(() => { void a.searchSongs('hello').catch(() => {}); });
        await settle();
        // The source's eight places are mod-a's: mod-b waits for one, though it has places of its own.
        const fromB = b.searchSongs('hello');
        await settle();
        expect(held.spy).toHaveBeenCalledTimes(8);
        // A request to a mod's source takes no place: mod-a, whose eight places are all taken, still gets in.
        await expect(a.searchSongs('tune', { providerId: radio })).resolves.toMatchObject({ items: [{ id: 'r1' }] });
        held.answer(0);
        await settle();
        expect(held.spy).toHaveBeenCalledTimes(9);
        held.answer(8);
        await expect(fromB).resolves.toBeTruthy();
        range(1, 7).forEach((index) => held.answer(index));
        await settle();

        resetFoliumRequestQuotasForTest();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        answerSearches();
        await Promise.all([...range(0, 120).map(() => a.searchSongs('hello')), ...range(0, 120).map(() => b.searchSongs('hello'))]);
        const c = omniOf('mod-c');
        await expect(failureOf(c.searchSongs('hello'))).resolves.toBe('rate-limited');
        // Requests to a mod's source count against each mod's minute, not against one for all mods.
        const [d, e] = [omniOf('mod-d'), omniOf('mod-e')];
        await Promise.all([...range(0, 120).map(() => d.searchSongs('tune', { providerId: radio })), ...range(0, 120).map(() => e.searchSongs('tune', { providerId: radio }))]);
        await expect(failureOf(d.searchSongs('tune', { providerId: radio }))).resolves.toBe('rate-limited');
        await expect(c.searchSongs('tune', { providerId: radio })).resolves.toBeTruthy();
    });

    it('lets a mod\'s source read folium.omni from inside its own search, eight at a time, without a deadlock', async () => {
        answerSearches();
        const api = omniOf();
        const relay = modSource({
            id: 'relay',
            displayName: 'Relay',
            search: async (query) => {
                // All eight outer searches are under way before any asks inside.
                await settle();
                const inner = await api.searchSongs(query, { providerId: 'netease', limit: 1 });
                return { items: inner.items.map((song) => providerSong(`via-${song.id}`)), hasMore: false };
            },
        });
        const outer = await Promise.all(range(0, 8).map((index) => api.searchSongs(`q${index}`, { providerId: relay })));
        expect(outer.map((page) => page.items[0]?.id)).toEqual(Array(8).fill('via-1'));
    });
});

describe('folium.omni failures', () => {
    it('turns the source\'s failures into the contract\'s codes', async () => {
        const search = vi.spyOn(neteaseApi, 'cloudSearch');
        const api = omniOf();
        const failWith = async (error: unknown) => {
            search.mockRejectedValueOnce(error);
            return failureOf(api.searchSongs('hello', { providerId: 'netease' }));
        };
        await expect(failWith(new OnlineProviderError('auth-required', 'sign in', 'netease'))).resolves.toBe('not-signed-in');
        await expect(failWith(new OnlineProviderError('subscription-required', 'pay', 'netease'))).resolves.toBe('vip-required');
        await expect(failWith(new OnlineProviderError('unsupported', 'no', 'netease'))).resolves.toBe('unsupported');
        await expect(failWith(new OnlineProviderError('unavailable', 'stopped', 'netease'))).resolves.toBe('unavailable');
        await expect(failWith(new OnlineProviderError('region-restricted', 'away', 'netease'))).resolves.toBe('region-restricted');
        await expect(failWith(new OnlineProviderError('network', 'slow', 'netease', undefined, 429))).resolves.toBe('rate-limited');
        await expect(failWith(new OnlineProviderError('network', 'later', 'netease', undefined, undefined, 5000))).resolves.toBe('rate-limited');
        for (const code of ['network', 'invalid-response', 'not-public', 'not-playable', 'preview-only'] as const) {
            await expect(failWith(new OnlineProviderError(code, code, 'netease')), code).resolves.toBe('network');
        }
        await expect(failWith(new Error('anything'))).resolves.toBe('network');
        // An abort from a source named is no switch of the selected source.
        await expect(failWith(new DOMException('stop', 'AbortError'))).resolves.toBe('network');
        signIn('netease', 5);
        await expect(failWith(new OnlineProviderError('auth-required', 'sign in again', 'netease'))).resolves.toBe('session-expired');
        expect(vi.mocked(console.warn)).toHaveBeenCalledWith('[Folium:mod-a] omni.searchSongs netease: session-expired', expect.any(OnlineProviderError));
    });

    it('reads anything a mod\'s source throws as network, a code of its own included', async () => {
        const forged = modSource({
            id: 'forged',
            displayName: 'Forged',
            search: async () => { throw Object.assign(new Error('rate-limited'), { code: 'rate-limited' }); },
        });
        await expect(failureOf(omniOf().searchSongs('q', { providerId: forged }))).resolves.toBe('network');
    });

    it('reads an allowance\'s refusal a mod\'s source rejects with as that source\'s failure, network, not as the caller\'s', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        answerSearches();
        const fromA = omniOf('mod-a');
        let inner: (Error & { code?: string }) | null = null;
        const relay = modSource({
            id: 'relay',
            displayName: 'Relay',
            search: async (query) => {
                try {
                    const page = await fromA.searchSongs(query, { providerId: 'netease', limit: 1 });
                    return { items: page.items.map((song) => providerSong(`via-${song.id}`)), hasMore: false };
                } catch (error) {
                    inner = error as Error & { code?: string };
                    throw error;
                }
            },
        });
        // mod-a's minute runs out, so the relay's own read inside is refused.
        const gate = createFoliumRequestGate({ modId: 'mod-a', what: 'omni.test', signal: new AbortController().signal, originOf: () => 'host' });
        await Promise.all(range(1, 120).map(() => gate.run('netease', () => Promise.resolve())));
        const outer = await omniOf('mod-b').searchSongs('q', { providerId: relay }).then(() => null, (error: Error & { code?: string }) => error);
        expect(inner).toMatchObject({ code: 'rate-limited' });
        expect(outer).toMatchObject({ code: 'network', message: 'network' });
        expect(outer).not.toBe(inner);
        expect(vi.mocked(console.warn)).toHaveBeenCalledWith(`[Folium:mod-b] omni.searchSongs ${relay}: network`, inner);
    });
});
