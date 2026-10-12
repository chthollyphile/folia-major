import type { HomeViewTab, LocalLibraryGroup, LocalSong, SongResult } from '../../../types';
import type { MediaId, ProviderAccountSummary, ProviderCollection, ProviderUser } from '../../../types/onlineMusic';
import type { NavidromeConfig, SubsonicAlbum, SubsonicArtist, SubsonicPlaylist, SubsonicSong } from '../../../types/navidrome';
import type { LibraryCollectionDescriptor, NavidromeGridViewCollectionType } from './collection';
import type { LibraryDirectoryNode, LibraryDirectorySelectionType, LibraryHiddenScope } from './directory';

// src/library/core/contracts/homeModel.ts
// 首页模型的契约（P3.3 从网格的 Grid3D 里提出来）：来源与页签、在线首页数据（收藏专辑、电台 feed）的资源、
// 首页卡片的视图模型、首页动作（导入、私人 FM、打开卡片）的控制器与端口。任何一套 suite 的首页都按这些类型
// 拿数据，不依赖网格。只有类型。

/** 首页一级页签（与应用的 HomeViewTab 同一套）。 */
export type LibraryHomeTabKey = HomeViewTab;
/** 在线来源的三个页签。 */
export type LibraryHomeOnlineTab = 'playlist' | 'radio' | 'albums';

/** 待翻译的文案：core 只给 i18n key 与插值，翻译在绑定 / 端口里做（fallback 是翻译为空时的兜底）。 */
export type LibraryHomeMessage = {
    key: string;
    values?: Record<string, string | number>;
    fallback?: string;
};

/** 一个一级页签：不可用时带原因（按钮禁用，原因作提示）。 */
export type LibraryHomeTab = {
    key: LibraryHomeTabKey;
    label: LibraryHomeMessage;
    disabledReason?: LibraryHomeMessage;
};

/** 已翻译的页签（绑定交给 renderer 的形状）。 */
export type LibraryHomeTabView = {
    key: LibraryHomeTabKey;
    label: string;
    disabledReason?: string;
};

/** 在线 provider 的账户视图（规则见 core/model/onlineProviderAccountView）。 */
export type LibraryHomeAccountView = 'resolving' | 'guest' | 'authenticated' | 'accountless';

/** 当前在线来源：provider、账户、能用哪些页签。 */
export type LibraryHomeOnlineSource = {
    providerId: string;
    providerLabel: string;
    provider?: ProviderAccountSummary;
    user: ProviderUser | null;
    accountView: LibraryHomeAccountView;
    /** 账户登录过期（provider 报 auth-required）。 */
    needsRelogin: boolean;
    /** 账户歌单页签的条目（含云盘）。 */
    collections: ProviderCollection[];
    canUsePlaylists: boolean;
    canUseAlbums: boolean;
    canUseRadio: boolean;
    /** provider 支持私人 FM 模式（FM 卡的描述显示当前模式）。 */
    hasPersonalFmModes: boolean;
    /** Heartbeat entry is offered only by capable, authenticated providers. */
    hasHeartbeatRecommendations?: boolean;
};

/** 本地曲库能不能用（浏览器要安全上下文与文件系统 API）。 */
export type LibraryHomeLocalAvailability = {
    supported: boolean;
    reason: 'insecure-http' | 'file-system-api-unavailable' | null;
};

/** 在线首页数据的归属：哪个 provider 的哪个账户。换了归属，旧数据与还在路上的应答都作废。 */
export type LibraryHomeFeedOwner = {
    providerId: string;
    userId: MediaId;
};

export type LibraryHomeFeedStatus = 'idle' | 'loading' | 'ready' | 'error';

export type LibraryHomeFeedSnapshot<TData> = {
    owner: LibraryHomeFeedOwner | null;
    status: LibraryHomeFeedStatus;
    /** 这个归属下至少成功读到过一次（ensure 据此决定要不要读）。 */
    loaded: boolean;
    data: TData;
};

/**
 * 一份在线首页数据（收藏专辑、电台 feed）。实现在 core/services/onlineHomeFeeds：每次读取领一个 generation，
 * 换归属或重新读取都会让旧的读取作废——晚到的应答直接丢掉，不会落进新 provider / 新账户的列表。
 */
export interface LibraryHomeFeedResource<TData> {
    getSnapshot(): LibraryHomeFeedSnapshot<TData>;
    subscribe(listener: () => void): () => void;
    /** 换归属（null：没有账户或 provider 不支持）：清空数据、作废进行中的读取。同一归属重复设置不起作用。 */
    setOwner(owner: LibraryHomeFeedOwner | null): void;
    /** 这个归属下还没读到过就读一次；正在读或已读到时什么都不做。 */
    ensure(): Promise<void>;
    /** 不管读没读过都重新读（旧数据保留到新数据到达）；没有归属时什么都不做。 */
    reload(): Promise<void>;
}

/** 电台页签的数据（omni.getHomeFeed 的结果；封面在读取时就按 provider 解析好）。 */
export type LibraryHomeRadioFeed = {
    personalFmCoverUrl?: string;
    dailyCoverUrl: string;
    dailyCount: number;
    /** 未声明时沿用旧 feed 的支持语义；默认环境装配会明确提供实际 provider 能力。 */
    supportsDailySongs?: boolean;
    recommended: ProviderCollection[];
};

/**
 * 宿主（library/app）为首页创建、交给任何 suite 的资源与控制器。一个首页一份，切 suite 不重建。
 * 生命周期跟着「首页真的离开」（首页整个藏起或卸载），不跟某个 suite 的首页组件：换 suite 时新 suite 的首页
 * 读到的是同一份数据、不重新请求；离开首页时宿主放掉在线数据的归属、让 Navidrome 概览与文件夹树作废，
 * 回到首页再读（见 library/app/useLibraryHomeResources 与 core/services/libraryHomeLifetime）。
 */
export type LibraryHomeResources = {
    favoriteAlbums: LibraryHomeFeedResource<ProviderCollection[]>;
    radioFeed: LibraryHomeFeedResource<LibraryHomeRadioFeed | null>;
    actions: LibraryHomeActionsController;
    /** Navidrome 页签的概览（进页签时 ensure；离开页签或首页时作废，下次进来重读）。 */
    navidromeOverview: LibraryNavidromeHomeResource;
    /** 本地文件夹树（本地页签 ensure；曲库变了重读；离开页签或首页时作废）。 */
    localDirectoryTrees: LibraryLocalDirectoryTreesResource;
};

/**
 * 首页的一张卡（网格滑条与 GridMap、TUI 的一行共用的视图模型）。目录条目的业务字段之外，
 * `raw` 是卡片背后的来源对象（打开集合时用），Navidrome 专辑另带几项展示字段。
 */
export type LibraryHomeCard = {
    id: string | number;
    name: string;
    type?: string;
    coverUrl?: string;
    description?: string;
    summary?: string;
    trackCount?: number;
    trackIds?: string[];
    isVirtual?: boolean;
    raw?: unknown;
    /** Navidrome 专辑卡的展示字段（交给集合描述）。 */
    albumArtist?: string;
    albumYear?: number;
    albumGenre?: string;
    albumDuration?: number;
    /** Navidrome 自建歌单可编辑。 */
    editable?: boolean;
};

/** 本地扫描进度（导入 / 重扫时曲库服务广播）。 */
export type LibraryHomeScanProgress = {
    active: boolean;
    folderName: string;
    totalSongs: number;
    completedSongs: number;
};

/** 首页动作控制器的快照：哪个导入在进行、扫描进度。 */
export type LibraryHomeActionsSnapshot = {
    importingFolder: boolean;
    refreshingFolders: boolean;
    importingPlaylist: boolean;
    scan: LibraryHomeScanProgress | null;
};

/** 首页动作的结果（存判别式；要显示的提示已经经端口发出）。 */
export type LibraryHomeActionResult =
    | { ok: true }
    | { ok: false; reason: 'busy' | 'unsupported' | 'failed' };

/** 歌单文件导入的结果（端口把曲库服务的结果压成这几个数）。 */
export type LibraryHomePlaylistImportResult = {
    /** 建出来的歌单名；一首都没匹配上时为 null（不建歌单）。 */
    playlistName: string | null;
    matchedCount: number;
    /** 没匹配上或匹配到多首的路径数。 */
    skippedCount: number;
};

/** 端口发出的提示：alert 是阻塞式提示框（原先的 window.alert），status 是应用内状态消息。 */
export type LibraryHomeNotice =
    | { kind: 'alert'; message: LibraryHomeMessage }
    | { kind: 'status'; type: 'error' | 'info' | 'success'; message: LibraryHomeMessage };

/** 打开集合的入口（宿主的 openGridView）。 */
export type LibraryHomeOpenCollection = (collection: LibraryCollectionDescriptor) => void;

/**
 * 首页动作的副作用端口（宿主装配，见 library/app/createLibraryHomePort）：本地曲库服务、私人 FM 与播放、
 * 集合描述工厂、提示的翻译与显示都在宿主一侧；core 只决定调哪些、按什么顺序、什么时候算忙。
 */
export interface LibraryHomePort {
    localAvailability(): LibraryHomeLocalAvailability;
    /** 选一个文件夹导入；返回新导入的歌曲数。 */
    importFolder(): Promise<number>;
    /** 重扫全部导入根；返回新导入的歌曲数。 */
    resyncAllFolders(): Promise<number>;
    /** 用宿主此刻的曲库匹配 m3u 文件里的路径并建歌单。 */
    importPlaylistFile(file: File): Promise<LibraryHomePlaylistImportResult>;
    /** 重新读取本地曲库。 */
    refreshLocalSongs(): Promise<void> | void;
    /** 订阅扫描进度；返回退订函数。 */
    subscribeScanProgress(listener: (progress: LibraryHomeScanProgress | null) => void): () => void;
    getPersonalFm(): Promise<SongResult[]>;
    playPersonalFm(song: SongResult, queue: SongResult[]): void;
    startHeartbeat?(): Promise<boolean>;
    describeOnlineCollection(collection: Record<string, unknown>, providerId: string): LibraryCollectionDescriptor;
    describeLocalGroup(group: LocalLibraryGroup): LibraryCollectionDescriptor;
    describeNavidromeCard(card: LibraryHomeCard, type: NavidromeGridViewCollectionType): LibraryCollectionDescriptor;
    notify(notice: LibraryHomeNotice): void;
}

/**
 * 首页动作控制器（实现在 core/services/libraryHomeActions，宿主创建，经 homeResources 交给 suite）。
 * 三个本地导入动作共用一个「忙」：任何一个在进行或扫描进行中时再提交返回 busy（歌单文件导入只看自己）。
 */
export interface LibraryHomeActionsController {
    getSnapshot(): LibraryHomeActionsSnapshot;
    /** 第一个订阅者到来时开始听扫描进度，最后一个离开时停。 */
    subscribe(listener: () => void): () => void;
    importFolder(): Promise<LibraryHomeActionResult>;
    refreshFolders(): Promise<LibraryHomeActionResult>;
    importPlaylistFile(file: File): Promise<LibraryHomeActionResult>;
    /** 取私人 FM 并从第一首开始播放（取不到歌时什么都不做）。 */
    playPersonalFm(): Promise<LibraryHomeActionResult>;
    /** 打开在线卡片：私人 FM 直接播放，其余交给宿主打开集合。 */
    openOnlineCard(card: LibraryHomeCard, providerId: string, open: LibraryHomeOpenCollection): Promise<LibraryHomeActionResult>;
    openLocalGroup(group: LocalLibraryGroup, open: LibraryHomeOpenCollection): void;
    openNavidromeCard(card: LibraryHomeCard, type: NavidromeGridViewCollectionType, open: LibraryHomeOpenCollection): void;
}

/** 列表右上角的一个动作（本地：导入文件夹、刷新、导入歌单文件；Navidrome：刷新）。 */
export type LibraryHomeListAction = {
    id: string;
    labelKey: string;
    /** labelKey 翻译为空时的兜底文字。 */
    fallbackLabel?: string;
    /** 悬停提示的 key（不给时用 labelKey）。 */
    titleKey?: string;
    /** 这个动作正在进行（按钮显示转圈）。 */
    pending: boolean;
    disabled: boolean;
};

/** Navidrome 首页概览的数据（一次读完：全部专辑按字母序、最近添加 / 播放、歌单、歌手、随机与收藏的歌）。 */
export type LibraryNavidromeHomeData = {
    albums: SubsonicAlbum[];
    recentlyAddedAlbums: SubsonicAlbum[];
    recentlyPlayedAlbums: SubsonicAlbum[];
    playlists: SubsonicPlaylist[];
    artists: SubsonicArtist[];
    randomSongs: SubsonicSong[];
    favoriteSongs: SubsonicSong[];
};

export type LibraryNavidromeHomeSnapshot = {
    /** 读取时的服务器配置；没有配置时为 null（首页显示「去设置」）。 */
    config: NavidromeConfig | null;
    isLoading: boolean;
    data: LibraryNavidromeHomeData;
};

/** Navidrome 首页概览资源（实现在 core/services/navidromeHomeLibrary）。每次 load 重新读配置，晚到的旧读取丢掉。 */
export interface LibraryNavidromeHomeResource {
    getSnapshot(): LibraryNavidromeHomeSnapshot;
    subscribe(listener: () => void): () => void;
    load(): Promise<void>;
    /** 作废之后还没读过就读一次（正在读或已经读过时什么都不做）。显示 Navidrome 页签的 surface 挂载时调。 */
    ensure(): Promise<void>;
    /** 让下一次 ensure 重新读（数据保留到新数据到达）。离开 Navidrome 页签或首页时由宿主调。 */
    invalidate(): void;
}

export type LibraryLocalDirectoryTreesSnapshot = {
    trees: LibraryDirectoryNode[];
    /** 至少读完过一次（空曲库的「导入文件夹」提示要等它）。 */
    loaded: boolean;
};

/** 本地文件夹树资源（实现在 core/services/localDirectoryTrees）：按曲库读导入根的快照建树，晚到的旧读取丢掉。 */
export interface LibraryLocalDirectoryTreesResource {
    getSnapshot(): LibraryLocalDirectoryTreesSnapshot;
    subscribe(listener: () => void): () => void;
    /** songs 不给时由服务自己读曲库（恢复忽略目录之后用）。 */
    load(songs?: readonly LocalSong[]): Promise<void>;
    /** 按这份曲库读过（同一个数组）且没作废时什么都不做，否则按它读。显示本地页签的 surface 挂载与曲库变化时调。 */
    ensure(songs: readonly LocalSong[]): Promise<void>;
    /** 让下一次 ensure 重新读（树保留到新树到达）。离开本地页签或首页时由宿主调。 */
    invalidate(): void;
}

/**
 * 首页此刻挂着的列表（任何 suite 的首页注册，见 core/state/useLibraryHomeSurfaceStore）：当前页签 / section 的
 * 全部条目（隐藏的也在）、目录会话 key、隐藏作用域、section 与动作。行为探针与以后的命令面板从这里读，不碰组件树。
 */
export type LibraryHomeListState = {
    tab: LibraryHomeTabKey;
    directoryKey: string;
    hiddenScope: LibraryHiddenScope;
    sections: { id: string; label: string; active: boolean }[];
    items: LibraryHomeCard[];
    isLoading: boolean;
    actions: { id: string; label: string; disabled: boolean }[];
    /** 这个列表支持的批量类型（没有批量时为 null）。 */
    batchSelectionType: LibraryDirectorySelectionType | null;
    /** 本地文件夹的目录树（只有本地 folders 有）。 */
    directoryTrees?: LibraryDirectoryNode[];
};

export interface LibraryHomeListHandle {
    getState(): LibraryHomeListState;
    /** 切到某个 section；没有这个 section 时返回 false。 */
    setSection(id: string): boolean;
    /** 等价于点右上角的这个动作（禁用或不存在时返回 false）。 */
    runAction(id: string): boolean;
    /** 用这个文件导入歌单（只有本地列表有）。 */
    importPlaylistFile?(file: File): Promise<boolean>;
}

export type LibraryHomeTabsState = {
    active: LibraryHomeTabKey;
    tabs: LibraryHomeTabView[];
};

export interface LibraryHomeTabsHandle {
    getState(): LibraryHomeTabsState;
    /** 切页签（不存在或不可用时返回 false）。 */
    setTab(tab: LibraryHomeTabKey): boolean;
}
