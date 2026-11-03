import { describe, expect, it, vi } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import type { ProviderCollection, ProviderPage } from '@/types/onlineMusic';
import type { SubsonicAlbum, SubsonicSong } from '@/types/navidrome';
import type { LibraryCollectionDescriptor } from '@/library/core/collection/collection.contract';
import type { LibraryArtistLocalLibrary } from '@/library/core/artist/artist.contract';
import { createArtistResource, type ArtistResourceDeps, type NavidromeArtistSource } from '@/library/core/artist/artistResource.service';
import { createArtistResourceRegistry } from '@/library/core/artist/artistResourceRegistry.service';

// test/unit/library/core/artistResource.test.ts
// 歌手资源（原 ArtistGridView 的加载）：generation 丢弃被取代的应答、专辑分页与失败续页、暂停与复用、
// 加载失败的错误态、本地 catalog 未就绪时保持 loading、dispose 之后不再写快照。

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
const deferred = <T,>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

const online = { source: 'online', providerId: 'p', id: 'ar', name: 'Main', type: 'artist' } as LibraryCollectionDescriptor;
const navi = { source: 'navidrome', id: 'navi-ar', name: 'Navi', type: 'artist' } as LibraryCollectionDescriptor;
const localArtist = { source: 'local', id: 'group', entityId: 'ar1', name: 'Local', type: 'artist', songIds: [] } as unknown as LibraryCollectionDescriptor;

const detail = (name = 'Main'): ProviderCollection => ({ providerId: 'p', id: 'ar', name, type: 'artist', description: 'bio' });
const song = (id: string) => ({ id, name: id, artists: [], album: { id: 0, name: '' } } as unknown as SongResult);
const albumPage = (offset: number, count: number, hasMore: boolean): ProviderPage<ProviderCollection> => ({
    items: Array.from({ length: count }, (_, index) => ({ providerId: 'p', id: `al${offset + index}`, name: `Album ${offset + index}`, type: 'album' })),
    hasMore,
    nextOffset: offset + count,
});

/** 在线 deps：每个请求都是一个可以手动完成的 deferred，按顺序记下。 */
const onlineDeps = () => {
    const detailCalls: Deferred<ProviderCollection | null>[] = [];
    const songCalls: Deferred<ProviderPage<SongResult>>[] = [];
    const albumCalls: { offset: number; reply: Deferred<ProviderPage<ProviderCollection>> }[] = [];
    const deps: ArtistResourceDeps = {
        getArtistDetail: () => { const d = deferred<ProviderCollection | null>(); detailCalls.push(d); return d.promise; },
        getArtistSongs: () => { const d = deferred<ProviderPage<SongResult>>(); songCalls.push(d); return d.promise; },
        getArtistAlbums: (_descriptor, page) => {
            const reply = deferred<ProviderPage<ProviderCollection>>();
            albumCalls.push({ offset: page.offset, reply });
            return reply.promise;
        },
        connectNavidrome: () => null,
        local: { resolveCoverUrl: () => undefined, toTracks: songs => songs.map(item => song(item.id)), applyCover: track => track },
        t: key => key,
        wait: async () => {},
        reportError: () => {},
    };
    return { deps, detailCalls, songCalls, albumCalls };
};

const answerFirstScreen = async (calls: ReturnType<typeof onlineDeps>, index = 0, name = 'Main') => {
    calls.detailCalls[index].resolve(detail(name));
    calls.songCalls[index].resolve({ items: [song('s1'), song('s2')], hasMore: false, nextOffset: 2 });
    await flush();
};

describe('online artist resource', () => {
    it('loads the detail and top songs, then pages the albums 50 at a time until hasMore is false', async () => {
        const calls = onlineDeps();
        const resource = createArtistResource('k', online, calls.deps);
        expect(resource.getSnapshot().status).toBe('idle');
        resource.ensure(online);
        resource.ensure(online);
        expect(resource.getSnapshot().status).toBe('loading');
        expect(calls.detailCalls).toHaveLength(1);

        await answerFirstScreen(calls);
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', detail: { name: 'Main', description: 'bio' }, albumSync: { state: 'syncing', offset: 0 } });
        expect(resource.getSnapshot().topSongs.map(item => item.id)).toEqual(['s1', 's2']);

        calls.albumCalls[0].reply.resolve(albumPage(0, 50, true));
        await flush();
        expect(resource.getSnapshot()).toMatchObject({ albumSync: { state: 'syncing', offset: 50 }, hint: 'background' });
        calls.albumCalls[1].reply.resolve(albumPage(50, 7, false));
        await flush();
        expect(calls.albumCalls.map(call => call.offset)).toEqual([0, 50]);
        expect(resource.getSnapshot().albums).toHaveLength(57);
        expect(resource.getSnapshot().albumSync).toEqual({ state: 'none' });
        expect(resource.canReuse(online)).toBe(true);
    });

    it('stops at the 10000 offset cap and waits 60ms between pages', async () => {
        const calls = onlineDeps();
        const waits: number[] = [];
        calls.deps.wait = async (ms) => { waits.push(ms); };
        calls.deps.getArtistAlbums = async (_descriptor, page) => albumPage(page.offset, 50, true);
        const resource = createArtistResource('k', online, calls.deps);
        resource.ensure(online);
        await answerFirstScreen(calls);
        for (let i = 0; i < 400; i += 1) await flush();
        expect(resource.getSnapshot().albums).toHaveLength(10000);
        expect(resource.getSnapshot().albumSync).toEqual({ state: 'none' });
        expect(waits).toHaveLength(199);
        expect(new Set(waits)).toEqual(new Set([60]));
    });

    it('records a failed page with its offset; retryAlbums resumes there without refetching the detail', async () => {
        const calls = onlineDeps();
        const resource = createArtistResource('k', online, calls.deps);
        resource.ensure(online);
        await answerFirstScreen(calls);
        calls.albumCalls[0].reply.resolve(albumPage(0, 50, true));
        await flush();
        calls.albumCalls[1].reply.reject(new Error('page 2'));
        await flush();
        expect(resource.getSnapshot().albumSync).toEqual({ state: 'interrupted', offset: 50, reason: 'failed' });
        expect(resource.getSnapshot().status).toBe('ready');
        // 失败中断的不复用：重开时从头来。
        expect(resource.canReuse(online)).toBe(false);

        resource.retryAlbums();
        expect(calls.albumCalls.map(call => call.offset)).toEqual([0, 50, 50]);
        calls.albumCalls[2].reply.resolve(albumPage(50, 3, false));
        await flush();
        expect(resource.getSnapshot().albums).toHaveLength(53);
        expect(calls.detailCalls).toHaveLength(1);
        expect(calls.songCalls).toHaveLength(1);
        // 不是失败中断时 retryAlbums 什么都不做。
        resource.retryAlbums();
        expect(calls.albumCalls).toHaveLength(3);
    });

    it('drops the responses of a load superseded by reload', async () => {
        const calls = onlineDeps();
        const resource = createArtistResource('k', online, calls.deps);
        resource.ensure(online);
        resource.reload();
        expect(calls.detailCalls).toHaveLength(2);
        await answerFirstScreen(calls, 1, 'Renamed');
        expect(resource.getSnapshot().detail?.name).toBe('Renamed');
        await answerFirstScreen(calls, 0, 'Stale');
        expect(resource.getSnapshot().detail?.name).toBe('Renamed');
        // 旧加载不翻专辑页：只有新加载的第一页。
        expect(calls.albumCalls.map(call => call.offset)).toEqual([0]);
    });

    it('turns a failed first screen into an error that reload recovers from', async () => {
        const calls = onlineDeps();
        const resource = createArtistResource('k', online, calls.deps);
        resource.ensure(online);
        calls.detailCalls[0].reject(new Error('detail'));
        await flush();
        expect(resource.getSnapshot()).toMatchObject({ status: 'error', error: 'load-failed', detail: null });
        expect(resource.canReuse(online)).toBe(false);
        resource.reload();
        expect(resource.getSnapshot()).toMatchObject({ status: 'loading', error: null });
        await answerFirstScreen(calls, 1);
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', error: null });
    });

    it('pausing mid-sync parks the page offset; a late page is dropped and ensure resumes from there', async () => {
        const calls = onlineDeps();
        const resource = createArtistResource('k', online, calls.deps);
        resource.ensure(online);
        await answerFirstScreen(calls);
        calls.albumCalls[0].reply.resolve(albumPage(0, 50, true));
        await flush();
        resource.pause();
        expect(resource.getSnapshot().albumSync).toEqual({ state: 'interrupted', offset: 50, reason: 'paused' });
        calls.albumCalls[1].reply.resolve(albumPage(50, 50, true));
        await flush();
        expect(resource.getSnapshot().albums).toHaveLength(50);
        expect(resource.canReuse(online)).toBe(true);

        resource.ensure(online);
        expect(calls.albumCalls.map(call => call.offset)).toEqual([0, 50, 50]);
        calls.albumCalls[2].reply.resolve(albumPage(50, 5, false));
        await flush();
        expect(resource.getSnapshot().albums).toHaveLength(55);
        expect(calls.detailCalls).toHaveLength(1);
    });

    it('pausing during the first screen is not reusable; ensure after it starts over', async () => {
        const calls = onlineDeps();
        const resource = createArtistResource('k', online, calls.deps);
        resource.ensure(online);
        resource.pause();
        expect(resource.canReuse(online)).toBe(false);
        await answerFirstScreen(calls, 0);
        expect(resource.getSnapshot().status).toBe('loading');
        resource.ensure(online);
        expect(calls.detailCalls).toHaveLength(2);
        await answerFirstScreen(calls, 1);
        expect(resource.getSnapshot().status).toBe('ready');
    });

    it('writes nothing and notifies nobody once disposed during a load', async () => {
        const calls = onlineDeps();
        const resource = createArtistResource('k', online, calls.deps);
        const listener = vi.fn();
        resource.subscribe(listener);
        resource.ensure(online);
        listener.mockClear();
        resource.dispose();
        await answerFirstScreen(calls);
        expect(listener).not.toHaveBeenCalled();
        expect(resource.getSnapshot().status).toBe('loading');
        resource.ensure(online);
        resource.reload();
        expect(calls.detailCalls).toHaveLength(1);
        expect(resource.canReuse(online)).toBe(false);
    });
});

describe('Navidrome artist resource', () => {
    const naviDeps = (source: Partial<NavidromeArtistSource> | null) => {
        const { deps } = onlineDeps();
        deps.connectNavidrome = () => source && ({
            getArtist: async () => null,
            getAlbum: async () => null,
            coverArtUrl: id => `cover:${id}`,
            toSong: subsonic => song(subsonic.id),
            ...source,
        });
        return deps;
    };
    const subsonicAlbum = (id: string, songIds: string[]): SubsonicAlbum => ({
        id, name: id, artist: 'A', artistId: 'navi-ar', songCount: songIds.length, duration: 1, created: '', coverArt: `art-${id}`,
        song: songIds.map(songId => ({ id: songId }) as SubsonicSong),
    });

    it('loads the albums and the first albums\' songs as top songs', async () => {
        const deps = naviDeps({
            getArtist: async () => ({ id: 'navi-ar', name: 'Navi', album: [subsonicAlbum('a1', []), subsonicAlbum('a2', [])] }),
            getAlbum: async (id) => subsonicAlbum(id, [`${id}-s1`, `${id}-s2`]),
        });
        const resource = createArtistResource('k', navi, deps);
        resource.ensure(navi);
        await flush();
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', detail: { name: 'Navi', coverUrl: 'cover:art-a1', albumCount: 2 }, albumSync: { state: 'none' } });
        expect(resource.getSnapshot().albums.map(album => album.id)).toEqual(['a1', 'a2']);
        expect(resource.getSnapshot().topSongs.map(item => item.id)).toEqual(['a1-s1', 'a1-s2', 'a2-s1', 'a2-s2']);
    });

    it('drops a late getArtist from a superseded load (the old fixme)', async () => {
        const replies: Deferred<{ id: string; name: string; album: never[] } | null>[] = [];
        const deps = naviDeps({
            getArtist: () => { const d = deferred<{ id: string; name: string; album: never[] } | null>(); replies.push(d); return d.promise; },
        });
        const resource = createArtistResource('k', navi, deps);
        resource.ensure(navi);
        resource.reload();
        replies[1].resolve({ id: 'navi-ar', name: 'Renamed', album: [] });
        await flush();
        expect(resource.getSnapshot().detail?.name).toBe('Renamed');
        replies[0].resolve({ id: 'navi-ar', name: 'Stale', album: [] });
        await flush();
        expect(resource.getSnapshot().detail?.name).toBe('Renamed');
    });

    it('reports a missing configuration and a missing artist as errors', async () => {
        const unconfigured = createArtistResource('k', navi, naviDeps(null));
        unconfigured.ensure(navi);
        expect(unconfigured.getSnapshot()).toMatchObject({ status: 'error', error: 'source-unavailable' });
        const missing = createArtistResource('k', navi, naviDeps({}));
        missing.ensure(navi);
        await flush();
        expect(missing.getSnapshot()).toMatchObject({ status: 'error', error: 'load-failed' });
    });
});

describe('local artist resource', () => {
    const catalog = (ready: boolean) => ({
        ready,
        entities: [{ id: 'ar1', kind: 'artist' as const, displayName: 'Local Artist', aliases: [], normalizedAliases: [], createdAt: 0, updatedAt: 0 }],
        assignments: [{ songId: 's1', artistEntityIds: ['ar1'], artistOrigin: 'import' as const, albumOrigin: 'import' as const, updatedAt: 0 }],
    });
    const songs = [{ id: 's1' }] as unknown as LocalSong[];

    it('stays loading (never empty) while the host catalog is not ready, then derives synchronously', () => {
        const { deps } = onlineDeps();
        const resource = createArtistResource('k', localArtist, deps);
        const seen: string[] = [];
        resource.subscribe(() => seen.push(`${resource.getSnapshot().status}:${resource.getSnapshot().detail?.name ?? '-'}`));
        resource.ensure(localArtist, { catalog: catalog(false), songs });
        expect(resource.getSnapshot().status).toBe('loading');
        const ready: LibraryArtistLocalLibrary = { catalog: catalog(true), songs };
        resource.ensure(localArtist, ready);
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', detail: { name: 'Local Artist', trackCount: 1 } });
        expect(seen).toEqual(['loading:-', 'ready:Local Artist']);
        // 同一份输入不重复派生、不重复通知；新的 catalog 重新派生。
        resource.ensure(localArtist, ready);
        expect(seen).toHaveLength(2);
        resource.ensure(localArtist, { catalog: { ...catalog(true), entities: [{ ...catalog(true).entities[0], displayName: 'Renamed' }] }, songs });
        expect(resource.getSnapshot().detail?.name).toBe('Renamed');
    });

    it('is ready without a detail when the entity no longer exists (the empty state)', () => {
        const { deps } = onlineDeps();
        const resource = createArtistResource('k', { ...localArtist, entityId: 'gone' } as LibraryCollectionDescriptor, deps);
        resource.ensure({ ...localArtist, entityId: 'gone' } as LibraryCollectionDescriptor, { catalog: catalog(true), songs });
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', detail: null, albums: [] });
    });
});

describe('artist resource registry', () => {
    it('keeps reusable online and Navidrome artists, disposes local ones on release', async () => {
        vi.useFakeTimers();
        try {
            const registry = createArtistResourceRegistry();
            const calls = onlineDeps();
            const onlineResource = registry.peekOrCreate('o', online, () => createArtistResource('o', online, calls.deps));
            const localResource = registry.peekOrCreate('l', localArtist, () => createArtistResource('l', localArtist, calls.deps));
            const releaseOnline = registry.retain(onlineResource)!;
            const releaseLocal = registry.retain(localResource)!;
            onlineResource.ensure(online);
            calls.detailCalls[0].resolve(detail());
            calls.songCalls[0].resolve({ items: [], hasMore: false, nextOffset: 0 });
            await flush();
            calls.albumCalls[0].reply.resolve(albumPage(0, 2, false));
            await flush();
            releaseOnline();
            releaseLocal();
            vi.runAllTimers();
            expect(registry.size()).toEqual({ live: 0, retained: 1 });
            const create = vi.fn(() => createArtistResource('o', online, calls.deps));
            expect(registry.peekOrCreate('o', online, create)).toBe(onlineResource);
            expect(create).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
