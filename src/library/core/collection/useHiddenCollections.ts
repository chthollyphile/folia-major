import { useCallback, useMemo } from 'react';
import type { LibraryDirectoryItem, LibraryHiddenScope } from '../directory/directory.contract';
import { isHideableDirectoryItem } from '../directory/directoryVisibility';
import { useHiddenCollectionsStore } from './useHiddenCollectionsStore';

// src/library/core/collection/useHiddenCollections.ts
// 目录 renderer 读写某个作用域的隐藏项：订阅的是这个作用域的数组（别的作用域变了不重渲染），
// 切换前先按 isHideableDirectoryItem 把关（专辑、歌手、文件夹的切换请求直接忽略）。

export const useHiddenCollections = (scope: LibraryHiddenScope) => {
    const ids = useHiddenCollectionsStore(state => state.hiddenByScope[scope]);
    const hiddenIds = useMemo<ReadonlySet<string>>(() => new Set(ids ?? []), [ids]);
    const toggleHidden = useCallback((item: Pick<LibraryDirectoryItem, 'id' | 'type' | 'hideable'>) => {
        if (!isHideableDirectoryItem(item)) return;
        useHiddenCollectionsStore.getState().toggleHidden(scope, String(item.id));
    }, [scope]);
    return { hiddenIds, toggleHidden };
};
