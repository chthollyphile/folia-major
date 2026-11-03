import type { LibraryDirectoryBatchPort } from '../core/directory/directory.contract';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import { buildLocalQueue } from '../../services/playbackAdapters';
import { createLocalPlaylist } from '../../services/localPlaylistService';
import { clearFolderIgnore, deleteFolderSongs, deleteSongsByIds, removeImportedRoot, resyncFolder } from '../../services/localMusicService';

// src/library/app/createLibraryDirectoryBatchPort.ts
// 把首页 surface 的播放回调与本地曲库服务装配成目录批量动作的端口（照 createLibraryPlaybackPort 的做法）。
// core 的 localDirectoryActions 只说「播这些歌、删这个文件夹、刷新曲库」；队列怎么建（带曲库实体的显示信息）、
// 走哪个服务，都在这里。surface 按调用现读：宿主每次渲染都可能换新的曲库与回调。

type DirectoryBatchSurface = Pick<
    HomeSurfaceProps,
    'localSongs' | 'localLibraryCatalog' | 'onPlayAll' | 'onAddAllToQueue' | 'onRefreshLocalSongs'
>;

export const createLibraryDirectoryBatchPort = (getSurface: () => DirectoryBatchSurface): LibraryDirectoryBatchPort => {
    // 队列带上曲库实体（专辑 / 歌手改名、合并）的显示信息；实体还没读好时按原始标签。
    const queueOf = (songs: Parameters<LibraryDirectoryBatchPort['playLocalSongs']>[0]) => {
        const { localLibraryCatalog } = getSurface();
        return buildLocalQueue(songs, undefined, localLibraryCatalog.ready ? localLibraryCatalog : undefined);
    };

    return {
        getLocalSongs: () => getSurface().localSongs,
        playLocalSongs: songs => {
            const queue = queueOf(songs);
            if (queue.length > 0) getSurface().onPlayAll?.(queue);
        },
        enqueueLocalSongs: songs => {
            const queue = queueOf(songs);
            if (queue.length > 0) getSurface().onAddAllToQueue?.(queue);
        },
        createLocalPlaylist: async (name, songs) => {
            await createLocalPlaylist(name, songs);
        },
        deleteFolderSongs: folderPath => deleteFolderSongs(folderPath),
        deleteSongsByIds: songIds => deleteSongsByIds(songIds),
        clearFolderIgnore: folderPath => clearFolderIgnore(folderPath),
        resyncFolder: async rootPath => {
            await resyncFolder(rootPath);
        },
        removeImportedRoot: rootPath => removeImportedRoot(rootPath),
        refreshLibrary: () => getSurface().onRefreshLocalSongs(),
    };
};
