import type { SongResult, UnifiedSong } from '../../../../types';
import type { MediaId } from '../../../../types/onlineMusic';
import type { LibraryCollectionDescriptor } from '../collection.contract';
import type { CollectionResourceKind } from '../../shared/resource.contract';
import type { LibraryCapability } from '../../shared/capability.contract';
import type { LibraryMutationPort } from '../../shared/ports.contract';
import { supportsLocalCollectionCover } from '../cover/localCollectionCover';
import type {
    CollectionMutationBranches,
    CollectionMutationCapabilities,
    CollectionMutationSnapshot,
} from './mutations.contract';

// src/library/core/collection/mutations/collectionMutationCapabilities.ts
// 变更动作的可用性：集合属于哪个来源分支、哪些动作能做、此刻能不能点。分支布尔逐字搬自 GridView
// （isLocalPlaylistCollection、canEditOwnedPlaylist、showSubscribeButton……），网格、TUI 与命令面板
// 都问这里，同一个集合给出同一个答案。纯函数：要问 provider 的（能不能改歌单、能不能订阅、是不是云盘）
// 由调用方算好传进来。

export type CollectionMutationBranchInput = {
    descriptor: LibraryCollectionDescriptor | null;
    /** 资源的种类：在线歌单只有拿到在线资源时才能编辑（与 GridView 的 isOnlineResource 一致）。 */
    resourceKind: CollectionResourceKind | null;
    currentUserId?: MediaId | null;
    /** omni.canEditCollectionTracks(descriptor)；非在线集合传 false。 */
    canEditCollectionTracks: boolean;
    /** omni.canSubscribeCollection(descriptor)；非在线集合传 false。 */
    canSubscribeCollection: boolean;
    /** omni.canDislikeCollectionSongs(descriptor)：每日推荐能不能「不喜欢并换一首」；非在线集合传 false。 */
    canDislikeCollectionSongs: boolean;
    /** isCloudDriveCollection(descriptor)。 */
    isCloudDrive: boolean;
    /** 每日推荐当前看的日期，'' 表示今天；看历史时不能编辑。 */
    dailyDate: string;
    /** 每日推荐正在看风格推荐（#938）：那是另一份歌，「不喜欢并换一首」不作用于它，也不能编辑。 */
    dailyStyleShown?: boolean;
    port: LibraryMutationPort;
};

/** 来源分支。每一行都对应 GridView 里的同名布尔，改这里要同时核对网格的按钮条件。 */
export const resolveCollectionMutationBranches = (input: CollectionMutationBranchInput): CollectionMutationBranches => {
    const collection = input.descriptor;
    const local = collection?.source === 'local' ? collection : null;
    const navidrome = collection?.source === 'navidrome' ? collection : null;
    const online = collection?.source === 'online' ? collection : null;

    const isLocalCollection = Boolean(local);
    const isNavidromeCollection = Boolean(navidrome);
    const isDailyRecommendationsCollection = Boolean(online && online.type === 'daily_recommendations');
    const isLocalFolderCollection = Boolean(local && local.type === 'folder' && !local.isVirtual);
    const isLocalAllSongsCollection = Boolean(local && local.type === 'folder' && local.isVirtual);
    const isLocalPlaylistCollection = Boolean(local && local.type === 'playlist' && local.playlistId && !local.isVirtual);
    const isLocalEntityCollection = Boolean(local && local.entityId);
    const isNavidromePlaylistCollection = Boolean(navidrome && navidrome.type === 'playlist' && navidrome.editable);
    const canAddNavidromeToPlaylist = Boolean(
        navidrome
        && navidrome.type !== 'playlist'
        && (input.port.navidrome?.addToPlaylist || input.port.navidrome?.createPlaylist),
    );

    const isOnlineResource = input.resourceKind === 'online';
    const canEditOnlineCollectionTracks = Boolean(online && input.canEditCollectionTracks);
    const canEditOwnedPlaylist = Boolean(
        isOnlineResource
        && online
        && online.type === 'playlist'
        && input.currentUserId != null
        && online.creator?.id === input.currentUserId
        && canEditOnlineCollectionTracks,
    );
    const canEditProviderPlaylist = Boolean(
        isOnlineResource
        && online
        && online.type === 'playlist'
        && online.isOwned === true
        && canEditOnlineCollectionTracks,
    );
    const canEditPlaylist = Boolean(
        canEditOwnedPlaylist
        || canEditProviderPlaylist
        // 管理每日推荐就是逐首「不喜欢」：provider 没有 dislikeSong（QQ）时不给编辑，免得按钮点了必定失败。
        || (isDailyRecommendationsCollection && !input.dailyDate && !input.dailyStyleShown && input.canDislikeCollectionSongs)
        || isLocalPlaylistCollection
        || isNavidromePlaylistCollection,
    );

    const isCloudDrive = Boolean(collection && input.isCloudDrive);
    const isOnlinePlaylist = Boolean(online && online.type === 'playlist' && !isCloudDrive);
    const isOnlineAlbum = Boolean(online && online.type === 'album' && !isCloudDrive);
    const showSubscribeButton = Boolean(
        collection
        && input.canSubscribeCollection
        && ((isOnlinePlaylist && !canEditOwnedPlaylist && !canEditProviderPlaylist) || isOnlineAlbum),
    );

    return {
        isLocalCollection,
        isNavidromeCollection,
        isDailyRecommendationsCollection,
        isLocalFolderCollection,
        isLocalAllSongsCollection,
        isLocalPlaylistCollection,
        isLocalEntityCollection,
        isNavidromePlaylistCollection,
        isCloudDrive,
        isOnlinePlaylist,
        isOnlineAlbum,
        canEditOnlineCollectionTracks,
        canEditOwnedPlaylist,
        canEditProviderPlaylist,
        canEditPlaylist,
        showSubscribeButton,
        canAddNavidromeToPlaylist,
    };
};

/** 删一个条目走哪条路。daily：不喜欢并换一首；local / navidrome：宿主端口；online：omni。 */
export type CollectionEntryRemovalKind = 'daily-dislike' | 'local-playlist' | 'navidrome-playlist' | 'online-playlist';

/**
 * 与 GridView 的 handleRemoveTrack 分支顺序一致。不同的是：没有对应端口时直接判为不支持，
 * 不再掉进在线分支（原先本地 / Navidrome 歌单缺端口时会去调 omni，必然失败）。
 */
export const resolveEntryRemovalKind = (
    branches: CollectionMutationBranches,
    port: LibraryMutationPort,
): CollectionEntryRemovalKind | null => {
    if (branches.isDailyRecommendationsCollection) {
        // 看历史日期时没有编辑开关（canEditPlaylist 为假），也就删不了。
        return branches.canEditPlaylist ? 'daily-dislike' : null;
    }
    if (branches.isLocalPlaylistCollection) return port.local?.removePlaylistSongs ? 'local-playlist' : null;
    if (branches.isNavidromePlaylistCollection) return port.navidrome?.removePlaylistSongs ? 'navidrome-playlist' : null;
    if (branches.canEditOwnedPlaylist || branches.canEditProviderPlaylist) return 'online-playlist';
    return null;
};

/**
 * 每日推荐与 Navidrome 的删除一次只能有一个：前者沿用 GridView 的单飞（上游会限流）；后者按原始下标删，
 * 两个请求并发时，后到的那个下标在服务器上已经错位了。
 */
export const isSerializedRemoval = (kind: CollectionEntryRemovalKind | null): boolean => (
    kind === 'daily-dislike' || kind === 'navidrome-playlist'
);

/** 本地歌曲在歌单里的 id：与 localPlaylistService 按 songId 删除的语义一致。 */
export const localPlaylistSongIdOf = (track: SongResult): string => (
    (track as UnifiedSong).localRef?.songId || String(track.id)
);

/** 「匹配在线信息」只对带本地引用的歌有意义。 */
export const localSongIdOf = (track: SongResult): string | null => (track as UnifiedSong).localRef?.songId ?? null;

export type CollectionMutationCapabilityState = {
    hasResource: boolean;
    pendingRemovalCount: number;
    subscribing: boolean;
    sourceActionPending: boolean;
    dailyLimitReached: boolean;
    dailyDatePending: boolean;
};

const UNSUPPORTED: LibraryCapability = { supported: false, enabled: false, pending: false, reason: 'unsupported' };
const READY: LibraryCapability = { supported: true, enabled: true, pending: false };
const BLOCKED_BY_PENDING: LibraryCapability = { supported: true, enabled: false, pending: true, reason: 'pending' };

/** 支持时：进行中就不可点（共用的 pending 标记），否则可用。 */
const gated = (supported: boolean, pending: boolean): LibraryCapability => {
    if (!supported) return UNSUPPORTED;
    return pending ? BLOCKED_BY_PENDING : READY;
};

const resolveRemoveEntryCapability = (
    kind: CollectionEntryRemovalKind | null,
    state: CollectionMutationCapabilityState,
): LibraryCapability => {
    if (!kind) return UNSUPPORTED;
    const pending = state.pendingRemovalCount > 0;
    if (kind === 'daily-dislike' && state.dailyLimitReached) {
        return { supported: true, enabled: false, pending, reason: 'limit-reached' };
    }
    if (pending && isSerializedRemoval(kind)) return BLOCKED_BY_PENDING;
    // 按歌删除可以并发（不同的歌互不影响）：别的条目仍可点，进行中的条目看 pendingEntryKeys。
    return pending ? { supported: true, enabled: true, pending: true } : READY;
};

/**
 * 各动作的可用性。按钮可见与否对应 supported（条件与 GridView 的渲染条件一致），enabled 对应 disabled。
 * 编辑实体、整理、匹配只是打开对话框，GridView 不在来源动作进行中禁用它们，这里也不禁用。
 */
export const resolveCollectionMutationCapabilities = ({
    descriptor,
    branches,
    port,
    state,
}: {
    descriptor: LibraryCollectionDescriptor | null;
    branches: CollectionMutationBranches;
    port: LibraryMutationPort;
    state: CollectionMutationCapabilityState;
}): CollectionMutationCapabilities => {
    const local = descriptor?.source === 'local' ? descriptor : null;
    const pending = state.sourceActionPending;
    return {
        removeEntry: resolveRemoveEntryCapability(resolveEntryRemovalKind(branches, port), state),
        // 收藏一按就变、请求期间也能再按（core/collection/mutations/collectionSaves.service 让请求跟着最后一次按下走），不因进行中禁用。
        subscribe: gated(branches.showSubscribeButton, false),
        editCollection: gated(branches.canEditPlaylist, pending),
        rename: gated(branches.isLocalPlaylistCollection || branches.isNavidromePlaylistCollection, pending),
        deleteCollection: gated(
            branches.isLocalFolderCollection || branches.isLocalPlaylistCollection || branches.isNavidromePlaylistCollection,
            pending,
        ),
        resyncFolder: gated(branches.isLocalFolderCollection && Boolean(port.local?.resyncFolder), pending),
        resyncAllFolders: gated(branches.isLocalAllSongsCollection && Boolean(port.local?.resyncAllFolders), pending),
        // 与网格的导出按钮同一条件：收藏这类虚拟歌单也能导出。
        exportPlaylist: gated(
            Boolean(local && local.type === 'playlist' && local.playlistId && port.local?.exportPlaylist),
            pending,
        ),
        addToPlaylist: gated(branches.canAddNavidromeToPlaylist && Boolean(port.navidrome?.addToPlaylist), pending),
        createPlaylist: gated(branches.canAddNavidromeToPlaylist && Boolean(port.navidrome?.createPlaylist), pending),
        editEntity: gated(branches.isLocalEntityCollection && Boolean(port.local?.editEntity), false),
        // 本地文件夹（含「全部歌曲」）、专辑、歌单；歌手不在内。只打开对话框，与编辑实体一样不随来源动作禁用。
        setCover: gated(supportsLocalCollectionCover(local) && Boolean(port.local?.editCover), false),
        organizeSongInfo: gated(branches.isLocalFolderCollection && Boolean(port.local?.organizeFolder), false),
        matchSong: gated(Boolean(port.local?.matchSong), false),
        dailyDate: gated(branches.isDailyRecommendationsCollection && state.hasResource, state.dailyDatePending),
    };
};

const NO_PORT: LibraryMutationPort = {};
const IDLE_STATE: CollectionMutationCapabilityState = {
    hasResource: false,
    pendingRemovalCount: 0,
    subscribing: false,
    sourceActionPending: false,
    dailyLimitReached: false,
    dailyDatePending: false,
};
const NO_BRANCHES = resolveCollectionMutationBranches({
    descriptor: null,
    resourceKind: null,
    canEditCollectionTracks: false,
    canSubscribeCollection: false,
    canDislikeCollectionSongs: false,
    isCloudDrive: false,
    dailyDate: '',
    port: NO_PORT,
});

/** 没有打开集合（或还没有控制器）时的快照：什么都不支持。 */
export const EMPTY_COLLECTION_MUTATION_SNAPSHOT: CollectionMutationSnapshot = {
    subscribed: null,
    subscribing: false,
    pendingEntryKeys: [],
    dailyLimitReached: false,
    sourceActionPending: false,
    dailyDate: '',
    dailyHistoryDates: [],
    dailyHistoryAvailable: false,
    dailyStyleAvailable: false,
    dailyStyleShown: false,
    dailyStyleGroups: [],
    dailyStyleGroupsFailed: false,
    dailyStyleSelection: null,
    renamedTo: null,
    availablePlaylists: [],
    branches: NO_BRANCHES,
    capabilities: resolveCollectionMutationCapabilities({ descriptor: null, branches: NO_BRANCHES, port: NO_PORT, state: IDLE_STATE }),
};
