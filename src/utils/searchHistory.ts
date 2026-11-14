// src/utils/searchHistory.ts
// 搜索历史这份列表本身的规则（纯函数，不碰存储）：最近的在前、同一个词只留一条、超上限从尾部淘汰。
// 读写和记在什么时候由 useSearchNavigationStore 负责：每次 submitSearch 都记，所以首页、命令面板、搜索页的搜索都进来。

/** 最多留几条；再记一条就把最旧的挤掉。 */
export const SEARCH_HISTORY_LIMIT = 12;
/** 比这长的词照样搜，但不记：多半是粘贴进来的一段话，留在历史里只会把别的挤掉。 */
export const SEARCH_HISTORY_MAX_QUERY_LENGTH = 100;

/** 去掉首尾空白、把中间连着的空白并成一个：「周杰伦  晴天」和「周杰伦 晴天」是同一个词。 */
export const normalizeSearchHistoryQuery = (query: string): string => query.trim().replace(/\s+/g, ' ');

/** 大小写不同算同一个词（搜索本身也不区分），留下的是最后输入的那一版。 */
const sameQuery = (a: string, b: string) => normalizeSearchHistoryQuery(a).toLowerCase() === normalizeSearchHistoryQuery(b).toLowerCase();

/** 记一条：提到最前，旧的同一个词删掉，超上限从尾部淘汰。空的、太长的不记，原样返回。 */
export const withSearchHistoryQuery = (history: readonly string[], query: string): string[] => {
    const normalized = normalizeSearchHistoryQuery(query);
    if (!normalized || normalized.length > SEARCH_HISTORY_MAX_QUERY_LENGTH) {
        return [...history];
    }
    return [normalized, ...history.filter(item => !sameQuery(item, normalized))].slice(0, SEARCH_HISTORY_LIMIT);
};

/** 删一条（同一个词的任何大小写写法都算）。 */
export const withoutSearchHistoryQuery = (history: readonly string[], query: string): string[] => {
    const normalized = normalizeSearchHistoryQuery(query);
    return history.filter(item => !sameQuery(item, normalized));
};

/**
 * 把存储里读出来的东西整理成一份能用的历史：不是字符串的、空的、太长的丢掉，重复的只留最前面那条，再按上限截断。
 * 存储可能被别的版本写过，也可能被手改过，所以读的时候和写的时候守同一套规则。
 */
export const sanitizeSearchHistory = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const history: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const normalized = normalizeSearchHistoryQuery(item);
        if (!normalized || normalized.length > SEARCH_HISTORY_MAX_QUERY_LENGTH) continue;
        if (history.some(existing => sameQuery(existing, normalized))) continue;
        history.push(normalized);
        if (history.length >= SEARCH_HISTORY_LIMIT) break;
    }
    return history;
};
