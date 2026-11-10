import type { TFunction } from 'i18next';
import type { UnifiedSong } from '../../types';
import type { LocalGridViewCollectionDescriptor } from '../core/collection/collection.contract';
import type { LibraryMutationPort, LibraryPlaylistOption } from '../core/shared/ports.contract';
import { deleteFolderSongs, resyncAllFolders, resyncFolder } from '../../services/localMusicService';
import { deleteLocalPlaylist, removeSongsFromLocalPlaylist, updateLocalPlaylist } from '../../services/localPlaylistService';
import { downloadLocalPlaylistM3u8 } from '../../services/localPlaylistFileService';
import { getNavidromeConfig, navidromeApi } from '../../services/navidromeService';
import { isLocalGridViewCollection } from '../../components/app/home/gridViewCollectionAdapters';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import { FAVORITE_ALBUMS_CHANGED_EVENT } from './useLibraryHomeResources';
import { useExploreFeedStore } from '../../stores/useExploreFeedStore';
import { localCollectionCoverKey } from '../core/collection/cover/localCollectionCover';
import { localCollectionCovers } from '../core/collection/cover/localCollectionCovers.service';

// src/library/app/createLibraryMutationPort.ts
// 把首页 surface 上的来源动作装配成 Library Core 的变更端口：本地曲库与 Navidrome 的读写、
// 宿主挂载的四个对话框（实体编辑、整理、匹配、集合封面）、账户刷新与应用内通知。实现原样搬自 GridViewOverlayHost 的 sourceActions，
// 行为不变；在线集合的变更不在这里（控制器经由 omni 完成）。

type MutationSurface = Pick<
    HomeSurfaceProps,
    | 'onRefreshLocalSongs'
    | 'onRefreshUser'
    | 'onStatusMessage'
    | 'localPlaylists'
    | 'localSongs'
>;

export type LibraryMutationPortDialogs = {
    editEntity: (entityId: string) => void;
    editCover: (collection: LocalGridViewCollectionDescriptor) => void;
    organizeFolder: (collection: LocalGridViewCollectionDescriptor) => void;
    matchSong: (songId: string) => void;
};

export const createLibraryMutationPort = ({
    surface,
    t,
    dialogs,
    navidromePlaylists,
    refreshNavidromePlaylists,
}: {
    surface: MutationSurface;
    t: TFunction;
    dialogs: LibraryMutationPortDialogs;
    navidromePlaylists: LibraryPlaylistOption[];
    refreshNavidromePlaylists: () => Promise<void>;
}): LibraryMutationPort => ({
    local: {
        refresh: surface.onRefreshLocalSongs,
        editEntity: async (entityId) => dialogs.editEntity(entityId),
        editCover: async (collection) => dialogs.editCover(collection),
        organizeFolder: async (collection) => {
            if (isLocalGridViewCollection(collection) && collection.type === 'folder' && !collection.isVirtual) {
                dialogs.organizeFolder(collection);
            }
        },
        matchSong: async (songId) => dialogs.matchSong(songId),
        resyncFolder: async (collection) => {
            const importedSongs = await resyncFolder(collection.name);
            if (importedSongs !== null) {
                await surface.onRefreshLocalSongs();
            }
        },
        resyncAllFolders: async () => {
            const importedSongs = await resyncAllFolders();
            if (importedSongs !== null) {
                await surface.onRefreshLocalSongs();
            }
        },
        deleteFolder: async (collection) => {
            await deleteFolderSongs(collection.name);
            surface.onRefreshLocalSongs();
        },
        renamePlaylist: async (playlistId, name) => {
            await updateLocalPlaylist(playlistId, playlist => ({
                ...playlist,
                name: name.trim(),
            }));
            surface.onRefreshLocalSongs();
        },
        deletePlaylist: async (playlistId) => {
            await deleteLocalPlaylist(playlistId);
            // 歌单 id 不会再出现：它的自定义封面一并删掉（失败只记一行，歌单已经删了）。
            const coverKey = localCollectionCoverKey({ type: 'playlist', id: playlistId, playlistId });
            if (coverKey) {
                void localCollectionCovers.clear(coverKey).catch(error => (
                    console.warn('[LocalCollectionCover] Failed to remove the cover of a deleted playlist:', error)
                ));
            }
            surface.onRefreshLocalSongs();
        },
        exportPlaylist: async (playlistId) => {
            const playlist = surface.localPlaylists.find(item => item.id === playlistId);
            if (!playlist) return;
            downloadLocalPlaylistM3u8(playlist, surface.localSongs);
            surface.onStatusMessage?.({
                type: 'success',
                text: t('localMusic.playlistExportSuccess', { name: playlist.name }),
            });
        },
        removePlaylistSongs: async (playlistId, songIds) => {
            await removeSongsFromLocalPlaylist(playlistId, songIds);
        },
    },
    navidrome: {
        availablePlaylists: navidromePlaylists,
        addToPlaylist: async (playlistId, songs) => {
            const config = getNavidromeConfig();
            if (!config) return;

            await navidromeApi.updatePlaylist(config, String(playlistId), {
                songIdsToAdd: songs
                    .map(song => (song as UnifiedSong).navidromeData?.id)
                    .filter((id): id is string => Boolean(id)),
            });
            await refreshNavidromePlaylists();
        },
        createPlaylist: async (name, songs) => {
            const config = getNavidromeConfig();
            if (!config) return;

            await navidromeApi.createPlaylist(
                config,
                name,
                songs
                    .map(song => (song as UnifiedSong).navidromeData?.id)
                    .filter((id): id is string => Boolean(id))
            );
            await refreshNavidromePlaylists();
        },
        renamePlaylist: async (playlistId, name) => {
            const config = getNavidromeConfig();
            if (!config) return;

            await navidromeApi.updatePlaylist(config, playlistId, { name });
            await refreshNavidromePlaylists();
        },
        deletePlaylist: async (playlistId) => {
            const config = getNavidromeConfig();
            if (!config) return;

            await navidromeApi.deletePlaylist(config, playlistId);
            await refreshNavidromePlaylists();
        },
        removePlaylistSongs: async (playlistId, rawIndexes) => {
            const config = getNavidromeConfig();
            if (!config) return;

            await navidromeApi.updatePlaylist(config, playlistId, {
                songIndexesToRemove: rawIndexes,
            });
        },
    },
    onCollectionMutated: surface.onRefreshUser,
    statusMessage: surface.onStatusMessage,
    notifyFavoriteAlbumsChanged: () => {
        window.dispatchEvent(new CustomEvent(FAVORITE_ALBUMS_CHANGED_EVENT));
    },
    // The explore page stops showing a collection taken out of the library.
    onCollectionSaved: (collection, saved) => useExploreFeedStore.getState().noteSaved(collection, saved),
});
