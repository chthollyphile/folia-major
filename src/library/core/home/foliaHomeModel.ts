import type { TFunction } from 'i18next';
import type { LocalLibraryGroup, LocalSong } from '../../../types';
import type { FoliaPlaylistSummary } from '../../../types/foliaPlaylist';
import type { LibraryHomeListAction } from './homeModel.contract';
import { getLocalCoverUrl, type LocalCoverAssetUrlResolver } from './localHomeModel';

// src/library/core/home/foliaHomeModel.ts
// 首页 Folia 组的模型：聚合歌单的列表。Folia 组只有歌单这一种内容（不做专辑收藏、歌手收藏），所以没有二级页签。
// 一张歌单在首页是一个「本地分组」（LocalLibraryGroup，type 'playlist'、带 playlistId）：打开时走和以前的本地歌单
// 同一条路（describeLocalGroup → 集合层），集合层按 playlistId 按需读歌单的全部条目，混着各个来源。这里拿到的只是歌单的
// 摘要：分组上的 songs 是歌单最前面一段里的本地歌（自动封面用，有上限），首数（trackCount）是摘要里的条目数。
// 「我喜欢的音乐」排在最前（isVirtual：不能改名、不能删，沿用本地歌单时期的标记，首页的特殊卡片也按它认）。

/** 聚合歌单 → 首页分组，「我喜欢的音乐」在最前，其余按歌单自己的先后。 */
export const buildFoliaHomeGroups = (
    playlists: readonly FoliaPlaylistSummary[],
    localSongs: readonly LocalSong[],
    t: TFunction,
    coverAssetUrl: LocalCoverAssetUrlResolver,
): LocalLibraryGroup[] => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const ordered = [...playlists.filter(playlist => playlist.isFavorite), ...playlists.filter(playlist => !playlist.isFavorite)];
    return ordered.map(playlist => {
        // 摘要里记着歌单最前面一段里的本地歌（有上限）：自动封面从它们里挑。
        const headSongIds = playlist.coverLocalSongIds ?? [];
        const playlistSongs = headSongIds.flatMap(songId => songsById.get(songId) ?? []);
        return {
            type: 'playlist' as const,
            name: playlist.isFavorite ? t('localMusic.favoritePlaylist') : playlist.name,
            songs: playlistSongs,
            // 本地歌的封面优先（和本地歌单时期一样）；没有时用歌单前面第一首带封面的条目的那张。
            coverUrl: getLocalCoverUrl(playlistSongs, coverAssetUrl) ?? playlist.coverUrl,
            id: `playlist-${playlist.id}`,
            playlistId: playlist.id,
            // 曲库里已经找不到的本地歌不算（看得到的只有摘要里记着的那一段；读歌单列表时这些条目本来也会被修掉）。
            trackCount: playlist.entryCount - (headSongIds.length - playlistSongs.length),
            description: playlist.isFavorite ? t('localMusic.favoritePlaylist') : t('home.foliaPlaylist'),
            isVirtual: playlist.isFavorite,
        };
    });
};

/** Folia 页右上角的动作。 */
export type FoliaHomeActionId = 'folia-new-playlist' | 'folia-reorder-playlists' | 'folia-import-playlist' | 'folia-open-scratchpad';

/**
 * Folia 页的动作：新建歌单、调整歌单顺序（除「我喜欢的音乐」外至少两张才有意义）、导入 M3U、打开速记簿。
 * 导入进行中时导入那一项转圈并禁用。
 */
export const resolveFoliaHomeActions = (
    state: { reorderableCount: number; importingPlaylist: boolean },
): (LibraryHomeListAction & { id: FoliaHomeActionId })[] => [
    { id: 'folia-new-playlist', labelKey: 'localMusic.createPlaylist', pending: false, disabled: false },
    { id: 'folia-reorder-playlists', labelKey: 'home.foliaReorderPlaylists', pending: false, disabled: state.reorderableCount < 2 },
    {
        id: 'folia-import-playlist',
        labelKey: state.importingPlaylist ? 'localMusic.importingPlaylist' : 'localMusic.importPlaylist',
        titleKey: 'localMusic.importPlaylist',
        pending: state.importingPlaylist,
        disabled: state.importingPlaylist,
    },
    { id: 'folia-open-scratchpad', labelKey: 'scratchpad.open', pending: false, disabled: false },
];
