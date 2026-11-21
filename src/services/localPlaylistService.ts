import { LocalPlaylist, LocalSong } from '../types';
import { getLocalSongs } from './db';
import { appDatabase } from './appDatabase';
import { getCacheTableName, putCacheEntry, readCacheEntry } from './repositories/cacheRepository';

const LOCAL_PLAYLISTS_CACHE_KEY = 'local_playlists';
const FAVORITE_PLAYLIST_NAME = 'Liked Songs';
const UNNAMED_PLAYLIST_NAME = 'Untitled Playlist';

const createPlaylistId = () => `local_playlist_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

type LegacyPlaylistSongRef = string | Pick<LocalSong, 'id'> | null | undefined;
type LegacyLocalPlaylist = Partial<LocalPlaylist> & {
    songs?: LegacyPlaylistSongRef[];
    tracks?: LegacyPlaylistSongRef[];
    trackIds?: string[];
};

const dedupeSongIds = (songIds: string[]) => {
    const seen = new Set<string>();
    const deduped: string[] = [];

    songIds.forEach(songId => {
        if (!songId || seen.has(songId)) {
            return;
        }

        seen.add(songId);
        deduped.push(songId);
    });

    return deduped;
};

const DUPLICATE_IMPORT_ROOT_SUFFIX = /\s\(\d+\)$/;

const getRootFolderName = (song: LocalSong): string => {
    const pathLike = song.filePath || song.folderName || '';
    return pathLike.split('/')[0] || '';
};

const getDuplicateImportRootBase = (rootFolderName: string): string => (
    rootFolderName.replace(DUPLICATE_IMPORT_ROOT_SUFFIX, '')
);

const getRelativePathWithoutRoot = (song: LocalSong): string | null => {
    if (!song.filePath) {
        return null;
    }

    const rootFolderName = getRootFolderName(song);
    return rootFolderName && song.filePath.startsWith(`${rootFolderName}/`)
        ? song.filePath.slice(rootFolderName.length + 1)
        : song.filePath;
};

const getDuplicateImportSongKey = (song: LocalSong): string | null => {
    const relativePath = getRelativePathWithoutRoot(song);
    if (!relativePath || typeof song.fileSize !== 'number' || typeof song.fileLastModified !== 'number') {
        return null;
    }

    return `${getDuplicateImportRootBase(getRootFolderName(song))}::${relativePath}::${song.fileSize}::${song.fileLastModified}`;
};

const isPreferredDuplicateImportCanonical = (candidate: LocalSong, current: LocalSong): boolean => {
    const candidateRoot = getRootFolderName(candidate);
    const currentRoot = getRootFolderName(current);
    const candidateLooksDuplicated = DUPLICATE_IMPORT_ROOT_SUFFIX.test(candidateRoot);
    const currentLooksDuplicated = DUPLICATE_IMPORT_ROOT_SUFFIX.test(currentRoot);

    if (candidateLooksDuplicated !== currentLooksDuplicated) {
        return !candidateLooksDuplicated;
    }

    if ((candidate.addedAt || 0) !== (current.addedAt || 0)) {
        return (candidate.addedAt || 0) < (current.addedAt || 0);
    }

    return candidate.id.localeCompare(current.id) < 0;
};

const buildDuplicateImportCanonicalSongIds = (songs: Iterable<LocalSong>): Map<string, string> => {
    const canonicalSongs = new Map<string, LocalSong>();

    for (const song of songs) {
        const duplicateKey = getDuplicateImportSongKey(song);
        if (!duplicateKey) {
            continue;
        }

        const currentCanonical = canonicalSongs.get(duplicateKey);
        if (!currentCanonical || isPreferredDuplicateImportCanonical(song, currentCanonical)) {
            canonicalSongs.set(duplicateKey, song);
        }
    }

    return new Map(Array.from(canonicalSongs.entries()).map(([duplicateKey, song]) => [duplicateKey, song.id]));
};

/**
 * 歌单里存的是"重复导入组"的 canonical id（见 repairPlaylistSongIds），而正在播放的可能是同一文件
 * 的另一份副本。判断收藏和写入收藏都必须先换算到同一把尺子，否则写进去的 id 和读出来的对不上。
 */
export const buildCanonicalLocalSongIdIndex = (songs: LocalSong[]): Map<string, string> => {
    const canonicalByDuplicateKey = buildDuplicateImportCanonicalSongIds(songs);
    const index = new Map<string, string>();

    songs.forEach(song => {
        const duplicateKey = getDuplicateImportSongKey(song);
        const canonicalSongId = duplicateKey ? canonicalByDuplicateKey.get(duplicateKey) : undefined;
        if (canonicalSongId && canonicalSongId !== song.id) {
            index.set(song.id, canonicalSongId);
        }
    });

    return index;
};

export const resolveCanonicalLocalSongId = (songId: string, songs: LocalSong[]): string => {
    const song = songs.find(candidate => candidate.id === songId);
    if (!song) {
        return songId;
    }

    const duplicateKey = getDuplicateImportSongKey(song);
    if (!duplicateKey) {
        return songId;
    }

    return buildDuplicateImportCanonicalSongIds(songs).get(duplicateKey) || songId;
};

const repairPlaylistSongIds = (
    songIds: string[],
    validSongById: Map<string, LocalSong>,
    duplicateCanonicalSongIds: Map<string, string>
): { songIds: string[]; changed: boolean; } => {
    const seen = new Set<string>();
    const repairedSongIds: string[] = [];
    let changed = false;

    songIds.forEach(songId => {
        const song = validSongById.get(songId);
        if (!song) {
            changed = true;
            return;
        }

        const duplicateKey = getDuplicateImportSongKey(song);
        const canonicalSongId = duplicateKey ? duplicateCanonicalSongIds.get(duplicateKey) || songId : songId;
        if (canonicalSongId !== songId) {
            changed = true;
        }

        if (seen.has(canonicalSongId)) {
            changed = true;
            return;
        }

        seen.add(canonicalSongId);
        repairedSongIds.push(canonicalSongId);
    });

    return { songIds: repairedSongIds, changed };
};

const normalizeSongIdRef = (value: LegacyPlaylistSongRef): string | null => {
    if (typeof value === 'string') {
        return value;
    }

    if (value && typeof value === 'object' && typeof value.id === 'string') {
        return value.id;
    }

    return null;
};

// Reads legacy playlist payloads and converts them into the current song-id-only shape.
const resolvePlaylistSongIds = (playlist: LegacyLocalPlaylist): string[] => {
    const candidateCollections: LegacyPlaylistSongRef[][] = [];

    if (Array.isArray(playlist.songIds)) {
        candidateCollections.push(playlist.songIds as LegacyPlaylistSongRef[]);
    }

    if (Array.isArray(playlist.trackIds)) {
        candidateCollections.push(playlist.trackIds);
    }

    if (Array.isArray(playlist.songs)) {
        candidateCollections.push(playlist.songs);
    }

    if (Array.isArray(playlist.tracks)) {
        candidateCollections.push(playlist.tracks);
    }

    for (const collection of candidateCollections) {
        const normalized = dedupeSongIds(
            collection
                .map(normalizeSongIdRef)
                .filter((songId): songId is string => Boolean(songId))
        );

        if (normalized.length > 0) {
            return normalized;
        }
    }

    return [];
};

const normalizePlaylist = (playlist: LegacyLocalPlaylist): LocalPlaylist => ({
    id: typeof playlist.id === 'string' && playlist.id ? playlist.id : createPlaylistId(),
    name: typeof playlist.name === 'string' && playlist.name
        ? playlist.name
        : (playlist.isFavorite ? FAVORITE_PLAYLIST_NAME : UNNAMED_PLAYLIST_NAME),
    songIds: resolvePlaylistSongIds(playlist),
    createdAt: typeof playlist.createdAt === 'number' ? playlist.createdAt : Date.now(),
    updatedAt: typeof playlist.updatedAt === 'number' ? playlist.updatedAt : Date.now(),
    isFavorite: Boolean(playlist.isFavorite),
});

const playlistNeedsNormalization = (playlist: LegacyLocalPlaylist): boolean => {
    if (!Array.isArray(playlist.songIds)) {
        return true;
    }

    if (Array.isArray(playlist.songs) || Array.isArray(playlist.tracks) || Array.isArray(playlist.trackIds)) {
        return true;
    }

    const normalizedSongIds = resolvePlaylistSongIds(playlist);
    if (normalizedSongIds.length !== playlist.songIds.length) {
        return true;
    }

    if (normalizedSongIds.some((songId, index) => songId !== playlist.songIds?.[index])) {
        return true;
    }

    return typeof playlist.createdAt !== 'number' || typeof playlist.updatedAt !== 'number';
};

const persistPlaylists = async (playlists: LocalPlaylist[]) => {
    await putCacheEntry(LOCAL_PLAYLISTS_CACHE_KEY, playlists.map(normalizePlaylist));
};

const readPlaylists = async (removedSongIds: readonly string[] = []): Promise<LocalPlaylist[]> => {
    const cached = await readCacheEntry<LegacyLocalPlaylist[]>(LOCAL_PLAYLISTS_CACHE_KEY);
    const cachedPlaylists = Array.isArray(cached) ? cached : [];
    const localSongs = await appDatabase.local_music.toArray();
    const validSongById = new Map(localSongs.map(song => [song.id, song]));
    removedSongIds.forEach(id => validSongById.delete(id));
    const duplicateCanonicalSongIds = buildDuplicateImportCanonicalSongIds(validSongById.values());
    let shouldPersist = cachedPlaylists.some(playlistNeedsNormalization);
    const playlists = cachedPlaylists.map(normalizePlaylist).map(playlist => {
        const repaired = repairPlaylistSongIds(playlist.songIds, validSongById, duplicateCanonicalSongIds);
        if (repaired.changed) {
            shouldPersist = true;
            return {
                ...playlist,
                songIds: repaired.songIds,
            };
        }

        return playlist;
    });

    const favoritePlaylist = playlists.find(playlist => playlist.isFavorite);
    if (!favoritePlaylist) {
        const nextPlaylists: LocalPlaylist[] = [
            {
                id: createPlaylistId(),
                name: FAVORITE_PLAYLIST_NAME,
                songIds: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isFavorite: true,
            },
            ...playlists,
        ];
        await persistPlaylists(nextPlaylists);
        return nextPlaylists;
    }

    if (shouldPersist) {
        await persistPlaylists(playlists);
    }

    return playlists;
};

// All playlists share one cache row. Hold its transaction through repair and mutation, including across windows.
const withPlaylistTransaction = <T>(operation: () => Promise<T>): Promise<T> => appDatabase.transaction(
    'rw', getCacheTableName(LOCAL_PLAYLISTS_CACHE_KEY), appDatabase.local_music, operation,
);

export const getLocalPlaylists = (): Promise<LocalPlaylist[]> => withPlaylistTransaction(() => readPlaylists());

export const removeDeletedSongIdsFromPlaylists = async (songIds: string[]): Promise<void> => {
    if (songIds.length) await withPlaylistTransaction(() => readPlaylists(songIds));
};

export const createLocalPlaylist = (name: string, songs: LocalSong[] = []): Promise<LocalPlaylist> => withPlaylistTransaction(async () => {
    const playlists = await readPlaylists();
    const now = Date.now();
    const playlist: LocalPlaylist = {
        id: createPlaylistId(),
        name: name.trim(),
        songIds: dedupeSongIds(songs.map(song => song.id)),
        createdAt: now,
        updatedAt: now,
    };

    await persistPlaylists([...playlists, playlist]);
    return playlist;
});

export const updateLocalPlaylist = (
    playlistId: string,
    updater: (playlist: LocalPlaylist) => LocalPlaylist | null
): Promise<LocalPlaylist | null> => withPlaylistTransaction(async () => {
    const playlists = await readPlaylists();
    const index = playlists.findIndex(playlist => playlist.id === playlistId);
    if (index === -1) return null;
    const update = updater(playlists[index]);
    if (!update) return null;

    const updatedPlaylist = normalizePlaylist({ ...update, updatedAt: Date.now() });
    playlists[index] = updatedPlaylist;
    await persistPlaylists(playlists);
    return updatedPlaylist;
});

export const deleteLocalPlaylist = (playlistId: string): Promise<void> => withPlaylistTransaction(async () => {
    const playlists = await readPlaylists();
    const target = playlists.find(playlist => playlist.id === playlistId);
    if (!target || target.isFavorite) {
        return;
    }

    await persistPlaylists(playlists.filter(playlist => playlist.id !== playlistId));
});

export const canDeleteLocalPlaylist = (playlist: LocalPlaylist | null | undefined): boolean => {
    return Boolean(playlist && !playlist.isFavorite);
};

const addSongIdsToLocalPlaylist = async (playlistId: string, songIds: string[]): Promise<LocalPlaylist | null> => (
    updateLocalPlaylist(playlistId, playlist => ({
        ...playlist,
        songIds: dedupeSongIds([...playlist.songIds, ...songIds]),
    }))
);

export const addSongsToLocalPlaylist = async (playlistId: string, songs: LocalSong[]): Promise<LocalPlaylist | null> => (
    addSongIdsToLocalPlaylist(playlistId, songs.map(song => song.id))
);

export const removeSongsFromLocalPlaylist = async (playlistId: string, songIds: string[]): Promise<LocalPlaylist | null> => {
    const removingIds = new Set(songIds);
    return updateLocalPlaylist(playlistId, playlist => ({
        ...playlist,
        songIds: playlist.songIds.filter(songId => !removingIds.has(songId)),
    }));
};

// Reject stale drafts and require a permutation so sorting cannot add, drop or duplicate songs.
export const reorderLocalPlaylistSongs = (
    playlistId: string,
    songIds: readonly string[],
    expectedSongIds: readonly string[],
): Promise<LocalPlaylist | null> => updateLocalPlaylist(playlistId, playlist => {
    const current = playlist.songIds;
    if (current.length !== expectedSongIds.length || current.some((id, index) => id !== expectedSongIds[index])) {
        return null;
    }
    const nextIds = new Set(songIds);
    if (songIds.length !== current.length || current.some(id => !nextIds.has(id))) return null;
    return { ...playlist, songIds: [...songIds] };
});

export const getFavoriteLocalPlaylist = async (): Promise<LocalPlaylist> => {
    const playlists = await getLocalPlaylists();
    const favoritePlaylist = playlists.find(playlist => playlist.isFavorite);

    if (!favoritePlaylist) {
        const created = await createLocalPlaylist(FAVORITE_PLAYLIST_NAME);
        return {
            ...created,
            isFavorite: true,
        };
    }

    return favoritePlaylist;
};

export const setLocalSongFavorite = async (song: LocalSong, shouldFavorite: boolean): Promise<LocalPlaylist | null> => {
    const favoritePlaylist = await getFavoriteLocalPlaylist();
    const canonicalSongId = resolveCanonicalLocalSongId(song.id, await getLocalSongs());

    if (shouldFavorite) {
        return addSongIdsToLocalPlaylist(favoritePlaylist.id, [canonicalSongId]);
    }

    return removeSongsFromLocalPlaylist(favoritePlaylist.id, [canonicalSongId]);
};
