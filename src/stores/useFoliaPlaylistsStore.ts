import { create } from 'zustand';
import { getFoliaPlaylists, subscribeFoliaPlaylists } from '../services/foliaPlaylist/foliaPlaylistService';
import type { FoliaPlaylist } from '../types/foliaPlaylist';

// src/stores/useFoliaPlaylistsStore.ts
// Folia 聚合歌单在内存里的那一份：界面都读这里，不各自去读数据库。不存任何设置（歌单本身在 IndexedDB，
// 见 src/services/foliaPlaylist/）。服务里每次写完会叫一声，这里跟着重读，所以改歌单的地方不用再手动刷新。

type FoliaPlaylistsState = {
    /** 按显示的先后；第一次读完之前是空的。 */
    playlists: FoliaPlaylist[];
    /** 读过至少一次（空列表和还没读分得开）。 */
    isLoaded: boolean;
    /** 重读一遍。正在读的时候再叫，会在这一次读完后再读一次，两次调用拿到同一个 promise。读失败只记日志，保留上一份。 */
    refresh: () => Promise<void>;
};

const pending: { inFlight: Promise<void> | null; again: boolean } = { inFlight: null, again: false };

export const useFoliaPlaylistsStore = create<FoliaPlaylistsState>(set => {
    const readOnce = async (): Promise<void> => {
        try {
            const playlists = await getFoliaPlaylists();
            set({ playlists, isLoaded: true });
        } catch (error) {
            console.error('[FoliaPlaylist] Failed to load playlists', error);
        }
    };
    // 读的时候又有人叫过：读完再读一次，直到没人叫为止。
    const takeAgain = (): boolean => {
        const again = pending.again;
        pending.again = false;
        return again;
    };
    const readUntilSettled = async (): Promise<void> => {
        await readOnce();
        while (takeAgain()) await readOnce();
    };
    return {
        playlists: [],
        isLoaded: false,
        refresh: () => {
            if (pending.inFlight) {
                pending.again = true;
                return pending.inFlight;
            }
            pending.inFlight = readUntilSettled().finally(() => {
                pending.inFlight = null;
            });
            return pending.inFlight;
        },
    };
});

subscribeFoliaPlaylists(() => {
    void useFoliaPlaylistsStore.getState().refresh();
});

/** 一张歌单（按 id）；没有或还没读到是 null。 */
export const useFoliaPlaylist = (playlistId: string | null | undefined): FoliaPlaylist | null => (
    useFoliaPlaylistsStore(state => (playlistId ? state.playlists.find(playlist => playlist.id === playlistId) ?? null : null))
);

/** 固定的那张「我喜欢的音乐」。 */
export const useFavoriteFoliaPlaylist = (): FoliaPlaylist | null => (
    useFoliaPlaylistsStore(state => state.playlists.find(playlist => playlist.isFavorite) ?? null)
);
