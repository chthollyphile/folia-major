import { describe, expect, it } from 'vitest';
import {
    SEARCH_HISTORY_LIMIT,
    SEARCH_HISTORY_MAX_QUERY_LENGTH,
    sanitizeSearchHistory,
    withSearchHistoryQuery,
    withoutSearchHistoryQuery,
} from '@/utils/searchHistory';

// test/unit/search/searchHistory.test.ts
// 搜索历史列表的规则：最近的在前、同一个词只留一条、超上限从尾部淘汰、太长的不记、读回来的脏数据整理干净。

describe('search history list', () => {
    it('puts the newest word first and moves a repeated word up instead of keeping two', () => {
        const history = withSearchHistoryQuery(['b', 'a'], 'a');
        expect(history).toEqual(['a', 'b']);
    });

    it('treats case and runs of spaces as the same word, keeping the latest spelling', () => {
        expect(withSearchHistoryQuery(['Jay  Chou', 'x'], '  jay chou ')).toEqual(['jay chou', 'x']);
    });

    it('drops the oldest word once the list is full', () => {
        const full = Array.from({ length: SEARCH_HISTORY_LIMIT }, (_, index) => `q${index}`);
        const next = withSearchHistoryQuery(full, 'new');
        expect(next).toHaveLength(SEARCH_HISTORY_LIMIT);
        expect(next[0]).toBe('new');
        expect(next).not.toContain(`q${SEARCH_HISTORY_LIMIT - 1}`);
    });

    it('does not record an empty word or one too long to be a search', () => {
        expect(withSearchHistoryQuery(['a'], '   ')).toEqual(['a']);
        expect(withSearchHistoryQuery(['a'], 'x'.repeat(SEARCH_HISTORY_MAX_QUERY_LENGTH + 1))).toEqual(['a']);
        expect(withSearchHistoryQuery([], 'x'.repeat(SEARCH_HISTORY_MAX_QUERY_LENGTH))).toHaveLength(1);
    });

    it('forgets a word in any spelling', () => {
        expect(withoutSearchHistoryQuery(['Jay Chou', 'b'], 'jay  chou')).toEqual(['b']);
    });

    it('cleans what comes back from storage by the same rules', () => {
        expect(sanitizeSearchHistory('nope')).toEqual([]);
        expect(sanitizeSearchHistory([' a ', 1, null, '', 'A', 'b', 'x'.repeat(SEARCH_HISTORY_MAX_QUERY_LENGTH + 1)])).toEqual(['a', 'b']);
        expect(sanitizeSearchHistory(Array.from({ length: 40 }, (_, index) => `q${index}`))).toHaveLength(SEARCH_HISTORY_LIMIT);
    });
});
