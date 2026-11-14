// src/services/onlineMusic/lxmusic/lxSavedPlaylists.ts
// 洛雪的「收藏列表」落在本机。
//
// 洛雪不连账号，收藏歌单没有远端可写，所以按本机持久化一份自建列表：
//   新建 / 改名 / 删除列表，把某一首收进某个列表，把某一首从列表里移出。
// 存进来的是「够重建一首歌」的最小字段（歌名、歌手、专辑、时长、平台 + 平台内 id），
// 下次打开直接从本机还原成一排能播的曲目，不用再回平台查一遍。
// 订阅是给界面用的：任何一次增删都通知一次，面板不必靠轮询。

import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';

const STORAGE_KEY = 'folia.lxmusic.playlists';
/** 列表数量上限：这是给「下次接着听」用的，不是歌库。 */
const MAX_PLAYLISTS = 60;
/** 单个列表的曲目上限。 */
const MAX_SONGS_PER_PLAYLIST = 500;

/** 存下来的一首歌：字段按 UnifiedSong 的重建需要裁到最小。 */
export type LxSavedSong = {
    mediaId: string;
    name: string;
    artists: string[];
    albumName: string;
    /** 平台原生专辑 id：首页「专辑」页靠它把收藏歌曲拼成封面墙，点开就能进那家真实的专辑页。 */
    albumId?: string;
    coverUrl?: string;
    durationMs: number;
    platform: string;
    nativeId: string;
};

export type LxSavedPlaylist = {
    id: string;
    name: string;
    createdAt: number;
    songs: LxSavedSong[];
};

const listeners = new Set<() => void>();
let cache: LxSavedPlaylist[] | null = null;

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

const normalize = (value: unknown): LxSavedPlaylist[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const playlist = entry as Partial<LxSavedPlaylist>;
        if (typeof playlist.id !== 'string' || typeof playlist.name !== 'string') return [];
        return [{
            id: playlist.id,
            name: playlist.name,
            createdAt: typeof playlist.createdAt === 'number' ? playlist.createdAt : Date.now(),
            songs: Array.isArray(playlist.songs) ? playlist.songs.filter(isSavedSong).slice(0, MAX_SONGS_PER_PLAYLIST) : [],
        }];
    }).slice(0, MAX_PLAYLISTS);
};

const read = (): LxSavedPlaylist[] => {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        cache = raw ? normalize(JSON.parse(raw)) : [];
    } catch {
        // 存的东西坏了就当没有：收藏列表不是能放出歌的关键路径。
        cache = [];
    }
    return cache;
};

const write = (next: LxSavedPlaylist[]): void => {
    cache = next;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // 隐私模式或配额满：写不进去也不该把当前操作打断，内存里已经改过了。
    }
    notify();
};

/** 全部收藏列表（按创建时间倒序，新建的在前面）。 */
export const getLxSavedPlaylists = (): LxSavedPlaylist[] => read();

export const subscribeLxSavedPlaylists = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const nextId = (): string => `lxpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** 新建一个列表；同名会加序号，空名不收。返回新列表，失败返回 null。 */
export const createLxSavedPlaylist = (rawName: string): LxSavedPlaylist | null => {
    const name = rawName.trim().slice(0, 30);
    if (!name) return null;
    const current = read();
    if (current.length >= MAX_PLAYLISTS) return null;
    const existing = new Set(current.map((playlist) => playlist.name));
    let finalName = name;
    let index = 2;
    while (existing.has(finalName)) {
        finalName = `${name} (${index})`;
        index += 1;
    }
    const playlist: LxSavedPlaylist = { id: nextId(), name: finalName, createdAt: Date.now(), songs: [] };
    write([playlist, ...current]);
    return playlist;
};

export const deleteLxSavedPlaylist = (playlistId: string): void => {
    const current = read();
    const next = current.filter((playlist) => playlist.id !== playlistId);
    if (next.length === current.length) return;
    write(next);
};

export const renameLxSavedPlaylist = (playlistId: string, rawName: string): void => {
    const name = rawName.trim().slice(0, 30);
    if (!name) return;
    write(read().map((playlist) => (playlist.id === playlistId ? { ...playlist, name } : playlist)));
};

/** 把一首歌收进列表；已经在里面就原样返回 false（幂等）。 */
export const addSongToLxPlaylist = (playlistId: string, song: UnifiedSong): boolean => {
    const saved = toSavedSong(song);
    if (!saved) return false;
    let changed = false;
    const next = read().map((playlist) => {
        if (playlist.id !== playlistId) return playlist;
        if (playlist.songs.some((item) => item.mediaId === saved.mediaId)) return playlist;
        changed = true;
        const songs = [...playlist.songs, saved];
        return { ...playlist, songs: songs.length > MAX_SONGS_PER_PLAYLIST ? songs.slice(songs.length - MAX_SONGS_PER_PLAYLIST) : songs };
    });
    if (changed) write(next);
    return changed;
};

export const removeSongFromLxPlaylist = (playlistId: string, mediaId: string): void => {
    const next = read().map((playlist) => (
        playlist.id === playlistId
            ? { ...playlist, songs: playlist.songs.filter((song) => song.mediaId !== mediaId) }
            : playlist
    ));
    write(next);
};

/** 这首歌是否已经在某个列表里（界面上给「已收藏」状态用）。 */
export const isSongInLxPlaylist = (playlistId: string, mediaId: string): boolean => {
    const playlist = read().find((item) => item.id === playlistId);
    return Boolean(playlist?.songs.some((song) => song.mediaId === mediaId));
};

/** 优先收进「最近用过」的列表：没列表时返回 null，界面据此提示先建一个。 */
export const getMostRecentLxPlaylist = (): LxSavedPlaylist | null => read()[0] ?? null;

/** UnifiedSong → 可存的精简结构。不是洛雪的在线歌（本地 / 别的平台）不入列表。 */
/** 占位专辑 id（`<平台>-album-unknown`）不是真 id，宁可当没有，也不拿它去打开专辑页。 */
const albumIdOf = (value: unknown): string | undefined => {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || /-album-unknown$/.test(id)) return undefined;
    return id;
};

export const toSavedSong = (song: UnifiedSong): LxSavedSong | null => {
    const ref = song.sourceRef;
    if (!ref || ref.kind !== 'online') return null;
    const data = ref.providerData as Record<string, unknown> | undefined;
    const platform = typeof data?.platform === 'string' ? data.platform : '';
    const nativeId = typeof data?.nativeId === 'string' ? data.nativeId : '';
    if (!platform || !nativeId) return null;
    return {
        mediaId: String(song.id),
        name: song.name,
        artists: song.artists.map((artist) => artist.name).filter(Boolean),
        albumName: song.album?.name ?? '',
        albumId: albumIdOf(song.album?.id),
        coverUrl: song.album?.coverUrl || undefined,
        durationMs: Number(song.durationMs) || 0,
        platform,
        nativeId,
    };
};

/** 存下来的结构 → 能直接交给播放器 / 加入队列的 UnifiedSong。 */
export const fromSavedSong = (saved: LxSavedSong): UnifiedSong => ({
    id: saved.mediaId as MediaId,
    name: saved.name,
    artists: saved.artists.length > 0
        ? saved.artists.map((name, index) => ({ id: `${saved.platform}-artist-${index}-${name}` as MediaId, name }))
        : [{ id: `${saved.platform}-artist-unknown` as MediaId, name: '未知歌手' }],
    album: {
        id: `${saved.platform}-album-unknown` as MediaId,
        name: saved.albumName || '未知专辑',
        coverUrl: saved.coverUrl,
    },
    durationMs: saved.durationMs,
    aliases: [],
    translatedNames: [],
    isPureMusic: false,
    sourceRef: {
        kind: 'online',
        providerId: 'lxmusic',
        mediaId: saved.mediaId,
        providerData: { platform: saved.platform, nativeId: saved.nativeId },
    },
});
