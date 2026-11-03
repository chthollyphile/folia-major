import { create } from 'zustand';
import type { LibrarySuiteId } from './suite.contract';
import { LIBRARY_SUITE_INITIAL_CHOICE } from './librarySuites';

// src/library/core/suite/useLibrarySuiteStore.ts
// 集合浏览用哪套 UI suite 展示（R3 之前是 useLibraryRendererStore 的 renderer）。
// B0 起是正式设置项（界面设置的「资料库界面」与命令面板），选择持久化到 localStorage（`library_suite`），
// 但只在用户主动选择时写入：没有记录时用初始选择（LIBRARY_SUITE_INITIAL_CHOICE）作初值，所以初始选择改了，
// 没选过的人会跟着走。不进外观配置的导入导出（界面偏好，不是视觉调参）。
// 合法的 id 由 registry 决定（state 不 import registry）：这里存的可能是当前构建里没有的 suite（初始选择、旧版本的记录），
// 渲染照常经 registry 回退；展示「当前 suite」的地方要用 registry 的 resolveActiveLibrarySuiteId 解析出实际生效的那套。
// 切换走 app/switchLibrarySuite，它会先校验。

const LIBRARY_SUITE_STORAGE_KEY = 'library_suite';

const readStoredSuite = (): LibrarySuiteId | null => {
    if (typeof window === 'undefined') return null;
    try {
        const stored = localStorage.getItem(LIBRARY_SUITE_STORAGE_KEY);
        return stored ? stored : null;
    } catch {
        return null;
    }
};

const writeStoredSuite = (suite: LibrarySuiteId) => {
    try {
        localStorage.setItem(LIBRARY_SUITE_STORAGE_KEY, suite);
    } catch {
        // Keep the choice for this session when storage is unavailable.
    }
};

type LibrarySuiteState = {
    /** 选中的 suite（用户的选择或初始选择），不一定可用；实际生效的经 registry 解析。 */
    suite: LibrarySuiteId;
    /** 用户选择：写入存储。只由 app/switchLibrarySuite（设置、命令面板、DEV 浮层）与探针调用。 */
    setSuite: (suite: LibrarySuiteId) => void;
    /** 从存储重新读一遍（存储被别处改写、或探针模拟重启时用）；没有记录时回到初始选择。 */
    hydrate: () => void;
};

export const useLibrarySuiteStore = create<LibrarySuiteState>(set => ({
    suite: readStoredSuite() ?? LIBRARY_SUITE_INITIAL_CHOICE,
    setSuite: (suite) => {
        writeStoredSuite(suite);
        set({ suite });
    },
    hydrate: () => set({ suite: readStoredSuite() ?? LIBRARY_SUITE_INITIAL_CHOICE }),
}));
