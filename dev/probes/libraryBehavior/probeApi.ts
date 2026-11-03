import type { GridSurfaceActionId, GridSurfaceState } from '../../../src/types/gridCommandSurface';
import type { LibraryDeclaredActions, LibrarySuiteId, LibrarySurfaceId } from '../../../src/library/core/suite/suite.contract';
import type { CollectionNavigationOrigin } from '../../../src/library/core/collection/collection.contract';
import type { LibraryArtistSurfaceActionId, LibraryArtistSurfaceState } from '../../../src/library/core/artist/artist.contract';
import type { ArtistFixtureId, OnlineArtistFixtureId, OnlineFixtureId, ProbeFixtureId } from './fixtureRules';
import type { ProbeFault } from './fakeProviders';
import type { ProbeRefreshKind } from './probeGates';
import type { ProbeCall, ProbeRequest } from './probeLog';

// dev/probes/libraryBehavior/probeApi.ts
// 行为探针挂在 window 上的驱动接口。只有类型：component 用例 import 它不会把探针运行时带进 Node。

/** 歌手页上的一张专辑卡：id、名字和它带着的链接提示（压栈时宿主据此决定来源与 provider）。 */
export type ProbeArtistAlbum = {
    id: string;
    name: string;
    link: { source?: string; providerId?: string; type?: string };
};

/**
 * 歌手页的语义视图。status：loading（初次加载）/ empty（没有任何内容，空态文案）/ syncing（专辑还在后台分页）/
 * interrupted（后台分页失败，有重试）/ ready / error（加载失败，有重试）；P4.1 起由宿主的歌手资源快照给出。
 */
export type ProbeArtistView = {
    /** 导航栈里这一层的名字（描述上的名字）。 */
    name: string;
    status: 'loading' | 'empty' | 'syncing' | 'interrupted' | 'ready' | 'error';
    detail: { name: string; cover: string | null; hasBio: boolean } | null;
    /** 热门歌曲的 playback key，按显示顺序（含不可播放的）。 */
    topSongIds: string[];
    playableTopSongIds: string[];
    /** 当前显示的专辑（筛选之后），按显示顺序。 */
    albumIds: string[];
    albums: ProbeArtistAlbum[];
    query: string | null;
    panels: { sidePanel: boolean; cutIn: boolean };
};

/** 导航栈里一层的描述摘要。 */
export type ProbeDescriptor = {
    source: string;
    providerId?: string;
    type: string;
    id: string;
    name: string;
    entityId?: string;
};

export type LibraryProbeApi = {
    /** 种子数据（沙盒模式下的 IndexedDB）是否已经就绪。 */
    ready: () => boolean;
    /** 沙盒模式才写 IndexedDB / Navidrome 配置；测试浏览器里自动开启。 */
    sandbox: boolean;
    fixtures: () => ProbeFixtureId[];
    /**
     * 等价于在首页点开这个集合。B11：origin 给 search / player 时等价于从搜索页 / 播放页打开（根层的来源，
     * bravais 整墙入场）；缺省是首页。
     */
    open: (fixtureId: ProbeFixtureId, origin?: CollectionNavigationOrigin) => void;
    /** 等价于浏览器后退：先发「将要弹栈」的通知（宿主让 suite 跑 beforeBack），再弹栈；不清会话与布局记录。 */
    back: () => void;
    /** 浏览会话里这个键的筛选词与焦点（没有会话时为 null）。 */
    browseSession: (sessionKey: string) => { query: string; focusedEntryKey: string | null } | null;
    /** 导航栈里每一层的名字，自底向上。 */
    stack: () => string[];
    /** 经由当前注册的命令筛选写 query；没有注册者时返回 false。 */
    setQuery: (query: string) => boolean;
    getQuery: () => string | null;
    surface: () => GridSurfaceState | null;
    /** 经由当前注册的 grid surface 执行动作；不在 availableActions 里时返回 false。 */
    runSurface: (action: GridSurfaceActionId) => boolean;
    /** 与开发版浮层同一条路径切换 suite（先把焦点写回会话）。 */
    setSuite: (suite: LibrarySuiteId) => void;
    suite: () => LibrarySuiteId;
    /** setSuite / suite 的旧名（R3 之前叫 renderer）。 */
    setRenderer: (renderer: LibrarySuiteId) => void;
    renderer: () => LibrarySuiteId;
    /** registry 里这个构建可用的 suite（与 DEV 浮层的按钮同源）。 */
    suites: () => LibrarySuiteId[];
    /** 当前选中的 suite 下，这个 surface 由谁渲染、声明了哪些动作（回退时是默认 suite 的声明）。 */
    resolveSurface: (surface: LibrarySurfaceId) => { suiteId: LibrarySuiteId; isFallback: boolean; declaredActions: LibraryDeclaredActions };
    /** 从当前集合压入一个歌手页（本地 fixture 的第一个歌手，需要沙盒）；返回是否压入。 */
    pushArtist: () => boolean;
    /**
     * 从当前集合压入一个 fixture 集合（与宿主收到 onPushCollection 之后同一条路：N1 的规则，正好是上一层时折成一次返回）；
     * 没有打开的集合、fixture 不可用时返回 false。用来在两个集合页之间构造紧邻往返（曲目链接只通向专辑 / 歌手）。
     */
    push: (fixtureId: ProbeFixtureId) => boolean;
    /** 按住这个在线集合的后台分页应答（页面按请求那一刻的上游数据生成），releasePages 时送达。 */
    holdPages: (fixtureId: OnlineFixtureId) => void;
    releasePages: (fixtureId: OnlineFixtureId) => void;
    /** 按住宿主的刷新（回调照样记账，只是迟迟不完成），releaseRefresh 时继续。 */
    holdRefresh: (kind: ProbeRefreshKind) => void;
    releaseRefresh: (kind: ProbeRefreshKind) => void;
    /** 按住在线 provider 的变更应答（请求已记账，上游在放行时才改），releaseMutations 时送达。 */
    holdMutations: () => void;
    releaseMutations: () => void;
    /** 以根层打开一个歌手页（在线：搜索结果同款描述；Navidrome、本地：首页同款描述；本地 / Navidrome 需要沙盒）。 */
    openArtist: (fixtureId: ArtistFixtureId) => boolean;
    /** 导航栈每一层的描述摘要，自底向上。 */
    stackDescriptors: () => ProbeDescriptor[];
    /** 当前在场歌手页的语义视图；没有歌手页时为 null。 */
    artist: () => ProbeArtistView | null;
    /** 打开歌手页上的一张专辑（网格：专辑侧栏那一行的回调；TUI：双击那一行）。 */
    openArtistAlbum: (albumId: string) => boolean;
    /** 打开歌手页的专辑侧栏 / 信息面板。 */
    openArtistPanel: (panel: 'side' | 'cut-in') => boolean;
    /** 让在场歌手页的资源从头重新加载（错误态「重试」的同一入口）；没有歌手页时返回 false。 */
    reloadArtist: () => boolean;
    /** 在场歌手页在浏览会话里的语义焦点（条目键 song:… / album:…）；没有歌手页时为 null。 */
    artistFocus: () => string | null;
    /** 网格歌手页此刻聚焦的卡的条目键（头像 / 简介卡或不是网格时为 null）。 */
    artistGridFocus: () => string | null;
    /** 当前注册的歌手页命令面板 surface 的状态（P4.2）；没有时为 null。 */
    artistSurface: () => LibraryArtistSurfaceState | null;
    /** 经由当前注册的歌手页 surface 执行动作（命令面板同一条通道）；不可用时返回 false。 */
    runArtistSurface: (action: LibraryArtistSurfaceActionId) => boolean;
    /** 在线歌手在请求账里的 target。 */
    artistTarget: (fixtureId: OnlineArtistFixtureId) => string;
    /** 故障注入与延迟（假 provider）；clearFaults 不给 target 时清空全部。 */
    addFault: (fault: ProbeFault) => void;
    clearFaults: (target?: string) => void;
    setLatency: (target: string, latency: { first?: number; rest?: number }) => void;
    /** 按住 / 放行任意 target 的后台分页应答（offset > 0；歌单曲目与歌手专辑）。 */
    holdPagesOf: (target: string) => void;
    releasePagesOf: (target: string) => void;
    /** Navidrome 垫片：按住某个端点的应答；放行最新一个或全部；上游给歌手改名。 */
    holdNavidrome: (endpoint: string) => void;
    releaseNavidrome: (endpoint: string, which?: 'newest' | 'all') => number;
    heldNavidrome: (endpoint: string) => number;
    renameNavidromeArtist: (artistId: string, name: string) => void;
    /** 预置假队列里已有的歌（playback key）：整批入队时它们不会再被收下。 */
    seedQueue: (keys: string[]) => void;
    /** 像宿主刷新本地曲库那样重新读一次（本地歌曲数组换新，依赖它的 catalog 随之重载）。 */
    refreshLocal: () => Promise<void>;
    calls: () => ProbeCall[];
    requests: () => ProbeRequest[];
    clearLog: () => void;
};

declare global {
    interface Window {
        __libraryProbe?: LibraryProbeApi;
    }
}
