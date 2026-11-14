import { create } from 'zustand';

// src/library/core/home/useHomeSearchHistoryStore.ts
// 首页搜索框的搜索历史：点开搜索框时列在下面，一条一个标签，能单条删也能一次清空。
// 存 localStorage（`folia_home_search_history_v1`，字符串数组，最近的在前），跨会话保留；
// 同一个词再搜一次就提到最前，不会堆两条；上限 12 条，多出的从尾部丢。

const HOME_SEARCH_HISTORY_KEY = 'folia_home_search_history_v1';
const MAX_HISTORY_ITEMS = 12;

const readStoredHistory = (): string[] => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(HOME_SEARCH_HISTORY_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .slice(0, MAX_HISTORY_ITEMS);
    } catch (e) {
        console.warn('[homeSearchHistory] Failed to restore search history:', e);
        return [];
    }
};

const writeStoredHistory = (items: string[]) => {
    try {
        localStorage.setItem(HOME_SEARCH_HISTORY_KEY, JSON.stringify(items));
    } catch (e) {
        console.warn('[homeSearchHistory] Failed to save search history:', e);
    }
};

/** 大小写不同算同一个词（搜索本身也不区分），但存的是最后输入的那一版。 */
const sameQuery = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

type HomeSearchHistoryState = {
    history: string[];
    /** 记一条搜索：去重、提到最前、超上限截断。 */
    remember: (query: string) => void;
    /** 删掉一条。 */
    forget: (query: string) => void;
    /** 清空整份历史。 */
    clear: () => void;
    /** 从存储重新读一遍（探针模拟重启时用）。 */
    hydrate: () => void;
};

export const useHomeSearchHistoryStore = create<HomeSearchHistoryState>((set, get) => ({
    history: readStoredHistory(),
    remember: (query) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        const next = [trimmed, ...get().history.filter(item => !sameQuery(item, trimmed))].slice(0, MAX_HISTORY_ITEMS);
        writeStoredHistory(next);
        set({ history: next });
    },
    forget: (query) => {
        const next = get().history.filter(item => item !== query);
        if (next.length === get().history.length) return;
        writeStoredHistory(next);
        set({ history: next });
    },
    clear: () => {
        if (get().history.length === 0) return;
        writeStoredHistory([]);
        set({ history: [] });
    },
    hydrate: () => set({ history: readStoredHistory() }),
}));
