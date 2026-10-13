import i18n from '../../i18n/config';
import type { LibraryHomePort, LibraryHomeScanProgress } from '../core/contracts/homeModel';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import { translateHomeMessage } from '../core/model/homeSources';
import { importFolder, resyncAllFolders, LOCAL_MUSIC_SCAN_PROGRESS_EVENT } from '../../services/localMusicService';
import { getLocalLibraryAvailability } from '../../services/localLibraryAvailability';
import { importLocalPlaylistFile } from '../../services/localPlaylistFileService';
import { omni } from '../../services/onlineMusic/omni';
import {
    createLocalGridViewCollection,
    createNavidromeGridViewCollection,
    createOnlineGridViewCollection,
} from '../../components/app/home/gridViewCollectionAdapters';

// src/library/app/createLibraryHomePort.ts
// 把首页 surface 的回调与本地曲库服务、omni、集合描述工厂装配成首页动作的端口（照 createLibraryDirectoryBatchPort
// 的做法）。core 的 libraryHomeActions 只说「导入文件夹、刷新曲库、播放私人 FM、打开这张卡」；调哪个服务、
// 提示怎么翻译与显示（alert 仍是 window.alert，状态消息走 onStatusMessage），都在这里。surface 按调用现读。

type HomePortSurface = Pick<HomeSurfaceProps, 'localSongs' | 'onRefreshLocalSongs' | 'onStatusMessage' | 'onPlaySong'>;

export const createLibraryHomePort = (getSurface: () => HomePortSurface): LibraryHomePort => ({
    localAvailability: () => getLocalLibraryAvailability(),
    importFolder: async () => (await importFolder()).length,
    resyncAllFolders: async () => (await resyncAllFolders())?.length ?? 0,
    importPlaylistFile: async (file) => {
        const result = await importLocalPlaylistFile(file, getSurface().localSongs);
        return {
            playlistName: result.playlist?.name ?? null,
            matchedCount: result.matchedSongIds.length,
            skippedCount: result.unmatchedPaths.length + result.ambiguousPaths.length,
        };
    },
    refreshLocalSongs: () => getSurface().onRefreshLocalSongs(),
    subscribeScanProgress: (listener) => {
        const handleScanProgress = (event: Event) => {
            listener((event as CustomEvent<LibraryHomeScanProgress>).detail ?? null);
        };
        window.addEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress);
        return () => window.removeEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress);
    },
    getPersonalFm: () => omni.getPersonalFm(),
    playPersonalFm: (song, queue) => getSurface().onPlaySong(song, queue, true),
    playSongs: (song, queue, isFmCall) => getSurface().onPlaySong(song, queue, isFmCall),
    describeOnlineCollection: (collection, providerId) => createOnlineGridViewCollection(collection, providerId),
    describeLocalGroup: group => createLocalGridViewCollection(group),
    describeNavidromeCard: (card, type) => createNavidromeGridViewCollection(card, type),
    notify: (notice) => {
        const text = translateHomeMessage(i18n.t, notice.message);
        if (notice.kind === 'alert') {
            alert(text);
            return;
        }
        getSurface().onStatusMessage?.({ type: notice.type, text });
    },
});
