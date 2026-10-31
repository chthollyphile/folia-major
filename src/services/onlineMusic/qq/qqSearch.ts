import type { UnifiedSong } from '../../../types';
import type { ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { searchQQSongs } from './qqLyricProvider';
import { normalizeQqCollection, normalizeQqSong } from './qqNormalize';
import { hasUsableQqSession, requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqSearch.ts
//
// QQ 的在线搜歌。匿名搜歌常被上游以 2001 拒绝，而且一旦被标记，低频请求也会周期性被拒（#473）；
// 2026-10-16 扫码对照实测：同一时段带会话的搜索一次都没有被拒，只换设备指纹、不带凭据则和匿名一样。
// 所以有会话时走后端 `/search`（带会话搜），没有会话、或后端这条路用不了时退回匿名直连。
// 2026-10-17 对照（#695）：匿名直连当时每次都是 2001，原因是请求里的 search_type 0 已被上游弃用，
// 改成 7 后匿名也能搜到；会话路径不受影响，路由照旧。
// 歌词匹配等跨 provider 的搜索不经过这里，仍是不要求登录的匿名路径。

/** 后端 `/search` 一页最多 20 条；匿名路径也用同一页长，两条路径之间切换时页码才对得上。 */
const QQ_SEARCH_MAX_PAGE_SIZE = 20;
/** 上游精简版搜索最多收 60 个字，后端超长回 400。 */
const QQ_SEARCH_MAX_KEYWORD_LENGTH = 60;

// 会话搜索空、匿名有结果时，后续页仍会走会话；记住这次回退的关键词，避免第 2 页又回到空清单。
// 首页会话重新有结果时再忘掉它；上限只防长期运行累积。
const ANONYMOUS_FALLBACK_KEYWORD_LIMIT = 100;
const anonymousSearchFallbackKeywords = new Set<string>();

const rememberAnonymousSearchFallback = (keyword: string): void => {
    anonymousSearchFallbackKeywords.delete(keyword);
    anonymousSearchFallbackKeywords.add(keyword);
    while (anonymousSearchFallbackKeywords.size > ANONYMOUS_FALLBACK_KEYWORD_LIMIT) {
        const oldest = anonymousSearchFallbackKeywords.values().next().value;
        if (oldest === undefined) break;
        anonymousSearchFallbackKeywords.delete(oldest);
    }
};

const forgetAnonymousSearchFallback = (keyword: string): void => {
    anonymousSearchFallbackKeywords.delete(keyword);
};

/** 测试与重置运行时缓存用：忘掉所有回退过匿名的关键词。 */
export const resetQqSearchFallbackMemory = (): void => {
    anonymousSearchFallbackKeywords.clear();
};

const SEARCH_REJECTED_KEY = 'search.rejected';

const isSearchRejected = (error: unknown): boolean => (
    error instanceof OnlineProviderError
    && (error.cause as { errorKey?: unknown } | undefined)?.errorKey === SEARCH_REJECTED_KEY
);

const readUpstreamCode = (error: unknown): number | undefined => {
    const match = /code (-?\d+)/.exec(error instanceof Error ? error.message : String(error));
    return match ? Number(match[1]) : undefined;
};

const searchWithSession = async (keyword: string, page: number, pageSize: number): Promise<ProviderPage<UnifiedSong>> => {
    const body = await requestQq<{ items?: unknown; more?: unknown; total?: unknown }>('search', {
        keyword, type: 'song', page, limit: pageSize,
    });
    if (!Array.isArray(body?.items)) {
        throw new OnlineProviderError('invalid-response', 'QQMusicApi search returned no items', 'qq', body);
    }
    // 后端原样交出上游条目，带着专辑与歌手的 mid，直接正规化；匿名路径经歌词模块转一手，mid 会丢。
    const items = body.items.map(normalizeQqSong);
    const total = Number(body.total);
    return {
        items,
        ...(Number.isSafeInteger(total) && total >= 0 ? { total } : {}),
        hasMore: body.more === true,
        nextOffset: page * pageSize,
    };
};

const searchAnonymously = async (keyword: string, page: number, pageSize: number): Promise<ProviderPage<UnifiedSong>> => {
    let results;
    try {
        results = await searchQQSongs(keyword, page, pageSize);
    } catch (error) {
        // 被拒不能当成「搜不到」：抛出去，搜索页才显示错误与重试。上游的码和抛出的错留在 cause 上。
        const upstreamCode = readUpstreamCode(error);
        throw new OnlineProviderError(
            'network',
            `QQ anonymous search failed: ${error instanceof Error ? error.message : String(error)}`,
            'qq',
            { error, ...(upstreamCode === undefined ? {} : { upstreamCode }) },
        );
    }
    const items = results.map(normalizeQqSong);
    return { items, hasMore: items.length === pageSize, nextOffset: page * pageSize };
};

/**
 * 按 offset 翻页搜歌。有会话先走后端；后端被上游拒绝（`search.rejected`）就直接报错，
 * 其他失败（旧后端 404、会话失效 401、后端没起来）退回匿名直连。
 * 第一页回退过匿名的关键词，后续页也直接走匿名。
 */
export const searchQqSongs = async (query: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> => {
    const keyword = query.trim().slice(0, QQ_SEARCH_MAX_KEYWORD_LENGTH);
    if (!keyword) return { items: [], hasMore: false, nextOffset: offset };

    const pageSize = Math.max(1, Math.min(limit, QQ_SEARCH_MAX_PAGE_SIZE));
    const page = Math.floor(Math.max(0, offset) / pageSize) + 1;

    if (hasUsableQqSession()) {
        // 首页已确认会拿到空清单时，后续页直接走匿名，别让列表又断在 20 条。
        if (offset > 0 && anonymousSearchFallbackKeywords.has(keyword)) {
            return searchAnonymously(keyword, page, pageSize);
        }
        try {
            const sessionPage = await searchWithSession(keyword, page, pageSize);
            // 会话路径固定送 search_type 0；上游对部分账号会回 200 + 空清单（匿名路径的 7 正常）。
            // 只有第一页又空又没有下一页时才重试匿名，别把上游的拒绝显示成「没有结果」。
            if (sessionPage.items.length > 0 || sessionPage.hasMore) {
                if (offset === 0) forgetAnonymousSearchFallback(keyword);
                return sessionPage;
            }
            if (offset > 0) return sessionPage;
            console.warn('[QQProvider] session search returned no items, retrying anonymously');
            rememberAnonymousSearchFallback(keyword);
            try {
                return await searchAnonymously(keyword, page, pageSize);
            } catch (fallbackError) {
                // 匿名也失败时保留会话的空页，只记日志，别把「没有结果」变成错误页。
                console.warn('[QQProvider] anonymous search fallback failed, keeping the empty session page', fallbackError);
                return sessionPage;
            }
        } catch (error) {
            if (isSearchRejected(error)) throw error;
            console.warn('[QQProvider] session search unavailable, falling back to anonymous search', error);
            rememberAnonymousSearchFallback(keyword);
        }
    }
    return searchAnonymously(keyword, page, pageSize);
};

// 后端 `/search` 搜专辑（type album）与歌单（type playlist）的条目，换成 normalizeQqCollection 认的字段名。
// 2026-10-31 不带会话实测两种都有结果：专辑给 albummid / name / pic / publish_date，歌手只有一个名字（singer）；
// song_num 一律是 0，不当曲目数。歌单给 dissid / dissname / logo / songnum / listennum / nickname / uin，
// 条目自带的数字 `type` 不是集合种类，不交下去；description 是「99首 某某 4.2亿次播放」这样拼出来的一句，不是简介。
const searchedQqAlbum = (raw: any): ProviderCollection => normalizeQqCollection({
    albummid: raw?.albummid,
    name: raw?.name,
    pic: raw?.pic,
    publishDate: raw?.publish_date,
    singerName: raw?.singer,
}, 'album');

const searchedQqPlaylist = (raw: any): ProviderCollection => normalizeQqCollection({
    dissid: raw?.dissid,
    dissname: raw?.dissname,
    picUrl: raw?.logo,
    songnum: raw?.songnum,
    listennum: raw?.listennum,
    ...(raw?.nickname ? { creator: { nick: raw.nickname, uin: raw?.uin } } : {}),
}, 'playlist');

/** 按 offset 翻页搜专辑或歌单，只走后端 `/search`：有会话带会话，没有时后端用匿名身份。 */
export const searchQqCollections = async (
    kind: 'album' | 'playlist',
    query: string,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    const keyword = query.trim().slice(0, QQ_SEARCH_MAX_KEYWORD_LENGTH);
    if (!keyword) return { items: [], hasMore: false, nextOffset: offset };

    const pageSize = Math.max(1, Math.min(limit, QQ_SEARCH_MAX_PAGE_SIZE));
    const page = Math.floor(Math.max(0, offset) / pageSize) + 1;
    const body = await requestQq<{ items?: unknown; more?: unknown; total?: unknown }>('search', {
        keyword, type: kind, page, limit: pageSize,
    });
    if (!Array.isArray(body?.items)) {
        throw new OnlineProviderError('invalid-response', `QQMusicApi ${kind} search returned no items`, 'qq', body);
    }
    const items = body.items
        .map(kind === 'album' ? searchedQqAlbum : searchedQqPlaylist)
        .filter(collection => collection.id !== '');
    const total = Number(body.total);
    return {
        items,
        ...(Number.isSafeInteger(total) && total >= 0 ? { total } : {}),
        hasMore: body.more === true && body.items.length > 0,
        nextOffset: page * pageSize,
    };
};
