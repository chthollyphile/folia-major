import { describe, expect, it, vi } from 'vitest';
import type { ProviderCollection, ProviderPage } from '@/types/onlineMusic';
import type { SongResult } from '@/types';
import {
    createFavoriteAlbumsFeed,
    createHomeFeedResource,
    createRadioFeed,
    FAVORITE_ALBUMS_PAGE_SIZE,
    HOME_FEED_RECOMMENDATION_LIMIT,
    loadAllFavoriteAlbums,
} from '@/library/core/home/online/onlineHomeFeeds.service';

// test/unit/library/core/onlineHomeFeeds.test.ts
// 在线首页资源（原 Grid3D 的收藏专辑 / 电台加载）：分页读完、换归属清空并作废进行中的读取、晚到的应答
// 按 generation 丢掉（切 provider 的竞态）、ensure 只读一次、reload 重新读、失败保留数据。

const album = (providerId: string, index: number): ProviderCollection => ({
    providerId,
    id: `${providerId}-album-${index}`,
    name: `Album ${index}`,
    type: 'album',
});

/** 可控的延迟：每次调用返回一个由测试决定何时完成的 promise。 */
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const pagedAlbums = (providerId: string, total: number) => vi.fn(async (_userId: unknown, page: { limit: number; offset: number }) => {
    const items = Array.from({ length: Math.max(0, Math.min(page.limit, total - page.offset)) }, (_, index) => album(providerId, page.offset + index));
    const nextOffset = page.offset + items.length;
    return { items, hasMore: nextOffset < total, nextOffset } satisfies ProviderPage<ProviderCollection>;
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('loadAllFavoriteAlbums', () => {
    it('reads every page in upstream order', async () => {
        const getUserAlbums = pagedAlbums('a', 120);
        const albums = await loadAllFavoriteAlbums({ getUserAlbums }, 'user-a');
        expect(albums.map(item => item.id)).toEqual(Array.from({ length: 120 }, (_, index) => `a-album-${index}`));
        expect(getUserAlbums.mock.calls.map(call => call[1])).toEqual([
            { limit: FAVORITE_ALBUMS_PAGE_SIZE, offset: 0 },
            { limit: FAVORITE_ALBUMS_PAGE_SIZE, offset: 50 },
            { limit: FAVORITE_ALBUMS_PAGE_SIZE, offset: 100 },
        ]);
    });

    it('stops when the next offset does not move forward', async () => {
        const getUserAlbums = vi.fn(async () => ({ items: [album('a', 0)], hasMore: true, nextOffset: 0 }));
        expect(await loadAllFavoriteAlbums({ getUserAlbums }, 'user-a')).toHaveLength(1);
        expect(getUserAlbums).toHaveBeenCalledTimes(1);
    });

    it('requests no further pages once the read is no longer current', async () => {
        const getUserAlbums = pagedAlbums('a', 120);
        let current = true;
        getUserAlbums.mockImplementationOnce(async () => {
            current = false;
            return { items: [album('a', 0)], hasMore: true, nextOffset: 50 };
        });
        await loadAllFavoriteAlbums({ getUserAlbums }, 'user-a', () => current);
        expect(getUserAlbums).toHaveBeenCalledTimes(1);
    });
});

describe('createHomeFeedResource', () => {
    it('loads nothing without an owner, and ensure loads once per owner', async () => {
        const load = vi.fn(async () => ['x']);
        const resource = createHomeFeedResource<string[]>({ label: 'test', empty: [], load });
        await resource.ensure();
        expect(load).not.toHaveBeenCalled();

        resource.setOwner({ providerId: 'a', userId: 1 });
        await resource.ensure();
        await resource.ensure();
        expect(load).toHaveBeenCalledTimes(1);
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', loaded: true, data: ['x'] });
    });

    it('setting the same owner again keeps the data; a new owner clears it', async () => {
        const resource = createHomeFeedResource<string[]>({ label: 'test', empty: [], load: async owner => [owner.providerId] });
        resource.setOwner({ providerId: 'a', userId: 1 });
        await resource.ensure();
        resource.setOwner({ providerId: 'a', userId: '1' });
        expect(resource.getSnapshot().data).toEqual(['a']);

        resource.setOwner({ providerId: 'b', userId: 1 });
        expect(resource.getSnapshot()).toMatchObject({ owner: { providerId: 'b' }, status: 'idle', loaded: false, data: [] });
        await resource.ensure();
        expect(resource.getSnapshot().data).toEqual(['b']);

        resource.setOwner(null);
        expect(resource.getSnapshot()).toMatchObject({ owner: null, status: 'idle', data: [] });
    });

    it('drops a late response for the previous owner (provider switch race)', async () => {
        const pending = new Map<string, ReturnType<typeof deferred<string[]>>>();
        const resource = createHomeFeedResource<string[]>({
            label: 'test',
            empty: [],
            load: owner => {
                const next = deferred<string[]>();
                pending.set(owner.providerId, next);
                return next.promise;
            },
        });
        resource.setOwner({ providerId: 'a', userId: 1 });
        const loadA = resource.ensure();
        resource.setOwner({ providerId: 'b', userId: 2 });
        const loadB = resource.ensure();

        pending.get('b')!.resolve(['b-1']);
        await loadB;
        pending.get('a')!.resolve(['a-1']);
        await loadA;
        expect(resource.getSnapshot()).toMatchObject({ owner: { providerId: 'b' }, status: 'ready', data: ['b-1'] });
    });

    it('a reload supersedes the read in flight: the older result never lands', async () => {
        const reads: ReturnType<typeof deferred<string[]>>[] = [];
        const resource = createHomeFeedResource<string[]>({
            label: 'test',
            empty: [],
            load: () => {
                const next = deferred<string[]>();
                reads.push(next);
                return next.promise;
            },
        });
        resource.setOwner({ providerId: 'a', userId: 1 });
        const first = resource.ensure();
        const second = resource.reload();
        reads[1].resolve(['new']);
        await second;
        reads[0].resolve(['old']);
        await first;
        expect(resource.getSnapshot().data).toEqual(['new']);
    });

    it('reload keeps the current data while it reads, and reports loading', async () => {
        const reads: ReturnType<typeof deferred<string[]>>[] = [];
        const resource = createHomeFeedResource<string[]>({
            label: 'test',
            empty: [],
            load: () => {
                const next = deferred<string[]>();
                reads.push(next);
                return next.promise;
            },
        });
        resource.setOwner({ providerId: 'a', userId: 1 });
        const first = resource.ensure();
        reads[0].resolve(['one']);
        await first;

        const listener = vi.fn();
        resource.subscribe(listener);
        const again = resource.reload();
        expect(resource.getSnapshot()).toMatchObject({ status: 'loading', data: ['one'] });
        reads[1].resolve(['two']);
        await again;
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', data: ['two'] });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('a failure keeps the data and lets ensure retry until a read succeeds', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const load = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(['ok']);
        const resource = createHomeFeedResource<string[]>({ label: 'test', empty: [], load });
        resource.setOwner({ providerId: 'a', userId: 1 });
        await resource.ensure();
        expect(resource.getSnapshot()).toMatchObject({ status: 'error', loaded: false, data: [] });
        await resource.ensure();
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', loaded: true, data: ['ok'] });
        expect(load).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalledTimes(1);
        error.mockRestore();
    });

    it('an aborted read (omni rejecting the previous provider) is not logged as an error', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const resource = createHomeFeedResource<string[]>({
            label: 'test',
            empty: [],
            load: async () => {
                throw new DOMException('Active online provider changed', 'AbortError');
            },
        });
        resource.setOwner({ providerId: 'a', userId: 1 });
        await resource.ensure();
        expect(resource.getSnapshot().status).toBe('error');
        expect(error).not.toHaveBeenCalled();
        error.mockRestore();
    });
});

describe('online home feeds', () => {
    it('the favorite albums feed pages through the owner\'s albums', async () => {
        const getUserAlbums = pagedAlbums('a', 60);
        const feed = createFavoriteAlbumsFeed({ getUserAlbums });
        feed.setOwner({ providerId: 'a', userId: 'user-a' });
        await feed.ensure();
        expect(feed.getSnapshot().data).toHaveLength(60);
        expect(getUserAlbums.mock.calls.every(call => call[0] === 'user-a')).toBe(true);
    });

    it('a slow first page from the previous provider stops paging and never lands', async () => {
        const firstPage = deferred<ProviderPage<ProviderCollection>>();
        const getUserAlbums = vi.fn(async (userId: unknown, page: { limit: number; offset: number }) => {
            if (userId === 'user-a') return firstPage.promise;
            return pagedAlbums('b', 3)(userId, page);
        });
        const feed = createFavoriteAlbumsFeed({ getUserAlbums });
        feed.setOwner({ providerId: 'a', userId: 'user-a' });
        const loadA = feed.ensure();
        feed.setOwner({ providerId: 'b', userId: 'user-b' });
        await feed.ensure();
        firstPage.resolve({ items: [album('a', 0)], hasMore: true, nextOffset: 50 });
        await loadA;
        await flush();

        expect(feed.getSnapshot().data.map(item => item.id)).toEqual(['b-album-0', 'b-album-1', 'b-album-2']);
        expect(getUserAlbums.mock.calls.filter(call => call[0] === 'user-a')).toHaveLength(1);
    });

    it('the radio feed resolves covers for the owner\'s provider and counts the daily songs', async () => {
        const songs = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }) as unknown as SongResult);
        const recommended = [album('a', 9)];
        const getHomeFeed = vi.fn(async () => ({ personalFm: songs('fm', 2), dailySongs: songs('daily', 4), recommendedCollections: recommended }));
        const songCoverUrl = vi.fn((song: SongResult | undefined, providerId: string) => (song ? `${providerId}:${String(song.id)}` : undefined));
        const feed = createRadioFeed({ getHomeFeed, songCoverUrl });
        feed.setOwner({ providerId: 'a', userId: 1 });
        await feed.ensure();

        expect(getHomeFeed).toHaveBeenCalledWith(HOME_FEED_RECOMMENDATION_LIMIT);
        expect(feed.getSnapshot().data).toEqual({
            personalFmCoverUrl: 'a:fm-0',
            hasPersonalFm: true,
            dailyCoverUrl: 'a:daily-0',
            dailyCount: 4,
            supportsDailySongs: true,
            recommended,
        });
    });

    it('an empty daily list gives an empty daily cover rather than undefined', async () => {
        const feed = createRadioFeed({
            getHomeFeed: async () => ({ personalFm: [], dailySongs: [], recommendedCollections: [] }),
            songCoverUrl: () => undefined,
        });
        feed.setOwner({ providerId: 'a', userId: 1 });
        await feed.ensure();
        expect(feed.getSnapshot().data).toEqual({ personalFmCoverUrl: undefined, hasPersonalFm: false, dailyCoverUrl: '', dailyCount: 0, recommended: [], supportsDailySongs: true });
    });

    // 一块没读到时照常显示读到的部分，但不记成读过：下次进电台页再读，偶发的失败不会在整个会话里留下一张空卡。
    it('shows a partial radio feed but reads it again on the next visit', async () => {
        const recommended = [album('a', 9)];
        const getHomeFeed = vi.fn()
            .mockResolvedValueOnce({ personalFm: [], dailySongs: [], recommendedCollections: recommended, partial: true as const })
            .mockResolvedValueOnce({ personalFm: [], dailySongs: [{ id: 'd-0' } as unknown as SongResult], recommendedCollections: recommended });
        const feed = createRadioFeed({ getHomeFeed, songCoverUrl: song => (song ? String(song.id) : undefined) });
        feed.setOwner({ providerId: 'a', userId: 1 });

        await feed.ensure();
        expect(feed.getSnapshot()).toMatchObject({ status: 'ready', loaded: false, data: { recommended, dailyCount: 0, partial: true } });

        await feed.ensure();
        expect(feed.getSnapshot()).toMatchObject({ status: 'ready', loaded: true, data: { dailyCount: 1, dailyCoverUrl: 'd-0' } });
        expect(feed.getSnapshot().data).not.toHaveProperty('partial');

        await feed.ensure();
        expect(getHomeFeed).toHaveBeenCalledTimes(2);
    });
});
