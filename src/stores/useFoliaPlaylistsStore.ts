import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
    getFoliaPlaylist,
    getFoliaPlaylistEntryKeys,
    getFoliaPlaylistSummaries,
    subscribeFoliaPlaylists,
    type FoliaPlaylistsChange,
} from '../services/foliaPlaylist/foliaPlaylistService';
import type { FoliaPlaylist, FoliaPlaylistSummary } from '../types/foliaPlaylist';

// src/stores/useFoliaPlaylistsStore.ts
// Folia 聚合歌单在内存里的那一份：界面都读这里，不各自去读数据库。不存任何设置（歌单本身在 IndexedDB，
// 见 src/services/foliaPlaylist/）。服务里每次写完会叫一声，这里跟着重读，所以改歌单的地方不用再手动刷新；
// 别的窗口（遥控窗口等）写的也会叫到这里（经 BroadcastChannel，见 foliaPlaylistBroadcast.ts），同样只是重读。
// 常驻的只有歌单的摘要（名字、条目数、自动封面要的一点东西）和「我喜欢的音乐」里的 key（红心的点亮状态）；
// 一张歌单的条目用 useFoliaPlaylistContent 按需读，用完就放掉。

type FoliaPlaylistsState = {
    /** 歌单的摘要，按显示的先后；第一次读完之前是空的。 */
    playlists: FoliaPlaylistSummary[];
    /** 「我喜欢的音乐」里全部条目的 key。只在那张歌单变了的时候重读（读的是主键，不读条目）。 */
    favoriteKeys: ReadonlySet<string>;
    /** 读过至少一次（空列表和还没读分得开）。 */
    isLoaded: boolean;
    /**
     * 重读一遍（曲库变了、启动时叫它：顺手把本地歌的条目对着曲库修一遍）。正在读的时候再叫，会在这一次读完后再读一次，
     * 两次调用拿到同一个 promise。读失败只记日志，保留上一份。
     */
    refresh: () => Promise<void>;
};

const NO_KEYS: ReadonlySet<string> = new Set();
// repair：下一次读要不要对着曲库修条目（要读整张曲库表）。歌单自己的写引起的重读不用修；第一次读、外面叫 refresh 才修。
const pending: { inFlight: Promise<void> | null; again: boolean; favoriteStale: boolean; repair: boolean } = {
    inFlight: null, again: false, favoriteStale: true, repair: true,
};
// 歌单被写了之后的重读（不修条目）；store 建好时接上。
let rereadAfterWrite: () => void = () => {};

export const useFoliaPlaylistsStore = create<FoliaPlaylistsState>((set, get) => {
    const readOnce = async (): Promise<void> => {
        const repair = pending.repair;
        pending.repair = false;
        try {
            const playlists = await getFoliaPlaylistSummaries({ repair });
            const favorite = playlists.find(playlist => playlist.isFavorite);
            const before = get().playlists.find(playlist => playlist.isFavorite);
            // 写（这个窗口的，或别的窗口传来的）会点名改了哪张；没传到的（频道开不了）看摘要变没变。
            const readKeys = pending.favoriteStale || favorite?.id !== before?.id || favorite?.updatedAt !== before?.updatedAt
                || favorite?.entryCount !== before?.entryCount;
            pending.favoriteStale = false;
            const favoriteKeys = readKeys ? new Set(favorite ? await getFoliaPlaylistEntryKeys(favorite.id) : []) : get().favoriteKeys;
            set({ playlists, favoriteKeys, isLoaded: true });
        } catch (error) {
            pending.favoriteStale = true;
            pending.repair ||= repair;
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
        // 和上面那次 takeAgain 在同一段同步代码里清掉：之后再叫 refresh 的人会开新的一轮，不会拿到一个不再读的 promise。
        pending.inFlight = null;
    };
    const start = (): Promise<void> => {
        if (pending.inFlight) {
            pending.again = true;
            return pending.inFlight;
        }
        const run = readUntilSettled();
        pending.inFlight = run;
        return run;
    };
    rereadAfterWrite = () => {
        void start();
    };
    return {
        playlists: [],
        favoriteKeys: NO_KEYS,
        isLoaded: false,
        refresh: () => {
            pending.repair = true;
            return start();
        },
    };
});

subscribeFoliaPlaylists((change: FoliaPlaylistsChange) => {
    const favoriteId = useFoliaPlaylistsStore.getState().playlists.find(playlist => playlist.isFavorite)?.id;
    if (favoriteId === undefined || change.all || change.playlistIds.includes(favoriteId)) pending.favoriteStale = true;
    // 还没读过第一次（pending.repair 还是 true）也没关系：那一次照样会修。
    rereadAfterWrite();
});

/** 一张歌单的摘要（按 id）；没有或还没读到是 null。 */
export const useFoliaPlaylist = (playlistId: string | null | undefined): FoliaPlaylistSummary | null => (
    useFoliaPlaylistsStore(state => (playlistId ? state.playlists.find(playlist => playlist.id === playlistId) ?? null : null))
);

/** 固定的那张「我喜欢的音乐」的摘要。 */
export const useFavoriteFoliaPlaylist = (): FoliaPlaylistSummary | null => (
    useFoliaPlaylistsStore(state => state.playlists.find(playlist => playlist.isFavorite) ?? null)
);

/**
 * 一张歌单连同它的全部条目，按需读：playlistId 是 null 就不读。这张歌单被改了（这个窗口里的写、别的窗口传来的写，或者摘要变了）会重读。
 * 还没读到、歌单不存在都是 null（isLoaded 分得开）；读失败是 isFailed（错误在日志里，歌单再被改时会再读）。
 * 组件卸载、换了歌单，读出来的那份就放掉，不常驻。
 */
export const useFoliaPlaylistContent = (
    playlistId: string | null | undefined,
): { playlist: FoliaPlaylist | null; isLoaded: boolean; isFailed: boolean } => {
    const [content, setContent] = useState<{ id: string; playlist: FoliaPlaylist | null; failed?: boolean } | null>(null);
    // 别的窗口改了这张歌单而话没传到（频道开不了）：摘要跟着列表重读时会变，拿它当重读的信号。
    const stamp = useFoliaPlaylistsStore(state => {
        const summary = playlistId ? state.playlists.find(playlist => playlist.id === playlistId) : undefined;
        return summary ? `${summary.updatedAt}:${summary.entryCount}` : '';
    });
    // 当前这张歌单的读法（下面第二个 effect 用）：reading 是正在读，stamp 是上一次读到的那份对应的摘要记号。
    const reader = useRef<{ read: () => void; reading: boolean; stamp: string | null } | null>(null);
    useEffect(() => {
        if (!playlistId) {
            setContent(null);
            reader.current = null;
            return undefined;
        }
        // 读的时候歌单又被改了：读完再读一次（放在对象上，等的那段时间里别处会改它）。
        const state = { alive: true, again: false };
        const own: NonNullable<typeof reader.current> = { read: () => {}, reading: false, stamp: null };
        const takeAgain = (): boolean => {
            const again = state.again;
            state.again = false;
            return again;
        };
        const read = async (): Promise<void> => {
            if (own.reading) {
                state.again = true;
                return;
            }
            own.reading = true;
            try {
                do {
                    const playlist = await getFoliaPlaylist(playlistId);
                    own.stamp = playlist ? `${playlist.updatedAt}:${playlist.entries.length}` : '';
                    if (state.alive) setContent({ id: playlistId, playlist });
                } while (takeAgain() && state.alive);
            } catch (error) {
                console.error('[FoliaPlaylist] Failed to load a playlist', playlistId, error);
                if (state.alive) setContent(current => (current?.id === playlistId ? current : { id: playlistId, playlist: null, failed: true }));
            } finally {
                own.reading = false;
            }
        };
        own.read = () => {
            void read();
        };
        reader.current = own;
        own.read();
        // 写（这个窗口的，或别的窗口传来的）点了这张歌单的名：重读。
        const unsubscribe = subscribeFoliaPlaylists((change) => {
            if (change.all || change.playlistIds.includes(playlistId)) own.read();
        });
        return () => {
            state.alive = false;
            unsubscribe();
            if (reader.current === own) reader.current = null;
        };
    }, [playlistId]);
    // 摘要变了：点过名的写已经由上面的订阅读过了（正在读，或者读到的那份和摘要对得上），不再读第二遍；
    // 对不上才是没传到的写，这时重读。
    useEffect(() => {
        const current = reader.current;
        if (!current || current.reading || current.stamp === null || current.stamp === stamp) return;
        current.read();
    }, [stamp]);
    const current = content && content.id === playlistId ? content : null;
    return { playlist: current?.playlist ?? null, isLoaded: current !== null && !current.failed, isFailed: Boolean(current?.failed) };
};
