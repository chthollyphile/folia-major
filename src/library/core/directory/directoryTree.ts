import type { LibraryDirectoryItem, LibraryDirectoryNode } from './directory.contract';
import { compactDirectoryTrees, filterDirectoryTreesByItems, flattenExpandedDirectoryNodes } from './directoryBatch';

// src/library/core/directory/directoryTree.ts
// 目录的「列表 / 树」行（纯函数）：本地文件夹按导入根的目录树排成可展开的树，其余目录是平铺的条目。
// 给列表形态的 renderer（TUI 的目录列表）用：树的筛选、压缩单子链、展开都用批量面板同一套纯函数
// （core/directory/directoryBatch），只是这里把树节点与目录条目对上——节点的路径正好是某个文件夹条目时，
// 这一行就是那个条目（能打开、能选）；对不上的节点（没有直属歌曲的上层文件夹、被忽略的文件夹）是只用于
// 展示层级的节点行。没有路径的条目（虚拟的「全部歌曲」）与树里找不到的条目排在树的前面。

export type LibraryDirectoryRow<TItem extends LibraryDirectoryItem = LibraryDirectoryItem> =
    | {
        kind: 'item';
        /** 行的身份：`item:${id}`（焦点按它记，树形与平铺下同一个条目是同一个 key）。 */
        key: string;
        item: TItem;
        depth: number;
        /** 树里对应的节点（平铺目录、树外的条目没有）。 */
        node?: LibraryDirectoryNode;
        expandable: boolean;
        expanded: boolean;
        /** 上一级行的 key（树的根与平铺的行为 null）。 */
        parentKey: string | null;
    }
    | {
        kind: 'node';
        /** `node:${node.id}`。 */
        key: string;
        node: LibraryDirectoryNode;
        depth: number;
        expandable: boolean;
        expanded: boolean;
        parentKey: string | null;
    };

const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase();

export const directoryItemRowKey = (id: string | number): string => `item:${id}`;
export const directoryNodeRowKey = (id: string): string => `node:${id}`;

const collectNodeIds = (nodes: readonly LibraryDirectoryNode[], into: string[] = []): string[] => {
    nodes.forEach(node => {
        into.push(node.id);
        collectNodeIds(node.children, into);
    });
    return into;
};

/**
 * 目录此刻的行。displayItems 是已经按隐藏视图与筛选词过滤过的条目（与批量范围同一份）；trees 给了（本地文件夹）
 * 就排成树：有筛选词时只留匹配的文件夹与它们的上层（filterDirectoryTreesByItems），压缩单子链，collapsedIds 里的
 * 节点不展开（默认全部展开）。
 */
export const resolveDirectoryRows = <TItem extends LibraryDirectoryItem>({
    displayItems,
    trees,
    query = '',
    collapsedIds,
}: {
    displayItems: readonly TItem[];
    trees?: readonly LibraryDirectoryNode[] | null;
    query?: string;
    collapsedIds?: ReadonlySet<string>;
}): LibraryDirectoryRow<TItem>[] => {
    const flatRow = (item: TItem): LibraryDirectoryRow<TItem> => ({
        kind: 'item',
        key: directoryItemRowKey(item.id),
        item,
        depth: 0,
        expandable: false,
        expanded: false,
        parentKey: null,
    });
    if (!trees || trees.length === 0) return displayItems.map(flatRow);

    const visibleTrees = query.trim()
        ? filterDirectoryTreesByItems([...trees], displayItems, query)
        : [...trees];
    const compacted = compactDirectoryTrees(visibleTrees);
    const collapsed = collapsedIds ?? new Set<string>();
    const expanded = new Set(collectNodeIds(compacted).filter(id => !collapsed.has(id)));
    const nodes = flattenExpandedDirectoryNodes(compacted, expanded);

    // 节点 → 条目：只认真实文件夹（有 path、不是虚拟条目），按规范化的路径对。
    const itemsByPath = new Map<string, TItem>();
    displayItems.forEach(item => {
        if (item.path && !item.isVirtual) itemsByPath.set(normalizePath(item.path), item);
    });

    // 树里有位置的条目（含折叠起来看不见的）：它们不算「树外的条目」，折叠时不跑到树前面去。
    const matched = new Set<TItem>();
    flattenExpandedDirectoryNodes(compacted, new Set(collectNodeIds(compacted))).forEach(node => {
        const item = itemsByPath.get(normalizePath(node.path));
        if (item) matched.add(item);
    });
    // 展开后的顺序里父节点总在子节点前面：走到父节点时记下它的行 key，子节点据此知道自己的上一级。
    const parentKeyOf = new Map<string, string>();
    const treeRows: LibraryDirectoryRow<TItem>[] = [];
    nodes.forEach(node => {
        const item = itemsByPath.get(normalizePath(node.path));
        const key = item ? directoryItemRowKey(item.id) : directoryNodeRowKey(node.id);
        const parentKey = parentKeyOf.get(node.id) ?? null;
        const expandable = node.children.length > 0;
        const isExpanded = expandable && expanded.has(node.id);
        treeRows.push(item
            ? { kind: 'item', key, item, depth: node.depth, node, expandable, expanded: isExpanded, parentKey }
            : { kind: 'node', key, node, depth: node.depth, expandable, expanded: isExpanded, parentKey });
        node.children.forEach(child => parentKeyOf.set(child.id, key));
    });

    const loose = displayItems.filter(item => !matched.has(item)).map(flatRow);
    return [...loose, ...treeRows];
};
