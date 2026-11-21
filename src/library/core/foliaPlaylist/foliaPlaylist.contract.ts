import type { SongResult } from '../../../types';
import type { FoliaPlaylist, FoliaPlaylistAddResult, FoliaPlaylistEntry, FoliaPlaylistOrigin } from '../../../types/foliaPlaylist';

// src/library/core/foliaPlaylist/foliaPlaylist.contract.ts
// Folia 聚合歌单给界面用的契约：读写的端口，以及一条条目现在能不能播。
// 歌单的内容界面从 useFoliaPlaylistsStore 读（写完会自己重读）；这里的端口是写操作，由宿主装配
// （src/library/app/createFoliaPlaylistPort.ts），suite 不直接碰 src/services/foliaPlaylist。

export type { FoliaPlaylist, FoliaPlaylistAddResult, FoliaPlaylistEntry, FoliaPlaylistOrigin };

export interface FoliaPlaylistPort {
    /** 建一张歌单，可以带上第一批歌（任何来源，一批里可以有多个来源）。名字是空的会 reject。 */
    create(name: string, songs?: readonly SongResult[], options?: { origin?: FoliaPlaylistOrigin }): Promise<FoliaPlaylist>;
    /** 「我喜欢的音乐」不能改名、空名字、歌单不存在：null。 */
    rename(playlistId: string, name: string): Promise<FoliaPlaylist | null>;
    /** 「我喜欢的音乐」不能删、歌单不存在：false。 */
    remove(playlistId: string): Promise<boolean>;
    /** 往歌单里加歌：任何来源，一批里可以有多个来源；已经在里面的（同一个 key）不重复加，舞台歌不收。 */
    addSongs(playlistId: string, songs: readonly SongResult[]): Promise<{ playlist: FoliaPlaylist | null; result: FoliaPlaylistAddResult }>;
    /** 按条目的 key 移除。 */
    removeEntries(playlistId: string, keys: readonly string[]): Promise<FoliaPlaylist | null>;
    /** 重排歌：orderedKeys 是 expectedKeys（草稿开始时的顺序）的一个排列；歌单期间被改过就不写，返回 null。 */
    reorderEntries(playlistId: string, orderedKeys: readonly string[], expectedKeys: readonly string[]): Promise<FoliaPlaylist | null>;
    /** 重排歌单本身：orderedIds 是现有歌单 id 的一个排列，否则不写，返回 false。 */
    reorderPlaylists(orderedIds: readonly string[]): Promise<boolean>;
    /** 把一首歌放进或移出「我喜欢的音乐」（任何来源；本地歌会换算到重复导入组里 canonical 的那条）。 */
    setFavorite(song: SongResult, shouldFavorite: boolean): Promise<FoliaPlaylist | null>;
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
