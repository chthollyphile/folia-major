import type { SongResult } from '../../../types';
import type {
    FoliaPlayViaUnavailable,
    FoliaPlaylist,
    FoliaPlaylistAddResult,
    FoliaPlaylistEntry,
    FoliaPlaylistOrigin,
    FoliaPlaylistSummary,
    FoliaRefreshFromOriginResult,
    FoliaSaveCollectionInput,
    FoliaSaveCollectionResult,
} from '../../../types/foliaPlaylist';

// src/library/core/foliaPlaylist/foliaPlaylist.contract.ts
// Folia 聚合歌单给界面用的契约：读写的端口，以及一条条目现在能不能播。
// 歌单的摘要界面从 useFoliaPlaylistsStore 读（写完会自己重读），一张歌单的条目用 useFoliaPlaylistContent 按需读；
// 写操作返回的也只是摘要（不为了返回值去读全部条目）。这里的端口是写操作，由宿主装配
// （src/library/app/createFoliaPlaylistPort.ts），suite 不直接碰 src/services/foliaPlaylist。

export type {
    FoliaPlayViaUnavailable,
    FoliaPlaylist,
    FoliaPlaylistAddResult,
    FoliaPlaylistEntry,
    FoliaPlaylistOrigin,
    FoliaPlaylistSummary,
    FoliaRefreshFromOriginResult,
    FoliaSaveCollectionInput,
    FoliaSaveCollectionResult,
};

/** 一个能把别家的歌「改由它来播」的音源，以及它现在能不能问。 */
export type FoliaPlayViaTarget = {
    sourceId: string;
    /** 现在问不了的原因（没配好之类）；能问就没有。停用、只用于匹配的音源不会列出来。 */
    unavailable?: FoliaPlayViaUnavailable;
};

export interface FoliaPlaylistPort {
    /** 建一张歌单，可以带上第一批歌（任何来源，一批里可以有多个来源）。名字是空的会 reject。 */
    create(name: string, songs?: readonly SongResult[], options?: { origin?: FoliaPlaylistOrigin }): Promise<FoliaPlaylistSummary>;
    /** 「我喜欢的音乐」不能改名、空名字、歌单不存在：null。 */
    rename(playlistId: string, name: string): Promise<FoliaPlaylistSummary | null>;
    /** 「我喜欢的音乐」不能删、歌单不存在：false。 */
    remove(playlistId: string): Promise<boolean>;
    /** 往歌单里加歌：任何来源，一批里可以有多个来源；已经在里面的（同一个 key）不重复加，舞台歌不收。 */
    addSongs(playlistId: string, songs: readonly SongResult[]): Promise<{ playlist: FoliaPlaylistSummary | null; result: FoliaPlaylistAddResult }>;
    /** 按条目的 key 移除。 */
    removeEntries(playlistId: string, keys: readonly string[]): Promise<FoliaPlaylistSummary | null>;
    /** 重排歌：orderedKeys 是 expectedKeys（草稿开始时的顺序）的一个排列；歌单期间被改过就不写，返回 null。 */
    reorderEntries(playlistId: string, orderedKeys: readonly string[], expectedKeys: readonly string[]): Promise<FoliaPlaylistSummary | null>;
    /** 重排歌单本身：orderedIds 是现有歌单 id 的一个排列，否则不写，返回 false。 */
    reorderPlaylists(orderedIds: readonly string[]): Promise<boolean>;
    /** 把一首歌放进或移出「我喜欢的音乐」（任何来源；本地歌会换算到重复导入组里 canonical 的那条）。 */
    setFavorite(song: SongResult, shouldFavorite: boolean): Promise<FoliaPlaylistSummary | null>;
    /**
     * 「改由某个音源播放」能选哪些音源：声明了能替 originSourceId 的歌答「对应歌曲」的那些（只凭 id 精确对应，
     * 不按歌名歌手找）。同步读此刻的状态；音源增减、开关、配置变了要重读。
     */
    getPlayViaTargets(originSourceId: string): FoliaPlayViaTarget[];
    /**
     * 把一张平台歌单转存成 Folia 歌单：歌由调用方读好传进来。选了 playVia 的，能精确对应的歌换成那个音源的并记下
     * 原来是哪首，其余照原样存；结果里有换了几首、没换几首。名字是空的会 reject。
     */
    saveCollection(input: FoliaSaveCollectionInput): Promise<{ playlist: FoliaPlaylistSummary; result: FoliaSaveCollectionResult }>;
    /**
     * 从原歌单刷新一张转存来的歌单：原歌单现在的歌由 fetchOriginSongs 去读（读不到就抛错，什么都不写）。
     * 只加不删：原歌单里新的歌加进来（按上次选的目标音源换），已经没有的歌和用户自己加的条目都留着。
     * options.playVia 给了就改用它并记下来（null：从此不换）。歌单不存在、不是转存来的：null。
     * options.signal 取消了的话，在动笔之前停下（抛 AbortError），什么都不写；saveCollection 的 input.signal 同理。
     */
    refreshFromOrigin(
        playlistId: string,
        fetchOriginSongs: (origin: FoliaPlaylistOrigin) => Promise<readonly SongResult[]>,
        options?: { playVia?: string | null; signal?: AbortSignal },
    ): Promise<{ playlist: FoliaPlaylistSummary; result: FoliaRefreshFromOriginResult } | null>;
    /**
     * 出处是读入的文件说的歌单（origin.fromFile、还没有 confirmedAt）：用户确认了可以向那个音源读那张歌单，记在歌单上。
     * 没确认之前 refreshFromOrigin 会 reject。shown 是给用户看的那个出处；歌单上的已经不是它了就不记，返回 false。
     */
    confirmOrigin(playlistId: string, shown: Pick<FoliaPlaylistOrigin, 'sourceId' | 'collectionId'>): Promise<boolean>;
}

/**
 * 一条条目现在的来源状态：
 * - available：来源在，可以去播（这首歌本身下架、没版权之类是播放时才知道的事，不在这里）；
 * - source-off：音源被关掉或只用于匹配（设置 → 音源里能再打开）；
 * - source-missing：音源没有注册——模组被卸载了，或者还没加载完；
 * - local-missing：本地曲库里没有这首（读歌单列表时这种行会被直接删掉，所以只在两次读之间短暂出现）；
 * - navidrome-unconfigured：没有配置 Navidrome 服务器。
 */
export type FoliaEntryAvailability =
    | { state: 'available' }
    | { state: 'source-off'; sourceId: string }
    | { state: 'source-missing'; sourceId: string }
    | { state: 'local-missing' }
    | { state: 'navidrome-unconfigured' };

/** 判断来源状态要问的几件事；宿主的默认装配在 src/library/app/createFoliaPlaylistPort.ts。 */
export interface FoliaEntryAvailabilityDeps {
    hasLocalSong(songId: string): boolean;
    /** 音源已经注册（它的模组装着并且加载了）。 */
    isSourceRegistered(sourceId: string): boolean;
    /** 音源在「设置 → 音源」里是启用的（不是停用，也不是只用于匹配）。 */
    isSourceSwitchedOn(sourceId: string): boolean;
    isNavidromeConfigured(): boolean;
}
