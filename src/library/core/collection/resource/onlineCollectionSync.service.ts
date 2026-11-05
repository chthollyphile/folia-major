import { appendUniqueByKey } from '../collectionPaging';

// src/library/core/collection/resource/onlineCollectionSync.service.ts
// Background paging for large online collections (GridView fills the rest after the first page).
// (Moved from components/folia-grid: the paging loop is collection IO, not grid presentation.)
//
// 进度按上游的原始 offset 推进，而不是按去重后的条数：上游歌单里可能有重复条目，
// 拿去重后的长度去比 total 永远到不了终点，只能白跑请求直到撞上安全上限。
// 单页失败先按退避重试，还失败才把中断点交回调用方，由界面决定怎么展示和续传。
// 什么时候停：上游这一页说没有了，或者读到了上游自己答出的总数（upstreamTotal，首页回答里带的）。传进来的
// total 多半是集合描述里记的曲目数，可能早已过期（曲目页不带总数的平台，歌单记着 150 首、实际 200 首时，按它
// 停就只剩第一页），不拿它提前结束；它只用来兜底：读过了它，翻来的一页又没有新条目，说明上游在原地打转，这时才停。

export type CollectionSyncPage<T> = {
    items: T[];
    total?: number;
    hasMore: boolean;
    nextOffset: number;
};

export type CollectionSyncResult<T> =
    /**
     * `whole`: the last page read said the list ends there. A sync also completes when pages stop
     * advancing or bring nothing new; the list may then go on past what was read.
     */
    | { status: 'complete'; items: T[]; offset: number; whole: boolean }
    | { status: 'failed'; items: T[]; offset: number; error: unknown }
    | { status: 'cancelled'; items: T[]; offset: number };

export type CollectionSyncOptions<T> = {
    initialItems: T[];
    /** Raw upstream offset to continue from; duplicates make it differ from `initialItems.length`. */
    startOffset: number;
    /** The collection's count as recorded (the descriptor's or detail's), possibly stale: only bounds a read going in circles. */
    total?: number;
    /** The count the provider's own answer gave (the first page's total): reading up to it ends the read. */
    upstreamTotal?: number;
    fetchPage: (offset: number) => Promise<CollectionSyncPage<T>>;
    getKey: (item: T) => string;
    /** Checked after every await; a newer sync or an unmount makes the old one stop quietly. */
    isCancelled: () => boolean;
    onPage: (items: T[], offset: number, hasMore: boolean) => void;
    wait?: (ms: number) => Promise<void>;
    retryDelaysMs?: readonly number[];
};

/** 打开时先取的那一页；够首屏铺满，又不至于让大歌单的首次请求太慢。 */
export const ONLINE_COLLECTION_FIRST_PAGE_SIZE = 150;
/** 后台补页每次取的条数。 */
export const ONLINE_COLLECTION_BACKGROUND_PAGE_SIZE = 1000;

export const COLLECTION_SYNC_PAGE_INTERVAL_MS = 100;
export const COLLECTION_SYNC_RETRY_DELAYS_MS = [500, 1500, 4000] as const;
// 最后的兜底：上游一直说还有、每页又都有新条目时，翻到这么多页为止。
const MAX_PAGES = 1000;

const defaultWait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

class SyncCancelled extends Error {}

// Fetches one page, retrying with backoff; throws the last error once retries run out.
const fetchPageWithRetry = async <T>(
    offset: number,
    options: CollectionSyncOptions<T>,
    wait: (ms: number) => Promise<void>,
): Promise<CollectionSyncPage<T>> => {
    const retryDelays = options.retryDelaysMs ?? COLLECTION_SYNC_RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
        try {
            return await options.fetchPage(offset);
        } catch (error) {
            if (options.isCancelled()) throw new SyncCancelled();
            if (attempt >= retryDelays.length) throw error;
            console.warn(`Collection sync page at offset ${offset} failed, retrying (${attempt + 1}/${retryDelays.length})`, error);
            await wait(retryDelays[attempt]);
            if (options.isCancelled()) throw new SyncCancelled();
        }
    }
};

// Pages through the rest of a collection until the provider says it ends, the upstream offset reaches
// the provider's own total, or the pages run dry or go in circles.
export const syncRemainingCollectionPages = async <T>(
    options: CollectionSyncOptions<T>,
): Promise<CollectionSyncResult<T>> => {
    const wait = options.wait ?? defaultWait;
    const { total } = options;
    const upstreamTotal = typeof options.upstreamTotal === 'number' && Number.isFinite(options.upstreamTotal) && options.upstreamTotal > 0
        ? options.upstreamTotal
        : undefined;
    let items = options.initialItems;
    let offset = options.startOffset;
    let whole = false;

    // 补页只在上一页说了「还有」时才开始（首页、缓存里记着 hasMore、续传）；之后每页说没有了就停（见循环末尾）。
    // 这里只按上游答出的总数先停（恰好整页时不再多发一次越界请求）；集合描述里记的 total 不算：offset 已经到了
    // 旧的总数，上游却还说有，就再读一页。
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
        if (upstreamTotal !== undefined && offset >= upstreamTotal) break;
        await wait(COLLECTION_SYNC_PAGE_INTERVAL_MS);
        if (options.isCancelled()) return { status: 'cancelled', items, offset };

        let page: CollectionSyncPage<T>;
        try {
            page = await fetchPageWithRetry(offset, options, wait);
        } catch (error) {
            if (error instanceof SyncCancelled || options.isCancelled()) {
                return { status: 'cancelled', items, offset };
            }
            return { status: 'failed', items, offset, error };
        }
        if (options.isCancelled()) return { status: 'cancelled', items, offset };
        whole = !page.hasMore;
        if (page.items.length === 0) break;

        const previousLength = items.length;
        const previousOffset = offset;
        items = appendUniqueByKey(items, page.items, options.getKey);
        offset = Math.max(offset, page.nextOffset);
        options.onPage(items, offset, page.hasMore);

        if (!page.hasMore || offset <= previousOffset) break;
        // 一整页都是旧条目，通常说明上游忽略了 offset，继续翻只会原地打转。总数之内的一页可能恰好全是重复的
        // 条目，照读；没有总数或已经读过总数时就停。
        if ((total === undefined || offset >= total) && items.length === previousLength) break;
    }

    return { status: 'complete', items, offset, whole };
};
