import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleDot, ListPlus, Minus, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { List as VirtualList, type RowComponentProps } from 'react-window';
import { createPortal } from 'react-dom';
import ConfirmDialog from '../../../../components/shared/ConfirmDialog';
import TextInputDialog from '../../../../components/shared/TextInputDialog';
import GridMapBatchItemList from './GridMapBatchItemList';
import type { GridMapBatchConfig, GridMapBatchContext, GridMapItem } from './GridMap';
import type { LibraryDirectoryBatchActionId, LibraryDirectoryNode } from '../../../core/directory/directory.contract';
import { compactDirectoryTrees, filterDirectoryTreesByItems, flattenExpandedDirectoryNodes, resolveDirectoryNodeSelection, resolveNextDirectoryNodeSelectionTarget } from '../../../core/directory/directoryBatch';
import { useLibraryDirectoryActions } from '../../../core/directory/useLibraryDirectoryActions';

// src/library/suites/grid/directory/GridMapBatchPanel.tsx
// GridMap 的批量面板：全选、目录树 / 条目清单的勾选、批量按钮与确认框。选择按 id 存在目录会话里，
// 动作经 core 的批量控制器（useLibraryDirectoryActions）：按钮可用与否、哪一行在转圈都读它的能力与 pending。

interface GridMapBatchPanelProps {
    title: string;
    context: GridMapBatchContext;
    totalItemCount: number;
    searchQuery: string;
    displayItems: GridMapItem[];
    /** 选中的条目 id（目录会话里的批选）。 */
    selectedItemIds: ReadonlySet<string>;
    config: GridMapBatchConfig;
    isDaylight: boolean;
    onToggleSelectAll: (selected: boolean) => void;
    onSetItemsSelected: (itemIds: string[], selected: boolean) => void;
    /** 「从曲库删除」的确认框是否打开（由 GridMap 持有，命令面板的删除命令也只是打开它）。 */
    isRemoveConfirmOpen: boolean;
    onRemoveConfirmOpenChange: (open: boolean) => void;
}

interface DirectoryRowProps {
    nodes: LibraryDirectoryNode[];
    expandedIds: Set<string>;
    busyRootPath: string | null;
    displayItems: GridMapItem[];
    selectedItemIds: ReadonlySet<string>;
    onToggleExpanded: (id: string) => void;
    onSetItemsSelected: GridMapBatchPanelProps['onSetItemsSelected'];
    onRescanRoot?: (rootPath: string) => void;
    onClearFolderIgnore?: (folderPath: string) => void;
    onRequestRemoveRoot?: (path: string) => void;
}

const DirectoryRow = ({
    index,
    style,
    ariaAttributes,
    nodes,
    expandedIds,
    busyRootPath,
    displayItems,
    selectedItemIds,
    onToggleExpanded,
    onSetItemsSelected,
    onRescanRoot,
    onClearFolderIgnore,
    onRequestRemoveRoot,
}: RowComponentProps<DirectoryRowProps>) => {
    const { t } = useTranslation();
    const node = nodes[index];
    const hasChildren = node.children.length > 0;
    const isRoot = node.depth === 0;
    const isBusy = busyRootPath === node.rootPath;
    const selection = resolveDirectoryNodeSelection(node.path, displayItems, selectedItemIds);
    const isSelectionDisabled = selection.itemIds.length === 0;
    const nextSelectionTarget = resolveNextDirectoryNodeSelectionTarget(selection);

    const cycleSelection = () => {
        if (nextSelectionTarget === 'none') {
            onSetItemsSelected(selection.itemIds, false);
            return;
        }
        if (nextSelectionTarget === 'direct') {
            onSetItemsSelected(selection.directItemIds, true);
            return;
        }
        onSetItemsSelected(selection.itemIds, true);
    };

    return (
        <div {...ariaAttributes} style={style} className="px-1 py-0.5">
            <div className="flex h-full items-center gap-1 rounded-xl px-1.5 hover:bg-black/5 dark:hover:bg-white/5">
                <button
                    type="button"
                    onClick={() => hasChildren && onToggleExpanded(node.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg opacity-55"
                    style={{ marginLeft: Math.min(node.depth, 4) * 12 }}
                    aria-label={t('home.gridFolderTreeToggle')}
                >
                    {hasChildren ? (expandedIds.has(node.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                </button>
                <button
                    type="button"
                    disabled={isSelectionDisabled}
                    onClick={cycleSelection}
                    role="checkbox"
                    aria-checked={selection.state === 'all' ? true : selection.state === 'none' ? false : 'mixed'}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                    title={node.path}
                >
                    <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-colors ${
                        selection.state === 'all'
                            ? 'border-sky-500 bg-sky-500 text-white'
                                : selection.state === 'direct'
                                    ? 'border-violet-500/70 bg-violet-500/20 text-violet-500'
                                    : selection.state === 'partial'
                                        ? 'border-sky-500/60 bg-sky-500/20 text-sky-500'
                                        : 'border-current/20'
                    } ${isSelectionDisabled ? 'opacity-25' : ''}`}>
                        {selection.state === 'all' && <Check size={12} strokeWidth={3} />}
                        {selection.state === 'direct' && <CircleDot size={12} strokeWidth={2.5} />}
                        {selection.state === 'partial' && <Minus size={12} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className={`block truncate text-xs font-semibold ${node.ignored ? 'line-through opacity-40' : ''}`}>{node.name}</span>
                        <span className="block truncate text-[10px] opacity-45">
                            {node.ignored ? t('home.gridFolderIgnored') : selection.state === 'direct'
                                ? t('home.gridFolderTreeDirectSelection', { count: node.directTrackCount })
                                : selection.itemIds.length > 0
                                    ? t('home.gridFolderTreeSelectionCount', { selected: selection.selectedCount, total: selection.itemIds.length })
                                    : t('home.gridFolderTrackCount', { count: node.totalTrackCount })}
                        </span>
                    </span>
                </button>
                {node.ignored && onClearFolderIgnore && (
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onClearFolderIgnore(node.path)}
                        className="rounded-lg p-1.5 opacity-55 transition hover:opacity-100 disabled:opacity-20"
                        title={t('home.gridFolderClearIgnore')}
                        aria-label={t('home.gridFolderClearIgnore')}
                    >
                        <RefreshCw size={13} className={isBusy ? 'animate-spin' : ''} />
                    </button>
                )}
                {isRoot && onRescanRoot && (
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onRescanRoot(node.rootPath)}
                        className="rounded-lg p-1.5 opacity-45 transition hover:opacity-100 disabled:opacity-20"
                        title={t('home.gridFolderRescanRoot')}
                    >
                        <RefreshCw size={13} className={isBusy ? 'animate-spin' : ''} />
                    </button>
                )}
                {isRoot && onRequestRemoveRoot && (
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onRequestRemoveRoot(node.rootPath)}
                        className="rounded-lg p-1.5 text-red-500 opacity-55 transition hover:opacity-100 disabled:opacity-20"
                        title={t('home.gridFolderRemoveRoot')}
                    >
                        <X size={13} />
                    </button>
                )}
            </div>
        </div>
    );
};

export const GridMapBatchPanel = ({
    title,
    context,
    totalItemCount,
    searchQuery,
    displayItems,
    selectedItemIds,
    config,
    isDaylight,
    onToggleSelectAll,
    onSetItemsSelected,
    isRemoveConfirmOpen: confirmRemove,
    onRemoveConfirmOpenChange: setConfirmRemove,
}: GridMapBatchPanelProps) => {
    const { t } = useTranslation();
    const [showPlaylistDialog, setShowPlaylistDialog] = useState(false);
    const [isTreeExpanded, setIsTreeExpanded] = useState(false);
    const [rootToRemove, setRootToRemove] = useState<string | null>(null);
    // 能力与进行中的动作来自 core 的批量控制器（命令面板读同一份）。
    const { capabilities, run } = useLibraryDirectoryActions(config, context);
    const pending = capabilities?.pending ?? null;
    const actions = capabilities?.actions ?? [];
    const busyRootPath = pending?.rootPath ?? null;
    const [expandedIds, setExpandedIds] = useState<Set<string>>(
        () => new Set((config.directoryTrees || []).map(node => node.id)),
    );
    const visibleDirectoryTrees = useMemo(
        () => searchQuery.trim()
            ? filterDirectoryTreesByItems(config.directoryTrees || [], displayItems, searchQuery)
            : config.directoryTrees || [],
        [config.directoryTrees, displayItems, searchQuery],
    );
    const compactedDirectoryTrees = useMemo(
        () => compactDirectoryTrees(visibleDirectoryTrees),
        [visibleDirectoryTrees],
    );
    const directoryNodes = useMemo(
        () => flattenExpandedDirectoryNodes(compactedDirectoryTrees, expandedIds),
        [compactedDirectoryTrees, expandedIds],
    );

    useEffect(() => {
        setExpandedIds(current => {
            const next = new Set(current);
            (config.directoryTrees || []).forEach(root => next.add(root.id));
            return next.size === current.size ? current : next;
        });
    }, [config.directoryTrees]);
    const canUseTracks = Boolean(capabilities?.canUseTracks);
    const usesDirectoryTree = config.selectionType === 'folders';
    const allSelectionState = context.items.length === 0
        ? 'none'
        : context.items.length === totalItemCount
            ? 'all'
            : 'partial';
    const dialogHost = typeof document === 'undefined' ? null : document.body;

    const runAction = (action: LibraryDirectoryBatchActionId, arg?: string) => {
        void run(action, arg);
    };

    const actionClass = 'flex w-full items-center justify-center gap-2 rounded-full bg-zinc-800/10 py-2.5 text-xs font-semibold transition hover:bg-zinc-900 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-zinc-100/10 dark:hover:bg-zinc-100 dark:hover:text-zinc-900';
    const primaryActionClass = 'flex w-full items-center justify-center gap-1.5 rounded-full py-3 text-xs font-bold shadow-md transition-transform hover:scale-102 active:scale-98 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:scale-100';

    return (
        <>
            <div className="min-w-0">
                <h3 className="line-clamp-2 text-xl font-bold leading-snug">{title}</h3>
                <p className="mt-1.5 text-[11px] opacity-50">
                    {t(`home.gridBatchSelectionSummary.${config.selectionType}`, {
                        selected: context.items.length,
                        total: totalItemCount,
                        tracks: context.trackIds.length,
                    })}
                </p>
            </div>

            <div
                data-ponder={usesDirectoryTree ? 'local-grid-map-directory-tree' : undefined}
                className={`relative z-10 mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border backdrop-blur-2xl transition-[width,background-color,box-shadow] duration-200 ${
                    usesDirectoryTree && isTreeExpanded
                        ? 'w-[min(44rem,calc(100vw-4.5rem))] shrink-0 border-black/10 bg-white/90 shadow-2xl dark:border-white/15 dark:bg-zinc-900/95'
                        : 'w-full border-black/5 bg-black/[0.025] dark:border-white/10 dark:bg-black/10'
                }`}
            >
                <div className="flex h-9 items-center justify-between border-b border-black/5 px-3 dark:border-white/10">
                    <button
                        type="button"
                        role="checkbox"
                        aria-checked={allSelectionState === 'partial' ? 'mixed' : allSelectionState === 'all'}
                        onClick={() => onToggleSelectAll(allSelectionState !== 'all')}
                        className="flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-[11px] font-semibold transition hover:opacity-75"
                    >
                        <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-colors ${
                            allSelectionState === 'all'
                                ? 'border-sky-500 bg-sky-500 text-white'
                                : allSelectionState === 'partial'
                                    ? 'border-sky-500/60 bg-sky-500/20 text-sky-500'
                                    : 'border-current/20'
                        }`}>
                            {allSelectionState === 'all' && <Check size={12} strokeWidth={3} />}
                            {allSelectionState === 'partial' && <Minus size={12} strokeWidth={3} />}
                        </span>
                        {t('home.gridFolderSelectAll')}
                    </button>
                    {usesDirectoryTree && (
                        <button
                            type="button"
                            onClick={() => setIsTreeExpanded(value => !value)}
                            className="flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold opacity-55 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                            title={t(isTreeExpanded ? 'home.gridFolderCollapseTreePanel' : 'home.gridFolderExpandTreePanel')}
                            aria-expanded={isTreeExpanded}
                        >
                            {isTreeExpanded ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
                            {t(isTreeExpanded ? 'home.gridFolderCollapseTreePanel' : 'home.gridFolderExpandTreePanel')}
                        </button>
                    )}
                </div>
                <div className="h-[calc(100%-2.25rem)] min-h-0">
                    {!usesDirectoryTree ? (
                        <GridMapBatchItemList
                            items={displayItems}
                            selectedItemIds={selectedItemIds}
                            onSetItemsSelected={onSetItemsSelected}
                        />
                    ) : directoryNodes.length > 0 ? (
                        <VirtualList
                            style={{ height: '100%', minHeight: 144, width: '100%' }}
                            rowCount={directoryNodes.length}
                            rowHeight={48}
                            rowProps={{
                                nodes: directoryNodes,
                                expandedIds,
                                busyRootPath,
                                displayItems,
                                selectedItemIds,
                                onToggleExpanded: id => setExpandedIds(current => {
                                    const next = new Set(current);
                                    if (next.has(id)) next.delete(id); else next.add(id);
                                    return next;
                                }),
                                onSetItemsSelected,
                                onClearFolderIgnore: actions.includes('clear-ignore')
                                    ? folderPath => runAction('clear-ignore', folderPath)
                                    : undefined,
                                onRescanRoot: actions.includes('rescan-root')
                                    ? rootPath => runAction('rescan-root', rootPath)
                                    : undefined,
                                onRequestRemoveRoot: actions.includes('remove-root') ? setRootToRemove : undefined,
                            }}
                            rowComponent={DirectoryRow}
                            className="custom-scrollbar"
                        />
                    ) : (
                        <div className="flex h-full min-h-36 items-center justify-center px-4 text-center text-xs opacity-45">
                            {t('home.gridFolderTreeEmpty')}
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-3 space-y-2 border-t pt-4" style={{ borderTopColor: 'color-mix(in srgb, var(--text-primary) 12%, transparent)' }}>
                <button
                    type="button"
                    disabled={!canUseTracks}
                    onClick={() => runAction('play')}
                    className={primaryActionClass}
                    style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                >
                    <Play size={14} fill="currentColor" />
                    {t('playlist.playFilteredTracks', { count: context.trackIds.length })}
                </button>
                <button type="button" disabled={!canUseTracks} onClick={() => runAction('enqueue')} className={actionClass}>
                    <ListPlus size={14} />
                    {t('playlist.addFilteredTracksToQueue', { count: context.trackIds.length })}
                </button>
                <button type="button" disabled={!canUseTracks} onClick={() => setShowPlaylistDialog(true)} className={actionClass}>
                    <Plus size={14} />{t('localMusic.createPlaylist')}
                </button>
                {actions.includes('remove') && (
                    <button type="button" disabled={!canUseTracks} onClick={() => setConfirmRemove(true)} className={`${actionClass} !text-red-500 hover:!bg-red-500 hover:!text-white`}>
                        <Trash2 size={14} />{t('home.gridFolderRemoveSelected')}
                    </button>
                )}
            </div>

            {dialogHost && createPortal((
                <>
                    <TextInputDialog
                        isOpen={showPlaylistDialog}
                        title={t('localMusic.createPlaylist')}
                        description={t('home.gridFolderCreatePlaylistDescription', { count: context.trackIds.length })}
                        placeholder={t('home.gridFolderPlaylistNamePlaceholder')}
                        confirmLabel={t('localMusic.createPlaylist')}
                        isDaylight={isDaylight}
                        onClose={() => setShowPlaylistDialog(false)}
                        onConfirm={async name => {
                            const result = await run('create-playlist', name);
                            // 没做成就让对话框留着（与原先动作抛错时一样：对话框只在 onConfirm 正常返回后关闭）。
                            if (!result.ok) throw new Error(result.message ?? result.reason);
                        }}
                    />

                    {actions.includes('remove') && (
                        <ConfirmDialog
                            isOpen={confirmRemove}
                            title={t('home.gridFolderRemoveSelectedTitle')}
                            description={t('home.gridFolderRemoveSelectedDescription', { count: context.trackIds.length })}
                            confirmText={t('home.gridFolderRemoveSelected')}
                            confirmVariant="danger"
                            isDaylight={isDaylight}
                            onClose={() => setConfirmRemove(false)}
                            onConfirm={() => {
                                setConfirmRemove(false);
                                runAction('remove');
                            }}
                        />
                    )}

                    <ConfirmDialog
                        isOpen={Boolean(rootToRemove)}
                        title={t('home.gridFolderRemoveRootTitle')}
                        description={t('home.gridFolderRemoveRootDescription', { path: rootToRemove || '' })}
                        confirmText={t('home.gridFolderRemoveRoot')}
                        confirmVariant="danger"
                        isDaylight={isDaylight}
                        onClose={() => setRootToRemove(null)}
                        onConfirm={() => {
                            const rootPath = rootToRemove;
                            setRootToRemove(null);
                            if (rootPath) runAction('remove-root', rootPath);
                        }}
                    />
                </>
            ), dialogHost)}
        </>
    );
};

export default GridMapBatchPanel;
