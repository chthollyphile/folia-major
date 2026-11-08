import type { ProviderPage } from '../../types/onlineMusic';

// src/services/onlineMusic/alignedPages.ts
// 把一次 { limit, offset } 的读取拆成固定大小、按大小对齐的小页逐页读（omni 读歌手全部歌曲时用）。

/**
 * 每一小页的大小。集合资源先读 { limit: 150, offset: 0 } 再按 { limit: 1000, offset: 150 } 往后补，两者都是它的倍数，
 * 所以每一小页的 offset 都落在它的整数倍上：按页码翻页的平台（page = floor(offset / limit) + 1）读到的正是这一段，
 * 不会把第一页重读一遍；按 offset 翻页、一次只肯回几百条的平台也不会因为请求太大而少给。
 */
export const ALIGNED_PAGE_SIZE = 50;

/**
 * 歌手「全部歌曲」最多读多少首（与歌手页专辑分页的 offset 上限同一个数）：古典作曲家、「群星」这类歌手动辄几万首，
 * 一路补到底要几百个串行请求、整份列表还要装进内存。到这里就当读完了，总数也按它截。
 */
export const ARTIST_SONGS_CAP = 10000;

type ReadPage<T> = (limit: number, offset: number) => Promise<ProviderPage<T>>;

/**
 * 读 [offset, offset + limit) 这一段：每次向 read 要 ALIGNED_PAGE_SIZE 条，读够这一段、平台说没有了、或者读到空页时停。
 * - 平台说还有时游标按整页前进（不照它少给的条数走）：按页码翻页的平台少给了一页，照条数走会落回同一页、把它重读一遍；
 *   按整页走不会重复，代价是单页上限比页大小还小的平台会跳过每页的零头。平台说没有了时停在它给的最后一条之后。
 * - 回给调用方的 hasMore 取最后一页的；total 取最后一页给的，但比已经读到的位置还小、平台又说还有时不可信（有的平台
 *   不给总数时拿本页条数充数），这时不回 total。
 * - 不截断最后一页：limit 不是页大小的倍数时可能多回不到一页的条目，换来下一次读取的 offset 仍然对齐。
 * - limit 不超过一页时原样读一次，与不拆页时一样。
 */
export const readAlignedPages = async <T>(
    read: ReadPage<T>,
    page: { limit: number; offset: number },
    pageSize = ALIGNED_PAGE_SIZE,
): Promise<ProviderPage<T>> => {
    const start = Math.max(0, Math.floor(page.offset));
    const limit = Math.max(1, Math.floor(page.limit));
    if (limit <= pageSize) return read(limit, start);

    const end = start + limit;
    const items: T[] = [];
    let cursor = start;
    let hasMore = true;
    let total: number | undefined;
    while (hasMore && cursor < end) {
        const chunk = await read(pageSize, cursor);
        items.push(...chunk.items);
        if (chunk.total !== undefined) total = chunk.total;
        hasMore = chunk.hasMore;
        // 空页：再读也是原地打转，停在这里。
        if (chunk.items.length === 0) break;
        cursor = hasMore ? cursor + pageSize : cursor + chunk.items.length;
    }
    if (total !== undefined && hasMore && total <= cursor) total = undefined;
    return { items, ...(total !== undefined ? { total } : {}), hasMore, nextOffset: cursor };
};
