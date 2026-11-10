import type { SongResult } from '../../../../types';
import type { DailyStyleGroup, DailyStyleSelection, MediaId } from '../../../../types/onlineMusic';
import type { LibraryCapability } from '../../shared/capability.contract';
import type { LibraryCollectionDescriptor } from '../collection.contract';
import type { LibraryMutationPort, LibraryPlaylistOption } from '../../shared/ports.contract';
import type { CollectionResource } from '../../shared/resource.contract';

// src/library/core/collection/mutations/mutations.contract.ts
// ---- 变更动作（P2）：删条目、订阅、改名、删除集合、重扫、导出……两套 UI 调同一个控制器。 ----
// 控制器的实现在 core/collection/mutations/collectionMutations.service，能力规则在 core/collection/mutations/collectionMutationCapabilities。

/**
 * 集合里的一个条目。同一首歌可以在歌单里出现多次，entryKey（`${playbackKey}-${occurrence}`，
 * 与网格卡片 id、TUI 行同一格式，见 core/collection/collectionEntries）区分是哪一次。
 */
export type LibraryEntryRef = { entryKey: string; track: SongResult };

/**
 * 动作没做成的原因：busy 同一动作还在进行（只发了一次请求）；stale 条目已经不在原处；
 * unsupported 这个集合没有这个动作；limit-reached 上游说没有更多了；failed 上游或本地出错。
 */
export type LibraryMutationFailureReason = 'busy' | 'stale' | 'unsupported' | 'limit-reached' | 'failed';

/** 存判别式，文案在 renderer 里翻译。 */
export type LibraryMutationResult =
    | { ok: true }
    | { ok: false; reason: LibraryMutationFailureReason; message?: string };

/**
 * 集合的来源分支，逐字对应 GridView 原先的布尔（见 core/collection/mutations/collectionMutationCapabilities）。
 * renderer 用它决定文案（例如专辑与歌单的订阅提示、文件夹删除要先确认）。
 */
export type CollectionMutationBranches = {
    isLocalCollection: boolean;
    isNavidromeCollection: boolean;
    isDailyRecommendationsCollection: boolean;
    isLocalFolderCollection: boolean;
    isLocalAllSongsCollection: boolean;
    isLocalPlaylistCollection: boolean;
    isLocalEntityCollection: boolean;
    isNavidromePlaylistCollection: boolean;
    isCloudDrive: boolean;
    isOnlinePlaylist: boolean;
    isOnlineAlbum: boolean;
    canEditOnlineCollectionTracks: boolean;
    canEditOwnedPlaylist: boolean;
    canEditProviderPlaylist: boolean;
    /** 有可编辑的内容（删条目或改名）：网格的「编辑」开关。 */
    canEditPlaylist: boolean;
    showSubscribeButton: boolean;
    canAddNavidromeToPlaylist: boolean;
};

export type CollectionMutationCapabilities = {
    /** 删除（或每日推荐的不喜欢）单个条目。 */
    removeEntry: LibraryCapability;
    subscribe: LibraryCapability;
    /** 进入 / 退出编辑（= canEditPlaylist）；编辑模式本身属于 renderer。 */
    editCollection: LibraryCapability;
    rename: LibraryCapability;
    deleteCollection: LibraryCapability;
    resyncFolder: LibraryCapability;
    resyncAllFolders: LibraryCapability;
    exportPlaylist: LibraryCapability;
    addToPlaylist: LibraryCapability;
    createPlaylist: LibraryCapability;
    editEntity: LibraryCapability;
    /** 本地文件夹 / 专辑 / 歌单的自定义封面（打开宿主的封面对话框）。 */
    setCover: LibraryCapability;
    organizeSongInfo: LibraryCapability;
    /** 本地歌曲匹配在线信息；还要看条目本身是不是本地歌。 */
    matchSong: LibraryCapability;
    /** 每日推荐切换历史日期 / 刷新今天。加载中的禁用由 renderer 结合资源快照决定。 */
    dailyDate: LibraryCapability;
};

export type CollectionMutationSnapshot = {
    /** 订阅状态：null 表示还不知道，或这个集合不能订阅。 */
    readonly subscribed: boolean | null;
    readonly subscribing: boolean;
    /** 删除请求还没回来的条目。 */
    readonly pendingEntryKeys: readonly string[];
    readonly dailyLimitReached: boolean;
    /** 共用的来源动作（改名、删除、重扫、导出、加入歌单）进行中。 */
    readonly sourceActionPending: boolean;
    /** 每日推荐当前看的日期，'' 表示今天。 */
    readonly dailyDate: string;
    readonly dailyHistoryDates: readonly string[];
    /**
     * 每日推荐能不能看历史日期：平台自己有这个功能（能力 historyRecommendations）才有日期可选；没有它的平台只有
     * 当天的列表和刷新。不是每日推荐时为 false。
     */
    readonly dailyHistoryAvailable: boolean;
    /**
     * 每日推荐能不能看风格推荐（#938）：平台有这个功能（能力 dailyStyleRecommendations）才有。不是每日推荐时为 false。
     */
    readonly dailyStyleAvailable: boolean;
    /** 正在看风格推荐（这时 dailyDate 是 ''）。 */
    readonly dailyStyleShown: boolean;
    /** 可选的风格分组；第一次看风格推荐时才去取，取到之前是空的。 */
    readonly dailyStyleGroups: readonly DailyStyleGroup[];
    /** 上一次取风格分组没取到（失败或一组都没有）；再调 loadDailyStyleGroups 重取。 */
    readonly dailyStyleGroupsFailed: boolean;
    /** 正在看的风格推荐是哪些风格（答复带回来的，答复没说时是刚保存的）；还不知道时为 null。 */
    readonly dailyStyleSelection: DailyStyleSelection | null;
    /**
     * 改名成功、但宿主的集合描述还带着旧名字时的新名字（renderer 显示它）；宿主的描述跟上或变了就回到 null。
     */
    readonly renamedTo: string | null;
    /** Navidrome「加入歌单」的候选歌单。 */
    readonly availablePlaylists: readonly LibraryPlaylistOption[];
    readonly branches: CollectionMutationBranches;
    readonly capabilities: CollectionMutationCapabilities;
};

/** 控制器跟随宿主更新的输入：同一集合会话里描述、资源（本地集合会换新资源）、端口、用户都会变。 */
export type CollectionMutationInputs = {
    descriptor: LibraryCollectionDescriptor;
    resource: CollectionResource | null;
    port: LibraryMutationPort;
    currentUserId?: MediaId | null;
};

/**
 * 一个集合会话一个实例（宿主持有，renderer 订阅）。每个动作执行时重新检查能力；同一条目 / 同一动作
 * 进行中再次提交返回 busy，只发一次请求。dispose 之后控制器的状态不再变化、不再通知，
 * 已发出的上游请求照常完成。
 */
export interface CollectionMutationController {
    getSnapshot(): CollectionMutationSnapshot;
    /** 第一个订阅者到来时才去取订阅状态与每日推荐的历史日期。返回退订函数。 */
    subscribe(listener: () => void): () => void;
    /** 宿主同步最新输入；能力随之重算，有变化才通知。 */
    update(inputs: Partial<CollectionMutationInputs>): void;
    removeEntry(entry: LibraryEntryRef): Promise<LibraryMutationResult>;
    toggleSubscribe(): Promise<LibraryMutationResult>;
    /** 名字去掉首尾空白；空或与当前显示的名字（renamedTo ?? 描述的名字）相同时什么都不做并返回 ok。 */
    rename(name: string): Promise<LibraryMutationResult>;
    /** 成功后由 renderer 返回上一层。 */
    deleteCollection(): Promise<LibraryMutationResult>;
    resyncFolder(): Promise<LibraryMutationResult>;
    resyncAllFolders(): Promise<LibraryMutationResult>;
    exportPlaylist(): Promise<LibraryMutationResult>;
    /** tracks 由 renderer 给（网格给的是可播放曲目）。 */
    addToPlaylist(playlistId: string | number, tracks: SongResult[]): Promise<LibraryMutationResult>;
    createPlaylist(name: string, tracks: SongResult[]): Promise<LibraryMutationResult>;
    editEntity(): Promise<LibraryMutationResult>;
    /** 打开宿主的集合封面对话框（poster.png、上传、选一首歌的封面、恢复默认）。 */
    setCover(): Promise<LibraryMutationResult>;
    organizeSongInfo(): Promise<LibraryMutationResult>;
    matchSong(track: SongResult): Promise<LibraryMutationResult>;
    /** date 为 '' 表示今天；afresh 让上游重新生成今天的推荐。看风格推荐时换日期就回到默认推荐。 */
    setDailyDate(date: string, options?: { afresh?: boolean }): Promise<LibraryMutationResult>;
    /** 换成风格推荐（按账号已选的风格）；风格分组第一次用到时一起去取。 */
    showDailyStyle(): Promise<LibraryMutationResult>;
    /** 把选的风格存到账号上，再换成这些风格的推荐。selection 至少要有一个风格。 */
    setDailyStyle(selection: DailyStyleSelection): Promise<LibraryMutationResult>;
    /** 取风格分组（打开风格选择时调）：已经取到或正在取时什么都不做，上次没取到就再取一次。 */
    loadDailyStyleGroups(): void;
    dispose(): void;
}
