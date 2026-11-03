import { create } from 'zustand';
import type { LibraryHiddenCollections, LibraryHiddenScope } from '../directory/directory.contract';
import { parseHiddenCollections, setHiddenCollection, toggleHiddenCollection } from '../directory/directoryVisibility';

// src/library/core/collection/useHiddenCollectionsStore.ts
// 首页目录的隐藏项（产品语义见 core/directory/directoryVisibility 的文件头）。原来是 DesktopGrid3DSurface 的组件状态，
// 每次挂载读一遍 localStorage；提到 store 后网格滑条、GridMap 和以后的 TUI 目录读同一份。
// localStorage 键与格式原样保留（`Record<scope, id[]>`），已有的隐藏不会丢。
// 这里不判断条目能不能隐藏——调用方先用 isHideableDirectoryItem 把关（store 只认作用域与 id）。

const HIDDEN_COLLECTIONS_STORAGE_KEY = 'hidden_grid_playlists';

const readStoredHiddenCollections = (): LibraryHiddenCollections => {
    if (typeof window === 'undefined') return {};
    try {
        const stored = localStorage.getItem(HIDDEN_COLLECTIONS_STORAGE_KEY);
        return parseHiddenCollections(stored ? JSON.parse(stored) : {});
    } catch {
        return {};
    }
};

const writeStoredHiddenCollections = (table: LibraryHiddenCollections) => {
    try {
        localStorage.setItem(HIDDEN_COLLECTIONS_STORAGE_KEY, JSON.stringify(table));
    } catch {
        // Keep the visibility change for this session when storage is unavailable.
    }
};

type HiddenCollectionsState = {
    /** 作用域 → 隐藏的条目 id；与存储里的格式相同。 */
    hiddenByScope: LibraryHiddenCollections;
    toggleHidden: (scope: LibraryHiddenScope, id: string) => void;
    setHidden: (scope: LibraryHiddenScope, id: string, hidden: boolean) => void;
    /** 从存储重新读一遍（存储被别处改写、或探针模拟重启时用）。 */
    hydrate: () => void;
};

export const useHiddenCollectionsStore = create<HiddenCollectionsState>((set, get) => {
    // 状态没变就不写存储、不通知订阅者。
    const commit = (next: LibraryHiddenCollections) => {
        if (next === get().hiddenByScope) return;
        writeStoredHiddenCollections(next);
        set({ hiddenByScope: next });
    };

    return {
        hiddenByScope: readStoredHiddenCollections(),
        toggleHidden: (scope, id) => commit(toggleHiddenCollection(get().hiddenByScope, scope, id)),
        setHidden: (scope, id, hidden) => commit(setHiddenCollection(get().hiddenByScope, scope, id, hidden)),
        hydrate: () => set({ hiddenByScope: readStoredHiddenCollections() }),
    };
});
