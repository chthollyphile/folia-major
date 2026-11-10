import { describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { OmniPage, ProviderCollection } from '@/types/onlineMusic';
import { OmniError } from '@/types/onlineMusic';
import type { OnlineGridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';
import { createOnlineCollectionResource, UNVERSIONED_COLLECTION_REUSE_MS, type OnlineCollectionResourceDeps } from '@/library/core/collection/resource/onlineCollectionResource.service';
import { ONLINE_TRACKS_CACHE_SCHEMA_VERSION, type OnlineTracksCacheEntry } from '@/library/core/collection/resource/onlineCollectionCache.service';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { createCollectionResourceRegistry } from '@/library/core/collection/resource/collectionResourceRegistry.service';

// test/unit/library/core/onlineCollectionResource.test.ts
// 在线集合资源：读缓存 → 首页 → 后台补页的规则与 GridView 原先一致；请求归属在资源上，
// 重新加载、版本变化、销毁之后晚到的结果一律作废。依赖全部注入，不碰真实 omni 与 IndexedDB。

const TARGET_TIME = 1000;
const song = (index: number, prefix = 's'): SongResult => ({
    id: `${prefix}-${index}`,
    name: `${prefix} ${index}`,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId: 'p', mediaId: `${prefix}-${index}` },
} as SongResult);
const songs = (count: number, prefix = 's') => Array.from({ length: count }, (_, index) => song(index, prefix));
const ids = (tracks: SongResult[]) => tracks.map(track => String(track.id));

const playlist = (overrides: Partial<OnlineGridViewCollectionDescriptor> = {}): OnlineGridViewCollectionDescriptor => ({
    source: 'online',
    providerId: 'p',
    id: 'pl',
    name: 'Playlist',
    type: 'playlist',
    trackCount: 300,
    tracksUpdatedAt: TARGET_TIME,
    ...overrides,
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
const deferred = <T,>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

/** 让排队的微任务（含多层 await）全部跑完。 */
const settle = async () => {
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
};

const pageOf = (all: SongResult[], limit: number, offset: number): OmniPage<SongResult> => {
    const items = all.slice(offset, offset + limit);
    return { items, total: all.length, hasMore: offset + items.length < all.length, nextOffset: offset + items.length };
};

type Harness = {
    deps: OnlineCollectionResourceDeps;
    pages: Array<{ offset: number; limit: number }>;
    writes: Array<{ key: string; tracks: SongResult[]; snapshotTime: number }>;
};

const harness = (
    all: SongResult[],
    overrides: Partial<OnlineCollectionResourceDeps> = {},
    cache: OnlineTracksCacheEntry = { tracks: [], snapshotTime: 0, schemaVersion: 0 },
): Harness => {
    const pages: Harness['pages'] = [];
    const writes: Harness['writes'] = [];
    return {
        pages,
        writes,
        deps: {
            getCollectionTracks: vi.fn(async (_collection, page) => {
                pages.push(page);
                return pageOf(all, page.limit, page.offset);
            }),
            getCollectionDetail: vi.fn(async () => null),
            getPersonalFm: vi.fn(async () => songs(3, 'fm')),
            getDailySongs: vi.fn(async () => songs(4, 'daily')),
            readCache: vi.fn(async () => cache),
            writeCache: vi.fn(async (key, tracks, snapshotTime) => {
                writes.push({ key, tracks, snapshotTime });
            }),
            wait: async () => {},
            ...overrides,
        },
    };
};

describe('online collection resource: unversioned memory reuse', () => {
    it('avoids another first-page request after leaving and reopening, then refetches after expiry', async () => {
        vi.useFakeTimers();
        try {
            let time = 1000;
            const descriptor = playlist({ tracksUpdatedAt: undefined, trackCount: 10 });
            const h = harness(songs(10), { now: () => time });
            const registry = createCollectionResourceRegistry({ releaseGraceMs: 0 });
            const create = () => createOnlineCollectionResource('k', h.deps);
            const first = registry.peekOrCreate('k', descriptor, create);
            const release = registry.retain(first)!;
            first.ensure(descriptor, {});
            await settle();
            release();
            vi.advanceTimersByTime(1);

            const reopened = registry.peekOrCreate('k', descriptor, create);
            expect(reopened).toBe(first);
            const releaseAgain = registry.retain(reopened)!;
            reopened.ensure(descriptor, {});
            await settle();
            expect(h.deps.getCollectionTracks).toHaveBeenCalledTimes(1);
            releaseAgain();
            vi.advanceTimersByTime(1);

            time += UNVERSIONED_COLLECTION_REUSE_MS;
            const expired = registry.peekOrCreate('k', descriptor, create);
            expect(expired).not.toBe(first);
            const releaseExpired = registry.retain(expired)!;
            expired.ensure(descriptor, {});
            await settle();
            expect(h.deps.getCollectionTracks).toHaveBeenCalledTimes(2);
            releaseExpired();
            vi.advanceTimersByTime(1);
        } finally {
            vi.useRealTimers();
        }
    });

    // artist_songs: an artist's every song (#918), back from an album opened from it.
    it.each(['playlist', 'album', 'artist_songs'] as const)('reuses a loaded %s only until its original deadline', async type => {
        let time = 1000;
        const descriptor = playlist({ type, tracksUpdatedAt: undefined, trackCount: 10 });
        const h = harness(songs(10), { now: () => time });
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(descriptor, {});
        await settle();
        resource.pause();

        expect(resource.canReuse(descriptor)).toBe(true);
        expect(resource.canReuse({ ...descriptor, trackCount: 11 })).toBe(false);
        time += UNVERSIONED_COLLECTION_REUSE_MS - 1;
        resource.ensure(descriptor, {});
        expect(resource.canReuse(descriptor)).toBe(true);
        expect(h.pages).toHaveLength(1);
        time += 1;
        expect(resource.canReuse(descriptor)).toBe(false);
    });

    it('reuses a successfully loaded empty playlist without accepting an unversioned disk snapshot', async () => {
        const descriptor = playlist({ tracksUpdatedAt: undefined, trackCount: 0 });
        const h = harness([], {}, {
            tracks: songs(2, 'stale'), snapshotTime: 0, schemaVersion: ONLINE_TRACKS_CACHE_SCHEMA_VERSION,
            nextOffset: 2, hasMore: false,
        });
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(descriptor, {});
        await settle();
        expect(h.pages).toHaveLength(1);
        expect(resource.getSnapshot().tracks).toEqual([]);
        expect(resource.canReuse(descriptor)).toBe(true);
    });

    it.each(['daily_recommendations', 'radio', 'cloud'] as const)('does not retain dynamic %s collections using the fallback', async type => {
        const descriptor = playlist({ type, tracksUpdatedAt: undefined, trackCount: 10 });
        const h = harness(songs(10));
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(descriptor, {});
        await settle();
        expect(resource.canReuse(descriptor)).toBe(false);
    });

    it('bypasses the kept tracks on refresh and refuses to reuse a failed refresh', async () => {
        const descriptor = playlist({ tracksUpdatedAt: undefined, trackCount: 10 });
        const h = harness(songs(10));
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(descriptor, {});
        await settle();
        expect(resource.canReuse(descriptor)).toBe(true);
        vi.mocked(h.deps.getCollectionTracks).mockRejectedValueOnce(new Error('refresh failed'));
        resource.reload();
        await settle();
        expect(h.deps.getCollectionTracks).toHaveBeenCalledTimes(2);
        expect(h.deps.readCache).toHaveBeenCalledTimes(1);
        expect(resource.canReuse(descriptor)).toBe(false);
    });

    it.each(['removeTracks', 'removeAt'] as const)('invalidates memory reuse after %s', async operation => {
        const descriptor = playlist({ tracksUpdatedAt: undefined, trackCount: 10 });
        const h = harness(songs(10));
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(descriptor, {});
        await settle();
        if (operation === 'removeTracks') await resource.removeTracks(track => track.id === 's-0');
        else resource.removeAt(0, getPlaybackSongKey(song(0)));
        expect(resource.getSnapshot().tracks).toHaveLength(9);
        expect(resource.canReuse(descriptor)).toBe(false);
    });
});

describe('online collection resource: loading', () => {
    it('uses a valid cache without asking for the first page, then fills the rest from the cached cursor', async () => {
        const all = songs(300);
        const h = harness(all, {}, { tracks: all.slice(0, 200), snapshotTime: TARGET_TIME, schemaVersion: ONLINE_TRACKS_CACHE_SCHEMA_VERSION, nextOffset: 200, hasMore: true, total: 300 });
        const resource = createOnlineCollectionResource('k', h.deps);
        const hints: string[] = [];
        resource.subscribe(() => hints.push(resource.getSnapshot().hint));

        resource.ensure(playlist(), {});
        await settle();

        expect(h.pages).toEqual([{ offset: 200, limit: 1000 }]);
        expect(ids(resource.getSnapshot().tracks)).toEqual(ids(all));
        expect(resource.getSnapshot().status).toBe('ready');
        expect(resource.getSnapshot().sync).toEqual({ status: 'none' });
        // 缓存命中立即提交，补页是后台更新。
        expect(hints).toContain('urgent');
        expect(hints).toContain('background');
    });

    it.each([
        ['no update time', { tracks: songs(5), snapshotTime: 0, schemaVersion: 5 }, {}],
        ['a different snapshot', { tracks: songs(5), snapshotTime: 1, schemaVersion: 5 }, {}],
        ['an older schema', { tracks: songs(5), snapshotTime: TARGET_TIME, schemaVersion: 4 }, {}],
        ['a collection without update time', { tracks: songs(5), snapshotTime: TARGET_TIME, schemaVersion: 5 }, { tracksUpdatedAt: undefined }],
    ])('ignores a cache with %s and fetches the 150-track first page', async (_label, cache, descriptorOverrides) => {
        const all = songs(100);
        const h = harness(all, {}, cache as OnlineTracksCacheEntry);
        const resource = createOnlineCollectionResource('k', h.deps);
        const hints: string[] = [];
        resource.subscribe(() => hints.push(resource.getSnapshot().hint));

        resource.ensure(playlist({ trackCount: 100, ...descriptorOverrides }), {});
        await settle();

        expect(h.pages[0]).toEqual({ offset: 0, limit: 150 });
        expect(ids(resource.getSnapshot().tracks)).toEqual(ids(all));
        expect(hints).toContain('background');
        expect(h.writes[0]?.tracks).toHaveLength(100);
    });

    it('pages the rest by raw upstream offset and de-duplicates later pages', async () => {
        const raw = [...songs(150), song(3), ...songs(60, 'tail')];
        const h = harness(raw);
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: raw.length }), {});
        await settle();

        expect(h.pages).toEqual([{ offset: 0, limit: 150 }, { offset: 150, limit: 1000 }]);
        expect(resource.getSnapshot().tracks).toHaveLength(210);
        expect(h.writes.at(-1)?.snapshotTime).toBe(TARGET_TIME);
    });

    it('reads past a stale track count while the pages say more is coming', async () => {
        // NetEase's track pages carry no total and say "more" whenever a page comes back full; the
        // liked list's count was read when it held 150 songs, and it holds 200 now.
        const all = songs(200);
        const h = harness(all, {
            getCollectionTracks: vi.fn(async (_collection, page) => {
                h.pages.push(page);
                const items = all.slice(page.offset, page.offset + page.limit);
                return { items, hasMore: items.length === page.limit, nextOffset: page.offset + items.length };
            }),
        });
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: 150 }), {});
        await settle();

        expect(h.pages).toEqual([{ offset: 0, limit: 150 }, { offset: 150, limit: 1000 }]);
        expect(resource.getSnapshot().tracks).toHaveLength(200);
        expect(resource.getSnapshot().sync.status).toBe('none');
    });

    it('asks no page past the total the provider gave, even when the last page said more', async () => {
        // Some providers say "more" whenever a page comes back full, and give their own total besides.
        const all = songs(1150);
        const h = harness(all, {
            getCollectionTracks: vi.fn(async (_collection, page) => {
                h.pages.push(page);
                const items = all.slice(page.offset, page.offset + page.limit);
                return { items, total: all.length, hasMore: items.length === page.limit, nextOffset: page.offset + items.length };
            }),
        });
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: 150 }), {});
        await settle();

        expect(h.pages).toEqual([{ offset: 0, limit: 150 }, { offset: 150, limit: 1000 }]);
        expect(resource.getSnapshot().tracks).toHaveLength(1150);
    });

    it('reads on when the first page gave a total no larger than itself and said more', async () => {
        // A provider whose count is only the page's own count: 150 rows, "150 in all", more to come.
        const all = songs(250);
        const h = harness(all, {
            getCollectionTracks: vi.fn(async (_collection, page) => {
                h.pages.push(page);
                const items = all.slice(page.offset, page.offset + page.limit);
                return { items, total: items.length, hasMore: items.length === page.limit, nextOffset: page.offset + items.length };
            }),
        });
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: undefined }), {});
        await settle();

        expect(h.pages).toEqual([{ offset: 0, limit: 150 }, { offset: 150, limit: 1000 }]);
        expect(resource.getSnapshot().tracks).toHaveLength(250);
    });

    it('fills the detail track count from the page total, and keeps it when the detail has none', async () => {
        const detail = deferred<ProviderCollection | null>();
        const h = harness(songs(20), { getCollectionDetail: vi.fn(() => detail.promise) });
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: undefined }), {});
        await settle();
        expect(resource.getSnapshot().detail?.trackCount).toBe(20);

        detail.resolve({ providerId: 'p', id: 'pl', name: 'Detailed', type: 'playlist' });
        await settle();
        expect(resource.getSnapshot().detail).toMatchObject({ name: 'Detailed', trackCount: 20 });
    });

    it('loads personal FM and daily recommendations with a single call and no paging', async () => {
        const h = harness([]);
        const fm = createOnlineCollectionResource('fm', h.deps);
        fm.ensure(playlist({ type: 'radio', id: 'personal_fm' }), {});
        const daily = createOnlineCollectionResource('daily', h.deps);
        daily.ensure(playlist({ type: 'daily_recommendations', id: 'daily_recommendations', tracksUpdatedAt: undefined }), {});
        await settle();

        expect(ids(fm.getSnapshot().tracks)).toEqual(ids(songs(3, 'fm')));
        expect(ids(daily.getSnapshot().tracks)).toEqual(ids(songs(4, 'daily')));
        expect(h.pages).toEqual([]);
        expect(h.deps.getCollectionDetail).not.toHaveBeenCalled();
    });

    it('treats an empty first page as a ready, empty collection without writing the cache', async () => {
        const h = harness([]);
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: 0 }), {});
        await settle();
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', tracks: [], error: null });
        expect(h.writes).toEqual([]);
    });

    it('maps a not-public error separately from other failures, and keeps old tracks on a failed reload', async () => {
        const notPublic = harness([], { getCollectionTracks: vi.fn(async () => { throw new OmniError('not-public', 'private', 'p'); }) });
        const privateList = createOnlineCollectionResource('a', notPublic.deps);
        privateList.ensure(playlist(), {});
        await settle();
        expect(privateList.getSnapshot()).toMatchObject({ status: 'error', error: { kind: 'not-public' } });

        let fail = false;
        const flaky = harness(songs(10), {
            getCollectionTracks: vi.fn(async (_c, page) => {
                if (fail) throw new Error('boom');
                return pageOf(songs(10), page.limit, page.offset);
            }),
        });
        const resource = createOnlineCollectionResource('b', flaky.deps);
        resource.ensure(playlist({ trackCount: 10 }), {});
        await settle();
        fail = true;
        resource.reload();
        await settle();
        expect(resource.getSnapshot()).toMatchObject({ status: 'error', error: { kind: 'generic', message: 'boom' } });
        expect(resource.getSnapshot().tracks).toHaveLength(10);
    });
});

describe('online collection resource: background sync', () => {
    it('stops at a failed page and resumes from that offset', async () => {
        const all = songs(400);
        let failures = 4;
        const h = harness(all, {
            getCollectionTracks: vi.fn(async (_c, page) => {
                h.pages.push(page);
                if (page.offset === 150 && failures > 0) {
                    failures -= 1;
                    throw new Error('page down');
                }
                return pageOf(all, page.limit, page.offset);
            }),
        });
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: 400 }), {});
        await settle();
        // What was thrown goes with it (`cause`): the page sorts it into a named case before it says it.
        expect(resource.getSnapshot().sync).toMatchObject({ status: 'interrupted', message: 'page down', offset: 150 });
        expect(resource.getSnapshot().tracks).toHaveLength(150);

        h.pages.length = 0;
        resource.resumeSync();
        await settle();
        expect(h.pages[0]?.offset).toBe(150);
        expect(resource.getSnapshot().tracks).toHaveLength(400);
        expect(resource.getSnapshot().sync).toEqual({ status: 'none' });
    });

    it('drops pages from a sync that a reload replaced, and reloads past the cache', async () => {
        const all = songs(300);
        const slowPage = deferred<OmniPage<SongResult>>();
        const h = harness(all, {
            getCollectionTracks: vi.fn(async (_c, page) => {
                h.pages.push(page);
                if (page.offset === 150 && h.pages.length === 2) return slowPage.promise;
                return pageOf(all, page.limit, page.offset);
            }),
        }, { tracks: [], snapshotTime: 0, schemaVersion: 0 });
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist(), {});
        await settle();
        expect(resource.getSnapshot().sync.status).toBe('syncing');

        resource.reload();
        await settle();
        const reloadedTracks = resource.getSnapshot().tracks;
        slowPage.resolve(pageOf(songs(300, 'stale'), 1000, 150));
        await settle();

        expect(resource.getSnapshot().tracks).toBe(reloadedTracks);
        expect(ids(resource.getSnapshot().tracks).some(id => id.startsWith('stale'))).toBe(false);
        expect(h.deps.readCache).toHaveBeenCalledTimes(1);
    });

    it('never brings back a removed song from a later page', async () => {
        const all = songs(300);
        const secondPage = deferred<OmniPage<SongResult>>();
        const h = harness(all, {
            getCollectionTracks: vi.fn(async (_c, page) => (page.offset === 0 ? pageOf(all, page.limit, 0) : secondPage.promise)),
        });
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist(), {});
        await settle();

        const removedKey = getPlaybackSongKey(all[0]);
        await resource.removeTracks(track => getPlaybackSongKey(track) === removedKey);
        expect(h.writes.at(-1)?.snapshotTime).not.toBe(TARGET_TIME);
        secondPage.resolve(pageOf(all, 1000, 150));
        await settle();

        expect(resource.getSnapshot().tracks).toHaveLength(299);
        expect(resource.getSnapshot().tracks.map(getPlaybackSongKey)).not.toContain(removedKey);
    });
});

describe('online collection resource: ownership', () => {
    it('restarts the first load when the collection version changes meanwhile', async () => {
        const firstPage = deferred<OmniPage<SongResult>>();
        let calls = 0;
        const h = harness(songs(10), {
            getCollectionTracks: vi.fn(async (_c, page) => {
                calls += 1;
                return calls === 1 ? firstPage.promise : pageOf(songs(12, 'v2'), page.limit, page.offset);
            }),
        });
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: 10 }), {});
        await settle();
        resource.ensure(playlist({ trackCount: 12, tracksUpdatedAt: 2000 }), {});
        await settle();
        firstPage.resolve(pageOf(songs(10, 'v1'), 150, 0));
        await settle();

        expect(ids(resource.getSnapshot().tracks)).toEqual(ids(songs(12, 'v2')));
        expect(resource.getSnapshot().revision).toBe('2000||12');
    });

    it('ignores everything that arrives after dispose', async () => {
        const firstPage = deferred<OmniPage<SongResult>>();
        const h = harness([], { getCollectionTracks: vi.fn(() => firstPage.promise) });
        const resource = createOnlineCollectionResource('k', h.deps);
        const listener = vi.fn();
        resource.subscribe(listener);
        resource.ensure(playlist(), {});
        await settle();
        listener.mockClear();

        resource.dispose();
        firstPage.resolve(pageOf(songs(300), 150, 0));
        await settle();
        expect(listener).not.toHaveBeenCalled();
        expect(h.writes).toEqual([]);
        expect(h.deps.getCollectionTracks).toHaveBeenCalledTimes(1);
    });

    it('does not request again for the same version, and reuses only a settled, cacheable load', async () => {
        const h = harness(songs(10));
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: 10 }), {});
        resource.ensure(playlist({ trackCount: 10 }), {});
        await settle();
        expect(h.deps.getCollectionTracks).toHaveBeenCalledTimes(1);

        expect(resource.canReuse(playlist({ trackCount: 10 }))).toBe(true);
        expect(resource.canReuse(playlist({ trackCount: 11 }))).toBe(false);
        expect(resource.canReuse(playlist({ trackCount: 10, tracksUpdatedAt: undefined }))).toBe(false);
    });
});

describe('online collection resource: edit bridge', () => {
    it('replaces a song in place only while that position still holds the expected song', async () => {
        const h = harness(songs(5));
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: 5 }), {});
        await settle();

        expect(resource.replaceTrackAt(1, getPlaybackSongKey(song(3)), song(99))).toBe(false);
        expect(resource.replaceTrackAt(1, getPlaybackSongKey(song(1)), song(99))).toBe(true);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s-0', 's-99', 's-2', 's-3', 's-4']);
    });

    it('commits a removal at once, as an urgent update', async () => {
        const h = harness(songs(5));
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: 5 }), {});
        await settle();

        const hints: string[] = [];
        resource.subscribe(() => hints.push(resource.getSnapshot().hint));
        const removal = resource.removeTracks(track => track.id === 's-0');
        // 不等缓存写完：调用的那一刻就提交了。
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s-1', 's-2', 's-3', 's-4']);
        expect(hints).toEqual(['urgent']);
        await removal;
    });

    it('replaces the whole list from a loader and reports loading meanwhile', async () => {
        const h = harness(songs(5));
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: 5 }), {});
        await settle();

        const next = deferred<SongResult[]>();
        const done = resource.replaceAll(() => next.promise);
        expect(resource.getSnapshot().status).toBe('loading');
        next.resolve(songs(2, 'history'));
        await done;
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready' });
        expect(ids(resource.getSnapshot().tracks)).toEqual(['history-0', 'history-1']);
    });

    it('drops the failure of the first read once a replacement comes in', async () => {
        const h = harness(songs(5));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.mocked(h.deps.getCollectionTracks).mockRejectedValueOnce(new Error('offline'));
        const resource = createOnlineCollectionResource('k', h.deps);
        resource.ensure(playlist({ trackCount: 5 }), {});
        await settle();
        expect(resource.getSnapshot().status).toBe('error');
        expect(resource.getSnapshot().error).not.toBeNull();

        expect(await resource.replaceAll(async () => songs(2, 'other'))).toBe(true);
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', error: null });
    });
});
