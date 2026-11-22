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

export type FoliaPlaylist = {
    /** 新建的是 `folia_playlist_<时间>_<随机>`；从本地歌单迁来的沿用原来的 `local_playlist_…`。 */
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    /** 固定的那张「我喜欢的音乐」：不能删、不能改名。 */
    isFavorite?: boolean;
    origin?: FoliaPlaylistOrigin;
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
    origin: Pick<FoliaPlaylistOrigin, 'sourceId' | 'collectionId' | 'name'>;
    /** 「改由某个音源播放」：目标音源的 id。不给就原样存。 */
    playVia?: string;
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
};

/** 往歌单里加一批歌的结果。 */
export type FoliaPlaylistAddResult = {
    added: number;
    /** 歌单里已经有的（含这一批里重复的）。 */
    duplicates: number;
    /** 不收的：舞台歌。 */
    rejected: number;
};
