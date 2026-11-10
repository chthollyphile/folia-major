import i18n from '../../../src/i18n/config';
import { useAppViewStore } from '../../../src/stores/useAppViewStore';
import { useCollectionNavigationStore } from '../../../src/stores/useCollectionNavigationStore';
import { useSearchNavigationStore } from '../../../src/stores/useSearchNavigationStore';
import type { HomeViewTab, SongResult } from '../../../src/types';
import { setCurrentSong, setPlayerState, setPlayQueue } from '../../../src/stores/usePlaybackStore';
import { usePlaybackEntryViewStore } from '../../../src/stores/usePlaybackEntryViewStore';
import { useAudioSettingsStore } from '../../../src/stores/useAudioSettingsStore';
import { setProbeWallToolsHost } from './probeWallToolsHost';
import { PlayerState } from '../../../src/types';
import DesktopGrid3DSurface from '../../../src/library/suites/grid/home/DesktopGrid3DSurface';
import { Grid3DSlider, type Grid3DSliderItem } from '../../../src/library/suites/grid/home/Grid3DSlider';
import { GridViewTabs } from '../../../src/library/suites/grid/home/GridViewTabs';
import GridMap, { type GridMapBatchConfig, type GridMapItem } from '../../../src/library/suites/grid/directory/GridMap';
import GridMapBatchPanel from '../../../src/library/suites/grid/directory/GridMapBatchPanel';
import type {
    LibraryDirectoryBatchConfig,
    LibraryDirectoryItem,
    LibraryDirectoryNode,
    LibraryHiddenScope,
} from '../../../src/library/core/directory/directory.contract';
import type { LibraryHomeCard } from '../../../src/library/core/home/homeModel.contract';
import { resolveDirectoryBatchActions, resolveDirectoryBatchScope, runDirectoryBatchAction } from '../../../src/library/core/directory/directoryBatch';
import { homeCardToDirectoryItem } from '../../../src/library/core/directory/directoryItems';
import { DEFAULT_DIRECTORY_SESSION_ID } from '../../../src/library/core/directory/directorySession';
import { useLibrarySuiteStore } from '../../../src/library/core/suite/useLibrarySuiteStore';
import { switchLibrarySuite } from '../../../src/library/app/switchLibrarySuite';
import { getLibrarySuite, listLibrarySuites, resolveLibrarySurface } from '../../../src/library/registry';
import { useLibrarySuiteChromeStore } from '../../../src/library/core/suite/useLibrarySuiteChromeStore';
import LibraryTuiDirectory from '../../../src/library/suites/tui/LibraryTuiDirectory';
import { getLibraryDirectorySession, useLibraryDirectorySessionStore } from '../../../src/library/core/directory/useLibraryDirectorySessionStore';
import { useLibraryDirectorySurfaceStore } from '../../../src/library/core/directory/useLibraryDirectorySurfaceStore';
import { COMMAND_PALETTE_COMMANDS, isCommandPaletteCommandEnabled } from '../../../src/components/command-palette/commandRegistry';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';
import { useGridSurfaceStore } from '../../../src/stores/useGridSurfaceStore';
import { filterDirectoryByVisibility, hiddenIdsOf, isDirectoryItemHidden, isHideableDirectoryItem } from '../../../src/library/core/directory/directoryVisibility';
import { useHiddenCollectionsStore } from '../../../src/library/core/collection/useHiddenCollectionsStore';
import { useLibraryHomeSurfaceStore } from '../../../src/library/core/home/useLibraryHomeSurfaceStore';
import { useNavidromeHomeSectionStore } from '../../../src/library/core/home/navidrome/useNavidromeHomeSectionStore';
import { SidePanelList } from '../../../src/components/shared/SidePanelList';
import { addProbeFault, setProbeLatency } from '../libraryBehavior/fakeProviders';
import { probeRefreshGate } from '../libraryBehavior/probeGates';
import { clearProbeCalls, clearProbeRequests, getProbeLog } from '../libraryBehavior/probeLog';
import type {
    HomeBatchScope,
    HomeHiddenView,
    HomeProbeApi,
    HomeProbeDescriptor,
    HomeProbeTab,
    HomeTabKey,
} from './probeApi';
import {
    findPresentComponent,
    firstHostElement,
    propsOf,
} from './reactFiberProbe';
import {
    bravaisDirectoryProps,
    closeBravaisDirectoryPanel,
    isBravaisPanelOpen,
    openBravaisDirectoryPanel,
} from './bravaisHomeProbe';

// dev/probes/homeBehavior/homeProbeApi.ts
// `window.__homeProbe` 的实现。页签、当前列表的条目 / section / 动作 / 加载态 / 隐藏作用域 / 批量类型 / 目录树
// 读的是 Library Core 的首页模型：首页注册在 core/home/useLibraryHomeSurfaceStore 里的句柄（任何 suite 的首页
// 都注册它），切页签、切 section、点动作、导入歌单文件也经这些句柄——与界面上的按钮同一个函数。
// 仍读网格组件树的（见 reactFiberProbe.ts 的说明）只剩网格专属的部分：滑条上实际显示 / 能打开的卡、地图按钮、
// GridMap 的条目与目录会话 key、批量面板是否在场。只有两处没有 props 可调、只能点 DOM：GridMap 标题上
// 打开侧面板的按钮，和隐藏管理面板里的两个开关（都在本文件里注明）。隐藏状态读的是 core 的隐藏 store
// （按当前列表的作用域），不从组件 props 推断。
// 目录的筛选词、批选、隐藏视图读写 core 的目录会话（GridMap 的 directoryKey 指向哪一个），批量范围用 core 的
// resolveDirectoryBatchScope 现算，批量动作经 runDirectoryBatchAction 交给控制器——与面板按钮同一个入口。
//
// P3.4 起首页也可以是 TUI（setSuite('tui')）：仍读组件树的那几个接口按「当前首页由哪套 suite 渲染」分两种实现。
// TUI 读的是 LibraryTuiDirectory 的 props（directoryKey、items、hiddenScope、batchConfig、onOpen），网格专属概念的对应：
// - open：在可见（去隐藏）的条目里找，调 onOpen——与 Enter / 双击同一个回调。
// - visibleItems：TUI 列表在浏览视图、没有筛选时显示的条目（去掉隐藏的），对应网格滑条上的卡。
// - openMap / isMapOpen：TUI 的目录视图一直开着（目录会话的 openDirectoryKey 就是它）：openMap 什么都不做、返回 true，
//   isMapOpen 在 TUI 列表在场时为 true。closeMap = 关闭目录：与 TUI 里 Esc 的最后一步同一个 store 动作
//   （closeDirectory 丢掉会话，再 openDirectory 重新打开一个空会话），所以之后 getQuery 是 ''（网格关掉地图后是 null）。
// - mapItems：TUI 此刻按隐藏视图与筛选词显示的条目（与 GridMap 同一个条目映射 core/directory/directoryItems）。
// - 批量：TUI 没有「批量面板」，有批量的目录（本地 folders / albums / artists）一直可选；openPanel / closePanel 什么都不做，
//   isBatchOpen 就是「这个目录有批量」。
// - 隐藏：toggleHidden 与行尾按钮、命令面板同一个 store 动作；setHiddenView 直接写目录会话的隐藏视图（TUI 的
//   [全部] / [只看隐藏的] / [完成] 写的就是它）。
//
// B9 起首页也可以是 bravais（setSuite('bravais')）：读 BravaisHomeDirectory 的 props，对应关系见 bravaisHomeProbe.ts 的
// 文件头（墙就是目录；筛选与批量 = 本地的目录树面板；在线页签没有目录过滤）。

const HIDDEN_STORAGE_KEY = 'hidden_grid_playlists';

type HarnessBindings = Pick<HomeProbeApi, 'sandbox' | 'ready' | 'remount' | 'localSongIds' | 'localPlaylists' | 'providers' | 'activeProvider' | 'switchProvider' | 'signOut' | 'setStage' | 'setLattice'>;

type SliderProps = { items: Grid3DSliderItem[]; onSelect: (item: Grid3DSliderItem, index: number) => void };
type GridMapProps = {
    directoryKey?: string;
    items: GridMapItem[];
    onBack: () => void;
    onTogglePlaylistHidden?: (item: GridMapItem) => void;
    batchConfig?: GridMapBatchConfig;
};
type BatchPanelProps = {
    config: GridMapBatchConfig;
};

const surfaceFiber = () => findPresentComponent(DesktopGrid3DSurface);
/** 首页模型：页签条与当前列表的句柄（没有显示列表时为 null）。 */
const homeTabs = () => useLibraryHomeSurfaceStore.getState().tabs;
const homeList = () => useLibraryHomeSurfaceStore.getState().list;
const listState = () => homeList()?.getState() ?? null;
const sliderProps = () => propsOf<SliderProps>(findPresentComponent(Grid3DSlider, surfaceFiber()));
const gridMapFiber = () => findPresentComponent(GridMap, surfaceFiber());
const gridMapProps = () => propsOf<GridMapProps>(gridMapFiber());
const batchPanelProps = () => propsOf<BatchPanelProps>(findPresentComponent(GridMapBatchPanel, gridMapFiber()));
// GridMap 把筛选后的 displayItems 原样交给侧栏列表（侧栏收起时也在渲染），它就是「GridMap 此刻显示的卡」。
const mapDisplayItems = (): GridMapItem[] | null => {
    const map = gridMapFiber();
    if (!map) return null;
    return propsOf<{ items: GridMapItem[] }>(findPresentComponent(SidePanelList, map))?.items ?? null;
};

type TuiDirectoryProps = {
    directoryKey: string;
    hiddenScope: LibraryHiddenScope;
    items: LibraryHomeCard[];
    batchConfig?: LibraryDirectoryBatchConfig;
    onOpen: (card: LibraryHomeCard) => void;
};

/** 此刻渲染首页的 suite（选中的 suite 没实现首页时回退网格）。 */
const homeSuite = () => resolveLibrarySurface('home', useLibrarySuiteStore.getState().suite).suiteId;

/** 一首只有身份的在线歌（playback key `online:<provider>:<id>`），给播放队列与正在播放的那首用。 */
const probeOnlineSong = (key: string): SongResult => {
    const [, providerId, mediaId] = key.split(':');
    return {
        id: mediaId, name: mediaId, artists: [], album: { id: 0, name: '' }, durationMs: 0,
        sourceRef: { kind: 'online', providerId, mediaId },
    } as SongResult;
};
const isTuiHome = () => homeSuite() === 'tui';
const tuiDirectoryProps = () => (isTuiHome() ? propsOf<TuiDirectoryProps>(findPresentComponent(LibraryTuiDirectory)) : null);
const isBravaisHome = () => homeSuite() === 'bravais';
const bravaisProps = () => (isBravaisHome() ? bravaisDirectoryProps() : null);

/** 当前的目录（网格：打开着的 GridMap；TUI：列表），以及它的会话 key、条目与批量配置。 */
type ProbeDirectory = {
    sessionId: string;
    items: LibraryDirectoryItem[];
    batchConfig?: LibraryDirectoryBatchConfig;
    /** 批量此刻能用（网格：批量面板开着；TUI：目录有批量）。 */
    batchOpen: boolean;
};
const currentDirectory = (): ProbeDirectory | null => {
    if (isBravaisHome()) {
        const props = bravaisProps();
        if (!props) return null;
        return {
            sessionId: props.directoryKey,
            items: props.items.map(homeCardToDirectoryItem),
            batchConfig: props.batchConfig,
            batchOpen: isBravaisPanelOpen(props),
        };
    }
    if (isTuiHome()) {
        const props = tuiDirectoryProps();
        if (!props) return null;
        return {
            sessionId: props.directoryKey,
            items: props.items.map(homeCardToDirectoryItem),
            batchConfig: props.batchConfig,
            batchOpen: Boolean(props.batchConfig),
        };
    }
    const props = gridMapProps();
    if (!props) return null;
    const panel = batchPanelProps();
    return {
        sessionId: props.directoryKey ?? DEFAULT_DIRECTORY_SESSION_ID,
        items: props.items,
        batchConfig: panel?.config,
        batchOpen: Boolean(panel),
    };
};

/** 当前目录读写的会话 key（网格的地图没开时为 null）。 */
const mapSessionId = (): string | null => currentDirectory()?.sessionId ?? null;

/** 当前列表作用域的隐藏 id（core 的隐藏 store；作用域取首页模型的当前列表，没有列表时落在 default）。 */
const currentHiddenIds = () => hiddenIdsOf(
    useHiddenCollectionsStore.getState().hiddenByScope,
    listState()?.hiddenScope ?? 'default',
);

const asId = (id: string | number) => String(id);
const nameOf = (name: unknown) => (typeof name === 'string' || typeof name === 'number' ? String(name) : '');

// 首页一级页签来自首页模型（core/home/homeSources 的 resolveHomeTabs，已翻译）。
const readTabs = (): HomeProbeTab[] => (homeTabs()?.getState().tabs ?? []).map(tab => ({
    key: tab.key as HomeTabKey,
    label: tab.label,
    disabled: Boolean(tab.disabledReason),
    ...(tab.disabledReason ? { reason: tab.disabledReason } : {}),
}));

const summarizeDescriptor = (detail: unknown): HomeProbeDescriptor => detail as HomeProbeDescriptor;

const flattenDirectory = (nodes: LibraryDirectoryNode[] = []): LibraryDirectoryNode[] => (
    nodes.flatMap(node => [node, ...flattenDirectory(node.children)])
);

// ---- 隐藏管理面板（没有批量配置时 GridMap 侧面板里的两个开关）：只能点 DOM ----
const panelButton = (labelKey: string): HTMLButtonElement | null => {
    const root = firstHostElement(gridMapFiber());
    if (!root) return null;
    const label = i18n.t(labelKey);
    return [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label) ?? null;
};
// 隐藏视图就是目录会话里的 visibilityMode（GridMap 的隐藏编辑模式读写它）。
const readHiddenView = (): HomeHiddenView => {
    const sessionId = mapSessionId();
    return sessionId ? getLibraryDirectorySession(sessionId).visibilityMode : 'browse';
};

/** 地图此刻的批量范围：可见 → 筛选 → 选中，全部从目录会话与 core 的纯规则现算。 */
const currentBatchScope = () => {
    const directory = currentDirectory();
    if (!directory) return null;
    const session = getLibraryDirectorySession(directory.sessionId);
    return resolveDirectoryBatchScope({
        items: directory.items,
        hiddenIds: currentHiddenIds(),
        visibilityMode: session.visibilityMode,
        query: session.query,
        selectedIds: new Set(session.selectedIds),
    });
};
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const waitFor = async (check: () => boolean, frames = 60): Promise<boolean> => {
    for (let frame = 0; frame < frames; frame += 1) {
        if (check()) return true;
        await nextFrame();
    }
    return check();
};
// GridMap 标题按钮：打开 / 关闭侧面板（批量面板或隐藏管理面板）。
const titleButton = (): HTMLButtonElement | null => (
    firstHostElement(gridMapFiber())?.querySelector<HTMLButtonElement>('button[class*="group/grid-title"]') ?? null
);
const isPanelOpen = () => Boolean(batchPanelProps()) || Boolean(panelButton('home.hidePlaylists') || panelButton('home.finishHidingPlaylists'));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ---- 目录命令：真实的命令定义，配一个只有 scope 与 t 的 context（目录命令只用到这两样） ----
const DIRECTORY_COMMANDS = COMMAND_PALETTE_COMMANDS.filter(command => command.scope === 'directory-surface');
const directoryCommandContext = (): CommandPaletteContext => ({
    scope: {
        view: useAppViewStore.getState().view,
        filter: useAppViewStore.getState().commandFilter,
        grid: useGridSurfaceStore.getState().gridSurface,
        directory: useLibraryDirectorySurfaceStore.getState().directorySurface,
    },
    shared: { t: (key: string, fallback?: string) => i18n.t(key, { defaultValue: fallback }) },
}) as unknown as CommandPaletteContext;

/** 安装 `window.__homeProbe`，返回卸载函数。 */
export const installHomeProbeApi = (bindings: HarnessBindings): (() => void) => {
    const api: HomeProbeApi = {
        ...bindings,
        // 模拟重启：隐藏 store 是模块级状态，重挂载不会重读存储；先从 localStorage 重读一遍，
        // 「重启后仍隐藏」断言的才是持久化的那份。
        remount: () => {
            useHiddenCollectionsStore.getState().hydrate();
            useNavidromeHomeSectionStore.getState().hydrate();
            bindings.remount();
        },
        suite: () => useLibrarySuiteStore.getState().suite,
        homeSuite,
        suites: () => listLibrarySuites().map(suite => suite.id),
        // 与 DEV 浮层在首页上点到的同一条：switchLibrarySuite（首页没有集合会话要冲刷）。
        setSuite: suiteId => switchLibrarySuite('home', suiteId),
        chrome: () => {
            const handle = useLibrarySuiteChromeStore.getState().chrome;
            if (!handle) return null;
            const declared = getLibrarySuite(handle.suiteId)?.chromeActions ?? [];
            return { suiteId: handle.suiteId, available: declared.map(action => action.id).filter(id => handle.isAvailable(id)) };
        },
        runChrome: actionId => useLibrarySuiteChromeStore.getState().chrome?.run(actionId) ?? false,
        setPlayQueue: playbackKeys => setPlayQueue(playbackKeys.map(probeOnlineSong)),
        setNowPlaying: (playbackKey, playing = true) => {
            setCurrentSong(playbackKey ? probeOnlineSong(playbackKey) : null);
            setPlayerState(playbackKey ? (playing ? PlayerState.PLAYING : PlayerState.PAUSED) : PlayerState.IDLE);
        },
        setEntryView: view => usePlaybackEntryViewStore.getState().setPlaybackEntryView(view),
        setWallToolsHost: setProbeWallToolsHost,
        volume: () => {
            const { volume, isMuted } = useAudioSettingsStore.getState();
            return { volume, isMuted };
        },
        paletteRequest: () => {
            const { seq, kind } = useAppViewStore.getState().commandPaletteRequest;
            return { seq, kind };
        },

        tabs: readTabs,
        tab: () => useSearchNavigationStore.getState().homeViewTab as HomeTabKey,
        setTab: tab => useSearchNavigationStore.getState().setHomeViewTab(tab as HomeViewTab),
        sections: () => (listState()?.sections ?? []).map(section => ({ id: section.id, active: section.active })),
        setSection: id => homeList()?.setSection(id) ?? false,
        items: () => {
            const state = listState();
            if (!state) return [];
            const hiddenIds = currentHiddenIds();
            return state.items.map(item => ({
                id: asId(item.id),
                name: nameOf(item.name),
                type: item.type,
                trackCount: item.trackCount,
                trackIds: item.trackIds,
                description: item.description,
                ...(item.isVirtual ? { isVirtual: true } : {}),
                hideable: isHideableDirectoryItem(item),
                hidden: isDirectoryItemHidden(item, hiddenIds),
            }));
        },
        visibleItems: () => {
            const bravais = bravaisProps();
            if (bravais) return filterDirectoryByVisibility(bravais.items, currentHiddenIds(), 'browse').map(item => asId(item.id));
            const tui = tuiDirectoryProps();
            if (tui) return filterDirectoryByVisibility(tui.items, currentHiddenIds(), 'browse').map(item => asId(item.id));
            return (sliderProps()?.items ?? []).map(item => asId(item.id));
        },
        scope: () => listState()?.hiddenScope ?? null,
        isLoading: () => Boolean(listState()?.isLoading),
        actions: () => (listState()?.actions ?? []).map(action => ({ id: action.id, disabled: action.disabled })),
        runAction: id => {
            const action = listState()?.actions.find(candidate => candidate.id === id);
            if (!action || action.disabled) return false;
            return homeList()?.runAction(id) ?? false;
        },
        // 与在文件选择框里选中这个文件一样：经本地列表的句柄交给首页动作控制器（结果不影响返回值，提示看回调账）。
        importPlaylistFile: async (fileName, text) => {
            const importPlaylistFile = homeList()?.importPlaylistFile;
            if (!importPlaylistFile) return false;
            await importPlaylistFile(new File([text], fileName, { type: 'audio/x-mpegurl' }));
            return true;
        },

        open: id => {
            const tui = tuiDirectoryProps() ?? bravaisProps();
            if (tui) {
                const card = filterDirectoryByVisibility(tui.items, currentHiddenIds(), 'browse').find(item => asId(item.id) === id);
                if (!card) return false;
                tui.onOpen(card);
                return true;
            }
            const props = sliderProps();
            const index = props?.items.findIndex(item => asId(item.id) === id) ?? -1;
            if (!props || index < 0) return false;
            props.onSelect(props.items[index], index);
            return true;
        },
        opened: () => getProbeLog().calls.filter(call => call.kind === 'openCollection').map(call => summarizeDescriptor(call.detail)),
        stack: () => useCollectionNavigationStore.getState().snapshot?.stack.map(collection => collection.name) ?? [],
        closeCollection: () => useCollectionNavigationStore.getState().clear(),

        openMap: () => {
            if (isBravaisHome()) {
                const props = bravaisProps();
                if (!props) return false;
                openBravaisDirectoryPanel(props);
                return true;
            }
            if (isTuiHome()) return Boolean(tuiDirectoryProps());
            const onOpenMap = propsOf<{ onOpenMap?: () => void }>(findPresentComponent(GridViewTabs, surfaceFiber()))?.onOpenMap;
            if (!onOpenMap) return false;
            onOpenMap();
            return true;
        },
        closeMap: () => {
            const bravais = bravaisProps();
            if (bravais) closeBravaisDirectoryPanel(bravais);
            const tui = tuiDirectoryProps() ?? bravais;
            if (tui) {
                const store = useLibraryDirectorySessionStore.getState();
                store.closeDirectory(tui.directoryKey);
                store.openDirectory(tui.directoryKey);
                return true;
            }
            const props = gridMapProps();
            if (!props) return false;
            props.onBack();
            return true;
        },
        isMapOpen: () => (isBravaisHome() ? Boolean(bravaisProps()) : isTuiHome() ? Boolean(tuiDirectoryProps()) : Boolean(gridMapFiber())),
        mapItems: () => {
            if (isTuiHome() || isBravaisHome()) {
                const scope = currentBatchScope();
                if (!scope) return [];
                const hiddenIds = currentHiddenIds();
                return scope.displayItems.map(item => ({
                    id: asId(item.id),
                    name: item.name,
                    type: item.type,
                    path: item.path,
                    description: item.description,
                    trackIds: item.trackIds,
                    ...(item.isVirtual ? { isVirtual: true as const } : {}),
                    hidden: isDirectoryItemHidden(item, hiddenIds),
                }));
            }
            const items = mapDisplayItems();
            if (!gridMapFiber() || !items) return [];
            const hiddenIds = currentHiddenIds();
            return items.map(item => ({
                id: asId(item.id),
                name: item.name,
                type: item.type,
                path: item.path,
                description: item.description,
                trackIds: item.trackIds,
                ...(item.isVirtual ? { isVirtual: true } : {}),
                hidden: isDirectoryItemHidden(item, hiddenIds),
            }));
        },
        setQuery: query => {
            const filter = useAppViewStore.getState().commandFilter;
            if (!filter) return false;
            filter.setQuery(query);
            return true;
        },
        // 地图开着（TUI：列表在场）时读它的目录会话；网格的地图关掉（会话已清）时为 null。
        getQuery: () => {
            const sessionId = mapSessionId();
            return sessionId ? getLibraryDirectorySession(sessionId).query : null;
        },

        batchAvailable: () => Boolean(listState()?.batchSelectionType),
        openPanel: () => {
            if (isBravaisHome()) {
                const props = bravaisProps();
                if (props) openBravaisDirectoryPanel(props);
                return Boolean(props);
            }
            if (isTuiHome()) return Boolean(tuiDirectoryProps());
            if (isPanelOpen()) return true;
            const button = titleButton();
            if (!button || button.disabled) return false;
            button.click();
            return true;
        },
        closePanel: () => {
            if (isBravaisHome()) {
                const props = bravaisProps();
                if (props) closeBravaisDirectoryPanel(props);
                return Boolean(props);
            }
            if (isTuiHome()) return Boolean(tuiDirectoryProps());
            if (!isPanelOpen()) return true;
            const button = titleButton();
            if (!button) return false;
            button.click();
            return true;
        },
        isBatchOpen: () => Boolean(currentDirectory()?.batchOpen),
        // 批量面板开着（TUI：目录有批量）才有范围（面板是否在场仍看组件树；范围本身从会话现算）。
        batchScope: (): HomeBatchScope | null => {
            const directory = currentDirectory();
            const scope = currentBatchScope();
            if (!directory?.batchOpen || !directory.batchConfig || !scope) return null;
            return {
                selectionType: directory.batchConfig.selectionType,
                itemIds: scope.context.items.map(item => asId(item.id)),
                trackIds: [...scope.context.trackIds],
                totalItemCount: scope.displayItems.length,
                actions: resolveDirectoryBatchActions(directory.batchConfig),
            };
        },
        batchSelect: (ids, selected = true) => {
            const directory = currentDirectory();
            if (!directory?.batchOpen) return false;
            useLibraryDirectorySessionStore.getState().setSelected(directory.sessionId, ids, selected);
            return true;
        },
        // 与面板的「全选」（TUI 的 Ctrl+A）一样：选中的是当前筛选出的卡片。
        batchSelectAll: (selected = true) => {
            const directory = currentDirectory();
            const scope = currentBatchScope();
            if (!directory?.batchOpen || !scope) return false;
            useLibraryDirectorySessionStore.getState().replaceSelection(
                directory.sessionId,
                selected ? scope.displayItems.map(item => asId(item.id)) : [],
            );
            return true;
        },
        runBatch: async (action, arg) => {
            const directory = currentDirectory();
            const scope = currentBatchScope();
            if (!directory?.batchOpen || !directory.batchConfig || !scope) return false;
            const result = await runDirectoryBatchAction(
                directory.batchConfig,
                action,
                scope.context,
                action === 'create-playlist' ? (arg ?? 'Probe Playlist') : arg,
            );
            return result.ok;
        },
        directorySurface: () => useLibraryDirectorySurfaceStore.getState().directorySurface?.getState() ?? null,
        directoryCommands: () => {
            const context = directoryCommandContext();
            return DIRECTORY_COMMANDS.filter(command => isCommandPaletteCommandEnabled(command, context)).map(command => command.id);
        },
        runDirectoryCommand: async (id, input = '') => {
            const context = directoryCommandContext();
            const command = DIRECTORY_COMMANDS.find(candidate => candidate.id === id);
            if (!command || !isCommandPaletteCommandEnabled(command, context)) return false;
            return Boolean(await command.execute(input, context));
        },
        directoryNodes: () => flattenDirectory(listState()?.directoryTrees).map(node => ({
            path: node.path,
            rootPath: node.rootPath,
            depth: node.depth,
            ignored: Boolean(node.ignored),
            directTrackCount: node.directTrackCount,
            totalTrackCount: node.totalTrackCount,
        })),

        toggleHidden: id => {
            const tui = tuiDirectoryProps() ?? bravaisProps();
            if (tui) {
                const card = tui.items.find(candidate => asId(candidate.id) === id);
                if (!card || !isHideableDirectoryItem(card)) return false;
                useHiddenCollectionsStore.getState().toggleHidden(tui.hiddenScope, asId(card.id));
                return true;
            }
            const props = gridMapProps();
            const item = props?.items.find(candidate => asId(candidate.id) === id);
            if (!props?.onTogglePlaylistHidden || !item || !isHideableDirectoryItem(item)) return false;
            props.onTogglePlaylistHidden(item);
            return true;
        },
        hiddenView: readHiddenView,
        setHiddenView: async view => {
            const tui = tuiDirectoryProps() ?? bravaisProps();
            if (tui) {
                if (tui.batchConfig) return false;
                useLibraryDirectorySessionStore.getState().setVisibilityMode(tui.directoryKey, view);
                await wait(0);
                return readHiddenView() === view;
            }
            if (!gridMapFiber() || batchPanelProps()) return false;
            if (!isPanelOpen()) {
                titleButton()?.click();
                if (!await waitFor(isPanelOpen)) return false;
            }
            const wantsManage = view !== 'browse';
            if ((readHiddenView() !== 'browse') !== wantsManage) {
                (panelButton('home.hidePlaylists') ?? panelButton('home.finishHidingPlaylists'))?.click();
                if (!await waitFor(() => (readHiddenView() !== 'browse') === wantsManage)) return false;
            }
            if (wantsManage && (readHiddenView() === 'manage-hidden-only') !== (view === 'manage-hidden-only')) {
                (panelButton('home.showHiddenPlaylistsOnly') ?? panelButton('home.showAllPlaylists'))?.click();
                if (!await waitFor(() => readHiddenView() === view)) return false;
            }
            return readHiddenView() === view;
        },
        storedHidden: () => {
            try {
                return JSON.parse(localStorage.getItem(HIDDEN_STORAGE_KEY) ?? '{}') as Record<string, string[]>;
            } catch {
                return {};
            }
        },

        setLatency: (target, latency) => setProbeLatency(target, latency),
        addFault: addProbeFault,
        holdRefresh: kind => probeRefreshGate(kind).hold(),
        releaseRefresh: kind => probeRefreshGate(kind).release(),
        calls: () => getProbeLog().calls,
        requests: () => getProbeLog().requests,
        clearLog: () => {
            clearProbeCalls();
            clearProbeRequests();
        },
    };
    window.__homeProbe = api;
    return () => {
        if (window.__homeProbe === api) delete window.__homeProbe;
    };
};

