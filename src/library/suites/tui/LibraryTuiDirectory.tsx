import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, useListRef } from 'react-window';
import { useTranslation } from 'react-i18next';
import type {
    LibraryDirectoryBatchActionId,
    LibraryDirectoryBatchConfig,
    LibraryDirectoryFocusedTarget,
    LibraryDirectoryNode,
    LibraryHiddenScope,
} from '../../core/directory/directory.contract';
import type { LibraryHomeCard } from '../../core/home/homeModel.contract';
import type { LibraryDeclaredActions } from '../../core/suite/suite.contract';
import { homeCardToDirectoryItem } from '../../core/directory/directoryItems';
import { resolveDirectoryRows, type LibraryDirectoryRow } from '../../core/directory/directoryTree';
import {
    resolveDirectoryBatchContext,
    resolveDirectoryNodeSelection,
    runDirectoryBatchAction,
} from '../../core/directory/directoryBatch';
import { isHideableDirectoryItem } from '../../core/directory/directoryVisibility';
import { filterDeclaredDirectorySurfaceActions, resolveDirectorySurfaceActions } from '../../core/directory/directorySurface';
import { useLibraryDirectorySessionStore } from '../../core/directory/useLibraryDirectorySessionStore';
import { useLibraryDirectoryQuery } from '../../core/directory/useLibraryDirectoryQuery';
import { useLibraryDirectorySelection } from '../../core/directory/useLibraryDirectorySelection';
import { useLibraryDirectoryVisibility } from '../../core/directory/useLibraryDirectoryVisibility';
import { useLibraryDirectoryScope } from '../../core/directory/useLibraryDirectoryScope';
import { useLibraryDirectoryActions } from '../../core/directory/useLibraryDirectoryActions';
import { useLibraryDirectorySurfaceRegistration } from '../../core/directory/useLibraryDirectorySurfaceRegistration';
import { useHiddenCollections } from '../../core/collection/useHiddenCollections';
import { useCommittedQuery } from '../../core/shared/useCommittedQuery';
import { useGridCommandFilter } from '../../../hooks/useGridCommandFilter';
import { colorWithAlpha } from '../../../components/visualizer/colorMix';
import LibraryTuiHomeRow, {
    LIBRARY_TUI_HOME_COLUMNS,
    LIBRARY_TUI_HOME_ROW_HEIGHT,
    type LibraryTuiDirectoryEntry,
    type LibraryTuiHomeRowProps,
} from './LibraryTuiHomeRow';
import LibraryTuiPrompt, { type LibraryTuiPromptRequest } from './LibraryTuiPrompt';
import { useLibraryTuiDirectoryKeys } from './useLibraryTuiHomeKeyboard';

// src/library/suites/tui/LibraryTuiDirectory.tsx
// TUI 首页的目录列表（网格的 GridMap 在 TUI 里的对应物）：当前页签 / section 的条目排成等宽列表，本地文件夹排成
// 可展开的目录树。数据与行为全部来自 Library Core：
// - 筛选词、批选、隐藏视图是目录会话（core/directory/useLibraryDirectorySessionStore，按目录 key），与 GridMap 读写
//   同一份——网格里筛选、选中后切到 TUI，看到的是同一个范围；筛选经命令面板（与 GridMap 同一个 useGridCommandFilter）。
// - 「目录打开 / 关闭」：TUI 的目录视图一直开着，显示哪个目录就 openDirectory 哪个（已经打开着就接着用它的会话）；
//   Esc 先清筛选词，再按一次是关闭目录（closeDirectory：丢掉选择与管理隐藏视图，然后重新打开一个空会话）。
//   与网格里关掉 GridMap 丢掉会话是同一条规则。
// - 范围 = 可见（去隐藏）→ 筛选 → 选中（useLibraryDirectoryScope）；批量动作经批量控制器（useLibraryDirectoryActions /
//   runDirectoryBatchAction），pending 与重复提交保护在控制器里；命令面板的目录 surface 与键盘同源。
// - 条目与 GridMap 同一个映射（core/directory/directoryItems），行由 core/directory/directoryTree 排出来。
// 这里不引用网格的任何实现。

/** 每个目录最后的焦点（行 key），切 section、打开集合再回来、换 suite 再回来都落在原来那一项上。 */
const focusMemory = new Map<string, string>();

type LibraryTuiDirectoryProps = {
    /** 目录会话 key（core/home/homeSources 的 resolveHomeDirectoryKey）。 */
    directoryKey: string;
    hiddenScope: LibraryHiddenScope;
    /** 当前页签 / section 的全部卡片（隐藏的也在）。 */
    items: LibraryHomeCard[];
    isLoading: boolean;
    emptyMessage: string;
    /** 本地 folders / albums / artists 的批量配置（其余目录没有批量）。 */
    batchConfig?: LibraryDirectoryBatchConfig;
    /** 本地文件夹的目录树（给了就排成树）。 */
    directoryTrees?: LibraryDirectoryNode[];
    declaredActions: LibraryDeclaredActions;
    isInteractive: boolean;
    accentColor: string;
    isDaylight: boolean;
    /** 打开一张卡（Enter / 双击）：交给首页动作控制器（私人 FM 直接播放，其余打开集合）。 */
    onOpen: (card: LibraryHomeCard) => void;
    /** 提示状态由页面持有（页面级的按键在提示开着时让路）。 */
    prompt: LibraryTuiPromptRequest | null;
    onPromptChange: (prompt: LibraryTuiPromptRequest | null) => void;
};

const toEntry = (card: LibraryHomeCard): LibraryTuiDirectoryEntry => ({ ...homeCardToDirectoryItem(card), card });

const LibraryTuiDirectory: React.FC<LibraryTuiDirectoryProps> = ({
    directoryKey,
    hiddenScope,
    items,
    isLoading,
    emptyMessage,
    batchConfig,
    directoryTrees,
    declaredActions,
    isInteractive,
    accentColor,
    isDaylight,
    onOpen,
    prompt,
    onPromptChange,
}) => {
    const { t } = useTranslation();
    const listRegionRef = useRef<HTMLDivElement>(null);
    const listRef = useListRef(null);

    // 显示的就是打开着的目录：挂载、切 section 时打开它（已经打开着——例如刚从网格的 GridMap 切过来——就接着用）。
    useEffect(() => {
        useLibraryDirectorySessionStore.getState().openDirectory(directoryKey);
    }, [directoryKey]);

    const { query, setQuery, port: queryPort } = useLibraryDirectoryQuery(directoryKey);
    // 筛选框贴在列表区域上；会话里已有筛选时首次可交互就把它带出来（例如从 GridMap 切过来）。
    const isFiltering = useGridCommandFilter({
        isInteractive,
        port: queryPort,
        anchorRef: listRegionRef,
        reopenIfFiltered: true,
    });
    const committedQuery = useCommittedQuery(query);
    const { selectedIds, setSelected, toggleSelected, replaceSelection } = useLibraryDirectorySelection(directoryKey);
    const { visibilityMode, setVisibilityMode, toggleManageHidden } = useLibraryDirectoryVisibility(directoryKey);
    const { hiddenIds, toggleHidden } = useHiddenCollections(hiddenScope);

    const entries = useMemo(() => items.map(toEntry), [items]);
    const hasHideableItems = useMemo(() => entries.some(isHideableDirectoryItem), [entries]);
    const { displayItems, context } = useLibraryDirectoryScope({
        items: entries,
        hiddenIds,
        visibilityMode,
        query: committedQuery,
        selectedIds,
    });
    const { capabilities, run } = useLibraryDirectoryActions(batchConfig, context);

    const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
    const rows = useMemo(() => resolveDirectoryRows({
        displayItems,
        trees: batchConfig?.selectionType === 'folders' ? directoryTrees : undefined,
        query: committedQuery,
        collapsedIds,
    }), [batchConfig?.selectionType, collapsedIds, committedQuery, directoryTrees, displayItems]);

    // 焦点按行 key 记（条目是 `item:${id}`，树节点是 `node:${id}`）；找不到时落在第一行。
    const [focusedKey, setFocusedKey] = useState<string | null>(() => focusMemory.get(directoryKey) ?? null);
    const [focusKeyOwner, setFocusKeyOwner] = useState(directoryKey);
    if (focusKeyOwner !== directoryKey) {
        setFocusKeyOwner(directoryKey);
        setFocusedKey(focusMemory.get(directoryKey) ?? null);
    }
    const foundRow = focusedKey ? rows.findIndex(row => row.key === focusedKey) : -1;
    const focusedRow = rows.length === 0 ? -1 : Math.max(foundRow, 0);
    const focused: LibraryDirectoryRow<LibraryTuiDirectoryEntry> | undefined = rows[focusedRow];
    useEffect(() => {
        if (focused) focusMemory.set(directoryKey, focused.key);
    }, [directoryKey, focused]);

    const moveFocus = useCallback((resolve: (current: number) => number) => {
        if (rows.length === 0) return;
        const next = Math.max(0, Math.min(resolve(Math.max(focusedRow, 0)), rows.length - 1));
        setFocusedKey(rows[next]?.key ?? null);
    }, [focusedRow, rows]);
    const focusRow = useCallback((row: number) => moveFocus(() => row), [moveFocus]);

    const setExpanded = (row: LibraryDirectoryRow<LibraryTuiDirectoryEntry>, expanded: boolean) => {
        const nodeId = row.node?.id;
        if (!nodeId || !row.expandable) return;
        setCollapsedIds(current => {
            if (current.has(nodeId) === !expanded) return current;
            const next = new Set(current);
            if (expanded) next.delete(nodeId); else next.add(nodeId);
            return next;
        });
    };

    const openRow = (index: number) => {
        const row = rows[index];
        if (!row) return;
        focusRow(index);
        if (row.kind === 'item') onOpen(row.item.card);
        else setExpanded(row, !row.expanded);
    };

    /** 这一行代表的条目 id（条目是它自己；树节点是子树里显示着的全部条目）。 */
    const itemIdsOfRow = (row: LibraryDirectoryRow<LibraryTuiDirectoryEntry>): string[] => (
        row.kind === 'item'
            ? [String(row.item.id)]
            : resolveDirectoryNodeSelection(row.node.path, displayItems, new Set()).itemIds
    );

    const runBatch = useCallback((action: LibraryDirectoryBatchActionId, arg?: string) => {
        void run(action, arg);
    }, [run]);

    // Ctrl+Enter：有选中时播放 / 入队选中的范围，没有时是焦点那一行（条目或树节点的子树）的全部歌。
    const playScope = (enqueue: boolean) => {
        if (!batchConfig || !focused) return;
        const action = enqueue ? 'enqueue' : 'play';
        if (context.items.length > 0) {
            runBatch(action);
            return;
        }
        const scope = resolveDirectoryBatchContext(displayItems, new Set(itemIdsOfRow(focused)));
        void runDirectoryBatchAction(batchConfig, action, scope);
    };

    const toggleFocusedSelection = () => {
        if (!batchConfig || !focused) return;
        const ids = itemIdsOfRow(focused);
        if (focused.kind === 'item') {
            toggleSelected(ids[0]);
        } else if (ids.length > 0) {
            const selection = resolveDirectoryNodeSelection(focused.node.path, displayItems, selectedIds);
            setSelected(ids, selection.state !== 'all');
        }
        moveFocus(index => index + 1);
    };

    const collapseFocused = () => {
        if (!focused) return;
        if (focused.expandable && focused.expanded) {
            setExpanded(focused, false);
            return;
        }
        if (focused.parentKey) setFocusedKey(focused.parentKey);
    };
    const expandFocused = () => {
        if (!focused?.expandable) return;
        if (!focused.expanded) setExpanded(focused, true);
        else moveFocus(index => index + 1);
    };

    const focusedTarget: LibraryDirectoryFocusedTarget | null = focused ? {
        hideable: focused.kind === 'item' && isHideableDirectoryItem(focused.item),
        rootPath: focused.node && focused.depth === 0 && !focused.node.ignored ? focused.node.rootPath : undefined,
        ignoredPath: focused.node?.ignored ? focused.node.path : undefined,
    } : null;

    const requestRemoveSelection = () => onPromptChange({
        kind: 'confirm',
        id: 'remove-selection',
        message: t('libraryTui.confirmRemoveSelection', { count: context.trackIds.length }),
    });
    const requestRemoveRoot = (rootPath: string) => onPromptChange({
        kind: 'confirm',
        id: `remove-root:${rootPath}`,
        message: t('libraryTui.confirmRemoveRoot', { path: rootPath }),
    });
    const requestCreatePlaylist = () => onPromptChange({
        kind: 'text',
        id: 'create-playlist',
        label: t('libraryTui.createPlaylistPrompt'),
    });

    const submitPrompt = async (value: string) => {
        if (!prompt || prompt.kind === 'rename' || prompt.kind === 'confirm-delete') return;
        if (prompt.kind === 'text') {
            const name = value.trim();
            if (!name) return;
            // 没建成就留在提示里（与网格的对话框一样：只在成功之后关闭）。
            const result = await run('create-playlist', name);
            if (result.ok) onPromptChange(null);
            return;
        }
        onPromptChange(null);
        if (prompt.id === 'remove-selection') runBatch('remove');
        else if (prompt.id.startsWith('remove-root:')) runBatch('remove-root', prompt.id.slice('remove-root:'.length));
    };

    // 命令面板的目录 surface：动作 = core 判定（与键盘、行内入口同源）∩ 这套 suite 声明的首页动作。
    const availableActions = filterDeclaredDirectorySurfaceActions(resolveDirectorySurfaceActions({
        capabilities,
        context,
        displayItemCount: displayItems.length,
        selectedItemCount: selectedIds.size,
        hasHideableItems,
        focused: focusedTarget,
    }), declaredActions);
    useLibraryDirectorySurfaceRegistration({
        isInteractive,
        getState: () => ({
            directoryKey,
            availableActions,
            displayItemCount: displayItems.length,
            selectedItemCount: selectedIds.size,
            selectedTrackCount: context.trackIds.length,
            visibilityMode,
        }),
        run: (action, input) => {
            if (!availableActions.includes(action)) return false;
            switch (action) {
                case 'play-selection':
                    runBatch('play');
                    return true;
                case 'enqueue-selection':
                    runBatch('enqueue');
                    return true;
                case 'create-playlist': {
                    const name = input?.trim();
                    if (!name) return false;
                    runBatch('create-playlist', name);
                    return true;
                }
                case 'remove-selection':
                    requestRemoveSelection();
                    return true;
                case 'select-all':
                    replaceSelection(displayItems.map(item => String(item.id)));
                    return true;
                case 'clear-selection':
                    replaceSelection([]);
                    return true;
                case 'manage-hidden':
                    toggleManageHidden();
                    return true;
                case 'toggle-hidden':
                    if (focused?.kind !== 'item') return false;
                    toggleHidden(focused.item);
                    return true;
                case 'rescan-root':
                    if (!focusedTarget?.rootPath) return false;
                    runBatch('rescan-root', focusedTarget.rootPath);
                    return true;
                case 'remove-root':
                    if (!focusedTarget?.rootPath) return false;
                    requestRemoveRoot(focusedTarget.rootPath);
                    return true;
                case 'clear-ignore':
                    if (!focusedTarget?.ignoredPath) return false;
                    runBatch('clear-ignore', focusedTarget.ignoredPath);
                    return true;
            }
            return false;
        },
    });

    const listHeight = listRegionRef.current?.clientHeight ?? 560;
    useLibraryTuiDirectoryKeys({
        isActive: isInteractive,
        isFiltering,
        isPromptOpen: prompt !== null,
        rowCount: rows.length,
        pageSize: Math.max(1, Math.floor(listHeight / LIBRARY_TUI_HOME_ROW_HEIGHT) - 1),
        moveFocus,
        onCollapse: collapseFocused,
        onExpand: expandFocused,
        onOpenFocused: () => openRow(focusedRow),
        onToggleSelect: toggleFocusedSelection,
        onSelectAll: () => {
            if (batchConfig) replaceSelection(displayItems.map(item => String(item.id)));
        },
        onPlayScope: playScope,
        // 先收起行内提示，再撤掉筛选词，最后关闭目录（丢掉选择与管理隐藏视图，重新打开一个空会话）。
        onEscape: () => {
            if (prompt) {
                onPromptChange(null);
            } else if (query) {
                setQuery('');
            } else {
                const store = useLibraryDirectorySessionStore.getState();
                store.closeDirectory(directoryKey);
                store.openDirectory(directoryKey);
            }
        },
    });

    // 等 react-window 量好视口再定位：刚挂载（例如从网格切过来）时列表还没有高度。
    useEffect(() => {
        if (focusedRow < 0) return;
        const frame = window.requestAnimationFrame(() => {
            listRef.current?.scrollToRow({ index: focusedRow, align: 'smart', behavior: 'instant' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [focusedRow, rows.length, listRef]);

    const typeLabel = useCallback((type: string | undefined) => (
        type ? t(`libraryTui.itemType.${type}`, { defaultValue: type }) : ''
    ), [t]);
    const rowProps = useMemo<LibraryTuiHomeRowProps>(() => ({
        rows,
        displayItems,
        focusedRow,
        selectedIds,
        hiddenIds,
        showSelection: Boolean(batchConfig),
        accentBackground: colorWithAlpha(accentColor, isDaylight ? 0.16 : 0.22),
        accentColor,
        typeLabel,
        ignoredLabel: t('libraryTui.ignoredFolder'),
        hiddenLabel: t('libraryTui.hiddenMark'),
        hideLabel: t('libraryTui.hide'),
        unhideLabel: t('libraryTui.unhide'),
        onFocusRow: focusRow,
        onActivateRow: openRow,
        onToggleHidden: hasHideableItems ? toggleHidden : undefined,
    // openRow 每次渲染都是新函数，但它只读当前的 rows 与回调。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [accentColor, batchConfig, displayItems, focusRow, focusedRow, hasHideableItems, hiddenIds, isDaylight, rows, selectedIds, t, toggleHidden, typeLabel]);

    const pending = capabilities?.pending ?? null;
    const isManaging = visibilityMode !== 'browse';
    const emptyText = isLoading ? t('home.loadingLibrary') : query ? t('home.gridSearchNoResults') : emptyMessage;

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-tui-directory={directoryKey}>
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-current/10 px-4 py-1 text-[12px]">
                <span className="opacity-50" data-tui-home-count>
                    {t('libraryTui.homeShown', { shown: displayItems.length, total: entries.length })}
                </span>
                {query ? <span data-tui-filter style={{ color: accentColor }}>{t('libraryTui.filter', { query })}</span> : null}
                {batchConfig && selectedIds.size > 0 ? (
                    <span data-tui-selection style={{ color: accentColor }}>
                        {t('libraryTui.homeSelection', { count: context.items.length, tracks: context.trackIds.length })}
                    </span>
                ) : null}
                {batchConfig && context.items.length > 0 ? (
                    <button type="button" data-tui-create-playlist onClick={requestCreatePlaylist} disabled={!capabilities?.canUseTracks} className="opacity-60 hover:opacity-100 disabled:opacity-30">
                        {`[${t('localMusic.createPlaylist')}]`}
                    </button>
                ) : null}
                {pending ? <span className="opacity-60" data-tui-busy>{t('libraryTui.homeBusy')}</span> : null}
                {isManaging ? (
                    <span className="flex items-center gap-x-2" data-tui-manage-hidden={visibilityMode}>
                        <span style={{ color: accentColor }}>{t('libraryTui.manageHidden')}:</span>
                        <button type="button" aria-pressed={visibilityMode === 'manage'} onClick={() => setVisibilityMode('manage')} className={visibilityMode === 'manage' ? 'font-bold' : 'opacity-60 hover:opacity-100'}>
                            {`[${t('libraryTui.manageShowAll')}]`}
                        </button>
                        <button type="button" aria-pressed={visibilityMode === 'manage-hidden-only'} onClick={() => setVisibilityMode('manage-hidden-only')} className={visibilityMode === 'manage-hidden-only' ? 'font-bold' : 'opacity-60 hover:opacity-100'}>
                            {`[${t('libraryTui.manageHiddenOnly')}]`}
                        </button>
                        <button type="button" onClick={() => setVisibilityMode('browse')} className="opacity-60 hover:opacity-100">
                            {`[${t('libraryTui.manageDone')}]`}
                        </button>
                    </span>
                ) : null}
            </div>
            <div className={`grid shrink-0 ${LIBRARY_TUI_HOME_COLUMNS} gap-x-3 border-b border-current/10 px-4 py-1 text-[11px] uppercase tracking-wider opacity-45`}>
                <span />
                <span />
                <span>{t('libraryTui.columnName')}</span>
                <span>{t('libraryTui.columnType')}</span>
                <span>{t('libraryTui.columnTracks')}</span>
                <span>{t('libraryTui.columnDescription')}</span>
                <span />
            </div>
            <div ref={listRegionRef} role="listbox" aria-label={directoryKey} className="relative min-h-0 flex-1">
                {rows.length === 0 ? (
                    <div className="px-4 py-6 text-[13px] opacity-50" data-tui-empty>{emptyText}</div>
                ) : (
                    <List
                        listRef={listRef}
                        rowCount={rows.length}
                        rowHeight={LIBRARY_TUI_HOME_ROW_HEIGHT}
                        rowComponent={LibraryTuiHomeRow}
                        rowProps={rowProps}
                        overscanCount={6}
                        className="custom-scrollbar"
                        style={{ height: '100%', width: '100%' }}
                    />
                )}
            </div>
            {prompt && (
                <LibraryTuiPrompt
                    key={prompt.kind === 'text' || prompt.kind === 'confirm' ? prompt.id : prompt.kind}
                    request={prompt}
                    pending={Boolean(pending)}
                    accentColor={accentColor}
                    onSubmit={value => void submitPrompt(value)}
                    onCancel={() => onPromptChange(null)}
                />
            )}
        </div>
    );
};

export default LibraryTuiDirectory;
