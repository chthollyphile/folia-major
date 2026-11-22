import type { LocalSong, SongResult, UnifiedSong } from '../../types';
import type { FoliaPlaylist, FoliaPlaylistEntry, FoliaPlaylistOrigin } from '../../types/foliaPlaylist';
import { foliaLocalSongKey, getFoliaEntryLocalSongId } from '../../utils/foliaPlaylistEntries';
import { toStoredSongSnapshot } from '../../utils/songSnapshot';
import { buildDuplicateImportCanonicalSongIds, getDuplicateImportSongKey } from './localSongDuplicates';

// src/services/foliaPlaylist/foliaPlaylistRows.ts
// Folia 聚合歌单的形状规则（纯函数，不碰数据库）：建 id、本地歌的条目、对着曲库修条目要的索引，
// 以及旧结构（按条目存之前）读回来时的检查。现在的存储在 FoliaPlaylistsDB（foliaPlaylistDatabase.ts）。
// 旧结构在 KineticPlayerDB 的 api_cache 表里，只在把它搬进新库时读（foliaPlaylistStorage.ts），这一版不再写：
// - `folia_playlists_meta`：{ version, order, localPlaylistsMigratedAt? }，歌单的先后与迁移标记；
// - `folia_playlist:<歌单 id>`：一张歌单一行（FoliaPlaylist，条目都在这一行里）。

export const FOLIA_PLAYLISTS_META_KEY = 'folia_playlists_meta';
export const FOLIA_PLAYLIST_ROW_PREFIX = 'folia_playlist:';
export const FOLIA_PLAYLISTS_VERSION = 1;
/** 「我喜欢的音乐」存下来的名字；界面按 isFavorite 显示翻译过的名字，不显示这个。 */
export const FAVORITE_PLAYLIST_NAME = 'Liked Songs';
export const UNNAMED_PLAYLIST_NAME = 'Untitled Playlist';

export type FoliaPlaylistsMeta = {
    version: number;
    /** 歌单 id，按显示的先后。 */
    order: string[];
    /** 旧的本地歌单（`local_playlists`）并进来的时间；有它就不再迁。 */
    localPlaylistsMigratedAt?: number;
    /** 那次迁了几张（排查用）。 */
    localPlaylistsMigratedCount?: number;
};

export const foliaPlaylistRowKey = (playlistId: string): string => `${FOLIA_PLAYLIST_ROW_PREFIX}${playlistId}`;

export const createFoliaPlaylistId = (): string => `folia_playlist_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

/** 读回来的 meta：坏的当空（没迁过、没有顺序），歌单的行还在，不会因此丢。 */
export const parseFoliaPlaylistsMeta = (data: unknown): FoliaPlaylistsMeta => {
    if (!isRecord(data)) return { version: FOLIA_PLAYLISTS_VERSION, order: [] };
    return {
        version: typeof data.version === 'number' ? data.version : FOLIA_PLAYLISTS_VERSION,
        order: Array.isArray(data.order) ? data.order.filter((id): id is string => typeof id === 'string') : [],
        ...(typeof data.localPlaylistsMigratedAt === 'number' ? { localPlaylistsMigratedAt: data.localPlaylistsMigratedAt } : {}),
        ...(typeof data.localPlaylistsMigratedCount === 'number' ? { localPlaylistsMigratedCount: data.localPlaylistsMigratedCount } : {}),
    };
};

const parseOrigin = (data: unknown): FoliaPlaylistOrigin | undefined => {
    if (!isRecord(data) || typeof data.sourceId !== 'string' || typeof data.collectionId !== 'string') return undefined;
    // 这个版本不认识的字段原样留着（和歌单、条目一样）。
    const { playVia: _playVia, refreshedAt: _refreshedAt, ...rest } = data;
    return {
        ...rest,
        sourceId: data.sourceId,
        collectionId: data.collectionId,
        name: typeof data.name === 'string' ? data.name : '',
        savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
        ...(typeof data.playVia === 'string' && data.playVia ? { playVia: data.playVia } : {}),
        ...(typeof data.refreshedAt === 'number' ? { refreshedAt: data.refreshedAt } : {}),
    };
};

/**
 * 读回来的一行：没有 id 的不是歌单（null）；条目至少要有 key 与 song，同一个 key 只留第一条。
 * 歌单和条目上这个版本不认识的字段原样留着（以后的版本加了字段、用户又退回这一版时，写回去不会把它们抹掉）。
 */
export const parseFoliaPlaylistRow = (data: unknown): FoliaPlaylist | null => {
    if (!isRecord(data) || typeof data.id !== 'string' || !data.id) return null;
    const seen = new Set<string>();
    const entries: FoliaPlaylistEntry[] = [];
    (Array.isArray(data.entries) ? data.entries : []).forEach((entry: unknown) => {
        if (!isRecord(entry) || typeof entry.key !== 'string' || !entry.key || !isRecord(entry.song) || seen.has(entry.key)) return;
        seen.add(entry.key);
        const { originalKey: _originalKey, fromOrigin: _fromOrigin, ...entryRest } = entry;
        entries.push({
            ...entryRest,
            key: entry.key,
            song: entry.song as unknown as SongResult,
            addedAt: typeof entry.addedAt === 'number' ? entry.addedAt : 0,
            ...(typeof entry.originalKey === 'string' ? { originalKey: entry.originalKey } : {}),
            ...(entry.fromOrigin === true ? { fromOrigin: true } : {}),
        });
    });
    const origin = parseOrigin(data.origin);
    const isFavorite = data.isFavorite === true;
    const { isFavorite: _isFavorite, origin: _origin, entries: _entries, ...rest } = data;
    return {
        ...rest,
        id: data.id,
        name: typeof data.name === 'string' && data.name ? data.name : (isFavorite ? FAVORITE_PLAYLIST_NAME : UNNAMED_PLAYLIST_NAME),
        createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
        updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
        ...(isFavorite ? { isFavorite: true } : {}),
        ...(origin ? { origin } : {}),
        entries,
    };
};

/** 按 meta 里的先后排；meta 没提到的行（不该有，防着）按建的时间排在后面。 */
export const orderFoliaPlaylists = (playlists: FoliaPlaylist[], order: readonly string[]): FoliaPlaylist[] => {
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...playlists].sort((a, b) => {
        const rankA = rank.get(a.id);
        const rankB = rank.get(b.id);
        if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
        if (rankA !== undefined) return -1;
        if (rankB !== undefined) return 1;
        return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    });
};

const buildLocalEntrySongFromMetadata = (localSong: LocalSong): SongResult => {
    const useImported = localSong.titleOrigin === 'import';
    const artistNames = (useImported ? undefined : localSong.onlineMetadata?.artists.map(artist => artist.name))
        ?? localSong.importedMetadata.artistNames;
    const albumName = (useImported ? undefined : localSong.onlineMetadata?.album?.name) ?? localSong.importedMetadata.albumName ?? '';
    const song: UnifiedSong = {
        id: localSong.id,
        name: localSong.title || localSong.fileName || '',
        artists: artistNames.filter(Boolean).map(name => ({ id: 0, name })),
        album: { id: 0, name: albumName },
        durationMs: typeof localSong.duration === 'number' ? localSong.duration : 0,
        isLocal: true,
        localRef: { songId: localSong.id },
        sourceRef: { kind: 'local', mediaId: localSong.id },
    };
    return toStoredSongSnapshot(song);
};

/**
 * 本地曲库的一条记录在歌单里的样子：只有引用和名字（没有封面、没有文件），显示时以曲库里的记录为准。
 * 这是本地歌没经过播放模型（UnifiedSong）就进歌单时用的：迁移、M3U 导入、从曲库页直接建歌单。
 */
export const buildLocalEntrySong = (localSong: LocalSong): SongResult => {
    try {
        return buildLocalEntrySongFromMetadata(localSong);
    } catch (error) {
        // 曲库里的记录缺了该有的字段（不该发生）：只留引用和名字，不让一条坏记录挡住迁移或红心。
        console.warn('[FoliaPlaylist] A local song record is malformed; keeping the reference only', localSong.id, error);
        const song: UnifiedSong = {
            id: localSong.id,
            name: localSong.title || localSong.fileName || '',
            artists: [],
            album: { id: 0, name: '' },
            durationMs: 0,
            isLocal: true,
            localRef: { songId: localSong.id },
            sourceRef: { kind: 'local', mediaId: localSong.id },
        };
        return toStoredSongSnapshot(song);
    }
};

export const buildLocalEntry = (localSong: LocalSong, addedAt: number): FoliaPlaylistEntry => ({
    key: foliaLocalSongKey(localSong.id),
    song: buildLocalEntrySong(localSong),
    addedAt,
});

/**
 * 修本地歌的条目：曲库里已经没有的那一行删掉；重复导入的副本换成 canonical 那一条，换完重复的只留第一条。
 * 别的来源的条目原样不动。没有变化时返回原数组。
 */
export const repairLocalEntries = (
    entries: readonly FoliaPlaylistEntry[],
    validSongById: ReadonlyMap<string, LocalSong>,
    canonicalByDuplicateKey: ReadonlyMap<string, string>,
): { entries: FoliaPlaylistEntry[]; changed: boolean } => {
    const seen = new Set<string>();
    const repaired: FoliaPlaylistEntry[] = [];

    entries.forEach(entry => {
        const songId = getFoliaEntryLocalSongId(entry);
        let next = entry;
        if (songId !== null) {
            const song = validSongById.get(songId);
            if (!song) return;
            const duplicateKey = getDuplicateImportSongKey(song);
            const canonicalSongId = duplicateKey ? canonicalByDuplicateKey.get(duplicateKey) || songId : songId;
            const canonicalSong = canonicalSongId === songId ? song : validSongById.get(canonicalSongId);
            if (canonicalSong && canonicalSong !== song) next = buildLocalEntry(canonicalSong, entry.addedAt);
        }
        if (seen.has(next.key)) return;
        seen.add(next.key);
        repaired.push(next);
    });

    const changed = repaired.length !== entries.length || repaired.some((entry, index) => entry !== entries[index]);
    return changed ? { entries: repaired, changed } : { entries: entries as FoliaPlaylistEntry[], changed };
};

export const buildLocalRepairIndex = (localSongs: readonly LocalSong[], removedSongIds: readonly string[] = []) => {
    const validSongById = new Map(localSongs.map(song => [song.id, song]));
    removedSongIds.forEach(id => validSongById.delete(id));
    return { validSongById, canonicalByDuplicateKey: buildDuplicateImportCanonicalSongIds(validSongById.values()) };
};
