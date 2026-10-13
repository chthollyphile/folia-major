import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, Settings, PanelsTopLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { resolveSearchSource, useSearchNavigationStore } from '../../../../stores/useSearchNavigationStore';
import { useShallow } from 'zustand/react/shallow';
import { SongResult, LocalSong, LocalPlaylist, LocalLibraryGroup, Theme, type StatusMessage } from '../../../../types';
import LocalGrid3DView from './LocalGrid3DView';
import NavidromeGrid3DView from './NavidromeGrid3DView';
import { useGrid3DTabKeys } from './useGrid3DTabKeys';
import DesktopGrid3DSurface, { type DesktopGrid3DAction } from './DesktopGrid3DSurface';
import { useHomeCardPositionStore } from '../../../../stores/useHomeCardPositionStore';
import OnlineProviderSwitcher from '../account/OnlineProviderSwitcher';
import OnlineProviderConnectPanel from '../account/OnlineProviderConnectPanel';
import OnlineProviderAccountlessPanel from '../account/OnlineProviderAccountlessPanel';
import type { ProviderAccountSummary, ProviderCollection, ProviderUser } from '../../../../types/onlineMusic';
import { useThemeSettingsStore } from '../../../../stores/useThemeSettingsStore';
import { countRender } from '../../../../dev/renderCount';
import type { LibraryAccountController } from '../../../core/contracts/account';
import type { LibraryDirectoryBatchController } from '../../../core/contracts/directory';
import type { LibraryLocalCatalogSnapshot } from '../../../core/contracts/home';
import type { LibraryHomeResources } from '../../../core/contracts/homeModel';
import type { LibraryDeclaredActions } from '../../../core/contracts/suite';
import type { LibraryHomeCard, LibraryHomeListState } from '../../../core/contracts/homeModel';
import { useLibraryHomeSources } from '../../../core/bindings/useLibraryHomeSources';
import { useCategorySongLists } from '../../../core/bindings/useCategorySongLists';
import { canReuseCategorySongLists, categoryScopeOf } from '../../../core/model/categorySelectionState';
import { CategoryFilterPanel } from '../shared/CategoryFilterPanel';
import type { CategorySelection } from '../../../core/model/categorySelectionState';
import { RefreshCw, ListFilter } from 'lucide-react';
import { omni } from '../../../../services/onlineMusic/omni';
import type { ProviderSongListCategoryGroup } from '../../../../types/onlineMusic';
import { useLibraryHomeOnline } from '../../../core/bindings/useLibraryHomeOnline';
import { useLibraryHomeActions } from '../../../core/bindings/useLibraryHomeActions';
import { useLibraryHomeDirectory } from '../../../core/bindings/useLibraryHomeDirectory';
import { useLibraryHomeListRegistration, useLibraryHomeTabsRegistration } from '../../../core/bindings/useLibraryHomeSurfaceRegistration';
import { useLibraryAccountProviders } from '../../../core/bindings/useLibraryAccount';
import { resolveProviderSelectLabel } from '../../../core/model/accountRules';
import { cycleIndex, translateHomeMessage } from '../../../core/model/homeSources';

// src/library/suites/grid/home/Grid3D.tsx
// Glassmorphic interactive desktop home view replacing the legacy 3D carousel.
// Supports cover sliding with auto-fading header controls and delegates GridView opening upward.

interface Grid3DProps {
    /** 在线账户 controller（宿主创建，见 LibraryHomeSurfaceProps）：切换器与连接面板经它选平台、登出。 */
    account: LibraryAccountController;
    /** 账户界面（登录弹窗）的挂载点，接在平台切换器之前（见 LibraryHomeSurfaceProps）。 */
    accountLayerRef?: (element: HTMLElement | null) => void;
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
    onOpenLattice?: () => void;
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
    /** 网格 suite 在 entry 里声明的首页动作（宿主经 registry 传入）：GridMap 的目录 surface 只发布声明 ∩ core 判定。 */
    declaredActions?: LibraryDeclaredActions;
}

export const Grid3D: React.FC<Grid3DProps> = (props) => {
    countRender('Grid3D');
    const {
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
        onStatusMessage,
        stageEnabled = false,
        stageIsActive = false,
        onOpenStagePlayer,
        account,
        accountLayerRef,
        isInteractive = true,
        directoryActions,
        homeResources,
        declaredActions,
    } = props;

    const { t } = useTranslation();
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

    // 来源、页签与在线列表都来自 Library Core 的首页模型（core/model/homeSources、homeCards 与首页资源）；
    // 这里只剩展示：布局、二维码登录、更新徽标、扫描进度胶囊。
    // 发现页的相似段跟着「此刻在听」的那首走：种子必须与当前音源同源
    // （A 家歌的数字 id 拿去打 B 家的相似接口只会问到无关的歌，跨源时宁可整段不出）。
    const discoverSeed = useMemo(() => (
        currentTrack && currentTrack.sourceRef?.kind === 'online'
            ? { id: String(currentTrack.id), ...(currentTrack.name ? { name: currentTrack.name } : {}) }
            : null
    ), [currentTrack]);

    const homeSources = useLibraryHomeSources({
        account,
        user,
        playlists,
        cloudPlaylist,
        navidromeEnabled,
        discoverSeed,
    });
    const { tab: homeViewTab, setTab: setHomeViewTab, isOnlineTab, online, tabs: homeTabs } = homeSources;
    const activeProviderId = online.providerId;
    const activeProviderSummary = online.provider;
    const activeProviderLabel = online.providerLabel;
    const activeUser = online.user;
    const activeAccountView = online.accountView;
    const activeProviderNeedsRelogin = online.needsRelogin;
    const onlineList = useLibraryHomeOnline(homeResources, homeSources);
    // 商铺分类：状态机在 core（两条契约：跨 tab 保留筛选、切回来复用已拉过的那批）。
    // 分类能力只看当前 provider 有没有声明（QQ/酷狗/网易各有自己的分类 id 空间）。
    const canBrowseCategories = omni.canBrowseSongListCategories(online.providerId);
    const [categoryGroups, setCategoryGroups] = useState<ProviderSongListCategoryGroup[]>([]);
    useEffect(() => {
        if (!canBrowseCategories) {
            setCategoryGroups([]);
            return undefined;
        }
        let cancelled = false;
        omni.getSongListCategories(online.providerId)
            .then(groups => { if (!cancelled) setCategoryGroups(groups); })
            .catch(error => {
                console.warn('[Grid3D] category groups failed', error);
                if (!cancelled) setCategoryGroups([]);
            });
        return () => { cancelled = true; };
    }, [canBrowseCategories, online.providerId]);

    const {
        categorySelected,
        setCategorySelected,
        categoryPanelOpen,
        setCategoryPanelOpen,
        categorySongLists,
        loadingCategory,
        categoryError,
    } = useCategorySongLists({
        isActiveTab: homeViewTab === 'radio',
        activeProviderId: online.providerId,
        loadCategorySongLists: categoryId => omni
            .getCategorySongLists(online.providerId, categoryId, { limit: 35, offset: 0 })
            .then(page => page.items),
        onError: () => onStatusMessage?.({ type: 'error', text: t('home.categoryLoadFailed') }),
    });
    const homeActions = homeResources.actions;
    const { snapshot: homeActionState, scanPercent: scanProgressPercent } = useLibraryHomeActions(homeActions);
    const scanProgress = homeActionState.scan;
    // 当前列表的目录会话 key 与隐藏作用域只在首页模型里算一次（core/model/homeSources），交给三个列表视图。
    const { directoryKey, hiddenScope } = useLibraryHomeDirectory({
        tab: homeViewTab,
        providerId: activeProviderId,
        localRow: localMusicState.activeRow,
    });
    // 在线列表只在账户已就绪时显示（无账户 / 解析中 / 未登录各有面板）。
    const showOnlineList = isOnlineTab
        && activeAccountView !== 'accountless'
        && activeAccountView !== 'resolving'
        && activeAccountView !== 'guest';

    const [focusedIndex, setFocusedIndex] = useState(0);
    // 卡片焦点记忆的作用域：与 surface 的 focusMemoryScope 同一份串，换一批后要把这份记忆清掉。
    const homeCardFocusScope = useMemo(
        () => JSON.stringify(['online', online.providerId, online.user?.id ?? null, homeViewTab]),
        [homeViewTab, online.providerId, online.user?.id],
    );
    // 已经拉过的分类作用域（provider:categoryId）：状态机据此判断能不能复用，不由组件自己判断。
    const categorySongListsScopeRef = useRef<string | null>(null);
    const gridRootRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [scanDetailsExpanded, setScanDetailsExpanded] = useState(false);

    const [updateStatus, setUpdateStatus] = useState<any>(null);

    useEffect(() => {
        if (!window.electron?.getUpdateStatus) {
            return;
        }

        let disposed = false;

        window.electron.getUpdateStatus().then((status) => {
            if (!disposed) {
                setUpdateStatus(status);
            }
        }).catch(() => {
            if (!disposed) {
                setUpdateStatus(null);
            }
        });

        const unsubscribe = window.electron.onUpdateStatusChanged?.((status) => {
            setUpdateStatus(status);
        });

        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, []);

    const showUpdateIndicator = Boolean(
        updateStatus?.updateCheckEnabled &&
        updateStatus.availableVersion &&
        !updateStatus.updateSeen
    );

    // Reset focused index when switching tabs.
    useEffect(() => {
        setFocusedIndex(0);
    }, [homeViewTab]);

    // 选平台、登出都交给账户 controller（选哪一支的规则、登录、切换确认都在 core；登录弹窗与确认框由账户宿主渲染）。
    const { providers: accountProviders } = useLibraryAccountProviders(account);
    // Shared by the switcher and the connect panel: switch now when there is nothing to sign in to.
    const selectProvider = (provider: ProviderAccountSummary) => {
        void account.selectProvider(provider.providerId);
    };

    useEffect(() => {
        setFocusedIndex(0);
    }, [activeProviderId, activeUser?.id]);

    // 分类筛选时，商铺页签换成那一批歌单。分类是上游内部键，换音源必须清（状态机在 core 里守着）。
    const categoryCards = useMemo<LibraryHomeCard[]>(() => {
        if (homeViewTab !== 'radio' || !categorySelected) return [];
        const scope = categoryScopeOf(online.providerId, categorySelected.itemId);
        // 已经拉过这一批就直接复用：切走再回来不该重拉、也不该闪骨架。
        if (!canReuseCategorySongLists(
            categorySongListsScopeRef.current,
            scope,
            categorySongLists.length,
        )) return onlineList.items;
        return categorySongLists.map(collection => ({
            id: collection.id,
            name: collection.name,
            coverUrl: collection.coverUrl,
            trackCount: collection.trackCount,
            description: collection.creator?.nickname || t('home.playlists'),
            summary: collection.description || '',
            type: collection.type,
            raw: collection,
        }));
    }, [homeViewTab, categorySelected, categorySongLists, online.providerId, onlineList.items, t]);

    const visibleItems = categoryCards.length > 0 ? categoryCards : onlineList.items;

    // 发现页的「换一批」：整批替换后回到头部，否则停在第 30 张时看到的仍是「第 30 张」——
    // 而新批的第 30 张与旧批完全不同，用户会以为后面的没换。
    const discoverActions = useMemo<DesktopGrid3DAction[]>(() => (
        homeViewTab === 'discover'
            ? [{
                id: 'refresh-discover',
                label: onlineList.isLoading ? t('options.scanning') : t('home.discoverRefresh'),
                icon: onlineList.isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />,
                disabled: onlineList.isLoading,
                onClick: () => {
                    useHomeCardPositionStore.getState().forget(homeCardFocusScope);
                    void homeResources.discoverFeed.swapBatch(discoverSeed ? { seedSongId: discoverSeed.id, seedSongName: discoverSeed.name } : {});
                },
                title: t('home.discoverRefresh'),
            }]
            : []
    ), [discoverSeed, homeCardFocusScope, homeResources.discoverFeed, homeViewTab, onlineList.isLoading, t]);

    // 分类面板的入口（只在当前 provider 真的有分类时出现；空数组时不告诉用户「没这个功能」）。
    const radioActions = useMemo<DesktopGrid3DAction[]>(() => (
        homeViewTab === 'radio' && categoryGroups.length > 0
            ? [{
                id: 'category-filter',
                label: categorySelected ? categorySelected.itemLabel : t('home.categoryTitle'),
                icon: <ListFilter size={13} />,
                active: categoryPanelOpen || Boolean(categorySelected),
                onClick: () => setCategoryPanelOpen(open => !open),
                title: t('home.categoryTitle'),
            }]
            : []
    ), [categoryGroups.length, categoryPanelOpen, categorySelected, homeViewTab, setCategoryPanelOpen, t]);

    // 空态要跟失败分开：选了分类却拉不到，默认「暂无内容」会让用户以为这个分类真的没有歌单。
    const onlineEmptyMessage = homeViewTab === 'radio' && categorySelected && categoryError
        ? categoryError
        : onlineList.emptyMessage;

    // Delegate GridView opening to the app-level host so Grid3D remains only the home surface.
    // If Personal FM is clicked, it plays Personal FM directly instead of opening GridView.
    const handleSelectCollectionCard = (card: LibraryHomeCard) => {
        // 集合卡与歌曲卡都走同一个动作：core 认歌曲卡（点卡即播，队列用所在段的那一批，
        // FM 段带 isFmCall 进 FM 模式），也认私人 FM 卡（直接播放），其余按集合打开。
        void homeActions.openOnlineCard(card, activeProviderId, collection => onOpenGridView?.(collection));
    };

    // 首页模型交给 core 的首页 surface 句柄：页签条，以及在线页签的列表（本地与 Navidrome 由各自的视图注册）。
    useLibraryHomeTabsRegistration({
        getState: () => ({ active: homeViewTab, tabs: homeTabs }),
        setTab: tab => {
            const target = homeTabs.find(candidate => candidate.key === tab);
            if (!target || target.disabledReason) return false;
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
    useGrid3DTabKeys({
        isActive: isInteractive,
        onCycleTab: delta => {
            const next = cycleIndex(homeTabs, homeTabs.findIndex(tab => tab.key === homeViewTab), delta, tab => !tab.disabledReason);
            if (next < 0 || homeTabs[next].key === homeViewTab) return;
            setHomeViewTab(homeTabs[next].key);
            focusActiveSlider();
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
                                    已经有五个内容 tab，多一个常驻文字就把胶囊撑得太长。点击始终直达。 */}
                                {onOpenLattice && currentTrack && (
                                    <button
                                        onClick={onOpenLattice}
                                        data-testid="home-lattice-pill"
                                        title={t('home.lattice')}
                                        aria-label={t('home.lattice')}
                                        className={`group relative inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${navPillInactiveText}`}
                                    >
                                        <PanelsTopLeft size={14} className="relative z-10 shrink-0" />
                                        <span
                                            aria-hidden="true"
                                            className="relative z-10 max-w-0 overflow-hidden opacity-0 transition-all duration-300 ease-out group-hover:ml-1.5 group-hover:max-w-28 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-28 group-focus-visible:opacity-100"
                                        >
                                            {t('home.latticeLabel')}
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
                    <OnlineProviderConnectPanel
                        providers={accountProviders}
                        isDaylight={isDaylight}
                        title={activeProviderNeedsRelogin ? t('status.loginExpired') : t('home.guestTitle')}
                        prompt={activeProviderNeedsRelogin
                            ? t('home.guestPromptProvider', {
                                provider: activeProviderSummary?.shortName || activeProviderSummary?.displayName || activeProviderId,
                            })
                            : t('home.guestPrompt')}
                        getActionLabel={provider => translateHomeMessage(t, resolveProviderSelectLabel(provider))}
                        onSelect={selectProvider}
                    />
                ) : showOnlineList ? (
                    <DesktopGrid3DSurface
                        focusMemoryScope={JSON.stringify(['online', activeProviderId, activeUser?.id ?? null, homeViewTab])}
                        title={homeViewTab === 'discover' ? t('home.discover') : onlineList.title}
                        mapButtonLabel={homeViewTab === 'discover' ? t('home.allSongs') : t('home.allAlbums')}
                        items={visibleItems}
                        focusedIndex={focusedIndex}
                        onFocusedIndexChange={setFocusedIndex}
                        onSelect={item => handleSelectCollectionCard(item as LibraryHomeCard)}
                        actions={discoverActions.length > 0 ? discoverActions : radioActions}
                        actionOverlay={
                            homeViewTab === 'radio' && categoryPanelOpen && categoryGroups.length > 0 ? (
                                <CategoryFilterPanel
                                    groups={categoryGroups}
                                    isDaylight={isDaylight}
                                    selected={categorySelected}
                                    onSelect={(selection: CategorySelection | null) => {
                                        setCategorySelected(selection);
                                        // 换一批同样道理：整批替换后回到头部。
                                        useHomeCardPositionStore.getState().forget(homeCardFocusScope);
                                    }}
                                    onClose={() => setCategoryPanelOpen(false)}
                                />
                            ) : null
                        }
                        isLoading={onlineList.isLoading || (homeViewTab === 'radio' && loadingCategory)}
                        emptyMessage={onlineEmptyMessage}
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

            {/* 账户界面（登录弹窗）的挂载点：账户宿主把弹窗 portal 进来。放在切换器之前，切换器仍盖在弹窗之上。 */}
            <div ref={accountLayerRef} data-library-account-layer="" className="contents" />

            <OnlineProviderSwitcher
                providers={accountProviders}
                activeProviderId={activeProviderId}
                isDaylight={isDaylight}
                onBackToPlayer={onBackToPlayer}
                onSelect={selectProvider}
                onLogout={provider => {
                    void account.logout(provider.providerId);
                }}
            />

        </div>
    );
};

export default Grid3D;
