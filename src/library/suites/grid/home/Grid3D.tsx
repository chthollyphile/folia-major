import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
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
import type { LibraryHomeCard, LibraryHomeListState, LibraryHomeTabKey } from '../../../core/home/homeModel.contract';
import { useLibraryHomeSources } from '../../../core/home/useLibraryHomeSources';
import { useLibraryHomeOnline } from '../../../core/home/online/useLibraryHomeOnline';
import { useLibraryHomeActions } from '../../../core/home/useLibraryHomeActions';
import { useLibraryHomeDirectory } from '../../../core/home/useLibraryHomeDirectory';
import { useLibraryHomeListRegistration, useLibraryHomeTabsRegistration } from '../../../core/home/useLibraryHomeSurfaceRegistration';
import { useGridMapVisibilityStore } from './gridMapVisibilityStore';
import { cycleIndex, isOnlineHomeTab } from '../../../core/home/homeSources';
import { useUpdateIndicator } from '../../../../hooks/useUpdateIndicator';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { useGlass } from '@/shinoinject/useGlass';
import { useHomeTabThumb } from './useHomeTabThumb';

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

// 一级页签切换时整块首页视图的横向位移：往页签顺序的右边走就从右边进、旧视图往左出，反向往回。
// 位移量取整屏宽（100%），进出两页首尾相接、切换过程中互不重叠（之前只有 40px，两页几乎叠在一起）。
// 进出都只做 x 位移、不做 opacity：Chromium 会在祖先做 opacity 动画时丢掉后代的 backdrop-filter，
// 视图内的 data-glass 面板会在整段切换动画期间不显示、动画结束才出现。只动 x（transform）没这个问题，
// 所以旧页也不淡出、直接滑出去，动画结束再转回 hidden。
const HOME_SURFACE_SLIDE_PERCENT = 100;

// 页签层内容包装：非活动层跳过重渲染（视图已常驻，父级的输入框、焦点等 state 变化不该再牵动它），
// 活动层每次都重渲染以拿到最新 props。切换时 isActive 变化，比较器放行，自然重渲染。
const HomeTabLayerContent = React.memo(
    function HomeTabLayerContent({ surface }: { surface: React.ReactNode; isActive: boolean }) {
        return <>{surface}</>;
    },
    (prev, next) => !prev.isActive && !next.isActive,
);

// 进出同时进行（各层都在，靠 animate 目标变化换位），旧视图淡出、新视图滑入，容器 overflow-hidden 裁掉横移。
// 用同一条 easeOut 曲线、同一个时长，横移与淡出一起落定，看起来才是一块内容在滑动而不是两段动画。
const HOME_SURFACE_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };

// 不常驻的页签：切走就卸载（退场动画放完即卸），再进来重新挂载、重新走一遍进入时的加载，不管上一次读没读完。
// 探索页重新渲染本身就重（页签自己那条 1 秒加载环就是为它加的），留着常驻不如每次干净重挂。
const TRANSIENT_TABS = new Set<LibraryHomeTabKey>(['explore']);

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

    // 直接跟随 homeViewTab（不再 useDeferredValue 推迟）：首页视图按页签常驻缓存（见下方 shownTabs 页签层），
    // 切页签只切换可见层、不重挂重算，所以不需要把渲染排到低优先级——那种做法会让新视图晚一拍才出现。
    const shownTab = homeViewTab;
    const shownIsOnlineTab = isOnlineHomeTab(shownTab);
    const shownShowOnlineList = shownIsOnlineTab
        && shownTab !== 'explore'
        && activeAccountView !== 'accountless'
        && activeAccountView !== 'resolving'
        && activeAccountView !== 'guest';

    // 进出方向按页签在一级页签里的先后定：向后面的页签走，新视图从右侧进（direction=1）。
    const shownTabIndex = homeTabs.findIndex(tab => tab.key === shownTab);
    const prevTabIndexRef = useRef(shownTabIndex);
    const tabDirection = shownTabIndex === prevTabIndexRef.current
        ? 0
        : shownTabIndex > prevTabIndexRef.current ? 1 : -1;
    useEffect(() => {
        prevTabIndexRef.current = shownTabIndex;
    }, [shownTabIndex]);

    const reduceMotion = useReducedMotionFor('uiMicroMotion');

    const onlineList = useLibraryHomeOnline(homeResources, { ...homeSources, tab: shownTab });
    const homeActions = homeResources.actions;
    const { snapshot: homeActionState, scanPercent: scanProgressPercent } = useLibraryHomeActions(homeActions);
    const scanProgress = homeActionState.scan;
    // 当前列表的目录会话 key 与隐藏作用域只在首页模型里算一次（core/home/homeSources），交给三个列表视图。
    const { directoryKey, hiddenScope } = useLibraryHomeDirectory({
        tab: shownTab,
        providerId: activeProviderId,
        localRow: localMusicState.activeRow,
    });
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
        enabled: shownShowOnlineList,
        getState: (): LibraryHomeListState => ({
            tab: shownTab,
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
    const navPillInactiveText = isDaylight ? 'text-black/60 hover:text-black' : 'text-white/60 hover:text-white';
    const activeTabBg = 'text-#fff';

    const bottomPadding = currentTrack ? 'pb-28 md:pb-32' : '';

    const focusActiveSlider = () => {
        requestAnimationFrame(() => {
            gridRootRef.current
                ?.querySelector<HTMLElement>('[data-grid3d-slider]')
                ?.focus({ preventScroll: true });
        });
    };

    // 白色摇杆：脱离 button 的独立元素，可拖动、拖动时放大、按所在页签激活；点击页签时自动吸附。
    const pillTrackRef = useRef<HTMLDivElement>(null);
    const { thumbLeft, thumbWidth, thumbDragging, thumbScale, thumbHandlers } =
        useHomeTabThumb({
            trackRef: pillTrackRef,
            items: homeTabs.map(tab => ({
                key: tab.key,
                disabled: Boolean(tab.disabledReason),
            })),
            activeKey: homeViewTab,
            onActivate: setHomeViewTab,
            onTapActive: focusActiveSlider,
        });

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

    // ---- 首页页签层（keep-alive）----
    // 访问过的页签各自常驻一层，切页签只切换可见性与横向位移，不重挂视图：不丢玻璃位移图、不重解码封面、
    // 不重跑各自一堆 effect。这是切换不再卡顿的关键，也正因为如此才敢去掉 useDeferredValue 的推迟渲染。
    const [visitedTabs, setVisitedTabs] = useState<LibraryHomeTabKey[]>(() => (TRANSIENT_TABS.has(shownTab) ? [] : [shownTab]));
    // 正在退场的层（做淡出动画，动画结束后转回 hidden）。切走时把上一层记进来，切回时把它剔出去。
    const [exitingTabs, setExitingTabs] = useState<LibraryHomeTabKey[]>([]);
    const prevShownTabRef = useRef(shownTab);
    // 每层的在线列表 / 目录会话快照：切走时留着，隐藏层用快照渲染，避免它拿到当前活动页签的数据。
    const tabSnapshotRef = useRef(new Map<string, {
        onlineList: typeof onlineList;
        directoryKey: string;
        hiddenScope: typeof hiddenScope;
    }>());

    useEffect(() => {
        setVisitedTabs(prev => (prev.includes(shownTab) ? prev : [...prev, shownTab]));
    }, [shownTab]);

    // 用 useLayoutEffect：切页签后本就该在这一帧画之前把「上一层」标成退场可见，否则它会先闪一下消失。
    useLayoutEffect(() => {
        const from = prevShownTabRef.current;
        prevShownTabRef.current = shownTab;
        setExitingTabs(prev => {
            const next = new Set(prev);
            next.delete(shownTab);
            if (from !== shownTab) next.add(from);
            return Array.from(next);
        });
    }, [shownTab]);

    useEffect(() => {
        tabSnapshotRef.current.set(shownTab, { onlineList, directoryKey, hiddenScope });
    }, [shownTab, onlineList, directoryKey, hiddenScope]);

    // 渲染的层：访问过 + 正在退场的 + 当前（已移除的页签不再渲染）。活动层排最后，同 z-index 时画在上层。
    const tabKeySet = new Set(homeTabs.map(tab => tab.key));
    tabKeySet.add(shownTab);
    const orderedLayerKeys = Array.from(new Set([...visitedTabs, ...exitingTabs, shownTab]))
        .filter(key => tabKeySet.has(key))
        .sort((a, b) => Number(a === shownTab) - Number(b === shownTab));
    // 某层相对活动页签的横向停靠位：在活动页签右边就停在 +offset（从右侧滑入），左边反之。
    const layerOffsetX = (key: LibraryHomeTabKey) => {
        const idx = homeTabs.findIndex(tab => tab.key === key);
        if (idx < 0 || idx === shownTabIndex) return 0;
        return idx > shownTabIndex ? 1 : -1;
    };

    // 单个页签层的内容：活动层用实时数据，非活动层用切走时的快照。活动层才可交互。
    const renderTabSurface = (key: LibraryHomeTabKey, isActive: boolean): React.ReactNode => {
        const snap = isActive
            ? { onlineList, directoryKey, hiddenScope }
            : tabSnapshotRef.current.get(key) ?? { onlineList, directoryKey, hiddenScope };
        const { onlineList: list, directoryKey: dirKey, hiddenScope: scope } = snap;
        const interactive = isInteractive && isActive;
        if (isOnlineHomeTab(key) && activeAccountView === 'accountless') {
            return (
                <OnlineProviderAccountlessPanel
                    providerLabel={activeProviderLabel}
                    isDaylight={isDaylight}
                    onSearch={() => searchInputRef.current?.focus()}
                />
            );
        }
        if (isOnlineHomeTab(key) && activeAccountView === 'resolving') {
            return (
                <div className="flex flex-1 w-full items-center justify-center" aria-busy="true">
                    <Loader2 className="animate-spin opacity-30" size={28} />
                </div>
            );
        }
        if (isOnlineHomeTab(key) && activeAccountView === 'guest') {
            // One button: it opens the sign-in window, where the platform is chosen.
            return <HomeLoginPanel account={account} />;
        }
        if (key === 'explore') {
            if (!online.canUseExplore) return null;
            return (
                <ExploreSurface
                    // Another platform or account starts from its own: how far a section was opened is not carried over.
                    key={`${activeProviderId}:${activeUser?.id ?? ''}`}
                    providerId={activeProviderId}
                    accountId={String(activeUser?.id ?? '')}
                    scope={`${activeUser?.id ?? ''}:${i18n.language}`}
                    onPlaySong={(song, queue) => onPlaySong(song, queue, false)}
                    onOpenCollection={collection => onOpenGridView?.(createOnlineGridViewCollection(collection, activeProviderId))}
                />
            );
        }
        if (isOnlineHomeTab(key)) {
            return (
                <DesktopGrid3DSurface
                    focusMemoryScope={JSON.stringify(['online', activeProviderId, activeUser?.id ?? null, key])}
                    title={list.title}
                    mapButtonLabel={t('home.allAlbums')}
                    items={list.items}
                    focusedIndex={focusedIndex}
                    onFocusedIndexChange={setFocusedIndex}
                    onSelect={item => handleSelectCollectionCard(item as LibraryHomeCard)}
                    isLoading={list.isLoading}
                    emptyMessage={list.emptyMessage}
                    theme={theme}
                    isDaylight={isDaylight}
                    isInteractive={interactive}
                    hasFloatingPlayer={Boolean(currentTrack)}
                    playlistVisibilityScope={scope}
                    directoryKey={dirKey}
                    declaredHomeActions={declaredActions}
                />
            );
        }
        if (key === 'local') {
            return (
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
                        directoryKey={dirKey}
                        theme={theme}
                        isDaylight={isDaylight}
                        isInteractive={interactive}
                        isActive={isActive}
                        hasFloatingPlayer={Boolean(currentTrack)}
                        onOpenGridView={onOpenGridView}
                        directoryActions={directoryActions}
                        declaredHomeActions={declaredActions}
                    />
                </div>
            );
        }
        return (
            <div className="w-full h-full flex-1">
                <NavidromeGrid3DView
                    theme={theme}
                    isDaylight={isDaylight}
                    isInteractive={interactive}
                    isActive={isActive}
                    focusedAlbumIndex={navidromeFocusedAlbumIndex}
                    setFocusedAlbumIndex={setNavidromeFocusedAlbumIndex ?? (() => { })}
                    hasFloatingPlayer={Boolean(currentTrack)}
                    homeActions={homeActions}
                    overview={homeResources.navidromeOverview}
                    directoryKey={dirKey}
                    declaredHomeActions={declaredActions}
                    onOpenSettings={() => onOpenSettings?.('help')}
                    onOpenGridView={onOpenGridView}
                />
            </div>
        );
    };

    useGlass();

    // 当前页签的 GridMap 显示着（含退场动画）时页头淡出；关闭时这个标记立刻翻转，页头与地图退场交叉淡入。
    // 三个首页列表的 GridMap 都经网格自己的可见性 store 记下显示的是哪个目录，不用逐个 surface 往上传。
    // 比对 directoryKey 而不是只看「有地图」：地图还开着时按 Tab 换页签，旧页的地图随层藏起来，
    // 新页的页头不该跟着一起淡掉。
    const isGridMapOpen = useGridMapVisibilityStore(
        state => state.visibleDirectoryKey !== null && state.visibleDirectoryKey === directoryKey,
    );
    // 页头淡出按「带玻璃的元素各自淡」来做：不能给页头容器加 opacity——祖先 opacity < 1 会把
    // backdrop-filter 的取样根截断在容器内，整段动画期间玻璃都不显示（与 CommandPalette 面板同一条）。
    // 元素自己的 opacity 不参与取样根判定，所以玻璃在淡出过程中一直有滤镜。
    const headerFadeStyle: React.CSSProperties = {
        opacity: isGridMapOpen ? 0 : 1,
        // opacity 排前面：它按 300ms 淡，其余属性沿用这些元素原本 150ms 的过渡（例如搜索框展开宽度）。
        transition: 'opacity 300ms ease-in-out, all 150ms',
    };

    return (
        <div
            ref={gridRootRef}
            data-ponder-page-scope="grid-page"
            className={`relative w-full h-full flex flex-col font-sans overflow-hidden ${mainBg} pointer-events-auto ${bottomPadding}`}
        >

            {/* Main Header Container (fades out piece by piece while GridMap is open; see headerFadeStyle) */}
            <div
                aria-hidden={isGridMapOpen}
                inert={isGridMapOpen}
                className={`z-[20] select-none ${isGridMapOpen ? 'pointer-events-none' : ''}`}
            >
                <div className="grid grid-cols-2 md:grid-cols-3 items-center w-full max-w-7xl mx-auto p-4 md:p-8 gap-y-4 md:gap-y-0">
                    {/* Left title and settings */}
                    <div className="flex items-center justify-start order-1 md:order-none gap-[10px]">
                        {/* 左侧按钮组 */}
                        <button
                            data-glass
                            data-glass-jelly
                            data-glass-light
                            onClick={() => onOpenSettings?.('help')}
                            className={`relative flex items-center gap-1.5 p-2.5 rounded-full hover:bg-white/10 transition-all ml-4 w-[40px] h-[40px]`}
                            style={{
                                backgroundColor: isDaylight
                                ? "rgba(255,255,255,0.42)"
                                : "rgba(0, 0, 0, 0.42)",
                                borderTop: isDaylight
                                ? "1px solid rgba(0,0,0,0.08)"
                                : "1px solid rgba(255,255,255,0.12)",
                                borderBottom: isDaylight
                                ? "1px solid rgba(0,0,0,0.08)"
                                : "1px solid rgba(255,255,255,0.12)",
                                outline: "1px solid rgba(40,40,40,0.2)",
                                boxShadow: "2px 2px 8px 2px rgba(40,40,40,0.4)",
                                ...headerFadeStyle,
                            }}
                            title={t('ui.options')}
                        >
                            <Settings size={20} style={{ color: 'var(--text-primary)' }} />
                            {showUpdateIndicator && (
                                <span className="text-[10px] font-medium text-zinc-800 dark:text-zinc-200 opacity-80 whitespace-nowrap bg-zinc-200/50 dark:bg-white/10 px-2 py-0.5 rounded-md">
                                    {t('options.updateAvailable')}
                                </span>
                            )}
                        </button>
                        
            {onOpenLattice && currentTrack && (
              <button
                data-glass
                data-glass-jelly
                data-glass-light
                onClick={() => onOpenLattice(opensExploreWall ? 'explore' : 'queue')}
                data-testid="home-lattice-pill"
                title={t("home.lattice")}
                aria-label={t("home.lattice")}
                className={`group relative inline-flex items-center justify-center p-2.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${navPillInactiveText} min-w-[40px] h-[40px]`}
                style={{
                  backgroundColor: isDaylight
                    ? "rgba(255,255,255,0.42)"
                    : "rgba(0, 0, 0, 0.42)",
                  borderTop: isDaylight
                    ? "1px solid rgba(0,0,0,0.08)"
                    : "1px solid rgba(255,255,255,0.12)",
                  borderBottom: isDaylight
                    ? "1px solid rgba(0,0,0,0.08)"
                    : "1px solid rgba(255,255,255,0.12)",
                  outline: "1px solid rgba(40,40,40,0.2)",
                  boxShadow: "2px 2px 8px 2px rgba(40,40,40,0.4)",
                  ...headerFadeStyle,
                }}
              >
                <PanelsTopLeft size={18} className="relative shrink-0" />
                <span
                  aria-hidden="true"
                  className="relative z-10 max-w-0 overflow-hidden opacity-0 transition-all duration-300 ease-out group-hover:ml-2.5 group-hover:max-w-28 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-28 group-focus-visible:opacity-100"
                >
                  {t("home.latticeLabel")}
                </span>
              </button>
            )}
                        {scanProgress?.active && (
                            <div
                                className="relative ml-3"
                                style={headerFadeStyle}
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
                    <div
                        data-glass-jelly
                        className="flex justify-center order-3 md:order-none col-span-2 md:col-span-1"
                    >
                        <div className="relative scale-90 md:scale-100 origin-center rounded-full -inset-1" style={{ overflow: 'visible' }}>
                            {/* 玻璃底色单独做绝对定位层，与摇杆、页签同为兄弟层级：摇杆不再嵌在玻璃元素里，
                                否则它自己的流体玻璃 backdrop 只能采到父级已经模糊过的背景，被削弱。 */}
                            <div
                                data-glass-light
                                data-glass
                                aria-hidden="true"
                                className="absolute -inset-1 rounded-full"
                                style={{
                                    backgroundColor: isDaylight ? 'rgba(255,255,255,0.42)' : 'rgba(0, 0, 0, 0.42)',
                                    borderTop: isDaylight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.12)',
                                    borderBottom: isDaylight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.12)',
                                    outline: '1px solid rgba(40,40,40,0.2)',
                                    boxShadow: '2px 2px 8px 2px rgba(40,40,40,0.4)',
                                    ...headerFadeStyle,
                                }}
                            />
                            {/* 摇杆：按住切换器任意处即吸附到鼠标并跟手，松手按最近页签吸附。层级与玻璃层平级，
                                pointer-events-none 让按下穿透到下面的页签轨道，不挡拖动与点击。 */}
                            <motion.div
                                data-glass-jelly
                                data-glass
                                data-glass-strength="1"
                                data-glass-blur="0.3"
                                data-glass-bend="4"
                                aria-hidden="true"
                                className={`absolute top-0 bottom-0 z-10 rounded-full shadow-sm pointer-events-none transition-[background-color,box-shadow] duration-200 ease-out outline outline-1 outline-[rgba(40,40,40,0.2)] ${isDaylight ? 'border-y border-black/[0.08]' : 'border-y border-white/[0.12]'} ${thumbDragging ? 'bg-transparent z-888 shadow-[2px_2px_8px_2px_rgba(40,40,40,0.4)]' : 'bg-[var(--text-accent)]/20 shadow-[2px_2px_8px_2px_rgba(40,40,40,0.4)]'}`}
                                style={{
                                    left: thumbLeft,
                                    width: thumbWidth,
                                    pointerEvents: 'none',
                                    // 按住摇杆（拖动中）时去掉底色，只留摇杆自身的流体玻璃；底色与阴影的进出
                                    // 由上面的 transition 补间，松手复原时不再瞬间跳变。
                                    boxShadow: thumbDragging ? '0 0 4px #000,0 0 8px #fffa' : '',
                                }}
                                // 摇杆的 opacity 交给 framer-motion（和 scale 同一个 animate），不写 CSS transition，
                                // 免得覆盖上面底色与阴影的补间；元素自己的 opacity 不影响 backdrop-filter。
                                animate={{ scale: thumbScale, opacity: isGridMapOpen ? 0 : 1 }}
                                transition={{
                                    scale: { type: 'spring', stiffness: 500, damping: 30 },
                                    opacity: { duration: 0.3, ease: 'easeInOut' },
                                }}
                            />
                            <div
                                ref={pillTrackRef}
                                {...thumbHandlers}
                                style={headerFadeStyle}
                                className="relative flex items-center gap-0 cursor-grab active:cursor-grabbing touch-none pointer-none"
                            >
                                {homeTabs.map((tab) => {
                                    const isActive = homeViewTab === tab.key;
                                    return (
                                        <span
                                            key={tab.key}
                                            title={tab.disabledReason || tab.label}
                                            className="inline-flex"
                                        >
                                            <button
                                                data-home-tab
                                                disabled={Boolean(tab.disabledReason)}
                                                aria-label={tab.disabledReason || tab.label}
                                                onClick={() => {
                                                    setHomeViewTab(tab.key);
                                                    focusActiveSlider();
                                                }}
                                                className={`relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-35 ${isActive ? activeTabBg : navPillInactiveText}`}
                                            >
                                                <span className="relative z-20">{tab.label}</span>
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
                            </div>
                        </div>
                    </div>

                    {/* Right Search Bar */}
                    <div className="flex justify-end order-2 md:order-none">
                        <form
                        onSubmit={handleSearch}
                        className="relative w-full md:w-56 transition-all focus-within:md:w-72  rounded-full"
                        data-glass
                        data-glass-jelly
                        data-glass-light
                        style={{
                            backgroundColor: isDaylight
                            ? "rgba(255,255,255,0.42)"
                            : "rgba(0, 0, 0, 0.42)",
                            borderTop: isDaylight
                            ? "1px solid rgba(0,0,0,0.08)"
                            : "1px solid rgba(255,255,255,0.12)",
                            borderBottom: isDaylight
                            ? "1px solid rgba(0,0,0,0.08)"
                            : "1px solid rgba(255,255,255,0.12)",
                            outline: "1px solid rgba(40,40,40,0.2)",
                            boxShadow: "2px 2px 8px 2px rgba(40,40,40,0.4)",
                            color: isDaylight ? "#000" : "#fff",
                            overflow: "auto",
                            ...headerFadeStyle,
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
                                className={`w-full border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-white/20 transition-all placeholder:text-current placeholder:opacity-40 select-text`}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </form>
                    </div>
                </div>
            </div>

            {/* Desktop Canvas Surface。每个访问过的页签常驻一层（keep-alive）：切页签只切换可见性和横向位移，
                不重挂视图，所以不丢玻璃位移图、不重解码封面、不重跑各自一堆 effect。未选中层用 visibility:hidden
                藏起来（保留布局尺寸，玻璃的 ResizeObserver 不会因此重建）。进出层都只做 x、不做 opacity：
                Chromium 在祖先做 opacity 动画时会丢掉后代的 backdrop-filter；旧页直接滑出整屏，动画结束转回 hidden。 */}
            <div className="flex-1 min-h-0 relative overflow-hidden">
                {orderedLayerKeys.map(key => {
                    const isActive = key === shownTab;
                    const isExiting = !isActive && exitingTabs.includes(key);
                    return (
                        <motion.div
                            key={key}
                            // 首次挂载（第一次访问该页签）从进入侧滑入，之后靠 animate 目标变化滑动。
                            initial={{
                                x: `${(isActive ? tabDirection : layerOffsetX(key)) * HOME_SURFACE_SLIDE_PERCENT}%`,
                                opacity: 1,
                            }}
                            animate={isActive
                                ? { x: '0%', opacity: 1 }
                                : { x: `${layerOffsetX(key) * HOME_SURFACE_SLIDE_PERCENT}%`, opacity: 1 }}
                            transition={reduceMotion ? { duration: 0 } : HOME_SURFACE_TRANSITION}
                            onAnimationComplete={() => {
                                if (isExiting) setExitingTabs(prev => prev.filter(k => k !== key));
                            }}
                            className="absolute inset-0 flex flex-col items-center justify-center"
                            style={{
                                visibility: isActive || isExiting ? 'visible' : 'hidden',
                                pointerEvents: isActive ? 'auto' : 'none',
                                zIndex: isActive ? 3 : isExiting ? 2 : 1,
                            }}
                        >
                            <HomeTabLayerContent isActive={isActive} surface={renderTabSurface(key, isActive)} />
                        </motion.div>
                    );
                })}
            </div>

            {/* The active account and the way back to the player; the sign-in window opens from it. */}
            <SwitcherPill account={account} onBackToPlayer={onBackToPlayer} />

        </div>
    );
};

export default Grid3D;
