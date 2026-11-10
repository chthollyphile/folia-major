import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryDirectoryBatchConfig, LibraryHiddenScope } from '../../core/directory/directory.contract';
import type { LibraryHomeCard } from '../../core/home/homeModel.contract';
import type { LibraryDeclaredActions } from '../../core/suite/suite.contract';
import type { LibraryHomeCardSource } from '../../core/home/homeSpecialCards';
import { isHideableDirectoryItem } from '../../core/directory/directoryVisibility';
import { useLibraryDirectorySessionStore } from '../../core/directory/useLibraryDirectorySessionStore';
import { useLibraryDirectoryQuery } from '../../core/directory/useLibraryDirectoryQuery';
import { useLibraryDirectorySelection } from '../../core/directory/useLibraryDirectorySelection';
import { useLibraryDirectoryVisibility } from '../../core/directory/useLibraryDirectoryVisibility';
import { useLibraryDirectoryScope } from '../../core/directory/useLibraryDirectoryScope';
import { useLibraryDirectoryActions } from '../../core/directory/useLibraryDirectoryActions';
import { useHiddenCollections } from '../../core/collection/useHiddenCollections';
import type { BravaisItemKind, BravaisLayer, BravaisSeamModel } from './bravaisLayer';
import type { BravaisHomeAccount, BravaisHomeSection, BravaisHomeShortcut, BravaisHomeTool } from './bravaisHomeModels';
import type { BravaisLayerEntries, BravaisSeamFilter, BravaisSeamMenuItem, BravaisWallHint } from './bravaisSeamModels';
import { createHomeItemCache, projectHomeShortcuts, projectHomeWallItems, resolveHomeWallMode, toHomeEntry } from './bravaisHomeProjection';
import type { BravaisHomeChrome } from './useBravaisHomeChrome';
import { useBravaisDirectoryPanel } from './useBravaisDirectoryPanel';
import { useBravaisHomeDirectorySurface } from './useBravaisHomeDirectorySurface';
import { useBravaisLayerRegistration } from './useBravaisLayerRegistration';
import { useBravaisUiStore } from './bravaisUiStore';
import { openBravaisFilter, useBravaisSeamFilter } from './useBravaisSeamFilter';
import { closeBravaisPanel, openBravaisPanel } from './bravaisPanelHistory';
import { useBravaisSeamStore } from './bravaisSeamLevel';

// src/library/suites/bravais/BravaisHomeDirectory.tsx
// 首页一个来源的墙（设计稿 §10.5）：当前页签 / section 的卡片就是一个目录（与 GridMap、TUI 读写同一份目录会话：
// 隐藏视图、批选、目录过滤，换 suite 不丢），投影成首页层推进 stage。墙一直是这个目录（显示它就 openDirectory 它）。
// - 浏览：去掉隐藏的，无限拼贴；歌单类磁贴悬停右上角有眼睛按钮（隐藏后那一格翻成墙面、后面的 rank 前移）。
// - 管理隐藏（视图模式，不是导航）：整面翻牌，已隐藏的也翻上来、灰度 + 半透明，眼睛按钮常驻、原地变色不重排；
//   「只看隐藏」退化为有限拼贴；退出整面翻回浏览。
// - 目录树面板（本地有批量的几行，窄缝的 ▤）= 批量模式：面板一打开墙就退化为以缝为中心的有限拼贴，没选中的灰度 +
//   半透明，点卡片只切换选中；面板里的输入位就是这一页的过滤（同一个目录 query）。关面板 = 退出批量模式：丢掉选择
//   （过滤词留着，墙仍按它收窄），翻回无限拼贴（有过滤词时是有限拼贴）。
// - 当前页过滤（设计稿 §7.6）：过滤词是目录会话的 query（与 GridMap、TUI 读写同一份；换页签 / section 换目录、离开首页时
//   由 core 的目录开关规则丢掉）。墙上打字进缝里的输入位（useBravaisSeamFilter），过滤时墙退化为以缝为中心的有限拼贴。
//   非批量模式下 `/` 留给全局搜索（「搜索在线平台」），不是过滤字符。
// - 特殊集合（我喜欢的音乐、私人 FM、全部歌曲…）：磁贴的类型标签换样式；缝里二级切换下面是它们的直达入口，数据来自
//   shortcutCards（这个来源里不限当前 section 的卡片），只列此刻真有、没被隐藏的（projectHomeShortcuts）。
// 这个组件只渲染 null；被探针读 props（directoryKey、items、hiddenScope、batchConfig、layerKey、onOpen）。

const NO_KEYS: ReadonlySet<string> = new Set();

const KIND_LABEL_KEYS: Record<BravaisItemKind, string> = {
    track: 'libraryBravais.kind.track',
    playlist: 'libraryBravais.kind.playlist',
    album: 'libraryBravais.kind.album',
    artist: 'libraryBravais.kind.artist',
    folder: 'libraryBravais.kind.folder',
    feed: 'libraryBravais.kind.feed',
};

export type BravaisHomeDirectoryProps = {
    chrome: BravaisHomeChrome;
    /** 首页层的身份：`home:<页签>`（本地四行、Navidrome 的 section 不换层，只整面翻牌）。 */
    layerKey: string;
    /** 卡片来源（特殊集合按来源判定）。 */
    source: LibraryHomeCardSource;
    /** 二级切换的 section（在线页签给页签自己）：进了墙的过滤身份。 */
    section: string;
    directoryKey: string;
    hiddenScope: LibraryHiddenScope;
    /** 当前页签 / section 的全部卡片（隐藏的也在）。 */
    items: LibraryHomeCard[];
    isLoading: boolean;
    /** 没有卡片时缝里的说明（登录过期、未配置、空曲库、空列表）；fb3：未登录时不给（缝里只有「连接在线平台」入口）。 */
    emptyMessage?: string;
    /** 没有卡片、又是因为还没连在线平台 / 还没导入本地文件夹时，墙面上的背景说明（bravaisEmptyWallHint）。 */
    wallHint?: BravaisWallHint;
    /** 缝的元数据行（来源）。 */
    meta: string;
    sections?: readonly BravaisHomeSection[];
    onSelectSection?: (key: string) => void;
    menu?: readonly BravaisSeamMenuItem[];
    /** 来源自己的按钮（Navidrome 的刷新），插在搜索之后、app 入口之前。 */
    sourceTools?: readonly BravaisHomeTool[];
    account?: BravaisHomeAccount | null;
    /** 本地 folders / albums / artists 的批量配置（有它才有目录树面板）。 */
    batchConfig?: LibraryDirectoryBatchConfig;
    /** 面板标题（section 名）。 */
    panelTitle: string;
    declaredActions: LibraryDeclaredActions;
    isInteractive: boolean;
    onOpen: (card: LibraryHomeCard) => void;
    /** 点了直接播放、不进新层的卡（私人 FM）。 */
    isDirect?: (card: LibraryHomeCard) => boolean;
    /** 直达入口从这些卡片里挑（不给就用 items：只看当前页签）。 */
    shortcutCards?: readonly LibraryHomeCard[];
    /** 不经墙打开直达入口的那张卡（不给就是 onOpen；Navidrome 要按卡片自己的 section 定集合类型）。 */
    openShortcut?: (card: LibraryHomeCard) => void;
};

const never = () => false;

const BravaisHomeDirectory: React.FC<BravaisHomeDirectoryProps> = ({
    chrome,
    layerKey,
    source,
    section,
    directoryKey,
    hiddenScope,
    items,
    isLoading,
    emptyMessage,
    wallHint,
    meta,
    sections,
    onSelectSection,
    menu,
    sourceTools,
    account,
    batchConfig,
    panelTitle,
    declaredActions,
    isInteractive,
    onOpen,
    isDirect = never,
    shortcutCards,
    openShortcut,
}) => {
    const { t } = useTranslation();

    // 墙显示的就是打开着的目录（与 TUI 一样；已经打开着——例如刚从网格的 GridMap 切过来——就接着用它的会话）。
    useEffect(() => {
        useLibraryDirectorySessionStore.getState().openDirectory(directoryKey);
    }, [directoryKey]);

    const panelFor = useBravaisUiStore(state => state.panelFor);
    const panelOpen = Boolean(batchConfig) && panelFor === layerKey;
    const openPanel = useCallback(() => {
        if (!batchConfig) return;
        if (useBravaisSeamStore.getState().level !== 'full') useBravaisSeamStore.getState().setLevel('full');
        openBravaisPanel(layerKey);
    }, [batchConfig, layerKey]);
    // 面板开在这一层、但这一行没有批量（切到了本地歌单）：收起它。
    useEffect(() => {
        if (!batchConfig && useBravaisUiStore.getState().panelFor === layerKey) closeBravaisPanel();
    }, [batchConfig, layerKey]);

    const declaresFilter = declaredActions.actions.includes('directory-filter');
    const { query, setQuery, port } = useLibraryDirectoryQuery(directoryKey);
    const effectiveQuery = useBravaisSeamFilter({
        port,
        query,
        isActive: isInteractive && declaresFilter,
        // 非批量模式下 `/` 是全局搜索；面板开着时它是过滤字符（与面板之前的目录过滤一致）。
        reserved: () => (useBravaisUiStore.getState().panelFor === layerKey ? [] : ['/']),
    });
    const { selectedIds, setSelected, toggleSelected, replaceSelection } = useLibraryDirectorySelection(directoryKey);
    const { visibilityMode, setVisibilityMode, toggleManageHidden, toggleHiddenOnly } = useLibraryDirectoryVisibility(directoryKey);
    const { hiddenIds, toggleHidden } = useHiddenCollections(hiddenScope);

    // 关面板 = 退出批量模式：丢掉选择（过滤词是这一页的，留着），墙翻回无限拼贴（还有过滤词时是有限拼贴）。
    const panelOpenRef = useRef(panelOpen);
    useEffect(() => {
        const wasOpen = panelOpenRef.current;
        panelOpenRef.current = panelOpen;
        if (wasOpen && !panelOpen) useLibraryDirectorySessionStore.getState().resetSelection(directoryKey);
    }, [directoryKey, panelOpen]);

    const entries = useMemo(() => items.map(toHomeEntry), [items]);
    const hasHideableItems = useMemo(() => entries.some(isHideableDirectoryItem), [entries]);
    const { visibleItems, displayItems, context } = useLibraryDirectoryScope({
        items: entries,
        hiddenIds,
        visibilityMode,
        query: effectiveQuery,
        selectedIds,
    });
    const { capabilities, run } = useLibraryDirectoryActions(batchConfig, context);

    // 缝里的过滤输入位（首页窄缝、目录面板里同一个）：读写目录会话的 query。
    const filter = useMemo<BravaisSeamFilter | undefined>(() => (declaresFilter ? {
        query,
        placeholder: t('libraryBravais.filterPlaceholder'),
        matchLabel: t('libraryBravaisCollection.matchCount', { matches: displayItems.length, total: visibleItems.length }),
        clearLabel: t('libraryBravaisCollection.clearFilter'),
        setQuery,
    } : undefined), [declaresFilter, displayItems.length, query, setQuery, t, visibleItems.length]);

    const directoryPanel = useBravaisDirectoryPanel({
        directoryKey,
        batchConfig,
        panelOpen,
        title: panelTitle,
        displayItems,
        query: effectiveQuery,
        selectedIds,
        context,
        capabilities,
        run,
        setSelected,
        toggleSelected,
        replaceSelection,
        openPanel,
    });

    // 墙上键盘焦点的那一张（命令面板「隐藏焦点歌单」用）。
    const [focusedKey, setFocusedKey] = useState<string | null>(null);
    const focusedEntry = useMemo(() => (focusedKey ? displayItems.find(entry => entry.itemKey === focusedKey) ?? null : null), [displayItems, focusedKey]);
    useBravaisHomeDirectorySurface({
        isInteractive,
        directoryKey,
        declaredActions,
        capabilities,
        context,
        displayItems,
        selectedIds,
        visibilityMode,
        hasHideableItems,
        focusedEntry,
        openPanel,
        replaceSelection,
        toggleManageHidden,
        toggleHidden,
        requestRemove: directoryPanel.requestRemove,
        runAction: directoryPanel.runAction,
    });

    // ---- 墙 ----
    const labels = useMemo(() => ({
        kindLabel: (kind: BravaisItemKind) => t(KIND_LABEL_KEYS[kind]),
        trackCount: (count: number) => t('libraryBravais.trackCount', { count }),
    }), [t]);
    const cacheRef = useRef(createHomeItemCache());
    const isDirectRef = useRef(isDirect);
    isDirectRef.current = isDirect;
    const wallItems = useMemo(() => projectHomeWallItems(displayItems, {
        hiddenIds,
        visibilityMode,
        selectedIds: panelOpen ? selectedIds : null,
        isDirect: card => isDirectRef.current(card),
        source,
    }, labels, cacheRef.current), [displayItems, hiddenIds, labels, panelOpen, selectedIds, source, visibilityMode]);
    const { mode, filterKey } = resolveHomeWallMode({ section, visibilityMode, batch: panelOpen, query: effectiveQuery });
    const planCount = mode === 'finite' ? visibleItems.length : undefined;
    const wall = useMemo(() => ({
        filterKey,
        planCount,
        loading: isLoading && items.length === 0,
        hint: items.length === 0 ? wallHint : undefined,
    }), [filterKey, isLoading, items.length, planCount, wallHint]);

    // 回调执行时读最新的映射（身份稳定，层描述不因它们换身份）。
    const latest = useRef({ displayItems, onOpen, toggleHidden, openShortcut });
    latest.current = { displayItems, onOpen, toggleHidden, openShortcut };
    const onOpenItem = useCallback((key: string) => {
        const entry = latest.current.displayItems.find(candidate => candidate.itemKey === key);
        if (entry) latest.current.onOpen(entry.card);
    }, []);
    const onToggleHidden = useCallback((key: string) => {
        const entry = latest.current.displayItems.find(candidate => candidate.itemKey === key);
        if (entry) latest.current.toggleHidden(entry);
    }, []);

    // ---- 缝 ----
    // 直达入口：只随「有哪几张、叫什么、在墙上是哪个 key」变（卡片数据就地更新不换身份）。
    const shortcutSpecs = useMemo(
        () => projectHomeShortcuts(shortcutCards ?? items, { source, hiddenIds, isDirect: card => isDirectRef.current(card) }),
        [hiddenIds, items, shortcutCards, source],
    );
    const shortcutSpecsRef = useRef(shortcutSpecs);
    shortcutSpecsRef.current = shortcutSpecs;
    const shortcutsKey = shortcutSpecs.map(spec => `${spec.special}\u0000${spec.label}\u0000${spec.itemKey}\u0000${spec.direct}`).join('\u0001');
    const shortcuts = useMemo<BravaisHomeShortcut[]>(() => shortcutSpecsRef.current.map(spec => ({
        special: spec.special,
        label: spec.label,
        itemKey: spec.itemKey,
        direct: spec.direct,
        open: () => {
            const card = shortcutSpecsRef.current.find(candidate => candidate.special === spec.special)?.card ?? spec.card;
            const { openShortcut: openCard, onOpen: open } = latest.current;
            (openCard ?? open)(card);
        },
    // 按内容比较（specs 每次是新数组）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    })), [shortcutsKey]);
    const tools = useMemo<BravaisHomeTool[]>(() => [
        chrome.searchTool,
        // 「⋯」里的「过滤当前页」：打字之外，用鼠标也能把首页窄缝里的过滤输入位叫出来。
        ...(declaresFilter ? [{ id: 'filter' as const, label: t('libraryBravais.filterPlaceholder'), run: openBravaisFilter }] : []),
        ...(batchConfig ? [{
            id: 'directory' as const,
            label: t('libraryBravaisHome.directory'),
            pressed: panelOpen,
            run: () => (useBravaisUiStore.getState().panelFor === layerKey ? closeBravaisPanel() : openPanel()),
        }] : []),
        ...(hasHideableItems ? [{
            id: 'manage-hidden' as const,
            label: t('libraryBravaisHome.manageHidden'),
            pressed: visibilityMode !== 'browse',
            run: toggleManageHidden,
        }] : []),
        ...(sourceTools ?? []),
        ...chrome.appTools,
    ], [batchConfig, chrome.appTools, chrome.searchTool, declaresFilter, hasHideableItems, layerKey, openPanel, panelOpen, sourceTools, t, toggleManageHidden, visibilityMode]);
    const manage = useMemo(() => (visibilityMode === 'browse' ? null : {
        mode: visibilityMode,
        title: t('libraryBravaisHome.manageHidden'),
        hiddenOnlyLabel: t('libraryBravaisHome.hiddenOnly'),
        doneLabel: t('libraryBravaisHome.manageDone'),
        onToggleHiddenOnly: toggleHiddenOnly,
        onDone: () => setVisibilityMode('browse'),
    }), [setVisibilityMode, t, toggleHiddenOnly, visibilityMode]);
    const status = displayItems.length > 0
        ? undefined
        : isLoading
            ? t('playlist.loading')
            : effectiveQuery ? t('libraryBravaisHome.noMatch') : emptyMessage;
    const seam = useMemo<BravaisSeamModel>(() => ({
        title: chrome.title,
        crumb: chrome.title,
        meta,
        status,
        filter,
        tabs: chrome.tabs,
        onSelectTab: chrome.onSelectTab,
        home: {
            sections,
            onSelectSection,
            shortcuts,
            shortcutsLabel: t('libraryBravaisHome.shortcuts'),
            tools,
            menu,
            menuLabel: t('libraryBravaisHome.more'),
            manage,
            scan: chrome.scan,
            search: chrome.search,
            account,
        },
    }), [account, chrome.onSelectTab, chrome.scan, chrome.search, chrome.tabs, chrome.title, filter, manage, menu, meta, onSelectSection, sections, shortcuts, status, t, tools]);

    const entriesModel = useMemo<BravaisLayerEntries>(() => ({
        hasPanel: Boolean(batchConfig),
        panelTitle,
        listCrumb: t('libraryBravaisHome.directoryCrumb'),
        hasQuery: Boolean(query),
        clearQuery: () => setQuery(''),
        hasForm: directoryPanel.hasForm,
        cancelForm: directoryPanel.cancelForm,
        hasViewMode: visibilityMode !== 'browse',
        exitViewMode: () => setVisibilityMode('browse'),
    }), [batchConfig, directoryPanel.cancelForm, directoryPanel.hasForm, panelTitle, query, setQuery, setVisibilityMode, t, visibilityMode]);

    const home = useMemo(() => ({
        panel: directoryPanel.panel,
        batch: directoryPanel.batch,
        onToggleHidden: hasHideableItems ? onToggleHidden : undefined,
        cycleTab: chrome.cycleTab,
    }), [chrome.cycleTab, directoryPanel.batch, directoryPanel.panel, hasHideableItems, onToggleHidden]);

    const layer = useMemo<BravaisLayer>(() => ({
        key: layerKey,
        sessionKey: 'home',
        surface: 'home',
        mode,
        items: wallItems,
        seam,
        isInteractive,
        focusedEntryKey: null,
        nowPlayingKey: null,
        queuedKeys: NO_KEYS,
        onOpenItem,
        onFocusEntry: setFocusedKey,
        wall,
        entries: entriesModel,
        home,
    }), [entriesModel, home, isInteractive, layerKey, mode, onOpenItem, seam, wall, wallItems]);
    useBravaisLayerRegistration('home', layer);
    return null;
};

export default BravaisHomeDirectory;
