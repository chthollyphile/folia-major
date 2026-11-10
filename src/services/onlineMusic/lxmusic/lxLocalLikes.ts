// src/services/onlineMusic/lxmusic/lxLocalLikes.ts
// 洛雪的「喜欢」落在本机。
//
// 音源不连账号，收藏没有远端可写，所以按本机持久化一份，同时回灌到账号缓存
// （useOnlineProviderAccountStore 的 likedSongIds）——播放器的心形读的就是那份缓存。
// 这样重启之后心还是红的，「我喜欢」里删歌也照样能把这份扣掉。

import type { MediaId } from '../../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';

const PROVIDER_ID = 'lxmusic';
const STORAGE_KEY = 'folia.lxmusic.likes';
/** 本机收藏记多少首就停：喜欢是给自己看的，不是歌库。 */
const MAX_LOCAL_LIKES = 5000;

const readIds = (): MediaId[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((id): id is MediaId => typeof id === 'string' && id.length > 0);
    } catch {
        // 存的东西坏了就当没有：收藏不是能放出歌的关键路径。
        return [];
    }
};

const writeIds = (ids: MediaId[]): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
        // 隐私模式或配额满：写不进去也不该把播放打断，内存里的账号缓存已经更新过了。
    }
};

/** 本机这一份收藏。 */
export const readLxLocalLikes = (): MediaId[] => readIds();

/** 写一首歌的喜欢（幂等：同一个 id 只会有一条）。 */
export const setLxLocalLiked = (mediaId: MediaId, liked: boolean): void => {
    const key = String(mediaId);
    const rest = readIds().filter(id => String(id) !== key);
    const next = liked ? [...rest, mediaId] : rest;
    // 超了上限就丢最旧的（数组头是旧的）。
    writeIds(next.length > MAX_LOCAL_LIKES ? next.slice(next.length - MAX_LOCAL_LIKES) : next);
};

/**
 * 把本机收藏灌回账号缓存。启动时调一次，心形和「我喜欢」才不会从零开始。
 * 只补不删：这一轮里别处（另一次整读）已经写进缓存的收藏，不能被这里冲掉。
 */
export const hydrateLxLocalLikes = (): void => {
    if (typeof localStorage === 'undefined') return;
    const ids = readIds();
    if (ids.length === 0) return;
    const account = useOnlineProviderAccountStore.getState().accounts[PROVIDER_ID];
    const current = account?.likedSongIds ?? [];
    const missing = ids.filter(id => !current.some(existing => String(existing) === String(id)));
    if (missing.length === 0) return;
    useOnlineProviderAccountStore.getState().updateAccount(PROVIDER_ID, {
        likedSongIds: [...current, ...missing],
        status: account?.status === 'authenticated' ? account.status : 'authenticated',
        user: account?.user ?? { id: 'lxmusic-local', nickname: '洛雪音源' },
    });
};
