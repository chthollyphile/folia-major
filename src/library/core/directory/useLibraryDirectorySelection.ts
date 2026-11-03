import { useCallback, useMemo } from 'react';
import { EMPTY_DIRECTORY_SESSION } from './directorySession';
import { useLibraryDirectorySessionStore } from './useLibraryDirectorySessionStore';

// src/library/core/directory/useLibraryDirectorySelection.ts
// 目录的批选（按稳定条目 id）读写目录会话。renderer 拿到的是 id 集合与几个写法；
// 批量范围怎么从选择推出来见 useLibraryDirectoryScope / core/directory/directoryBatch。

export const useLibraryDirectorySelection = (sessionId: string) => {
    const ids = useLibraryDirectorySessionStore(state => (state.sessions[sessionId] ?? EMPTY_DIRECTORY_SESSION).selectedIds);
    const selectedIds = useMemo<ReadonlySet<string>>(() => new Set(ids), [ids]);
    const store = useLibraryDirectorySessionStore.getState;

    const setSelected = useCallback(
        (itemIds: readonly string[], selected: boolean) => store().setSelected(sessionId, itemIds, selected),
        [sessionId, store],
    );
    const toggleSelected = useCallback((itemId: string) => store().toggleSelected(sessionId, itemId), [sessionId, store]);
    const replaceSelection = useCallback(
        (itemIds: readonly string[]) => store().replaceSelection(sessionId, itemIds),
        [sessionId, store],
    );
    /** 清空选择并回到浏览视图（打开 / 关闭批量面板时）。 */
    const resetSelection = useCallback(() => store().resetSelection(sessionId), [sessionId, store]);

    return { selectedIds, setSelected, toggleSelected, replaceSelection, resetSelection };
};
