import type { LibraryDirectoryItem } from './directory.contract';

// src/library/core/directory/directorySearch.ts
// 目录的基础筛选语义（原 GridMap 的 gridMapSearch），与具体 UI 无关：GridMap 与以后的 TUI 目录用同一套。

export type DirectorySearchableItem = Pick<LibraryDirectoryItem, 'name' | 'path' | 'description' | 'summary'>;

/** 按空白拆词，每个词都要出现在名称、路径、描述或摘要里（不区分大小写）；空 query 全部通过。 */
export const matchesDirectorySearch = (
    item: DirectorySearchableItem,
    query: string,
): boolean => {
    const terms = query
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    if (terms.length === 0) return true;

    const searchableText = [item.name, item.path, item.description, item.summary]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
    return terms.every(term => searchableText.includes(term));
};
