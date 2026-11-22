import type { SongResult } from '../types';

// src/types/foliaPlaylist.ts
// Folia 聚合歌单：跨来源的歌单，归宿主保管（不在任何音源模组的存储里）。读写在 src/services/foliaPlaylist/。

/** 从哪张账号歌单转存来的；自己建的没有。 */
export type FoliaPlaylistOrigin = {
    sourceId: string;
    collectionId: string;
    name: string;
    savedAt: number;
    /** 转存时选的「改由某个音源播放」：那个音源的 id。之后从原歌单刷新时，新来的歌也按它换。没选就没有。 */
    playVia?: string;
    /** 上一次从原歌单刷新的时间；没刷新过就没有。 */
    refreshedAt?: number;
    /** 原来那张是歌单还是专辑（刷新时按它去读）；没写的是歌单。 */
    collectionType?: 'playlist' | 'album';
    /**
     * 原来那张歌单在音源那边的附带数据（集合描述上的 providerData：有的音源读歌单的歌时要它，光有 id 不够）。
     * 刷新时原样交回给那个音源。只是那张歌单公开的标识，没有账号与凭据；没有就不写。
     */
    collectionData?: unknown;
    /**
     * 这个出处是从读入的歌单文件来的：是哪家的哪张歌单只是文件说的，没人核对过。自己转存来的没有这个记号。
     * 记号由读文件的代码加（foliaPlaylistFile.ts），不从文件里读。
     */
    fromFile?: true;
    /**
     * 出处来自文件（fromFile）时：用户确认「可以向这个音源读这张歌单」的时刻。没确认之前「从原歌单更新」不去读
     *（foliaPlaylistService 的 refreshFoliaPlaylistFromOrigin 会拒绝），确认过就不再问。
     */
    confirmedAt?: number;
};

export type FoliaPlaylistEntry = {
    /** 实际播放的那首：getPlaybackSongKey（`online:<音源>:<id>`、`navidrome:<id>`、`local:<id>`）。去重与行的身份。 */
    key: string;
    /** 显示用的快照（toStoredSongSnapshot）：来源停用或卸载后照样能显示。本地歌只留引用，显示以曲库里的记录为准。 */
    song: SongResult;
    addedAt: number;
    /** 转存时换了来源的，记下原来是哪首；没换的不写。 */
    originalKey?: string;
    /** 这一条是跟着原歌单来的（转存时带进来，或刷新时加的）；用户自己加进这张歌单的没有。规则见 utils/foliaPlaylistTransfer.ts。 */
    fromOrigin?: boolean;
};

/** 一张歌单自己的东西（不含条目）。 */
export type FoliaPlaylistInfo = {
    /** 新建的是 `folia_playlist_<时间>_<随机>`；从本地歌单迁来的沿用原来的 `local_playlist_…`。 */
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    /** 固定的那张「我喜欢的音乐」：不能删、不能改名。 */
    isFavorite?: boolean;
    origin?: FoliaPlaylistOrigin;
};

/**
 * 歌单的摘要：界面常驻内存的只有它（歌单列表、首页的卡片、收藏框）。条目不在这里——打开歌单、整张播放、
 * 排序、导出时才去读（foliaPlaylistService 的 getFoliaPlaylist / getFoliaPlaylistEntries）。
 */
export type FoliaPlaylistSummary = FoliaPlaylistInfo & {
    /** 条目数。 */
    entryCount: number;
    /** 自动封面用：歌单最前面一段里第一首带封面的非本地歌的封面地址。 */
    coverUrl?: string;
    /** 自动封面用：歌单最前面一段里的本地歌的 id（按歌单里的顺序，有上限）；封面由曲库里的记录给。 */
    coverLocalSongIds?: string[];
};

/** 一张歌单连同它的全部条目（按需读出来的，不常驻）。 */
export type FoliaPlaylist = FoliaPlaylistInfo & {
    entries: FoliaPlaylistEntry[];
};

/**
 * 问目标音源「对应歌曲」时一首都没问成的原因（前四种和 services/onlineMusic/songCounterparts.ts 的同一组）；
 * `failed`：问了，但全都超时或出错。
 */
export type FoliaPlayViaUnavailable = 'not-registered' | 'switched-off' | 'not-configured' | 'unsupported' | 'failed';

/** 把一张平台歌单转存成 Folia 歌单要给的东西。 */
export type FoliaSaveCollectionInput = {
    /** 新歌单的名字；空的会 reject。 */
    name: string;
    /** 原歌单的歌，按原歌单的顺序；由调用方读好传进来。 */
    songs: readonly SongResult[];
    /** 原歌单是哪个音源的哪一张、叫什么。 */
    origin: Pick<FoliaPlaylistOrigin, 'sourceId' | 'collectionId' | 'name' | 'collectionType' | 'collectionData'>;
    /** 「改由某个音源播放」：目标音源的 id。不给就原样存。 */
    playVia?: string;
    /** 用户取消了：问完音源、动笔之前看一眼，已经取消就什么都不写（抛 AbortError）。 */
    signal?: AbortSignal;
};

export type FoliaSaveCollectionResult = {
    /** 换成目标音源来播的。 */
    swapped: number;
    /** 没换、照原样存的。 */
    notSwapped: number;
    /** 原歌单里重复的（没有再加一条）。 */
    duplicates: number;
    /** 不收的：舞台歌。 */
    rejected: number;
    /** 选了目标音源却一首都没问成的原因；歌单照样建，全部照原样存，目标音源照样记着（刷新时再试）。 */
    playViaUnavailable?: FoliaPlayViaUnavailable;
    /** 问成了一部分时，没问成（超时、出错、总时限到了没轮到）的首数；它们照原样存，算在 notSwapped 里。 */
    playViaFailed?: number;
};

export type FoliaRefreshFromOriginResult = {
    /** 原歌单里新出现、加进歌单的。 */
    added: number;
    /** 这次换成目标音源来播的（新加的和原来没换的都算）。 */
    swapped: number;
    /** 原歌单里已经没有的：留在歌单里，从此算用户自己加的。 */
    detached: number;
    /** 原歌单里的歌因为和歌单里已有的条目重复而没加的。 */
    duplicates: number;
    /** 不收的：舞台歌。 */
    rejected: number;
    /** 原歌单读回来是空的：什么都没改（更像是读失败，不拿它把整张歌单和原歌单断开）。 */
    originEmpty?: boolean;
    /** 有目标音源却一首都没问成的原因；这次没换，其余照常刷新。 */
    playViaUnavailable?: FoliaPlayViaUnavailable;
    /** 问成了一部分时，没问成（超时、出错、总时限到了没轮到）的首数；这些这次没换。 */
    playViaFailed?: number;
};

/** 往歌单里加一批歌的结果。 */
export type FoliaPlaylistAddResult = {
    added: number;
    /** 歌单里已经有的（含这一批里重复的）。 */
    duplicates: number;
    /** 不收的：舞台歌。 */
    rejected: number;
};
