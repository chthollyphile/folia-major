import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, Settings, Cable, X, Menu } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { resolveSearchSource, useSearchNavigationStore } from '../../../../stores/useSearchNavigationStore';
import { useShallow } from 'zustand/react/shallow';
import { SongResult, LocalSong, LocalLibraryGroup, Theme, type StatusMessage } from '../../../../types';
import type { FoliaPlaylistSummary } from '../../../../types/foliaPlaylist';
import LocalGrid3DView from './LocalGrid3DView';
import NavidromeGrid3DView from './NavidromeGrid3DView';
import { useGrid3DTabKeys } from './useGrid3DTabKeys';
import DesktopGrid3DSurface from './DesktopGrid3DSurface';
import OnlineProviderAccountlessPanel from '../account/OnlineProviderAccountlessPanel';
import HomeLoginPanel from '../../../../components/login/HomeLoginPanel';
import SwitcherPill from '../../../../components/login/SwitcherPill';
import ExploreSurface from '../../../../components/app/home/explore/ExploreSurface';
import { createOnlineGridViewCollection } from '../../../../components/app/home/gridViewCollectionAdapters';
import { hasExploreWallEntries } from '../../../../components/app/lattice/exploreWall';
import type { ProviderCollection, ProviderUser } from '../../../../types/onlineMusic';
import { useThemeSettingsStore } from '../../../../stores/useThemeSettingsStore';
import type { LatticeSource } from '../../../../stores/useAppViewStore';
import { useExploreFeedStore } from '../../../../stores/useExploreFeedStore';
import { countRender } from '../../../../dev/renderCount';
import type { LibraryAccountController } from '../../../core/account/account.contract';
import type { LibraryDirectoryBatchController } from '../../../core/directory/directory.contract';
import type { LibraryLocalCatalogSnapshot } from '../../../core/home/home.contract';
import type { LibraryHomeResources } from '../../../core/home/homeModel.contract';
import type { LibraryHomeExtraTab, LibraryDeclaredActions } from '../../../core/suite/suite.contract';
import type { LibraryHomeCard, LibraryHomeGroupView, LibraryHomeListState, LibraryHomeTabKey } from '../../../core/home/homeModel.contract';
import { useLibraryHomeSources } from '../../../core/home/useLibraryHomeSources';
import { useLibraryHomeOnline } from '../../../core/home/online/useLibraryHomeOnline';
import { useLibraryHomeActions } from '../../../core/home/useLibraryHomeActions';
import { useLibraryHomeDirectory } from '../../../core/home/useLibraryHomeDirectory';
import { useLibraryHomeListRegistration, useLibraryHomeTabsRegistration } from '../../../core/home/useLibraryHomeSurfaceRegistration';
import { cycleIndex } from '../../../core/home/homeSources';
import HomeSearchHistory from './HomeSearchHistory';
import Grid3DHomeTabs from './Grid3DHomeTabs';
import HomeNoticePanel from './HomeNoticePanel';
import FoliaGrid3DView from './FoliaGrid3DView';
import { buildOnlineGridTabs, OnlineGridTabsRow } from './OnlineGridTabs';
import { openSettings } from '../../../../stores/useSettingsModalStore';
import { useUpdateIndicator } from '../../../../hooks/useUpdateIndicator';
import { useIsBottomLayoutCompact } from '../../../../stores/useBottomDockStore';

// src/library/suites/grid/home/Grid3D.tsx
// Glassmorphic interactive desktop home view replacing the legacy 3D carousel.
// Supports cover sliding with auto-fading header controls and delegates GridView opening upward.

interface Grid3DProps {
    /** 在线账户 controller（宿主创建，见 LibraryHomeSurfaceProps）：登录按钮与右下角的切换器读它，换平台、登录、退出都在登录窗口里。 */
    account: LibraryAccountController;
    onPlaySong: (song: SongResult, playlistCtx?: SongResult[], isFmCall?: boolean) => void;
    onBackToPlayer: () => void;
    onRefreshUser: () => void;
    user: ProviderUser | null;
    playlists: ProviderCollection[];
    cloudPlaylist?: ProviderCollection | null;
    currentTrack?: SongResult | null;
    localSongs: LocalSong[];
    localLibraryCatalog: LibraryLocalCatalogSnapshot;
    localPlaylists: FoliaPlaylistSummary[];
    onRefreshLocalSongs: () => Promise<void> | void;
    localMusicState: {
        activeRow: 0 | 1 | 2;
        selectedGroup: LocalLibraryGroup | null;
        detailStack: LocalLibraryGroup[];
        detailOriginView: 'home' | 'player' | null;
        focusedFolderIndex: number;
        focusedAlbumIndex: number;
        focusedArtistIndex: number;
        focusedPlaylistIndex: number;
    };
    setLocalMusicState: React.Dispatch<React.SetStateAction<{
        activeRow: 0 | 1 | 2;
        selectedGroup: LocalLibraryGroup | null;
        detailStack: LocalLibraryGroup[];
        detailOriginView: 'home' | 'player' | null;
        focusedFolderIndex: number;
        focusedAlbumIndex: number;
        focusedArtistIndex: number;
        focusedPlaylistIndex: number;
    }>>;
    navidromeFocusedAlbumIndex?: number;
    setNavidromeFocusedAlbumIndex?: (index: number) => void;
    onSearchCommitted: (query: string, sourceTab: any, replace?: boolean) => void;
    theme: Theme;
    onOpenSettings?: (initialTab?: 'help' | 'options') => void;
    /** `source`: what the wall shows; the play queue when left out. */
    onOpenLattice?: (source?: LatticeSource) => void;
    navidromeEnabled?: boolean;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[]) => void;
    onStatusMessage?: (message: StatusMessage) => void;
    onOpenGridView?: (collection: any) => void;
    stageEnabled?: boolean;
    stageIsActive?: boolean;
    onOpenStagePlayer?: () => void;
    isInteractive?: boolean;
    /** 本地目录的批量动作控制器（宿主创建，见 LibraryHomeSurfaceProps）。 */
    directoryActions?: LibraryDirectoryBatchController;
    /** 首页资源（在线收藏专辑、电台 feed；宿主创建，见 library/app/useLibraryHomeResources）。 */
    homeResources: LibraryHomeResources;
    extraTabs?: readonly LibraryHomeExtraTab[];
    onNativeTabSelected?: () => void;
    /** 网格 suite 在 entry 里声明的首页动作（宿主经 registry 传入）：GridMap 的目录 surface 只发布声明 ∩ core 判定。 */
    declaredActions?: LibraryDeclaredActions;
}

export const Grid3D: React.FC<Grid3DProps> = (props) => {
    countRender('Grid3D');
    const {
        onPlaySong,
        onBackToPlayer,
        user,
        playlists,
        cloudPlaylist = null,
        currentTrack,
        localSongs,
        localLibraryCatalog,
        localPlaylists,
        localMusicState,
        setLocalMusicState,
        navidromeFocusedAlbumIndex = 0,
        setNavidromeFocusedAlbumIndex,
        onSearchCommitted,
        theme,
        onOpenSettings,
        onOpenLattice,
        navidromeEnabled = false,
        onOpenGridView,
        stageEnabled = false,
        stageIsActive = false,
        onOpenStagePlayer,
        account,
        isInteractive = true,
        directoryActions,
        homeResources,
        declaredActions,
    } = props;

    const { t, i18n } = useTranslation();
    const {
        isDaylight,
    } = useThemeSettingsStore(useShallow(state => ({
        isDaylight: state.isDaylight,
    })));
    const {
        searchQuery,
        setSearchQuery,
        isSearching,
        submitSearch,
        searchHistory,
        forgetSearchHistoryQuery,
        clearSearchHistory,
    } = useSearchNavigationStore(useShallow(state => ({
        searchQuery: state.searchQuery,
        setSearchQuery: state.setSearchQuery,
        isSearching: state.isSearching,
        submitSearch: state.submitSearch,
        searchHistory: state.searchHistory,
        forgetSearchHistoryQuery: state.forgetSearchHistoryQuery,
        clearSearchHistory: state.clearSearchHistory,
    })));

    // 来源、页签与在线列表都来自 Library Core 的首页模型（core/home/homeSources、homeCards 与首页资源）；
    // 这里只剩展示：布局、登录入口、更新徽标、扫描进度胶囊。
    const homeSources = useLibraryHomeSources({
        account,
        user,
        playlists,
        cloudPlaylist,
        navidromeEnabled,
        folia: true,
    });
    const { tab: homeViewTab, setTab: setHomeViewTab, isOnlineTab, online, tabs: homeTabs, groups: homeGroups, noOnlineSources } = homeSources;
    const onlineGroup = homeGroups.find(group => group.key === 'online');
    const activeProviderId = online.providerId;
    const activeProviderLabel = online.providerLabel;
    const activeUser = online.user;
    const activeAccountView = online.accountView;
    const activeProviderNeedsRelogin = online.needsRelogin;
    const onlineList = useLibraryHomeOnline(homeResources, homeSources);
    const homeActions = homeResources.actions;
    const { snapshot: homeActionState, scanPercent: scanProgressPercent } = useLibraryHomeActions(homeActions);
    const scanProgress = homeActionState.scan;
    // 当前列表的目录会话 key 与隐藏作用域只在首页模型里算一次（core/home/homeSources），交给三个列表视图。
    const { directoryKey, hiddenScope } = useLibraryHomeDirectory({
        tab: homeViewTab,
        providerId: activeProviderId,
        localRow: localMusicState.activeRow,
    });
    // 在线列表只在账户已就绪时显示（无账户 / 解析中 / 未登录各有面板）。探索页签没有卡片列表：它是平台自己的推荐页。
    const showOnlineList = isOnlineTab
        && !noOnlineSources
        && homeViewTab !== 'explore'
        && activeAccountView !== 'accountless'
        && activeAccountView !== 'resolving'
        && activeAccountView !== 'guest';
    // On the explore tab the wall (队列拼贴) shows the page's entries, not the play queue: it is
    // offered there once the page has an entry to show, with or without a song on the player.
    const opensExploreWall = homeViewTab === 'explore' && online.canUseExplore;
    const hasExploreWall = useExploreFeedStore(state => opensExploreWall && hasExploreWallEntries(state.feed));

    const [focusedIndex, setFocusedIndex] = useState(0);
    const gridRootRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    /** 紧凑档页签菜单的按钮：Esc 收起菜单后把焦点交回它，跟项目里其它下拉菜单一致。 */
    const compactTabsButtonRef = useRef<HTMLButtonElement>(null);
    const [scanDetailsExpanded, setScanDetailsExpanded] = useState(false);
    // 点开搜索框时贴在它下面的历史：数据是 useSearchNavigationStore 的 searchHistory，由 submitSearch 记。
    const [isSearchHistoryOpen, setIsSearchHistoryOpen] = useState(false);

    const showUpdateIndicator = useUpdateIndicator();
    // 紧凑档（窗口窄于 960，progress-bar v3，见 useBottomLayoutTracking）：页头一行放不下标题加五颗
    // 页签胶囊，Folia 标题让位给当前页签的名字；搜索也收成一颗按钮——点开之后整排按钮向左滑出、搜索框从右边滑进来
    // 占满整条页头。没挂档位追踪的页面（OBS 之类）一直是桌面档，标题与搜索框照旧。
    const isCompact = useIsBottomLayoutCompact();
    /** 紧凑档的搜索是不是已经滑进来；桌面档的搜索框一直摆着，不看这个。 */
    const [isCompactSearchOpen, setIsCompactSearchOpen] = useState(false);
    /** 紧凑档把页签收成了一颗菜单按钮：点开展开页签列表，再点（或选一个页签、点外面）收起。 */
    const [isCompactTabsOpen, setIsCompactTabsOpen] = useState(false);
    /** 紧凑档页头正中的标题：当前一级页签（组）的名字，二级页签在下面的小胶囊里看得到；万一对不上任何组，退回 Folia。 */
    const compactTabTitle = homeGroups.find(group => group.active)?.label ?? 'Folia';

    // Reset focused index when switching tabs.
    useEffect(() => {
        setFocusedIndex(0);
    }, [homeViewTab]);

    // 回到桌面档就把紧凑档的搜索层和页签菜单都收回去：下次再进紧凑档从收起的状态开始，
    // 不会留着一个已经滑出去的输入框或还张着的菜单。
    useEffect(() => {
        if (!isCompact) {
            setIsCompactSearchOpen(false);
            setIsCompactTabsOpen(false);
        }
    }, [isCompact]);

    // 搜索层滑进来之后把焦点直接交给输入框：点那一下就是来打字的，不用再点一次。
    // 等一帧再聚焦：那一帧起搜索层才开始从右边滑进来。preventScroll 是必须的——此刻它还在
    // 页头右侧之外（translateX(100%)），浏览器默认会为了露出它把整个页面横向滚一段。
    useEffect(() => {
        if (!isCompact || !isCompactSearchOpen) return undefined;
        const frame = requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
        return () => cancelAnimationFrame(frame);
    }, [isCompact, isCompactSearchOpen]);

    // 点搜索框与历史面板以外的地方就把搜索层收回去（和点那颗 × 一样）。用 pointerdown 而不是 click：
    // 指针落在别处（例如海报、页签）时先收起，那一下不会同时被当成「先点搜索框、再点别处」。
    // 历史面板挂在表单里，所以按「在不在表单内」判断；搜索钮自己不算外面，否则点它等于先收再开。
    useEffect(() => {
        if (!isCompact || !isCompactSearchOpen) return undefined;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (target instanceof Element && target.closest('[data-home-search-layer]')) return;
            setIsCompactSearchOpen(false);
            setIsSearchHistoryOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    }, [isCompact, isCompactSearchOpen]);

    // 点页签菜单与它的按钮以外的地方就把菜单收回去。用 pointerdown 与上面搜索层一致：
    // 落在别处时先收起，那一下不会同时被当成「点按钮」。Esc 同样收起，并把焦点交回菜单按钮。
    useEffect(() => {
        if (!isCompact || !isCompactTabsOpen) return undefined;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (target instanceof Element && target.closest('[data-home-tabs-menu]')) return;
            setIsCompactTabsOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setIsCompactTabsOpen(false);
            compactTabsButtonRef.current?.focus();
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isCompact, isCompactTabsOpen]);

    useEffect(() => {
        setFocusedIndex(0);
    }, [activeProviderId, activeUser?.id]);

    // Delegate GridView opening to the app-level host so Grid3D remains only the home surface.
    // If Personal FM is clicked, it plays Personal FM directly instead of opening GridView.
    const handleSelectCollectionCard = (card: LibraryHomeCard) => {
        void homeActions.openOnlineCard(card, activeProviderId, collection => onOpenGridView?.(collection));
    };

    // 首页模型交给 core 的首页 surface 句柄：页签条，以及在线页签的列表（本地与 Navidrome 由各自的视图注册）。
    useLibraryHomeTabsRegistration({
        getState: () => ({ active: homeViewTab, tabs: homeTabs, groups: homeGroups }),
        setTab: tab => {
            const target = homeTabs.find(candidate => candidate.key === tab);
            // 不可用的页不让选，除非它是某个组的落点（在线组一页都不可用时仍要进得去，见 resolveHomeGroups）。
            if (!target || (target.disabledReason && !homeGroups.some(group => group.target === tab))) return false;
            props.onNativeTabSelected?.();
            setHomeViewTab(tab);
            return true;
        },
    });
    useLibraryHomeListRegistration({
        enabled: showOnlineList,
        getState: (): LibraryHomeListState => ({
            tab: homeViewTab,
            directoryKey,
            hiddenScope,
            sections: [],
            items: onlineList.items,
            isLoading: onlineList.isLoading,
            actions: [],
            batchSelectionType: null,
        }),
        setSection: () => false,
        runAction: () => false,
    });

    // Search committed callback
    // 提交一个词：搜索（submitSearch 顺带记进历史）、把首页让给结果页。
    // 从历史标签点进来时直接带着那一条走，不必等 setSearchQuery 落进 state。
    const runSearch = async (rawQuery: string) => {
        const query = rawQuery.trim();
        setIsSearchHistoryOpen(false);
        if (!query) return;

        const searchSource = isOnlineTab ? activeProviderId : resolveSearchSource(homeViewTab);
        const didSearch = await submitSearch({
            query,
            sourceTab: searchSource,
            deps: {
                localSongs,
                localLibraryCatalog,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
        });

        if (didSearch) {
            onSearchCommitted(query, searchSource);
        }
    };

    const handleSearch = (e?: React.FormEvent) => {
        e?.preventDefault();
        void runSearch(searchQuery);
    };

    const isSearchingActive = isSearching;

    // Background style mappings
    const mainBg = isDaylight ? 'bg-white/40' : 'bg-black/20';
    const inputBg = isDaylight ? 'bg-black/5 focus:bg-black/10' : 'bg-white/5 focus:bg-white/10';
    /** 紧凑档页签菜单里未选中的项（桌面档的胶囊在 Grid3DHomeTabs 里自带同样的配色）。 */
    const navPillInactiveText = isDaylight ? 'text-black/60 hover:text-black' : 'text-white/60 hover:text-white';

    const bottomPadding = currentTrack ? 'pb-28 md:pb-32' : '';

    const focusActiveSlider = () => {
        requestAnimationFrame(() => {
            gridRootRef.current
                ?.querySelector<HTMLElement>('[data-grid3d-slider]')
                ?.focus({ preventScroll: true });
        });
    };

    // Tab / Shift+Tab 在可用页签之间循环，切完把焦点交回海报轨道，和点胶囊一样。
    // Tab / Shift+Tab includes contributed pages; opening one hands keyboard focus to its own navigation.
    // Its host disables this native surface while the page is open, so subsequent Tab stays inside the page.
    const navigationTabs = [
        ...homeTabs.map(tab => ({ id: tab.key, enabled: !tab.disabledReason, select: () => {
            setHomeViewTab(tab.key);
            focusActiveSlider();
        } })),
        ...(props.extraTabs ?? []).map(tab => ({ ...tab, enabled: true })),
    ];
    // 一级那一排：点一个组去它记住的那一页（在线组是上次停的那一页）。
    const selectHomeTab = (tab: LibraryHomeTabKey) => {
        setHomeViewTab(tab);
        focusActiveSlider();
    };
    const selectHomeGroup = (group: LibraryHomeGroupView) => {
        if (group.target) selectHomeTab(group.target);
    };
    // 「设置 → 音源」只在桌面版有。
    const openSourceSettings = window.electron ? () => openSettings('options', 'sources', null, 'sourceList') : undefined;
    // 一个音源都没启用时没有二级页签可言（页都是空的），只留「去启用音源」那块提示。
    const onlineTabs = noOnlineSources ? [] : buildOnlineGridTabs(onlineGroup, homeViewTab, selectHomeTab);
    const onlineTabsLabel = t('home.onlineTabsLabel', { source: onlineGroup?.label ?? '' });

    useGrid3DTabKeys({
        isActive: isInteractive,
        onCycleTab: delta => {
            const next = cycleIndex(navigationTabs, navigationTabs.findIndex(tab => tab.id === homeViewTab), delta, tab => tab.enabled);
            if (next < 0 || navigationTabs[next].id === homeViewTab) return;
            // 键盘循环换页签时把紧凑档菜单也收起：不然它会浮在已经换过的页面上。
            setIsCompactTabsOpen(false);
            navigationTabs[next].select();
        },
    });

    return (
        <div
            ref={gridRootRef}
            data-ponder-page-scope="grid-page"
            className={`relative w-full h-full flex flex-col font-sans overflow-hidden ${mainBg} pointer-events-auto backdrop-blur-sm ${bottomPadding}`}
        >

            {/* Main Header Container (Fades out when sliding/interacting) */}
            <div className="transition-opacity duration-300 ease-in-out z-20 opacity-100 select-none">
                {/* 页头是道推拉门：紧凑档点开搜索时，整排按钮向左滑出，搜索框从右边滑进来占满整条页头；
                    收起时两边各自滑回。进出都只做 transform——不给祖先加 opacity 或 filter，那会把
                    backdrop-filter 的取样根截断在容器里。这一层横着裁切：滑出去的两层由它收掉，
                    纵向不裁：扫库进度气泡是往下弹的，要留它出去。 */}
                <div className="relative overflow-x-clip">
                {/* 纵向留白两档一致，按桌面档：上内边距一直是 32px（p-8 的纵向那半）。
                    两档都用三等分：两侧各占一份剩余宽度，中间那一块恰好落在页面正中。
                    桌面档中间是页签胶囊；紧凑档页签收进了左侧菜单，中间放当前页签的名字，
                    换页签、加页签都不会让它偏。
                    中间这一块是 auto 宽、不参与伸缩：窗口再窄也不压它，先让两边让出位置。
                    横向在窄窗口收窄到 16px；窗口很窄时只收每个页签的左右内边距。 */}
                <div
                    className="items-center w-full max-w-7xl mx-auto px-4 md:px-8 py-8 transition-transform duration-300 ease-out grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
                    style={{ transform: isCompact && isCompactSearchOpen ? 'translateX(-100%)' : 'translateX(0)' }}
                >
                    {/* Left title and settings */}
                    <div className="flex min-w-0 items-center justify-start">
                        {/* 紧凑档（窗口窄于 960）页头一行放不下五颗胶囊，Folia 标题让位给它们，页签也收成
                            最左侧的一颗菜单按钮：这里留下菜单、设置与队列拼贴。桌面档照旧。 */}
                        {!isCompact && (
                            <h1 className="text-2xl font-bold tracking-tight opacity-90 flex items-center gap-3">
                                Folia
                            </h1>
                        )}
                        {isCompact && (
                            <div className="relative mr-1" data-home-tabs-menu>
                                <button
                                    ref={compactTabsButtonRef}
                                    type="button"
                                    onClick={() => setIsCompactTabsOpen(open => !open)}
                                    title={t('home.navMenu')}
                                    aria-label={t('home.navMenu')}
                                    aria-expanded={isCompactTabsOpen}
                                    aria-haspopup="true"
                                    data-testid="home-tabs-menu-toggle"
                                    className={`relative flex shrink-0 items-center justify-center rounded-full p-2 transition-all ${isCompactTabsOpen ? 'bg-white/10 opacity-100' : 'opacity-40 hover:bg-white/10 hover:opacity-100'}`}
                                >
                                    <Menu size={20} style={{ color: 'var(--text-primary)' }} />
                                </button>
                                <AnimatePresence>
                                    {isCompactTabsOpen && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -6 }}
                                            transition={{ duration: 0.16 }}
                                            data-testid="home-tabs-menu"
                                            className="absolute left-0 top-full z-40 mt-2 max-h-[calc(100vh-6rem)] w-56 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border p-1.5 shadow-xl backdrop-blur-2xl theme-glass-panel"
                                        >
                                            {/* 菜单里是一级页签（组），和桌面档的胶囊一致；点一个组去它记住的那一页。 */}
                                            {homeGroups.map(group => (
                                                <button
                                                    key={group.key}
                                                    type="button"
                                                    disabled={group.target === null}
                                                    title={group.disabledReason || group.label}
                                                    aria-label={group.disabledReason || group.label}
                                                    aria-current={group.active ? 'page' : undefined}
                                                    onClick={() => {
                                                        selectHomeGroup(group);
                                                        setIsCompactTabsOpen(false);
                                                    }}
                                                    className={`flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${group.active
                                                        ? (isDaylight ? 'bg-black/10 text-black' : 'bg-white/15 text-white')
                                                        : navPillInactiveText}`}
                                                >
                                                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                                                    {group.active && (
                                                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isDaylight ? 'bg-black/70' : 'bg-white/80'}`} />
                                                    )}
                                                </button>
                                            ))}
                                            {props.extraTabs?.map(tab => (
                                                <button
                                                    key={tab.id}
                                                    type="button"
                                                    onClick={() => {
                                                        tab.select();
                                                        setIsCompactTabsOpen(false);
                                                    }}
                                                    className={`flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${navPillInactiveText}`}
                                                >
                                                    <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                                                </button>
                                            ))}
                                            {stageEnabled && (
                                                <button
                                                    type="button"
                                                    data-stage-active={stageIsActive ? 'true' : 'false'}
                                                    onClick={() => {
                                                        onOpenStagePlayer?.();
                                                        setIsCompactTabsOpen(false);
                                                    }}
                                                    className={`flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${navPillInactiveText}`}
                                                >
                                                    <span className="min-w-0 flex-1 truncate">{t('home.stage')}</span>
                                                </button>
                                            )}
                                            {/* 队列拼贴（探索页上是探索拼贴）在紧凑档从页头那格图标收进这里，
                                                条件与那颗图标一致：只看有没有东西可铺。 */}
                                            {onOpenLattice && (opensExploreWall ? hasExploreWall : currentTrack) && (
                                                <button
                                                    type="button"
                                                    data-testid="home-lattice-pill"
                                                    onClick={() => {
                                                        onOpenLattice(opensExploreWall ? 'explore' : 'queue');
                                                        setIsCompactTabsOpen(false);
                                                    }}
                                                    className={`flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${navPillInactiveText}`}
                                                >
                                                    <span className="min-w-0 flex-1 truncate">{t(opensExploreWall ? 'home.latticeExplore' : 'home.lattice')}</span>
                                                </button>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}
                        <button
                            onClick={() => onOpenSettings?.('help')}
                            className={`relative flex items-center gap-1.5 p-2 rounded-full hover:bg-white/10 transition-all ${isCompact ? '' : 'ml-4'} ${showUpdateIndicator
                                    ? 'opacity-90 hover:opacity-100'
                                    : 'opacity-40 hover:opacity-100'
                                }`}
                            title={t('ui.options')}
                        >
                            <Settings size={20} style={{ color: 'var(--text-primary)' }} />
                            {showUpdateIndicator && (
                                <span className="text-[10px] font-medium text-zinc-800 dark:text-zinc-200 opacity-80 whitespace-nowrap bg-zinc-200/50 dark:bg-white/10 px-2 py-0.5 rounded-md">
                                    {t('options.updateAvailable')}
                                </span>
                            )}
                        </button>
                        {scanProgress?.active && (
                            <div
                                className="relative ml-3"
                                onMouseEnter={() => setScanDetailsExpanded(true)}
                                onMouseLeave={() => setScanDetailsExpanded(false)}
                            >
                                <button
                                    onClick={() => setScanDetailsExpanded(prev => !prev)}
                                    className="relative rounded-full p-px transition-all"
                                    style={{
                                        background: `conic-gradient(from -90deg, ${isDaylight ? (theme?.accentColor || 'rgba(17,24,39,0.92)') : 'rgba(255,255,255,0.98)'} 0deg ${scanProgressPercent * 3.6}deg, ${isDaylight ? 'rgba(24,24,27,0.16)' : 'rgba(255,255,255,0.14)'} ${scanProgressPercent * 3.6}deg 360deg)`,
                                        borderRadius: '999px'
                                    }}
                                    title={t('options.scanProgress')}
                                >
                                    <div
                                        className={`relative flex items-center justify-center min-w-[56px] h-7 px-2.5 rounded-full backdrop-blur-md ${isDaylight ? 'bg-white/95 text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]' : 'bg-zinc-950/92 text-zinc-100'
                                            }`}
                                    >
                                        <span className="relative z-10 text-[10px] font-semibold tabular-nums leading-none">
                                            {scanProgressPercent}%
                                        </span>
                                    </div>
                                </button>
                                <AnimatePresence>
                                    {scanDetailsExpanded && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -6 }}
                                            className={`absolute left-0 top-full mt-2 w-72 p-4 rounded-2xl border backdrop-blur-xl shadow-xl ${isDaylight ? 'bg-white/85 border-black/10 text-zinc-800' : 'bg-black/60 border-white/10 text-zinc-100'
                                                }`}
                                        >
                                            <div className="text-sm font-semibold truncate">
                                                {t('options.scanningFolder', { folderName: scanProgress.folderName })}
                                            </div>
                                            <div className={`text-xs mt-1 ${isDaylight ? 'text-zinc-600' : 'text-zinc-300/70'}`}>
                                                {t('options.scanProgressDesc')}
                                            </div>
                                            <div className="mt-3 flex items-center justify-between text-xs font-mono">
                                                <span>{t('ui.progress')}</span>
                                                <span>{Math.min(scanProgress.completedSongs, scanProgress.totalSongs)} / {scanProgress.totalSongs}</span>
                                            </div>
                                            <div className={`mt-2 w-full h-2 rounded-full overflow-hidden ${isDaylight ? 'bg-black/10' : 'bg-white/10'}`}>
                                                <div
                                                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                                                    style={{
                                                        width: `${scanProgress.totalSongs > 0 ? (scanProgress.completedSongs / scanProgress.totalSongs) * 100 : 0}%`,
                                                        backgroundColor: theme?.accentColor || 'var(--text-primary)'
                                                    }}
                                                />
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>

                    {/* Center Tab Switcher：桌面档是首页两级页签的一级那一排（Grid3DHomeTabs）；紧凑档页签收进左侧的菜单按钮，
                        这里改放当前一级页签（组）的名字，照样落在页面正中——收起菜单也看得出自己在哪一组；二级页签仍在下面的小胶囊里。
                        胶囊的宽度永远是它自身的内容宽度（shrink-0）：窗口再窄也不压它，先让两侧让位。页签名太长（译文）时截断，不把两侧挤没。 */}
                    <div className="flex shrink-0 justify-center">
                        {isCompact ? (
                            <h1
                                data-testid="home-compact-tab-title"
                                className="relative max-w-[min(50vw,20rem)] text-2xl font-bold tracking-tight opacity-90"
                            >
                                {/* 换页签时旧名字往上淡出、新名字从下面淡入；mode="wait" 让两者不叠在一起。
                                    initial={false}：首次挂载和进紧凑档那一下直接显示，不播入场。 */}
                                <AnimatePresence mode="wait" initial={false}>
                                    <motion.span
                                        key={compactTabTitle}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -8 }}
                                        transition={{ duration: 0.16, ease: 'easeOut' }}
                                        className="block truncate"
                                    >
                                        {compactTabTitle}
                                    </motion.span>
                                </AnimatePresence>
                            </h1>
                        ) : (
                            <Grid3DHomeTabs
                                groups={homeGroups}
                                onSelectGroup={selectHomeGroup}
                                extraTabs={props.extraTabs}
                                isDaylight={isDaylight}
                                stage={{ enabled: stageEnabled, active: stageIsActive, open: onOpenStagePlayer }}
                                lattice={onOpenLattice && (opensExploreWall ? hasExploreWall : currentTrack)
                                    ? { explore: opensExploreWall, open: () => onOpenLattice(opensExploreWall ? 'explore' : 'queue') }
                                    : null}
                            />
                        )}
                    </div>

                    {/* Right Search Bar */}
                    <div className="flex min-w-0 items-center justify-end">
                        {isCompact ? (
                            // 紧凑档收着的时候这里只有一颗圆钮：点开之后整条页头交给搜索层（见下面），
                            // 这一排按钮一起向左滑出去。
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCompactTabsOpen(false);
                                    setIsCompactSearchOpen(open => !open);
                                }}
                                data-home-search-layer
                                title={t('home.searchButton')}
                                aria-label={t('home.searchButton')}
                                aria-expanded={isCompactSearchOpen}
                                data-testid="home-search-toggle"
                                className={`relative flex shrink-0 items-center justify-center p-2 rounded-full hover:bg-white/10 transition-all ${isSearchingActive ? 'opacity-90' : 'opacity-40 hover:opacity-100'}`}
                            >
                                {isSearchingActive
                                    ? <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-primary)' }} />
                                    : <Search size={20} style={{ color: 'var(--text-primary)' }} />}
                            </button>
                        ) : (
                        <form
                            onSubmit={handleSearch}
                            data-home-search-layer
                            className="relative w-full transition-all md:w-56 focus-within:md:w-72"
                            onBlur={event => {
                                // 焦点离开整块（连面板一起）才收起，点到面板里的标签不算离开。
                                if (!event.currentTarget.contains(event.relatedTarget)) {
                                    setIsSearchHistoryOpen(false);
                                }
                            }}
                        >
                            {isSearchingActive ? (
                                <Loader2 className="absolute left-3 top-1/2 w-4 h-4 animate-spin opacity-40 -mt-2" />
                            ) : (
                                <Search
                                    className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4 cursor-pointer hover:opacity-100 transition-opacity"
                                    onClick={() => handleSearch()}
                                />
                            )}
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder={homeViewTab === 'local' ? t('home.searchLocal') : homeViewTab === 'navidrome' ? t('home.searchNavidrome') : t('home.searchDatabase')}
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onFocus={() => setIsSearchHistoryOpen(true)}
                                onKeyDown={event => {
                                    if (event.key === 'Escape' && isSearchHistoryOpen) {
                                        event.stopPropagation();
                                        setIsSearchHistoryOpen(false);
                                    }
                                }}
                                aria-expanded={isSearchHistoryOpen && searchHistory.length > 0}
                                aria-controls="home-search-history"
                                className={`w-full ${inputBg} border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-white/20 transition-all placeholder:text-current placeholder:opacity-40 select-text`}
                                style={{ color: 'var(--text-primary)' }}
                            />
                            <AnimatePresence>
                                {isSearchHistoryOpen && searchHistory.length > 0 && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        transition={{ duration: 0.16 }}
                                        className="absolute right-0 top-full z-40 mt-2"
                                    >
                                        <HomeSearchHistory
                                            items={searchHistory}
                                            onPick={item => {
                                                setSearchQuery(item);
                                                void runSearch(item);
                                            }}
                                            onRemove={forgetSearchHistoryQuery}
                                            onClear={clearSearchHistory}
                                            isDaylight={isDaylight}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </form>
                        )}
                    </div>
                </div>

                {/* 紧凑档展开的搜索：从右边滑进来占满整条页头（左右 padding 与页头一致，所以贴齐两侧；
                    页头是 px-4 md:px-8，这里跟着走同一条断点，768–959 之间才不会被拉回 px-4）。
                    收起时滑回右边，同时断掉指针与焦点；输入框里的字留着，下次展开接着改。 */}
                {isCompact && (
                    <div
                        className="absolute inset-0 flex items-center px-4 md:px-8 transition-transform duration-300 ease-out"
                        style={{
                            transform: isCompactSearchOpen ? 'translateX(0)' : 'translateX(100%)',
                            pointerEvents: isCompactSearchOpen ? 'auto' : 'none',
                        }}
                        aria-hidden={!isCompactSearchOpen}
                        inert={!isCompactSearchOpen}
                    >
                        <form
                            onSubmit={handleSearch}
                            data-home-search-layer
                            className={`relative h-10 w-full rounded-full ${inputBg} border border-white/10`}
                        >
                            {isSearchingActive ? (
                                <Loader2 className="absolute left-3 top-1/2 w-4 h-4 animate-spin opacity-40 -mt-2" />
                            ) : (
                                <Search
                                    className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4 cursor-pointer hover:opacity-100 transition-opacity"
                                    onClick={() => handleSearch()}
                                />
                            )}
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder={homeViewTab === 'local' ? t('home.searchLocal') : homeViewTab === 'navidrome' ? t('home.searchNavidrome') : t('home.searchDatabase')}
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onFocus={() => setIsSearchHistoryOpen(true)}
                                onKeyDown={event => {
                                    // Esc 先收搜索历史（没有历史可收就不用先按一下）；历史收着时才收起整条
                                    // 搜索层。输入框里的字留着，下次展开接着改。
                                    if (event.key !== 'Escape') return;
                                    event.stopPropagation();
                                    if (isSearchHistoryOpen && searchHistory.length > 0) {
                                        setIsSearchHistoryOpen(false);
                                        return;
                                    }
                                    setIsCompactSearchOpen(false);
                                    searchInputRef.current?.blur();
                                }}
                                aria-expanded={isSearchHistoryOpen && searchHistory.length > 0}
                                aria-controls="home-search-history"
                                className="h-10 w-full rounded-full py-2 pl-10 pr-10 text-sm focus:outline-none transition-all placeholder:text-current placeholder:opacity-40 select-text"
                                style={{ color: 'var(--text-primary)' }}
                            />
                            {/* 收起：打完字（或改到一半）不想搜了就按这个，输入框跟着滑回右边。 */}
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCompactSearchOpen(false);
                                    setIsSearchHistoryOpen(false);
                                    searchInputRef.current?.blur();
                                }}
                                title={t('home.searchClose')}
                                aria-label={t('home.searchClose')}
                                className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full transition-colors hover:bg-white/15"
                            >
                                <X size={14} style={{ color: 'var(--text-primary)' }} />
                            </button>
                            <AnimatePresence>
                                {isSearchHistoryOpen && searchHistory.length > 0 && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        transition={{ duration: 0.16 }}
                                        className="absolute inset-x-0 top-full z-40 mt-2"
                                    >
                                        <HomeSearchHistory
                                            items={searchHistory}
                                            onPick={item => {
                                                setSearchQuery(item);
                                                void runSearch(item);
                                            }}
                                            onRemove={forgetSearchHistoryQuery}
                                            onClear={clearSearchHistory}
                                            isDaylight={isDaylight}
                                            stretch
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </form>
                    </div>
                )}
                </div>
            </div>

            {/* Desktop Canvas Surface */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center relative">
                {/* 没有卡片列表的在线页（探索、未登录、无账户、没有音源）：二级页签单独画在同一个位置。 */}
                {isOnlineTab && !showOnlineList && (
                    <OnlineGridTabsRow tabs={onlineTabs} isDaylight={isDaylight} label={onlineTabsLabel} />
                )}
                {homeViewTab === 'folia' ? (
                    // Folia 组：聚合歌单的卡片（不设二级页签）；新建、排序、导入、打开速记簿在右上角。
                    <div className="w-full h-full flex-1" data-testid="home-folia">
                        <FoliaGrid3DView
                            playlists={localPlaylists}
                            localSongs={localSongs}
                            focusedIndex={localMusicState.focusedPlaylistIndex}
                            setFocusedIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedPlaylistIndex: index }))}
                            homeActions={homeActions}
                            directoryKey={directoryKey}
                            theme={theme}
                            isDaylight={isDaylight}
                            isInteractive={isInteractive}
                            hasFloatingPlayer={Boolean(currentTrack)}
                            onOpenGridView={onOpenGridView}
                            declaredHomeActions={declaredActions}
                        />
                    </div>
                ) : isOnlineTab && noOnlineSources ? (
                    <HomeNoticePanel
                        testId="home-no-sources"
                        icon={Cable}
                        title={t('home.noSourcesTitle')}
                        body={t('home.noSourcesBody')}
                        isDaylight={isDaylight}
                        action={openSourceSettings ? { label: t('home.noSourcesAction'), icon: Cable, run: openSourceSettings } : undefined}
                    />
                ) : isOnlineTab && activeAccountView === 'accountless' ? (
                    <OnlineProviderAccountlessPanel
                        providerLabel={activeProviderLabel}
                        isDaylight={isDaylight}
                        onSearch={() => {
                            // 紧凑档的搜索层收起时是 inert 的，直接 focus() 不生效（点了像没反应）：
                            // 先把它展开，展开后的 effect 会在下一帧把焦点交给输入框。
                            if (isCompact) {
                                setIsCompactSearchOpen(true);
                                return;
                            }
                            searchInputRef.current?.focus();
                        }}
                    />
                ) : isOnlineTab && activeAccountView === 'resolving' ? (
                    <div className="flex flex-1 w-full items-center justify-center" aria-busy="true">
                        <Loader2 className="animate-spin opacity-30" size={28} />
                    </div>
                ) : isOnlineTab && activeAccountView === 'guest' ? (
                    // One button: it opens the sign-in window, where the platform is chosen.
                    <HomeLoginPanel account={account} />
                ) : homeViewTab === 'explore' ? (
                    online.canUseExplore && (
                        <ExploreSurface
                            // Another platform or account starts from its own: how far a section was opened is not carried over.
                            key={`${activeProviderId}:${activeUser?.id ?? ''}`}
                            providerId={activeProviderId}
                            accountId={String(activeUser?.id ?? '')}
                            scope={`${activeUser?.id ?? ''}:${i18n.language}`}
                            onPlaySong={(song, queue) => onPlaySong(song, queue, false)}
                            onOpenCollection={collection => onOpenGridView?.(createOnlineGridViewCollection(collection, activeProviderId))}
                        />
                    )
                ) : showOnlineList ? (
                    <DesktopGrid3DSurface
                        focusMemoryScope={JSON.stringify(['online', activeProviderId, activeUser?.id ?? null, homeViewTab])}
                        title={onlineList.title}
                        mapButtonLabel={t('home.allAlbums')}
                        items={onlineList.items}
                        focusedIndex={focusedIndex}
                        onFocusedIndexChange={setFocusedIndex}
                        onSelect={item => handleSelectCollectionCard(item as LibraryHomeCard)}
                        isLoading={onlineList.isLoading}
                        emptyMessage={onlineList.emptyMessage}
                        theme={theme}
                        isDaylight={isDaylight}
                        isInteractive={isInteractive}
                        hasFloatingPlayer={Boolean(currentTrack)}
                        playlistVisibilityScope={hiddenScope}
                        directoryKey={directoryKey}
                        declaredHomeActions={declaredActions}
                        tabs={onlineTabs}
                        tabsLabel={onlineTabsLabel}
                    />
                ) : homeViewTab === 'local' ? (
                    <div className="w-full h-full flex-1">
                        <LocalGrid3DView
                            localSongs={localSongs}
                            localLibraryCatalog={localLibraryCatalog}
                            activeRow={localMusicState.activeRow}
                            setActiveRow={(row) => setLocalMusicState(prev => ({ ...prev, activeRow: row }))}
                            focusedFolderIndex={localMusicState.focusedFolderIndex}
                            setFocusedFolderIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedFolderIndex: index }))}
                            focusedAlbumIndex={localMusicState.focusedAlbumIndex}
                            setFocusedAlbumIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedAlbumIndex: index }))}
                            focusedArtistIndex={localMusicState.focusedArtistIndex}
                            setFocusedArtistIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedArtistIndex: index }))}
                            homeActions={homeActions}
                            directoryTreesResource={homeResources.localDirectoryTrees}
                            directoryKey={directoryKey}
                            theme={theme}
                            isDaylight={isDaylight}
                            isInteractive={isInteractive}
                            hasFloatingPlayer={Boolean(currentTrack)}
                            onOpenGridView={onOpenGridView}
                            directoryActions={directoryActions}
                            declaredHomeActions={declaredActions}
                        />
                    </div>
                ) : (
                    <div className="w-full h-full flex-1">
                        <NavidromeGrid3DView
                            theme={theme}
                            isDaylight={isDaylight}
                            isInteractive={isInteractive}
                            focusedAlbumIndex={navidromeFocusedAlbumIndex}
                            setFocusedAlbumIndex={setNavidromeFocusedAlbumIndex ?? (() => { })}
                            hasFloatingPlayer={Boolean(currentTrack)}
                            homeActions={homeActions}
                            overview={homeResources.navidromeOverview}
                            directoryKey={directoryKey}
                            declaredHomeActions={declaredActions}
                            onOpenSettings={() => onOpenSettings?.('help')}
                            onOpenGridView={onOpenGridView}
                        />
                    </div>
                )}
            </div>

            {/* The active account and the way back to the player; the sign-in window opens from it. */}
            <SwitcherPill account={account} onBackToPlayer={onBackToPlayer} />

        </div>
    );
};

export default Grid3D;
