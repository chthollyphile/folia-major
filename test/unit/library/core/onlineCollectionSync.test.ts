import { describe, expect, it, vi } from 'vitest';
import { syncRemainingCollectionPages, type CollectionSyncPage } from '../../../../src/library/core/collection/resource/onlineCollectionSync.service';

// test/unit/library/core/onlineCollectionSync.test.ts
// 在线大歌单后台补齐：按上游 offset 收敛、单页失败重试、中断点可续传、作废后不再回调。

type Item = { id: string };

// Serves a fixed upstream list in pages of `pageSize`, ignoring the requested limit like QQ does.
const upstream = (ids: string[], pageSize: number) => (offset: number): Promise<CollectionSyncPage<Item>> => {
    const items = ids.slice(offset, offset + pageSize).map(id => ({ id }));
    const nextOffset = offset + items.length;
    return Promise.resolve({ items, total: ids.length, hasMore: nextOffset < ids.length, nextOffset });
};

const baseOptions = {
    getKey: (item: Item) => item.id,
    isCancelled: () => false,
    onPage: () => {},
    wait: () => Promise.resolve(),
};

describe('syncRemainingCollectionPages', () => {
    it('reaches the upstream total even when duplicates keep the unique count below it', async () => {
        const ids = Array.from({ length: 250 }, (_, index) => `s${index}`);
        ids[120] = 's5';
        ids[200] = 's6';
        const fetchPage = vi.fn(upstream(ids, 100));

        const result = await syncRemainingCollectionPages({
            ...baseOptions,
            initialItems: ids.slice(0, 100).map(id => ({ id })),
            startOffset: 100,
            total: ids.length,
            fetchPage,
        });

        expect(result.status).toBe('complete');
        expect(result.offset).toBe(250);
        expect(result.items).toHaveLength(248);
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it('keeps going past 50 pages for collections larger than the old loop cap', async () => {
        const ids = Array.from({ length: 6000 }, (_, index) => `s${index}`);

        const result = await syncRemainingCollectionPages({
            ...baseOptions,
            initialItems: [],
            startOffset: 0,
            total: ids.length,
            fetchPage: upstream(ids, 100),
        });

        expect(result).toMatchObject({ status: 'complete', offset: 6000 });
        expect(result.items).toHaveLength(6000);
    });

    it('retries a failing page before moving on', async () => {
        const ids = Array.from({ length: 200 }, (_, index) => `s${index}`);
        const serve = upstream(ids, 100);
        let failures = 2;
        const fetchPage = vi.fn((offset: number) => (failures-- > 0 ? Promise.reject(new Error('timeout')) : serve(offset)));
        const wait = vi.fn(() => Promise.resolve());
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await syncRemainingCollectionPages({
            ...baseOptions,
            wait,
            initialItems: [],
            startOffset: 0,
            total: ids.length,
            fetchPage,
            retryDelaysMs: [10, 20, 40],
        });

        expect(result).toMatchObject({ status: 'complete', offset: 200 });
        expect(wait).toHaveBeenCalledWith(10);
        expect(wait).toHaveBeenCalledWith(20);
    });

    it('reports where it stopped once retries run out, so the caller can resume there', async () => {
        const ids = Array.from({ length: 300 }, (_, index) => `s${index}`);
        const serve = upstream(ids, 100);
        const fetchPage = vi.fn((offset: number) => (offset >= 200 ? Promise.reject(new Error('rate limited')) : serve(offset)));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const failed = await syncRemainingCollectionPages({
            ...baseOptions,
            initialItems: [],
            startOffset: 0,
            total: ids.length,
            fetchPage,
            retryDelaysMs: [1, 1],
        });

        expect(failed).toMatchObject({ status: 'failed', offset: 200 });
        expect(failed.items).toHaveLength(200);
        expect(fetchPage).toHaveBeenCalledTimes(2 + 3);

        const resumed = await syncRemainingCollectionPages({
            ...baseOptions,
            initialItems: failed.items,
            startOffset: failed.offset,
            total: ids.length,
            fetchPage: serve,
        });
        expect(resumed).toMatchObject({ status: 'complete', offset: 300 });
        expect(resumed.items).toHaveLength(300);
    });

    it('stops without calling back once a newer sync takes over', async () => {
        const ids = Array.from({ length: 300 }, (_, index) => `s${index}`);
        let cancelled = false;
        const onPage = vi.fn(() => { cancelled = true; });

        const result = await syncRemainingCollectionPages({
            ...baseOptions,
            isCancelled: () => cancelled,
            onPage,
            initialItems: [],
            startOffset: 0,
            total: ids.length,
            fetchPage: upstream(ids, 100),
        });

        expect(result.status).toBe('cancelled');
        expect(onPage).toHaveBeenCalledTimes(1);
    });

    it('stops on a repeated page when the total is unknown instead of looping', async () => {
        const fetchPage = vi.fn((offset: number) => Promise.resolve({
            items: [{ id: 'a' }, { id: 'b' }],
            hasMore: true,
            nextOffset: offset + 2,
        }));

        const result = await syncRemainingCollectionPages({
            ...baseOptions,
            initialItems: [{ id: 'a' }, { id: 'b' }],
            startOffset: 2,
            fetchPage,
        });

        expect(result.status).toBe('complete');
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('says the list was read whole only when the last page read said it ends there', async () => {
        const ids = Array.from({ length: 250 }, (_, index) => `s${index}`);
        const firstPage = ids.slice(0, 100).map(id => ({ id }));

        const toTheEnd = await syncRemainingCollectionPages({
            ...baseOptions,
            initialItems: firstPage,
            startOffset: 100,
            fetchPage: upstream(ids, 100),
        });
        expect(toTheEnd).toMatchObject({ status: 'complete', offset: 250, whole: true });

        // Stopped by a count that is short of the list, while the provider said more would come.
        const cutShortByTheCount = await syncRemainingCollectionPages({
            ...baseOptions,
            initialItems: firstPage,
            startOffset: 100,
            total: 200,
            fetchPage: upstream(ids, 100),
        });
        expect(cutShortByTheCount).toMatchObject({ status: 'complete', offset: 200, whole: false });

        // Stopped because the pages no longer bring anything new.
        const goingInCircles = await syncRemainingCollectionPages({
            ...baseOptions,
            initialItems: [{ id: 'a' }, { id: 'b' }],
            startOffset: 2,
            fetchPage: offset => Promise.resolve({ items: [{ id: 'a' }, { id: 'b' }], hasMore: true, nextOffset: offset + 2 }),
        });
        expect(goingInCircles).toMatchObject({ status: 'complete', whole: false });
    });
});
