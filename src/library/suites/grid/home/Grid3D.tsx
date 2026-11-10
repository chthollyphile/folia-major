import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, Settings, PanelsTopLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { resolveSearchSource, useSearchNavigationStore } from '../../../../stores/useSearchNavigationStore';
import { useShallow } from 'zustand/react/shallow';
import { SongResult, LocalSong, LocalPlaylist, LocalLibraryGroup, Theme, type StatusMessage } from '../../../../types';
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
import type { LibraryHomeCard, LibraryHomeListState } from '../../../core/home/homeModel.contract';
import { useLibraryHomeSources } from '../../../core/home/useLibraryHomeSources';
import { useLibraryHomeOnline } from '../../../core/home/online/useLibraryHomeOnline';
import { useLibraryHomeActions } from '../../../core/home/useLibraryHomeActions';
import { useLibraryHomeDirectory } from '../../../core/home/useLibraryHomeDirectory';
import { useLibraryHomeListRegistration, useLibraryHomeTabsRegistration } from '../../../core/home/useLibraryHomeSurfaceRegistration';
import { cycleIndex } from '../../../core/home/homeSources';
import { useUpdateIndicator } from '../../../../hooks/useUpdateIndicator';

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
    localPlaylists: LocalPlaylist[];
    onRefreshLocalSongs: () => Promise<void> | void;
    localMusicState: {
        activeRow: 0 | 1 | 2 | 3;
        selectedGroup: LocalLibraryGroup | null;
        detailStack: LocalLibraryGroup[];
        detailOriginView: 'home' | 'player' | null;
        focusedFolderIndex: number;
        focusedAlbumIndex: number;
        focusedArtistIndex: number;
        focusedPlaylistIndex: number;
    };
    setLocalMusicState: React.Dispatch<React.SetStateAction<{
        activeRow: 0 | 1 | 2 | 3;
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
    } = useSearchNavigationStore(useShallow(state => ({
        searchQuery: state.searchQuery,
        setSearchQuery: state.setSearchQuery,
        isSearching: state.isSearching,
        submitSearch: state.submitSearch,
    })));

    // 来源、页签与在线列表都来自 Library Core 的首页模型（core/home/homeSources、homeCards 与首页资源）；
    // 这里只剩展示：布局、登录入口、更新徽标、扫描进度胶囊。
    const homeSources = useLibraryHomeSources({
        account,
        user,
        playlists,
        cloudPlaylist,
        navidromeEnabled,
    });
    const { tab: homeViewTab, setTab: setHomeViewTab, isOnlineTab, online, tabs: homeTabs } = homeSources;
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
    const [scanDetailsExpanded, setScanDetailsExpanded] = useState(false);

    const showUpdateIndicator = useUpdateIndicator();

    // Reset focused index when switching tabs.
    useEffect(() => {
        setFocusedIndex(0);
    }, [homeViewTab]);

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
        getState: () => ({ active: homeViewTab, tabs: homeTabs }),
        setTab: tab => {
            const target = homeTabs.find(candidate => candidate.key === tab);
            if (!target || target.disabledReason) return false;
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
    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const query = searchQuery.trim();
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

    const isSearchingActive = isSearching;

    // Background style mappings
    const mainBg = isDaylight ? 'bg-white/40' : 'bg-black/20';
    const inputBg = isDaylight ? 'bg-black/5 focus:bg-black/10' : 'bg-white/5 focus:bg-white/10';
    const navPillBg = isDaylight ? 'bg-black/5' : 'bg-white/10';
    const navPillInactiveText = isDaylight ? 'text-black/60 hover:text-black' : 'text-white/60 hover:text-white';
    const activeTabBg = isDaylight ? 'text-black font-bold' : 'text-black';

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
    useGrid3DTabKeys({
        isActive: isInteractive,
        onCycleTab: delta => {
            const next = cycleIndex(navigationTabs, navigationTabs.findIndex(tab => tab.id === homeViewTab), delta, tab => tab.enabled);
            if (next < 0 || navigationTabs[next].id === homeViewTab) return;
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
                <div className="grid grid-cols-2 md:grid-cols-3 items-center w-full max-w-7xl mx-auto p-4 md:p-8 gap-y-4 md:gap-y-0">
                    {/* Left title and settings */}
                    <div className="flex items-center justify-start order-1 md:order-none">
                        <h1 className="text-2xl font-bold tracking-tight opacity-90 flex items-center gap-3">
                            Folia
                        </h1>
                        <button
                            onClick={() => onOpenSettings?.('help')}
                            className={`relative flex items-center gap-1.5 p-2 rounded-full hover:bg-white/10 transition-all ml-4 ${showUpdateIndicator
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

                    {/* Center Tab Switcher */}
                    <div className="flex justify-center order-3 md:order-none col-span-2 md:col-span-1">
                        <div className={`relative ${navPillBg} backdrop-blur-md p-1 rounded-full scale-90 md:scale-100 origin-center`}>
                            <div className="inline-flex items-center gap-0">
                                {homeTabs.map((tab) => {
                                    const isActive = homeViewTab === tab.key;
                                    return (
                                        <span
                                            key={tab.key}
                                            title={tab.disabledReason || tab.label}
                                            className="inline-flex"
                                        >
                                            <button
                                                disabled={Boolean(tab.disabledReason)}
                                                aria-label={tab.disabledReason || tab.label}
                                                onClick={() => {
                                                    setHomeViewTab(tab.key);
                                                    focusActiveSlider();
                                                }}
                                                className={`relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-35 ${isActive ? activeTabBg : navPillInactiveText}`}
                                            >
                                                {isActive && (
                                                    <motion.span
                                                        layoutId="home-active-tab-pill-desktop"
                                                        className="absolute inset-0 rounded-full bg-white shadow-sm"
                                                        transition={{ type: 'spring', stiffness: 460, damping: 36, mass: 0.9 }}
                                                    />
                                                )}
                                                <span className="relative z-10">{tab.label}</span>
                                            </button>
                                        </span>
                                    );
                                })}
                                {props.extraTabs?.map(tab => (
                                    <button key={tab.id} type="button" onClick={tab.select}
                                        className={`relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs md:text-sm font-medium whitespace-nowrap ${navPillInactiveText}`}>
                                        {tab.label}
                                    </button>
                                ))}
                                {stageEnabled && (
                                    <button
                                        onClick={() => onOpenStagePlayer?.()}
                                        data-stage-active={stageIsActive ? 'true' : 'false'}
                                        className={`relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${navPillInactiveText}`}
                                    >
                                        <span className="relative z-10">{t('home.stage')}</span>
                                    </button>
                                )}
                                {/* 播放队列的海报视图和 Stage 一样属于「去哪儿」，所以它在这一排，
                                    而不是标题旁的工具图标。没有在播歌曲时队列也是空的，直接不出现。
                                    平时只占一个图标的宽度，指针悬停或键盘聚焦时才展开文字——这一排
                                    已经有五个内容 tab，多一个常驻文字就把胶囊撑得太长。点击始终直达。
                                    在「探索」页签上它打开的是同一面墙，铺的是探索页的条目（探索拼贴）：
                                    探索页有条目可铺时出现，不看有没有在播歌曲。 */}
                                {onOpenLattice && (opensExploreWall ? hasExploreWall : currentTrack) && (
                                    <button
                                        onClick={() => onOpenLattice(opensExploreWall ? 'explore' : 'queue')}
                                        data-testid="home-lattice-pill"
                                        title={t(opensExploreWall ? 'home.latticeExplore' : 'home.lattice')}
                                        aria-label={t(opensExploreWall ? 'home.latticeExplore' : 'home.lattice')}
                                        className={`group relative inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${navPillInactiveText}`}
                                    >
                                        <PanelsTopLeft size={14} className="relative z-10 shrink-0" />
                                        <span
                                            aria-hidden="true"
                                            className="relative z-10 max-w-0 overflow-hidden opacity-0 transition-all duration-300 ease-out group-hover:ml-1.5 group-hover:max-w-28 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-28 group-focus-visible:opacity-100"
                                        >
                                            {t(opensExploreWall ? 'home.latticeExplore' : 'home.latticeLabel')}
                                        </span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Search Bar */}
                    <div className="flex justify-end order-2 md:order-none">
                        <form onSubmit={handleSearch} className="relative w-full md:w-56 transition-all focus-within:md:w-72">
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
                                className={`w-full ${inputBg} border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-white/20 transition-all placeholder:text-current placeholder:opacity-40 select-text`}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </form>
                    </div>
                </div>
            </div>

            {/* Desktop Canvas Surface */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center relative">
                {isOnlineTab && activeAccountView === 'accountless' ? (
                    <OnlineProviderAccountlessPanel
                        providerLabel={activeProviderLabel}
                        isDaylight={isDaylight}
                        onSearch={() => searchInputRef.current?.focus()}
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
                    />
                ) : homeViewTab === 'local' ? (
                    <div className="w-full h-full flex-1">
                        <LocalGrid3DView
                            localSongs={localSongs}
                            localPlaylists={localPlaylists}
                            localLibraryCatalog={localLibraryCatalog}
                            activeRow={localMusicState.activeRow}
                            setActiveRow={(row) => setLocalMusicState(prev => ({ ...prev, activeRow: row }))}
                            focusedFolderIndex={localMusicState.focusedFolderIndex}
                            setFocusedFolderIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedFolderIndex: index }))}
                            focusedAlbumIndex={localMusicState.focusedAlbumIndex}
                            setFocusedAlbumIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedAlbumIndex: index }))}
                            focusedArtistIndex={localMusicState.focusedArtistIndex}
                            setFocusedArtistIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedArtistIndex: index }))}
                            focusedPlaylistIndex={localMusicState.focusedPlaylistIndex}
                            setFocusedPlaylistIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedPlaylistIndex: index }))}
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
