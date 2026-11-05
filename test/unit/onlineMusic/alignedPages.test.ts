import { describe, expect, it, vi } from 'vitest';
import type { ProviderPage } from '@/types/onlineMusic';
import { ALIGNED_PAGE_SIZE, readAlignedPages } from '@/services/onlineMusic/alignedPages';

// test/unit/onlineMusic/alignedPages.test.ts
// 拆页读取（#918 歌手全部歌曲）：一次 { limit, offset } 拆成对齐的小页；按页码翻页与按 offset 翻页的平台都读得对，
// 集合资源先 150 再 1000 的两次读取首尾相接、不重复。

const ids = (count: number) => Array.from({ length: count }, (_, index) => index);

/** 按页码翻页：page = floor(offset / limit) + 1，读的是那一整页，不看 offset 的零头。 */
const pageNumbered = (total: number) => vi.fn(async (limit: number, offset: number): Promise<ProviderPage<number>> => {
    const page = Math.floor(offset / limit) + 1;
    const items = ids(total).slice((page - 1) * limit, page * limit);
    const nextOffset = offset + items.length;
    return { items, total, hasMore: nextOffset < total, nextOffset };
});

/** 按 offset 翻页，一次最多回 cap 条（多要也只给这么多），只说还有没有、不给总数。 */
const offsetCapped = (total: number, cap: number) => vi.fn(async (limit: number, offset: number): Promise<ProviderPage<number>> => {
    const items = ids(total).slice(offset, offset + Math.min(limit, cap));
    const nextOffset = offset + items.length;
    return { items, hasMore: nextOffset < total, nextOffset };
});

describe('readAlignedPages', () => {
    it('reads the first 150 and then 1000 from 150 on a page-numbered source without reading a page twice', async () => {
        const read = pageNumbered(1234);
        const first = await readAlignedPages(read, { limit: 150, offset: 0 });
        expect(first).toEqual({ items: ids(150), total: 1234, hasMore: true, nextOffset: 150 });
        const second = await readAlignedPages(read, { limit: 1000, offset: first.nextOffset });
        expect(second).toMatchObject({ total: 1234, hasMore: true, nextOffset: 1150 });
        expect(second.items).toEqual(ids(1150).slice(150));
        const third = await readAlignedPages(read, { limit: 1000, offset: second.nextOffset });
        expect(third).toMatchObject({ hasMore: false, nextOffset: 1234 });
        expect(third.items).toEqual(ids(1234).slice(1150));
        // 每一次都要 50 条，offset 落在 50 的整数倍上。
        for (const [limit, offset] of read.mock.calls) {
            expect(limit).toBe(ALIGNED_PAGE_SIZE);
            expect(offset % ALIGNED_PAGE_SIZE).toBe(0);
        }
    });

    it('reads a whole 1000 from an offset source that answers a big request with only 200', async () => {
        const read = offsetCapped(700, 200);
        const page = await readAlignedPages(read, { limit: 1000, offset: 150 });
        expect(page.items).toEqual(ids(700).slice(150));
        expect(page).toMatchObject({ hasMore: false, nextOffset: 700 });
        expect(page.total).toBeUndefined();
        expect(read).toHaveBeenCalledTimes(11);
    });

    it('stops where the source says the list ends, and on an empty page', async () => {
        const short = pageNumbered(30);
        expect(await readAlignedPages(short, { limit: 150, offset: 0 })).toEqual({ items: ids(30), total: 30, hasMore: false, nextOffset: 30 });
        expect(short).toHaveBeenCalledTimes(1);

        const lying = vi.fn(async (_limit: number, offset: number): Promise<ProviderPage<number>> => (
            offset === 0 ? { items: ids(50), hasMore: true, nextOffset: 50 } : { items: [], hasMore: true, nextOffset: offset }
        ));
        expect(await readAlignedPages(lying, { limit: 150, offset: 0 })).toMatchObject({ items: ids(50), nextOffset: 50 });
        expect(lying).toHaveBeenCalledTimes(2);
    });

    it('steps a whole page on when a page-numbered source gives fewer than asked, so no page is read twice', async () => {
        // 每页最多给 30 条的按页码翻页的平台：照条数走会落回第 1 页，按整页走每页只读一次（每页的零头读不到）。
        const capped = vi.fn(async (limit: number, offset: number): Promise<ProviderPage<number>> => {
            const page = Math.floor(offset / limit) + 1;
            const items = ids(1000).slice((page - 1) * limit, (page - 1) * limit + 30);
            return { items, total: 1000, hasMore: true, nextOffset: offset + items.length };
        });
        const page = await readAlignedPages(capped, { limit: 150, offset: 0 });
        expect(capped.mock.calls.map(([, offset]) => offset)).toEqual([0, 50, 100]);
        expect(new Set(page.items).size).toBe(page.items.length);
        expect(page).toMatchObject({ hasMore: true, nextOffset: 150, total: 1000 });

        // 一次给了一条就说没有了：停在它之后。
        const ends = vi.fn(async (_limit: number, offset: number): Promise<ProviderPage<number>> => (
            { items: [offset], hasMore: offset < 50, nextOffset: offset + 1 }
        ));
        expect(await readAlignedPages(ends, { limit: 150, offset: 0 })).toMatchObject({ items: [0, 50], hasMore: false, nextOffset: 51 });
    });

    it('drops a total smaller than where it has read while the source says there is more', async () => {
        // 不给总数、拿本页条数充数的平台：total 每页都是 50。
        const counted = vi.fn(async (limit: number, offset: number): Promise<ProviderPage<number>> => {
            const items = ids(1000).slice(offset, offset + limit);
            return { items, total: items.length, hasMore: items.length === limit, nextOffset: offset + items.length };
        });
        const page = await readAlignedPages(counted, { limit: 150, offset: 0 });
        expect(page.items).toEqual(ids(150));
        expect(page.total).toBeUndefined();
        expect(page.hasMore).toBe(true);
    });

    it('reads whole pages past a limit that is not a multiple, so the next offset stays aligned', async () => {
        const read = pageNumbered(500);
        const page = await readAlignedPages(read, { limit: 120, offset: 0 });
        expect(page.items).toHaveLength(150);
        expect(page.nextOffset).toBe(150);
    });

    it('asks once, as it is, for a limit of one page or less', async () => {
        const read = pageNumbered(500);
        expect(await readAlignedPages(read, { limit: 10, offset: 0 })).toMatchObject({ items: ids(10), nextOffset: 10 });
        expect(read).toHaveBeenCalledWith(10, 0);
        expect(read).toHaveBeenCalledTimes(1);
    });
});
