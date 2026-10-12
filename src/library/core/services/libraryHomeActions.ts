import type { LocalLibraryGroup } from '../../../types';
import type { NavidromeGridViewCollectionType } from '../contracts/collection';
import type {
    LibraryHomeActionResult,
    LibraryHomeActionsController,
    LibraryHomeActionsSnapshot,
    LibraryHomeCard,
    LibraryHomeOpenCollection,
    LibraryHomePort,
    LibraryHomeScanProgress,
} from '../contracts/homeModel';
import { isHeartbeatCard, isPersonalFmCard, onlineCardCollection } from '../model/homeCards';
import { isHomeImportBusy, resolveLocalUnavailableReason } from '../model/homeSources';

// src/library/core/services/libraryHomeActions.ts
// 首页动作层（原样搬自 Grid3D）：本地的导入文件夹、刷新全部、导入歌单文件，私人 FM 直接播放，打开卡片。
// - 三个导入共用一个「忙」：任何一个在进行或扫描在进行时，导入文件夹 / 刷新再提交返回 busy；歌单文件导入只看自己；
// - 导入文件夹前先看本地曲库能不能用（不能用时弹提示）；导入 / 刷新有新歌才刷新曲库；导入失败弹「不支持」提示，
//   刷新失败只记日志；歌单文件导入一首都没匹配上时报错、不刷新，否则刷新曲库后按有没有跳过的路径给出提示；
// - 扫描进度：第一个订阅者到来时开始听端口，最后一个离开时停（宿主创建一次，不需要 dispose）。
// 副作用都经宿主装配的 LibraryHomePort。

const OK: LibraryHomeActionResult = { ok: true };
const BUSY: LibraryHomeActionResult = { ok: false, reason: 'busy' };
const UNSUPPORTED: LibraryHomeActionResult = { ok: false, reason: 'unsupported' };
const FAILED: LibraryHomeActionResult = { ok: false, reason: 'failed' };

const IDLE: LibraryHomeActionsSnapshot = {
    importingFolder: false,
    refreshingFolders: false,
    importingPlaylist: false,
    scan: null,
};

/** 创建首页动作控制器。端口在调用时现读（宿主每次渲染都可能换新的曲库与回调）。 */
export const createLibraryHomeActions = (port: LibraryHomePort): LibraryHomeActionsController => {
    let snapshot = IDLE;
    const listeners = new Set<() => void>();
    let stopScanProgress: (() => void) | null = null;

    const patch = (next: Partial<LibraryHomeActionsSnapshot>) => {
        snapshot = { ...snapshot, ...next };
        listeners.forEach(listener => listener());
    };

    const handleScanProgress = (progress: LibraryHomeScanProgress | null) => {
        patch({ scan: progress?.active ? progress : null });
    };

    const playPersonalFm = async (): Promise<LibraryHomeActionResult> => {
        try {
            const songs = await port.getPersonalFm();
            if (songs.length > 0) port.playPersonalFm(songs[0], songs);
            return OK;
        } catch (error) {
            console.error('[LibraryHome] Failed to fetch and play Personal FM:', error);
            return FAILED;
        }
    };

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            if (!stopScanProgress) stopScanProgress = port.subscribeScanProgress(handleScanProgress);
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0 && stopScanProgress) {
                    stopScanProgress();
                    stopScanProgress = null;
                }
            };
        },

        importFolder: async () => {
            if (isHomeImportBusy(snapshot)) return BUSY;
            const unavailable = resolveLocalUnavailableReason(port.localAvailability());
            if (unavailable) {
                port.notify({ kind: 'alert', message: unavailable });
                return UNSUPPORTED;
            }
            patch({ importingFolder: true });
            try {
                const imported = await port.importFolder();
                if (imported > 0) void port.refreshLocalSongs();
                return OK;
            } catch (error) {
                console.error('[LibraryHome] Failed to import local folder:', error);
                port.notify({ kind: 'alert', message: { key: 'localMusic.importNotSupported' } });
                return FAILED;
            } finally {
                patch({ importingFolder: false });
            }
        },

        refreshFolders: async () => {
            if (isHomeImportBusy(snapshot)) return BUSY;
            patch({ refreshingFolders: true });
            try {
                const imported = await port.resyncAllFolders();
                if (imported > 0) void port.refreshLocalSongs();
                return OK;
            } catch (error) {
                console.error('[LibraryHome] Failed to resync local folders:', error);
                return FAILED;
            } finally {
                patch({ refreshingFolders: false });
            }
        },

        importPlaylistFile: async (file) => {
            if (snapshot.importingPlaylist) return BUSY;
            patch({ importingPlaylist: true });
            try {
                const result = await port.importPlaylistFile(file);
                if (!result.playlistName) {
                    port.notify({ kind: 'status', type: 'error', message: { key: 'localMusic.playlistImportNoMatches' } });
                    return FAILED;
                }
                await port.refreshLocalSongs();
                const values = { name: result.playlistName, count: result.matchedCount };
                port.notify(result.skippedCount > 0
                    ? { kind: 'status', type: 'info', message: { key: 'localMusic.playlistImportPartial', values: { ...values, skipped: result.skippedCount } } }
                    : { kind: 'status', type: 'success', message: { key: 'localMusic.playlistImportSuccess', values } });
                return OK;
            } catch (error) {
                console.error('[LibraryHome] Failed to import local playlist:', error);
                port.notify({ kind: 'status', type: 'error', message: { key: 'localMusic.playlistImportFailed' } });
                return FAILED;
            } finally {
                patch({ importingPlaylist: false });
            }
        },

        playPersonalFm,

        openOnlineCard: async (card: LibraryHomeCard, providerId: string, open: LibraryHomeOpenCollection) => {
            if (isHeartbeatCard(card)) {
                if (!port.startHeartbeat) return UNSUPPORTED;
                return await port.startHeartbeat() ? OK : FAILED;
            }
            if (isPersonalFmCard(card)) return playPersonalFm();
            open(port.describeOnlineCollection(onlineCardCollection(card), providerId));
            return OK;
        },

        openLocalGroup: (group: LocalLibraryGroup, open: LibraryHomeOpenCollection) => {
            open(port.describeLocalGroup(group));
        },

        openNavidromeCard: (card: LibraryHomeCard, type: NavidromeGridViewCollectionType, open: LibraryHomeOpenCollection) => {
            open(port.describeNavidromeCard(card, type));
        },
    };
};
