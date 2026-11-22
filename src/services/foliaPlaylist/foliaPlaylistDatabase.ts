import Dexie, { type Table } from 'dexie';
import type { FoliaPlaylistEntry, FoliaPlaylistInfo } from '../../types/foliaPlaylist';

// src/services/foliaPlaylist/foliaPlaylistDatabase.ts
// Folia 聚合歌单自己的数据库（IndexedDB，名字 FoliaPlaylistsDB），按条目存：
// - playlists：一张歌单一行，只有摘要（名字、时间、出处、条目数、自动封面要的一点东西、歌单之间的先后），没有条目；
// - entries：一条条目一行，主键 [歌单 id, 条目 key]，另有 [歌单 id, 位置号] 的索引（按歌单里的顺序读）
//   和 localSongId 的索引（只有本地歌的行有这个字段：曲库删歌、重扫之后对着它修）；
// - meta：一行（key 'state'），存储的版本与「旧结构搬过来了」的标记。
// 不放进 KineticPlayerDB：给那个库加表要升它的版本号，旧版本的 Folia 打不开版本号更高的库，用户一降级就坏。
// 单独一个库，旧版本根本看不见它；按类别清缓存、清 api_cache 也碰不到它。代价是和曲库（local_music）不在
// 同一个事务里：要读曲库的操作先在事务外面读好，再开这个库的事务（见 foliaPlaylistStorage.ts）。
// 这个库以后改结构也尽量不升版本号（加字段不用升；meta.version 是软的版本标记）。

export const FOLIA_PLAYLISTS_DATABASE_NAME = 'FoliaPlaylistsDB';
export const FOLIA_PLAYLISTS_STATE_KEY = 'state';

/** playlists 表的一行。这个版本不认识的字段读写时原样带着。 */
export type FoliaPlaylistRow = FoliaPlaylistInfo & {
    /** 歌单之间的先后（从小到大）。 */
    rank: number;
    entryCount: number;
    coverUrl?: string;
    /** coverUrl 是哪一条条目的（那一条被移走时要重找）。 */
    coverKey?: string;
    coverLocalSongIds?: string[];
};

/** entries 表的一行：条目本身，加上它属于哪张歌单、排在哪。 */
export type FoliaPlaylistEntryRow = FoliaPlaylistEntry & {
    playlistId: string;
    /** 位置号：留着空隙的整数，见 foliaPlaylistPositions.ts。 */
    pos: number;
    /** 本地歌的行才有：曲库里那首歌的 id。 */
    localSongId?: string;
};

export type FoliaPlaylistsStateRow = {
    key: typeof FOLIA_PLAYLISTS_STATE_KEY;
    version: number;
    /** 开始从「一张歌单一行」的旧结构往这边搬的时间：有它没有 importedAt，是搬到一半断了，下次接着搬。 */
    importStartedAt?: number;
    /** 旧结构（api_cache 里的行，或更早的 local_playlists）搬进来的时间；有它就不再搬。 */
    importedAt?: number;
    /** 那次是从哪搬的、搬了几张（排查用）。 */
    importedFrom?: 'folia-rows' | 'local-playlists' | 'nothing';
    importedCount?: number;
};

export class FoliaPlaylistsDatabase extends Dexie {
    playlists!: Table<FoliaPlaylistRow, string>;
    entries!: Table<FoliaPlaylistEntryRow, [string, string]>;
    meta!: Table<FoliaPlaylistsStateRow, string>;

    constructor(name = FOLIA_PLAYLISTS_DATABASE_NAME) {
        super(name);
        this.version(1).stores({
            playlists: 'id',
            entries: '[playlistId+key], [playlistId+pos], localSongId',
            meta: 'key',
        });
    }
}

export const foliaPlaylistsDatabase = new FoliaPlaylistsDatabase();
