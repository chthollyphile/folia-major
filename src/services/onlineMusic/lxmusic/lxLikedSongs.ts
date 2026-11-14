// src/services/onlineMusic/lxmusic/lxLikedSongs.ts
// 洛雪的本机「我喜欢」：一份带元数据的歌单。
//
// lxLocalLikes 只记 id（播放器的心形读的是那份 id 集合，回灌进账号缓存）。可首页那张
// 「我的喜欢」卡要的是「所有点过喜欢的歌」——光有 id 拼不出卡面（歌名、歌手、封面都没有），
// 所以点喜欢时顺带把一首歌的最简字段也存下来，和收藏列表（lxSavedPlaylists）同一套结构。
//
// 两者分工：
//   · lxLocalLikes —— 哪些歌被点过喜欢（id，播放器心形与「我喜欢」状态用）；
//   · lxLikedSongs —— 这些歌长什么样，够重建出能播、带封面的曲目（首页卡 / 收藏弹层用）。
// 取消喜欢时两边一起删。

import type { UnifiedSong } from '../../../types';
import { fromSavedSong, toSavedSong, type LxSavedSong } from './lxSavedPlaylists';
import { readLxLocalLikes } from './lxLocalLikes';
import { lxApiSongById, type LxApiSong, type LxPublicPlatform } from './lxmusicTransport';

const PUBLIC_PLATFORMS: ReadonlyArray<string> = ['wy', 'tx', 'kg', 'kw'];

/** 「我喜欢」这张集合在洛雪 provider 里的 id（收藏弹层、首页卡、集合路由都用它）。 */
export const LX_LIKED_PLAYLIST_ID = 'lxliked';
/** 与 lxLocalLikes 的上限对齐：喜欢不是歌库。 */
const MAX_LIKED = 5000;
const STORAGE_KEY = 'folia.lxmusic.liked-songs';

const listeners = new Set<() => void>();
let cache: LxSavedSong[] | null = null;

const notify = (): void => {
    listeners.forEach((listener) => {
        try {
            listener();
        } catch {
            // 单个订阅者炸了不该影响其它人。
        }
    });
};

const isSavedSong = (value: unknown): value is LxSavedSong => {
    if (!value || typeof value !== 'object') return false;
    const song = value as Partial<LxSavedSong>;
    return typeof song.mediaId === 'string'
        && typeof song.name === 'string'
        && Array.isArray(song.artists)
        && typeof song.platform === 'string'
        && typeof song.nativeId === 'string';
};

const read = (): LxSavedSong[] => {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        cache = Array.isArray(parsed) ? parsed.filter(isSavedSong).slice(0, MAX_LIKED) : [];
    } catch {
        cache = [];
    }
    return cache;
};

const write = (next: LxSavedSong[]): void => {
    cache = next;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // 配额满 / 隐私模式：内存里已经生效，不打断当前操作。
    }
    notify();
};

/** 所有点过喜欢的歌，最近点的在前。 */
export const getLxLikedSongs = (): LxSavedSong[] => read();

/** 喜欢状态变化时通知（首页卡、收藏弹层据此刷新）。 */
export const subscribeLxLikedSongs = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** 点喜欢 / 取消喜欢：带元数据的歌进列表，取消则删掉。没有元数据（只给了 id）时静默忽略。 */
export const setLxLikedSong = (song: UnifiedSong | null | undefined, liked: boolean): boolean => {
    const saved = song ? toSavedSong(song) : null;
    if (!saved) return false;
    const current = read();
    if (liked) {
        if (current.some((item) => item.mediaId === saved.mediaId)) return false;
        const next = [saved, ...current];
        write(next.length > MAX_LIKED ? next.slice(0, MAX_LIKED) : next);
        return true;
    }
    if (!current.some((item) => item.mediaId === saved.mediaId)) return false;
    write(current.filter((item) => item.mediaId !== saved.mediaId));
    return true;
};

/** 按 id 删除（取消喜欢时手上只有 id 也能删干净）。 */
export const removeLxLikedSong = (mediaId: string): void => {
    const current = read();
    if (!current.some((item) => item.mediaId === mediaId)) return;
    write(current.filter((item) => item.mediaId !== mediaId));
};

/** 本机喜欢 → 能直接交给播放器的曲目。 */
export const getLxLikedUnifiedSongs = (): UnifiedSong[] => read().map(fromSavedSong);


/**
 * 按 id 回填老数据。
 *
 * 早期版本点喜欢时只把 id 写进了 `folia.lxmusic.likes`，没留歌名/封面，于是首页那张卡画不出来。
 * 这里把「只有 id、还没有元数据」的那些挨个拿到各家详情接口问一次，问到了就补进本列表。
 * 只补不删：查不到（比如酷我那边只凭 musicid 反查不到，或者曲子已下架）就原样留着，不编造。
 */
const toLikedSaved = (platform: string, nativeId: string, song: LxApiSong): LxSavedSong => ({
    mediaId: `${platform}:${nativeId}`,
    name: song.name,
    artists: song.artists.map((artist) => artist.name).filter(Boolean),
    albumName: song.album?.name ?? '',
    albumId: song.album?.id ? String(song.album.id) : undefined,
    coverUrl: song.coverUrl || song.album?.coverUrl,
    durationMs: Number(song.durationMs) || 0,
    platform,
    nativeId,
});

let hydrating = false;
let hydrated = false;

export const hydrateLxLikedSongs = async (): Promise<void> => {
    if (hydrating) return;
    hydrating = true;
    try {
        const ids = readLxLocalLikes();
        const known = new Set(read().map((item) => item.mediaId));
        const missing = ids.map((id) => String(id)).filter((id) => !known.has(id));
        for (const mediaId of missing.slice(0, 200)) {
            const sep = mediaId.indexOf(':');
            if (sep <= 0) continue;
            const platform = mediaId.slice(0, sep);
            const nativeId = mediaId.slice(sep + 1);
            if (!PUBLIC_PLATFORMS.includes(platform) || !nativeId) continue;
            const song = await lxApiSongById(platform as LxPublicPlatform, nativeId);
            if (!song) continue;
            const next = [toLikedSaved(platform, nativeId, song), ...read()];
            write(next.slice(0, MAX_LIKED));
        }
    } catch {
        // 回填失败不该影响「我的喜欢」本身能显示的东西。
    } finally {
        hydrating = false;
        hydrated = true;
    }
};

/** 只跑一次（首页进到洛雪歌单页时触发）。 */
export const ensureLxLikedSongsHydrated = (): void => {
    if (hydrated || hydrating) return;
    void hydrateLxLikedSongs();
};
