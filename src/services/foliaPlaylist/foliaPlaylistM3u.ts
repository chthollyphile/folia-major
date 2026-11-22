import type { LocalSong } from '../../types';
import type { FoliaPlaylist, FoliaPlaylistSummary } from '../../types/foliaPlaylist';
import { createSafeObjectUrl } from '../../utils/blobGuards';
import { sanitizeDownloadFileName } from '../../utils/downloadFileName';
import { getFoliaEntryLocalSongId } from '../../utils/foliaPlaylistEntries';
import { createFoliaPlaylistFromLocalSongs } from './foliaPlaylistService';

// src/services/foliaPlaylist/foliaPlaylistM3u.ts
// Parses, matches, imports, and exports portable M3U playlists for the indexed local library.
// M3U 只装得下本地文件：导入建出来的歌单全是本地歌；导出只写歌单里本地歌的条目，别的来源的跳过并报出跳过了几首。

export interface ParsedM3uPlaylist {
    name?: string;
    paths: string[];
}

export interface LocalPlaylistImportResult {
    playlist: FoliaPlaylistSummary | null;
    matchedSongIds: string[];
    unmatchedPaths: string[];
    ambiguousPaths: string[];
}

const M3U_COMMENT_PREFIX = '#';
const M3U_PLAYLIST_NAME_PREFIX = '#PLAYLIST:';

const sanitizeM3uText = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

const stripWrappingQuotes = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length >= 2 && (
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    )) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
};

const decodePath = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

// Converts file URLs, Windows paths, and relative paths into one slash-separated comparison form.
export const normalizeM3uPath = (rawPath: string): string | null => {
    let path = stripWrappingQuotes(rawPath).replace(/^\uFEFF/, '');
    if (!path) return null;

    if (/^file:\/\//i.test(path)) {
        try {
            path = new URL(path).pathname;
        } catch {
            path = path.replace(/^file:\/\/+?/i, '');
        }
    } else if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
        return null;
    }

    path = decodePath(path).replace(/\\/g, '/').replace(/^\/[a-z]:\//i, '').replace(/^[a-z]:\//i, '');
    const segments: string[] = [];
    path.split('/').forEach(segment => {
        const trimmed = segment.trim();
        if (!trimmed || trimmed === '.') return;
        if (trimmed === '..') {
            segments.pop();
            return;
        }
        segments.push(trimmed);
    });

    return segments.length > 0 ? segments.join('/') : null;
};

export const parseM3uPlaylist = (text: string): ParsedM3uPlaylist => {
    let name: string | undefined;
    const paths: string[] = [];

    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach(rawLine => {
        const line = rawLine.trim();
        if (!line) return;
        if (line.toUpperCase().startsWith(M3U_PLAYLIST_NAME_PREFIX)) {
            const candidate = line.slice(M3U_PLAYLIST_NAME_PREFIX.length).trim();
            if (candidate) name = candidate;
            return;
        }
        if (!line.startsWith(M3U_COMMENT_PREFIX)) {
            paths.push(line);
        }
    });

    return { name, paths };
};

const getPathWithoutImportedRoot = (path: string): string => {
    const separatorIndex = path.indexOf('/');
    return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
};

const addCandidate = (map: Map<string, LocalSong[]>, path: string, song: LocalSong): void => {
    const key = path.toLocaleLowerCase();
    const current = map.get(key) || [];
    if (!current.some(candidate => candidate.id === song.id)) {
        map.set(key, [...current, song]);
    }
};

export const matchM3uPathsToLocalSongs = (
    paths: string[],
    localSongs: LocalSong[],
): Omit<LocalPlaylistImportResult, 'playlist'> => {
    const exactCandidates = new Map<string, LocalSong[]>();
    const normalizedSongs = localSongs.flatMap(song => {
        const fullPath = normalizeM3uPath(song.filePath);
        if (!fullPath) return [];
        const relativePath = getPathWithoutImportedRoot(fullPath);
        addCandidate(exactCandidates, fullPath, song);
        addCandidate(exactCandidates, relativePath, song);
        addCandidate(exactCandidates, fullPath.split('/').pop() || fullPath, song);
        return [{ song, fullPath, relativePath }];
    });
    const matchedSongIds: string[] = [];
    const matchedSongIdSet = new Set<string>();
    const unmatchedPaths: string[] = [];
    const ambiguousPaths: string[] = [];

    paths.forEach(rawPath => {
        const path = normalizeM3uPath(rawPath);
        if (!path) {
            unmatchedPaths.push(rawPath);
            return;
        }

        let candidates = exactCandidates.get(path.toLocaleLowerCase()) || [];
        if (candidates.length === 0 && path.includes('/')) {
            const foldedPath = path.toLocaleLowerCase();
            candidates = normalizedSongs
                .filter(({ fullPath, relativePath }) => {
                    const foldedFullPath = fullPath.toLocaleLowerCase();
                    const foldedRelativePath = relativePath.toLocaleLowerCase();
                    return foldedFullPath.endsWith(`/${foldedPath}`)
                        || foldedPath.endsWith(`/${foldedFullPath}`)
                        || foldedPath.endsWith(`/${foldedRelativePath}`);
                })
                .map(({ song }) => song);
        }

        const uniqueCandidates = Array.from(new Map(candidates.map(song => [song.id, song])).values());
        if (uniqueCandidates.length === 0) {
            unmatchedPaths.push(rawPath);
            return;
        }
        if (uniqueCandidates.length > 1) {
            ambiguousPaths.push(rawPath);
            return;
        }

        const songId = uniqueCandidates[0].id;
        if (!matchedSongIdSet.has(songId)) {
            matchedSongIdSet.add(songId);
            matchedSongIds.push(songId);
        }
    });

    return { matchedSongIds, unmatchedPaths, ambiguousPaths };
};

const getPlaylistNameFromFile = (fileName: string): string => (
    fileName.replace(/\.m3u8?$/i, '').trim() || 'Imported Playlist'
);

export const importLocalPlaylistFile = async (
    file: File,
    localSongs: LocalSong[],
): Promise<LocalPlaylistImportResult> => {
    const parsed = parseM3uPlaylist(await file.text());
    const matched = matchM3uPathsToLocalSongs(parsed.paths, localSongs);
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const matchedSongs = matched.matchedSongIds
        .map(songId => songsById.get(songId))
        .filter((song): song is LocalSong => Boolean(song));
    const playlist = matchedSongs.length > 0
        ? await createFoliaPlaylistFromLocalSongs(parsed.name?.trim() || getPlaylistNameFromFile(file.name), matchedSongs)
        : null;

    return { playlist, ...matched };
};

const getExportPath = (song: LocalSong, sharedRoot: string | null): string => {
    const path = normalizeM3uPath(song.filePath) || song.filePath.replace(/\\/g, '/');
    return sharedRoot && path.startsWith(`${sharedRoot}/`)
        ? path.slice(sharedRoot.length + 1)
        : path;
};

export interface FoliaPlaylistM3uExport {
    content: string;
    exportedCount: number;
    /** 没写进去的条目：别的来源的歌，和曲库里找不到的本地歌。 */
    skippedCount: number;
}

export const serializeFoliaPlaylistToM3u8 = (
    playlist: FoliaPlaylist,
    localSongs: LocalSong[],
): FoliaPlaylistM3uExport => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const songs = playlist.entries
        .map(entry => {
            const songId = getFoliaEntryLocalSongId(entry);
            return songId === null ? undefined : songsById.get(songId);
        })
        .filter((song): song is LocalSong => Boolean(song));
    const roots = new Set(songs.map(song => normalizeM3uPath(song.filePath)?.split('/')[0]).filter(Boolean));
    const sharedRoot = roots.size === 1 ? Array.from(roots)[0] || null : null;
    const lines = ['#EXTM3U', `#PLAYLIST:${sanitizeM3uText(playlist.name)}`];

    songs.forEach(song => {
        const onlineArtists = song.onlineMetadata?.artists.map(artist => artist.name).filter(Boolean) || [];
        const artists = onlineArtists.length > 0 ? onlineArtists : song.importedMetadata.artistNames;
        const displayName = sanitizeM3uText([artists.join(', '), song.title].filter(Boolean).join(' - '));
        lines.push(`#EXTINF:${Math.max(0, Math.round(song.duration / 1000))},${displayName}`);
        lines.push(getExportPath(song, sharedRoot));
    });

    return {
        content: `${lines.join('\r\n')}\r\n`,
        exportedCount: songs.length,
        skippedCount: playlist.entries.length - songs.length,
    };
};

/** 下载歌单的 .m3u8；返回写进去几首、跳过了几首。 */
export const downloadFoliaPlaylistM3u8 = (playlist: FoliaPlaylist, localSongs: LocalSong[]): FoliaPlaylistM3uExport => {
    const exported = serializeFoliaPlaylistToM3u8(playlist, localSongs);
    const blob = new Blob([exported.content], { type: 'application/vnd.apple.mpegurl;charset=utf-8' });
    const url = createSafeObjectUrl(blob);
    if (!url) throw new Error('Failed to create playlist download');

    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeDownloadFileName(playlist.name, 'playlist')}.m3u8`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return exported;
};
