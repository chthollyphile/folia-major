import type {
    LibraryDirectoryBatchActionId,
    LibraryDirectoryBatchCapabilities,
    LibraryDirectoryBatchConfig,
    LibraryDirectoryBatchContext,
    LibraryDirectoryBatchPending,
    LibraryDirectoryBatchScope,
    LibraryDirectoryItem,
    LibraryDirectoryNode,
    LibraryDirectoryNodeSelection,
    LibraryDirectoryNodeSelectionTarget,
    LibraryDirectorySelectionType,
    LibraryDirectoryVisibilityMode,
} from './directory.contract';
import type { LibraryMutationResult } from '../collection/mutations/mutations.contract';
import { matchesDirectorySearch } from './directorySearch';
import { filterDirectoryByVisibility } from './directoryVisibility';

// src/library/core/directory/directoryBatch.ts
// 目录批量的纯规则（原网格的 gridMapBatch）：批量范围、目录树的展开 / 压缩 / 筛选、树节点的三态选择、
// 一个 section 提供哪些批量动作、批量能力，以及把动作 id 分派到控制器。
//
// 选择按稳定的条目 id 存（会话里的 selectedIds），不是「排除集合」：范围 = 可见（去隐藏）→ 筛选 → 选中，
// 选中的条目按目录顺序排（不是点击顺序），歌曲按条目顺序去重、保留第一次出现的位置。

/** 条目路径的比较形式：统一斜杠、去掉首尾斜杠、不区分大小写；没有 path 的条目用名称。 */
const normalizeItemPath = (item: Pick<LibraryDirectoryItem, 'path' | 'name'>) => (item.path || item.name)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLocaleLowerCase();

const normalizeNodePath = (path: string) => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase();

/** 批量范围：displayItems 里被选中的条目（按 displayItems 的顺序）与它们去重保序后的歌曲 id。 */
export const resolveDirectoryBatchContext = <TItem extends LibraryDirectoryItem>(
    displayItems: readonly TItem[],
    selectedItemIds: ReadonlySet<string>,
): LibraryDirectoryBatchContext<TItem> => {
    const items = displayItems.filter(item => selectedItemIds.has(String(item.id)));
    const seenTrackIds = new Set<string>();
    const trackIds: string[] = [];

    for (const item of items) {
        for (const trackId of item.trackIds || []) {
            if (seenTrackIds.has(trackId)) continue;
            seenTrackIds.add(trackId);
            trackIds.push(trackId);
        }
    }

    return { items, trackIds };
};

/**
 * 目录的批量范围，一步到位：按隐藏视图过滤 → 按筛选词过滤 → 取选中的。
 * 筛掉的、隐藏的条目即使 id 还在选择里也不进范围（选择本身不动，清掉筛选后它们回来）。
 */
export const resolveDirectoryBatchScope = <TItem extends LibraryDirectoryItem>({
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
    const visibleItems = filterDirectoryByVisibility(items, hiddenIds, visibilityMode);
    const displayItems = query.trim()
        ? visibleItems.filter(item => matchesDirectorySearch(item, query))
        : visibleItems;
    return { visibleItems, displayItems, context: resolveDirectoryBatchContext(displayItems, selectedIds) };
};

export const flattenExpandedDirectoryNodes = (
    roots: LibraryDirectoryNode[],
    expandedIds: ReadonlySet<string>,
): LibraryDirectoryNode[] => {
    const flattened: LibraryDirectoryNode[] = [];

    const visit = (node: LibraryDirectoryNode) => {
        flattened.push(node);
        if (!expandedIds.has(node.id)) return;
        node.children.forEach(visit);
    };

    roots.forEach(visit);
    return flattened;
};

// Compacts single-child folder chains like VS Code while preserving actionable path identity.
export const compactDirectoryTrees = (
    roots: LibraryDirectoryNode[],
): LibraryDirectoryNode[] => {
    const compactNode = (
        source: LibraryDirectoryNode,
        visualDepth: number,
        preserveNode: boolean,
    ): LibraryDirectoryNode => {
        let terminal = source;
        const names = [source.name];

        if (!preserveNode) {
            while (!terminal.ignored && terminal.directTrackCount === 0 && terminal.children.length === 1 && !terminal.children[0].ignored) {
                terminal = terminal.children[0];
                names.push(terminal.name);
            }
        }

        return {
            ...terminal,
            name: names.join(' / '),
            depth: visualDepth,
            children: terminal.children.map(child => compactNode(child, visualDepth + 1, false)),
        };
    };

    return roots.map(root => compactNode(root, 0, true));
};

// Keeps search-matching folders and their ancestors so tree context is never lost.
export const filterDirectoryTreesByItems = (
    roots: LibraryDirectoryNode[],
    items: readonly LibraryDirectoryItem[],
    query = '',
): LibraryDirectoryNode[] => {
    const itemPaths = items.map(normalizeItemPath);

    const filterNode = (node: LibraryDirectoryNode): LibraryDirectoryNode | null => {
        const nodePath = normalizeNodePath(node.path);
        const children = node.children
            .map(filterNode)
            .filter((child): child is LibraryDirectoryNode => Boolean(child));
        const isContextOrMatch = itemPaths.some(path => (
            path === nodePath || path.startsWith(`${nodePath}/`)
        ));
        const matchesIgnoredFolder = node.ignored && query.trim() && matchesDirectorySearch(node, query);
        return isContextOrMatch || matchesIgnoredFolder || children.length > 0 ? { ...node, children } : null;
    };

    return roots.map(filterNode).filter((root): root is LibraryDirectoryNode => Boolean(root));
};

// Resolves one tree node against the currently filtered directory items and the selected ids.
export const resolveDirectoryNodeSelection = (
    nodePath: string,
    displayItems: readonly LibraryDirectoryItem[],
    selectedItemIds: ReadonlySet<string>,
): LibraryDirectoryNodeSelection => {
    const normalizedPath = normalizeNodePath(nodePath);
    const itemIds = displayItems
        .filter(item => {
            const itemPath = normalizeItemPath(item);
            return itemPath === normalizedPath || itemPath.startsWith(`${normalizedPath}/`);
        })
        .map(item => String(item.id));
    const directItemIds = displayItems
        .filter(item => normalizeItemPath(item) === normalizedPath)
        .map(item => String(item.id));
    const selectedCount = itemIds.reduce(
        (count, itemId) => count + (selectedItemIds.has(itemId) ? 1 : 0),
        0,
    );
    const directSelectedCount = directItemIds.reduce(
        (count, itemId) => count + (selectedItemIds.has(itemId) ? 1 : 0),
        0,
    );
    const hasOnlyDirectItemsSelected = directItemIds.length > 0
        && directSelectedCount === directItemIds.length
        && selectedCount === directSelectedCount;

    return {
        itemIds,
        directItemIds,
        selectedCount,
        state: selectedCount === 0
            ? 'none'
            : selectedCount === itemIds.length
                ? 'all'
                : hasOnlyDirectItemsSelected
                    ? 'direct'
                    : 'partial',
    };
};

// Cycles a directory between subtree selection, no selection, and direct tracks only.
export const resolveNextDirectoryNodeSelectionTarget = (
    selection: LibraryDirectoryNodeSelection,
): LibraryDirectoryNodeSelectionTarget => {
    if (selection.state === 'all') return 'none';
    if (selection.state === 'none' && selection.directItemIds.length > 0 && selection.directItemIds.length < selection.itemIds.length) {
        return 'direct';
    }
    return 'all';
};

const LOCAL_FOLDER_BATCH_ACTIONS: LibraryDirectoryBatchActionId[] = [
    'play',
    'enqueue',
    'create-playlist',
    'remove',
    'rescan-root',
    'remove-root',
    'clear-ignore',
];
const TRACK_BATCH_ACTIONS: LibraryDirectoryBatchActionId[] = ['play', 'enqueue', 'create-playlist'];

/**
 * 一个 section 提供的批量动作，按固定顺序（面板按钮与命令都按这个顺序）。
 * 批量 section 都是本地曲库的：文件夹有全部七个（删除、重扫根、移除根、恢复忽略目录只对文件夹有意义），
 * 专辑与歌手只有播放、入队、新建歌单。
 */
export const resolveDirectoryBatchActions = (
    config: { selectionType: LibraryDirectorySelectionType },
): LibraryDirectoryBatchActionId[] => (
    config.selectionType === 'folders' ? [...LOCAL_FOLDER_BATCH_ACTIONS] : [...TRACK_BATCH_ACTIONS]
);

/** 落在选中范围的歌上的动作：范围里没歌、或别的动作还在进行时都不可用。 */
const TRACK_SCOPE_ACTIONS = new Set<LibraryDirectoryBatchActionId>(['play', 'enqueue', 'create-playlist', 'remove']);

/** 批量能力：面板的按钮与目录命令面板都读它（同一个来源，不各自判断）。 */
export const resolveDirectoryBatchCapabilities = (
    config: { selectionType: LibraryDirectorySelectionType },
    context: Pick<LibraryDirectoryBatchContext, 'trackIds'>,
    pending: LibraryDirectoryBatchPending | null,
): LibraryDirectoryBatchCapabilities => ({
    actions: resolveDirectoryBatchActions(config),
    pending,
    canUseTracks: context.trackIds.length > 0 && !pending,
});

/** 这个动作此刻能不能对选中范围用（只看范围类动作；根上的动作由目录树那一行自己判断）。 */
export const canRunDirectoryBatchAction = (
    capabilities: LibraryDirectoryBatchCapabilities,
    action: LibraryDirectoryBatchActionId,
): boolean => capabilities.actions.includes(action)
    && (!TRACK_SCOPE_ACTIONS.has(action) || capabilities.canUseTracks);

const UNSUPPORTED: LibraryMutationResult = { ok: false, reason: 'unsupported' };

/**
 * 把一个批量动作分派到配置里的控制器（面板按钮、命令面板、探针走同一个入口）。
 * section 不支持的动作、根上的动作缺参数时返回 unsupported，不调控制器。
 * 删除与恢复忽略目录之后的视图收尾（afterAction）在控制器的 pending 期间执行。
 */
export const runDirectoryBatchAction = (
    config: LibraryDirectoryBatchConfig,
    action: LibraryDirectoryBatchActionId,
    context: LibraryDirectoryBatchContext,
    arg?: string,
): Promise<LibraryMutationResult> => {
    if (!resolveDirectoryBatchActions(config).includes(action)) return Promise.resolve(UNSUPPORTED);
    const { controller } = config;
    const after = config.afterAction ? { after: () => config.afterAction?.(action) } : undefined;
    switch (action) {
        case 'play': return controller.play(context);
        case 'enqueue': return controller.enqueue(context);
        case 'create-playlist': return arg?.trim() ? controller.createPlaylist(arg, context) : Promise.resolve(UNSUPPORTED);
        case 'remove': return controller.remove(context, after);
        case 'rescan-root': return arg ? controller.rescanRoot(arg, after) : Promise.resolve(UNSUPPORTED);
        case 'remove-root': return arg ? controller.removeRoot(arg, after) : Promise.resolve(UNSUPPORTED);
        case 'clear-ignore': return arg ? controller.clearIgnore(arg, after) : Promise.resolve(UNSUPPORTED);
    }
    return Promise.resolve(UNSUPPORTED);
};
