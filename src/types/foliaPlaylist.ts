import type { SongResult } from '../types';

// src/types/foliaPlaylist.ts
// Folia 聚合歌单：跨来源的歌单，归宿主保管（不在任何音源模组的存储里）。读写在 src/services/foliaPlaylist/。

/** 从哪张账号歌单转存来的；自己建的没有。 */
export type FoliaPlaylistOrigin = {
    sourceId: string;
    collectionId: string;
    name: string;
    savedAt: number;
};

export type FoliaPlaylistEntry = {
    /** 实际播放的那首：getPlaybackSongKey（`online:<音源>:<id>`、`navidrome:<id>`、`local:<id>`）。去重与行的身份。 */
    key: string;
    /** 显示用的快照（toStoredSongSnapshot）：来源停用或卸载后照样能显示。本地歌只留引用，显示以曲库里的记录为准。 */
    song: SongResult;
    addedAt: number;
    /** 转存时换了来源的，记下原来是哪首；没换的不写。 */
    originalKey?: string;
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

/** 往歌单里加一批歌的结果。 */
export type FoliaPlaylistAddResult = {
    added: number;
    /** 歌单里已经有的（含这一批里重复的）。 */
    duplicates: number;
    /** 不收的：舞台歌。 */
    rejected: number;
};
