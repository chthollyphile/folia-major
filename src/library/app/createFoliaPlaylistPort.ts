import type { FoliaEntryAvailabilityDeps, FoliaPlaylistPort } from '../core/foliaPlaylist/foliaPlaylist.contract';
import { getLocalSong } from '../../services/db';
import {
    addSongsToFoliaPlaylist,
    confirmFoliaPlaylistOrigin,
    createFoliaPlaylist,
    deleteFoliaPlaylist,
    refreshFoliaPlaylistFromOrigin,
    removeFoliaPlaylistEntries,
    renameFoliaPlaylist,
    reorderFoliaPlaylistEntries,
    reorderFoliaPlaylists,
    saveCollectionAsFoliaPlaylist,
    setFoliaSongFavorite,
    setLocalSongFavorite,
    type FoliaTransferDeps,
} from '../../services/foliaPlaylist/foliaPlaylistService';
import { getNavidromeConfig } from '../../services/navidromeService';
import { omni } from '../../services/onlineMusic/omni';
import { listSongCounterpartTargets, resolveSongCounterparts } from '../../services/onlineMusic/songCounterparts';
import { isLocalPlaybackSong } from '../../utils/appPlaybackGuards';

// src/library/app/createFoliaPlaylistPort.ts
// Folia 聚合歌单的宿主装配：把 core 的端口接到存储服务上，把「来源还在不在」接到 omni、Navidrome 配置和本地曲库上。
// 歌单的内容不经这里读：界面用 useFoliaPlaylistsStore（写完会自己重读）。

// 「对应歌曲」接到音源上：只问得到公开的 id 和公开的元数据，批量与时限都在 songCounterparts.ts。
const transferDeps: FoliaTransferDeps = {
    resolveCounterparts: (targetSourceId, songs) => resolveSongCounterparts(targetSourceId, songs),
};

export const createFoliaPlaylistPort = (): FoliaPlaylistPort => ({
    create: (name, songs, options) => createFoliaPlaylist(name, songs, options),
    rename: (playlistId, name) => renameFoliaPlaylist(playlistId, name),
    remove: playlistId => deleteFoliaPlaylist(playlistId),
    addSongs: (playlistId, songs) => addSongsToFoliaPlaylist(playlistId, songs),
    removeEntries: (playlistId, keys) => removeFoliaPlaylistEntries(playlistId, keys),
    reorderEntries: (playlistId, orderedKeys, expectedKeys) => reorderFoliaPlaylistEntries(playlistId, orderedKeys, expectedKeys),
    reorderPlaylists: orderedIds => reorderFoliaPlaylists(orderedIds),
    setFavorite: async (song, shouldFavorite) => {
        // 本地歌走曲库的记录：歌单里留的是重复导入组里 canonical 的那条。
        const localSong = isLocalPlaybackSong(song) ? await getLocalSong(song.localRef.songId) : undefined;
        return localSong ? setLocalSongFavorite(localSong, shouldFavorite) : setFoliaSongFavorite(song, shouldFavorite);
    },
    getPlayViaTargets: originSourceId => listSongCounterpartTargets(originSourceId),
    saveCollection: input => saveCollectionAsFoliaPlaylist(input, transferDeps),
    refreshFromOrigin: (playlistId, fetchOriginSongs, options) => (
        refreshFoliaPlaylistFromOrigin(playlistId, fetchOriginSongs, transferDeps, options)
    ),
    confirmOrigin: (playlistId, shown) => confirmFoliaPlaylistOrigin(playlistId, shown),
});

/**
 * 「来源还在不在」的默认装配。localSongIds 是当前曲库里的歌；音源那两项读的是此刻的状态，
 * 音源增减或开关变了要重新判断（omni.subscribeProviders / omni.getProviderRegistryVersion）。
 */
export const createFoliaEntryAvailabilityDeps = (localSongIds: ReadonlySet<string>): FoliaEntryAvailabilityDeps => ({
    hasLocalSong: songId => localSongIds.has(songId),
    isSourceRegistered: sourceId => omni.getProviderNaming(sourceId) !== null,
    isSourceSwitchedOn: sourceId => omni.isSourceSwitchedOn(sourceId),
    isNavidromeConfigured: () => getNavidromeConfig() !== null,
});
