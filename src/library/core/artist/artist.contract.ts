import type { LocalSong, SongResult } from '../../../types';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../../../types/localLibrary';
import type { LibraryCapability } from '../shared/capability.contract';
import type { LibraryCollectionDescriptor } from '../collection/collection.contract';
import type { LibraryArtistActionId } from '../suite/suite.contract';

// src/library/core/artist/artist.contract.ts
// 歌手页的契约：宿主按 collectionKey 持有的歌手资源（详情、热门歌曲、专辑与专辑的后台分页）。
// 原先这些都是 ArtistGridView 的组件状态（artistInfo / topSongs / albums / loading / backgroundLoading /
// backgroundLoadFailed + loadGenerationRef）；挪到 core 之后，任何一套 suite 的歌手页都只订阅同一份快照。
// 这里只有数据与判别式，不出现成品错误文案、ReactNode 或动画值。

/** 本地曲库的 catalog（实体与归属）。ready=false 表示宿主还没读完——这时本地歌手只能说「加载中」，不能说「没有内容」。 */
export type LibraryLocalCatalog = {
    readonly ready: boolean;
    /** 读不出来（不会再来）：本地歌手这时是读失败，不是一直「加载中」。没有时当作还在读。 */
    readonly failed?: boolean;
    readonly entities: LocalLibraryEntity[];
    readonly assignments: LocalLibraryAssignment[];
};

/** 本地歌手的输入：宿主的 catalog 快照与本地歌曲（宿主每次变化都交给资源，资源同步重算）。 */
export type LibraryArtistLocalLibrary = {
    readonly catalog: LibraryLocalCatalog;
    readonly songs: LocalSong[];
};

/**
 * idle：还没开始（宿主的 ensure 还没到，界面按加载中处理）；loading：详情 / 热门歌曲加载中（本地：catalog 未就绪）；
 * ready：详情与热门歌曲已到（专辑可能还在后台分页）；error：本轮加载失败（见 error）。
 */
export type LibraryArtistStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * 加载失败的种类（判别式，翻译在渲染时做）：
 * - load-failed：上游请求失败（在线详情 / 热门歌曲抛错，Navidrome 拿不到歌手）；
 * - source-unavailable：来源不可用（Navidrome 没有配置）。
 */
export type LibraryArtistLoadError = 'load-failed' | 'source-unavailable';

/**
 * 专辑的后台分页（只有在线歌手有）：没有 / 进行中（下一页的 offset）/ 在某个 offset 处中断。
 * 中断的原因：failed 是那一页请求失败（界面给重试，retryAlbums 从这个 offset 续）；paused 是资源被暂停
 * （宿主离开了这个歌手页），复用时 ensure 自动从这个 offset 续，界面按「还在加载」处理。
 */
export type LibraryArtistAlbumSync =
    | { readonly state: 'none' }
    | { readonly state: 'syncing'; readonly offset: number }
    | { readonly state: 'interrupted'; readonly offset: number; readonly reason: 'failed' | 'paused' };

/** 歌手详情（名字、头像、简介、统计）。 */
export type LibraryArtistDetail = {
    readonly id?: string | number;
    readonly name: string;
    readonly coverUrl?: string;
    readonly description?: string;
    readonly trackCount?: number;
    readonly albumCount?: number;
    readonly aliases?: string[];
};

/** 歌手的一张专辑；在线专辑原样带着 provider 的字段（打开时作为链接提示交给宿主）。 */
export type LibraryArtistAlbum = {
    readonly id: string | number;
    readonly name: string;
    readonly coverUrl?: string;
    readonly publishedAt?: number;
    /** 曲目数（在线 provider 给了才有，Navidrome 是 songCount，本地按歌数）；未知时没有。 */
    readonly trackCount?: number;
    readonly providerId?: string;
    readonly [field: string]: unknown;
};

/** urgent 立即提交；background 是专辑的后台分页，renderer 放进 transition、拖拽中可以先暂存（同集合资源）。 */
export type LibraryArtistUpdateHint = 'urgent' | 'background';

export type LibraryArtistSnapshot = {
    readonly key: string;
    readonly status: LibraryArtistStatus;
    /** 没有详情（在线 provider 不给、本地实体不存在）时为 null：界面显示空态。 */
    readonly detail: LibraryArtistDetail | null;
    /** 热门歌曲（最多 10 首，按显示顺序，含不可播放的）；每次变化都是新数组。 */
    readonly topSongs: SongResult[];
    /** 全部专辑（未筛选），按上游顺序去重；每次变化都是新数组。 */
    readonly albums: LibraryArtistAlbum[];
    readonly albumSync: LibraryArtistAlbumSync;
    readonly error: LibraryArtistLoadError | null;
    readonly hint: LibraryArtistUpdateHint;
};

export type LibraryArtistSource = 'online' | 'navidrome' | 'local';

/**
 * 歌手资源。宿主按 collectionKey 创建并持有（不订阅快照），suite 只订阅。每次加载领一个 generation，
 * 被取代的加载（reload、pause、dispose 之后）的应答一律丢弃。
 */
export interface LibraryArtistResource {
    readonly key: string;
    readonly source: LibraryArtistSource;
    getSnapshot(): LibraryArtistSnapshot;
    /** 返回退订函数。 */
    subscribe(listener: () => void): () => void;
    /**
     * 对齐这份描述（与本地曲库）：第一次调用开始加载；暂停后复用时续上被暂停的专辑分页；本地歌手每次都按
     * 最新的 catalog 与歌曲同步重算（catalog 未就绪时保持 loading）。同一状态下重复调用不会重复请求。
     */
    ensure(descriptor: LibraryCollectionDescriptor, local?: LibraryArtistLocalLibrary): void;
    /** 专辑分页失败后从失败的 offset 续（详情与热门歌曲不重新请求）；不是失败中断时忽略。 */
    retryAlbums(): void;
    /** 从头重新加载（作废进行中的加载）。 */
    reload(): void;
    /** 宿主离开：作废进行中的加载，正在分页的专辑记为 paused 中断。 */
    pause(): void;
    dispose(): void;
    /** 宿主再次打开同一个歌手时能否直接复用（详情已到、没有失败）。 */
    canReuse(descriptor: LibraryCollectionDescriptor): boolean;
}

/**
 * 歌手页每个语义动作此刻的能力（core/artist/artistSurface 的 resolveArtistCapabilities，纯规则，只看歌手资源的
 * 快照与描述）。按钮、键位与命令面板共用同一份：suite 只在「声明 ∩ supported」时给入口，enabled 决定能不能点。
 */
export type LibraryArtistCapabilities = { readonly [Action in LibraryArtistActionId]: LibraryCapability };

/**
 * 歌手页交给命令面板的动作（artist surface）。与语义动作的对应见 core/artist/artistSurface 的
 * ARTIST_SURFACE_ACTION_SOURCES：play-top-songs → play-scope、enqueue-top-songs → enqueue-scope、
 * reload → reload、retry-albums → resume-sync、edit-entity → edit-entity。单曲播放 / 入队、打开专辑 / 歌手
 * 作用于某一项，不进命令面板（与集合 surface 的 play / enqueue 一样）。
 */
export type LibraryArtistSurfaceActionId =
    | 'play-top-songs'
    | 'enqueue-top-songs'
    | 'reload'
    | 'retry-albums'
    | 'edit-entity';

/** 命令面板问歌手页的状态；每次现读，不缓存。 */
export interface LibraryArtistSurfaceState {
    /** 歌手资源的 key（= 浏览会话的键）。 */
    artistKey: string;
    /** 此刻可用的动作（能力 enabled ∩ suite 的声明）。 */
    availableActions: readonly LibraryArtistSurfaceActionId[];
    playableTopSongCount: number;
    queueableTopSongCount: number;
    /** 全部专辑数与筛选后显示的专辑数。 */
    albumCount: number;
    shownAlbumCount: number;
    isFilterActive: boolean;
}

/** 正在交互的歌手页发布给命令面板的句柄。run 返回动作是否被接下（不可用时为 false）。 */
export interface LibraryArtistSurfaceHandle {
    getState(): LibraryArtistSurfaceState;
    run(action: LibraryArtistSurfaceActionId): boolean;
}
