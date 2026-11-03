import type { LocalSong } from '../../../types';
import type { LibraryMutationResult } from '../collection/mutations/mutations.contract';

// src/library/core/directory/directory.contract.ts
// 首页目录的契约：目录条目（任意 suite 展示的一张卡 / 一行的业务部分）、本地文件夹树节点、批量范围与批量动作。
// 只有类型。条目里不放 ReactNode 之类的 UI 字段；网格需要随卡带回的原对象（rawCollection）由网格自己的
// GridMapItem 扩展，不进契约。

/**
 * 目录里的一个条目（歌单、专辑、歌手、文件夹、电台……）。
 * `id` 在同一个目录（同一来源的同一 section）里唯一；隐藏、批选、焦点都按它认人。
 */
export interface LibraryDirectoryItem {
    id: string | number;
    name: string;
    /** 条目类型：playlist、album、artist、folder、cloud、radio、daily_recommendations、personal_fm…… */
    type?: string;
    /** 本地真实文件夹的相对路径（目录树与批量范围按它匹配）；虚拟条目没有。 */
    path?: string;
    description?: string;
    summary?: string;
    trackCount?: number;
    /** 这个条目包含的歌曲 id（目前只有本地条目有），批量范围按它去重保序。 */
    trackIds?: string[];
    coverUrl?: string;
    /** 不对应真实来源对象的条目：本地「全部歌曲」「我喜欢」、未知专辑 / 歌手、Navidrome 随机 / 收藏歌单。 */
    isVirtual?: boolean;
    /** 显式声明能否隐藏；不给时按类型推断（见 core/directory/directoryVisibility 的 isHideableDirectoryItem）。 */
    hideable?: boolean;
}

/** 本地文件夹树的一个节点（只含目录，不含曲目）。service 构建它，批量面板 / 目录树展示它。 */
export interface LibraryDirectoryNode {
    id: string;
    name: string;
    path: string;
    rootPath: string;
    depth: number;
    ignored?: boolean;
    directTrackCount: number;
    totalTrackCount: number;
    children: LibraryDirectoryNode[];
}

/** 支持批量的 section。 */
export type LibraryDirectorySelectionType = 'folders' | 'albums' | 'artists';

/**
 * 批量动作 id。隐藏不是批量动作（见 directoryVisibility 的产品语义）。
 * play / enqueue / create-playlist 每个批量 section 都有；其余只有本地文件夹有。
 */
export type LibraryDirectoryBatchActionId =
    | 'play'
    | 'enqueue'
    | 'create-playlist'
    | 'remove'
    | 'rescan-root'
    | 'remove-root'
    | 'clear-ignore';

/** 批量范围：选中的条目（按目录顺序）与它们去重保序后的歌曲 id。 */
export interface LibraryDirectoryBatchContext<TItem extends LibraryDirectoryItem = LibraryDirectoryItem> {
    items: TItem[];
    trackIds: string[];
}

/**
 * 批量动作进行中的那一个（同一时间只允许一个，见 core/directory/localDirectoryActions.service）。
 * rootPath：落在某个导入根上的动作（重扫根、移除根、恢复忽略目录）——面板只让那一行显示忙。
 */
export interface LibraryDirectoryBatchPending {
    action: LibraryDirectoryBatchActionId;
    rootPath?: string;
}

/** 批量动作控制器的快照。 */
export interface LibraryDirectoryBatchSnapshot {
    pending: LibraryDirectoryBatchPending | null;
}

/** 控制器动作的可选收尾：在 pending 期间、曲库刷新之后执行（本地文件夹视图在这里重读目录树）。 */
export interface LibraryDirectoryBatchRunOptions {
    after?: () => Promise<void> | void;
}

/**
 * 本地目录的批量动作控制器（实现在 core/directory/localDirectoryActions.service，宿主装配端口后创建，
 * 经首页 surface 交给 suite）。所有动作返回 LibraryMutationResult：进行中再提交返回 busy，
 * 范围里没有歌返回 unsupported，抛错返回 failed；做成的动作之后都会刷新曲库。
 */
export interface LibraryDirectoryBatchController {
    getSnapshot(): LibraryDirectoryBatchSnapshot;
    subscribe(listener: () => void): () => void;
    play(context: LibraryDirectoryBatchContext): Promise<LibraryMutationResult>;
    enqueue(context: LibraryDirectoryBatchContext): Promise<LibraryMutationResult>;
    createPlaylist(name: string, context: LibraryDirectoryBatchContext): Promise<LibraryMutationResult>;
    /** 文件夹删除的路径规则见实现（「全部歌曲」不按文件夹删；整个文件夹都选中才删文件夹）。 */
    remove(context: LibraryDirectoryBatchContext, options?: LibraryDirectoryBatchRunOptions): Promise<LibraryMutationResult>;
    clearIgnore(folderPath: string, options?: LibraryDirectoryBatchRunOptions): Promise<LibraryMutationResult>;
    rescanRoot(rootPath: string, options?: LibraryDirectoryBatchRunOptions): Promise<LibraryMutationResult>;
    removeRoot(rootPath: string, options?: LibraryDirectoryBatchRunOptions): Promise<LibraryMutationResult>;
}

/**
 * 批量动作的副作用端口（宿主装配，见 library/app/createLibraryDirectoryBatchPort）：播放 / 入队怎么建队列、
 * 本地曲库服务怎么调，都在宿主一侧；core 只决定调哪些、按什么顺序。
 */
export interface LibraryDirectoryBatchPort {
    /** 宿主此刻的本地曲库（批量范围的歌曲 id 按它解析；文件夹删除的路径规则读 folderName）。 */
    getLocalSongs(): readonly LocalSong[];
    playLocalSongs(songs: LocalSong[]): Promise<void> | void;
    enqueueLocalSongs(songs: LocalSong[]): Promise<void> | void;
    createLocalPlaylist(name: string, songs: LocalSong[]): Promise<void> | void;
    deleteFolderSongs(folderPath: string): Promise<void> | void;
    deleteSongsByIds(songIds: string[]): Promise<void> | void;
    clearFolderIgnore(folderPath: string): Promise<void> | void;
    resyncFolder(rootPath: string): Promise<void> | void;
    removeImportedRoot(rootPath: string): Promise<void> | void;
    /** 重新读取本地曲库（歌曲、歌单）。 */
    refreshLibrary(): Promise<void> | void;
}

/**
 * 一个目录 section 的批量配置（首页视图装配）：section 类型、文件夹树、动作控制器。
 * 能用哪些动作由 core/directory/directoryBatch 的 resolveDirectoryBatchActions 按 section 类型给出。
 */
export interface LibraryDirectoryBatchConfig {
    selectionType: LibraryDirectorySelectionType;
    directoryTrees?: LibraryDirectoryNode[];
    controller: LibraryDirectoryBatchController;
    /** 动作做成之后、仍在 pending 期间，视图要补的事（本地文件夹：删除、恢复忽略后重读目录树）。 */
    afterAction?: (action: LibraryDirectoryBatchActionId) => Promise<void> | void;
}

/** 目录树上一个节点相对当前（已筛选）条目的选中状态。 */
export interface LibraryDirectoryNodeSelection {
    /** 这个节点及其子孙对应的条目。 */
    itemIds: string[];
    /** 正好是这个节点本身的条目。 */
    directItemIds: string[];
    selectedCount: number;
    state: 'none' | 'partial' | 'direct' | 'all';
}

/** 点一次节点复选框后要变成的选择：全部取消、只选本层、选整棵子树。 */
export type LibraryDirectoryNodeSelectionTarget = 'none' | 'direct' | 'all';

/**
 * 隐藏项的作用域：在线按 provider 分（`online:${providerId}`），本地曲库一个、Navidrome 一个；
 * `default` 是没声明作用域的目录的兜底。同一个 id 在不同作用域互不影响。
 */
export type LibraryHiddenScope = `online:${string}` | 'local' | 'navidrome' | 'default';

/**
 * 隐藏表：作用域 → 隐藏的条目 id（按隐藏的先后）。就是 localStorage `hidden_grid_playlists` 里存的格式；
 * 取消隐藏后作用域留一个空数组。
 */
export type LibraryHiddenCollections = Record<string, string[]>;

/**
 * 目录的隐藏视图：browse 只显示未隐藏的（浏览、筛选、批量都在这之上）；manage 显示全部并标出隐藏的；
 * manage-hidden-only 只显示隐藏的。后两个是「管理隐藏」（网格里是 GridMap 的隐藏编辑模式）。
 */
export type LibraryDirectoryVisibilityMode = 'browse' | 'manage' | 'manage-hidden-only';

/**
 * 首页上的一个目录：来源 + section。key 由 core/directory/directorySession 的 directoryKey 算出
 * （`home:local:folders`、`home:online:${providerId}:playlists`、`home:navidrome:${section}`）。
 */
export type LibraryDirectoryRef =
    | { source: 'local'; section: string }
    | { source: 'online'; providerId: string; section: string }
    | { source: 'navidrome'; section: string };

/**
 * 目录的浏览会话（core/directory/useLibraryDirectorySessionStore）：筛选词、批选、隐藏视图。按目录 key 分开，
 * 跨 suite 共用（网格的 GridMap、以后的 TUI 目录读写同一份）。
 * selectedIds 是稳定的条目 id（不是下标），按选中的先后存；批量范围按目录顺序重排，不按点击顺序。
 */
export interface LibraryDirectorySession {
    query: string;
    selectedIds: readonly string[];
    visibilityMode: LibraryDirectoryVisibilityMode;
}

/** 批量范围的推导结果：可见（去隐藏）→ 筛选 → 选中（见 core/directory/directoryBatch 的 resolveDirectoryBatchScope）。 */
export interface LibraryDirectoryBatchScope<TItem extends LibraryDirectoryItem = LibraryDirectoryItem> {
    /** 隐藏视图过滤之后的条目。 */
    visibleItems: TItem[];
    /** 再按筛选词过滤之后的条目（界面上显示的那些）。 */
    displayItems: TItem[];
    /** displayItems 里被选中的条目（目录顺序）与它们去重保序的歌。 */
    context: LibraryDirectoryBatchContext<TItem>;
}

/** 批量能力（面板按钮与命令面板同源）：section 支持的动作、此刻能不能对选中的歌动手。 */
export interface LibraryDirectoryBatchCapabilities {
    actions: LibraryDirectoryBatchActionId[];
    pending: LibraryDirectoryBatchPending | null;
    /** 选中范围里有歌、且没有动作在进行：播放、入队、新建歌单、删除可用。 */
    canUseTracks: boolean;
}

/**
 * 目录交给命令面板的动作（directory surface）。批量动作作用于选中范围；select-all 选中筛选出的全部条目
 * （网格里会先打开批量面板）；remove-selection 只请求删除（网格里打开确认框，TUI 里是行内确认）；manage-hidden
 * 切换「管理隐藏」视图。后四个作用于目录里「当前焦点」那一项，只有有焦点概念的目录发布（TUI 的目录列表；网格的
 * GridMap 用卡片上的按钮与批量面板目录树上的按钮做这些）：toggle-hidden 隐藏 / 取消隐藏焦点条目；rescan-root、
 * remove-root 作用于焦点那个导入根（remove-root 先确认）；clear-ignore 恢复焦点那个被忽略的文件夹。
 */
export type LibraryDirectorySurfaceActionId =
    | 'play-selection'
    | 'enqueue-selection'
    | 'create-playlist'
    | 'remove-selection'
    | 'select-all'
    | 'clear-selection'
    | 'manage-hidden'
    | 'toggle-hidden'
    | 'rescan-root'
    | 'remove-root'
    | 'clear-ignore';

/** 目录里当前焦点那一项能做的事（只有有焦点概念的目录给出）。 */
export interface LibraryDirectoryFocusedTarget {
    /** 焦点条目可以隐藏（歌单类）。 */
    hideable?: boolean;
    /** 焦点是一个导入根（目录树的根节点）：它的根路径。 */
    rootPath?: string;
    /** 焦点是一个被忽略的文件夹：它的路径。 */
    ignoredPath?: string;
}

/** 命令面板问目录的状态；每次现读，不缓存。 */
export interface LibraryDirectorySurfaceState {
    directoryKey: string;
    /** 此刻可用的动作（core/directory/directorySurface 的 resolveDirectorySurfaceActions，与面板按钮同源）。 */
    availableActions: readonly LibraryDirectorySurfaceActionId[];
    displayItemCount: number;
    selectedItemCount: number;
    selectedTrackCount: number;
    visibilityMode: LibraryDirectoryVisibilityMode;
}

/** 正在交互的目录发布给命令面板的句柄。run 返回动作是否被接下（create-playlist 没有名字时为 false）。 */
export interface LibraryDirectorySurfaceHandle {
    getState(): LibraryDirectorySurfaceState;
    run(action: LibraryDirectorySurfaceActionId, input?: string): boolean;
}
