import type { LocalSong } from '../../types';
import type { FoliaPlaylist, FoliaPlaylistEntry } from '../../types/foliaPlaylist';
import {
    FAVORITE_PLAYLIST_NAME,
    UNNAMED_PLAYLIST_NAME,
    buildLocalEntry,
    buildLocalRepairIndex,
    createFoliaPlaylistId,
    repairLocalEntries,
} from './foliaPlaylistRows';

// src/services/foliaPlaylist/localPlaylistMigration.ts
// 旧的本地歌单（api_cache 里 `local_playlists` 一行，LocalPlaylist[]：{ id, name, songIds, createdAt, updatedAt, isFavorite? }）
// 变成 Folia 聚合歌单：一张变一张，id、名字、时间、isFavorite、歌的顺序照搬，每个 songId 变成一条本地歌的条目。
// 这里只做换算（纯函数）；什么时候迁、迁没迁过，在 foliaPlaylistService 的事务里。旧的那一行只读不写、不删。

export const LEGACY_LOCAL_PLAYLISTS_CACHE_KEY = 'local_playlists';

type LegacyPlaylistSongRef = string | { id?: unknown } | null | undefined;
type LegacyLocalPlaylist = {
    id?: unknown;
    name?: unknown;
    songIds?: unknown;
    trackIds?: unknown;
    songs?: unknown;
    tracks?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    isFavorite?: unknown;
};

const normalizeSongIdRef = (value: LegacyPlaylistSongRef): string | null => {
    if (typeof value === 'string') return value || null;
    if (value && typeof value === 'object' && typeof value.id === 'string') return value.id || null;
    return null;
};

// 更早的版本把歌存在 songs / tracks / trackIds 里：依次找，用第一个非空的。
const resolveLegacySongIds = (playlist: LegacyLocalPlaylist): string[] => {
    for (const collection of [playlist.songIds, playlist.trackIds, playlist.songs, playlist.tracks]) {
        if (!Array.isArray(collection)) continue;
        const seen = new Set<string>();
        const songIds: string[] = [];
        (collection as LegacyPlaylistSongRef[]).forEach(ref => {
            const songId = normalizeSongIdRef(ref);
            if (!songId || seen.has(songId)) return;
            seen.add(songId);
            songIds.push(songId);
        });
        if (songIds.length > 0) return songIds;
    }
    return [];
};

export type LocalPlaylistMigrationResult = {
    playlists: FoliaPlaylist[];
    /** 曲库里已经没有的 id（旧版本读歌单时同样会丢掉它们）。 */
    droppedSongCount: number;
    /** 不是对象的行，跳过了几个。 */
    skippedPlaylistCount: number;
};

/**
 * 把旧的本地歌单换算成 Folia 歌单。和旧版本读歌单时做的修补一样：曲库里没有的 id 丢掉，重复导入的副本换成
 * canonical 那条并去重。只有第一张标了 isFavorite 的算「我喜欢的音乐」。一张歌单坏了只跳过它自己。
 */
export const convertLegacyLocalPlaylists = (
    legacy: unknown,
    localSongs: readonly LocalSong[],
    now: number = Date.now(),
): LocalPlaylistMigrationResult => {
    const result: LocalPlaylistMigrationResult = { playlists: [], droppedSongCount: 0, skippedPlaylistCount: 0 };
    if (!Array.isArray(legacy)) return result;

    const { validSongById, canonicalByDuplicateKey } = buildLocalRepairIndex(localSongs);
    const usedIds = new Set<string>();
    let hasFavorite = false;

    (legacy as unknown[]).forEach(item => {
        if (!item || typeof item !== 'object') {
            result.skippedPlaylistCount += 1;
            return;
        }
        const playlist = item as LegacyLocalPlaylist;
        const isFavorite = Boolean(playlist.isFavorite) && !hasFavorite;
        hasFavorite ||= isFavorite;
        const createdAt = typeof playlist.createdAt === 'number' ? playlist.createdAt : now;
        const updatedAt = typeof playlist.updatedAt === 'number' ? playlist.updatedAt : now;
        const songIds = resolveLegacySongIds(playlist);
        const entries: FoliaPlaylistEntry[] = [];
        songIds.forEach(songId => {
            const song = validSongById.get(songId);
            if (song) entries.push(buildLocalEntry(song, createdAt));
        });
        result.droppedSongCount += songIds.length - entries.length;

        let id = typeof playlist.id === 'string' && playlist.id ? playlist.id : createFoliaPlaylistId();
        while (usedIds.has(id)) id = createFoliaPlaylistId();
        usedIds.add(id);

        result.playlists.push({
            id,
            name: typeof playlist.name === 'string' && playlist.name
                ? playlist.name
                : (isFavorite ? FAVORITE_PLAYLIST_NAME : UNNAMED_PLAYLIST_NAME),
            createdAt,
            updatedAt,
            ...(isFavorite ? { isFavorite: true } : {}),
            entries: repairLocalEntries(entries, validSongById, canonicalByDuplicateKey).entries,
        });
    });

    return result;
};
