import { useMemo } from 'react';
import type { LibraryDirectoryBatchScope, LibraryDirectoryItem, LibraryDirectoryVisibilityMode } from './directory.contract';
import { resolveDirectoryBatchContext, resolveDirectoryBatchScope } from './directoryBatch';

// src/library/core/directory/useLibraryDirectoryScope.ts
// 目录此刻显示哪些条目、批量范围是哪些：可见（去隐藏）→ 筛选 → 选中（纯规则在 core/directory/directoryBatch）。
// query 由调用方给（网格传 useDeferredValue 之后的筛选词，键入时不卡渲染）。

const NO_SELECTION: ReadonlySet<string> = new Set();

export const useLibraryDirectoryScope = <TItem extends LibraryDirectoryItem>({
    items,
    hiddenIds,
    visibilityMode,
    query,
    selectedIds,
}: {
    items: readonly TItem[];
    hiddenIds: ReadonlySet<string>;
    visibilityMode: LibraryDirectoryVisibilityMode;
    query: string;
    selectedIds: ReadonlySet<string>;
}): LibraryDirectoryBatchScope<TItem> => {
    // 分两段记忆：选择变了只重算范围，displayItems 的身份不变（下游的卡片列表不重建）。
    const { visibleItems, displayItems } = useMemo(
        () => resolveDirectoryBatchScope({ items, hiddenIds, visibilityMode, query, selectedIds: NO_SELECTION }),
        [hiddenIds, items, query, visibilityMode],
    );
    const context = useMemo(
        () => resolveDirectoryBatchContext(displayItems, selectedIds),
        [displayItems, selectedIds],
    );
    return useMemo(() => ({ visibleItems, displayItems, context }), [context, displayItems, visibleItems]);
};
