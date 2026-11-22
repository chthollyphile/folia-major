import type { LocalSong } from '../../types';
import type { FoliaPlaylist, FoliaPlaylistAddResult, FoliaPlaylistSummary } from '../../types/foliaPlaylist';
import type { FoliaEntryAvailabilityDeps } from '../../library/core/foliaPlaylist/foliaPlaylist.contract';
import { createSafeObjectUrl } from '../../utils/blobGuards';
import { sanitizeDownloadFileName } from '../../utils/downloadFileName';
import { getNavidromeConfig, navidromeApi } from '../navidromeService';
import { omni } from '../onlineMusic/omni';
import {
    FOLIA_PLAYLIST_FILE_EXTENSION,
    FOLIA_PLAYLIST_FILE_MAX_BYTES,
    FOLIA_PLAYLIST_FILE_MAX_ENTRIES,
    detectPlaylistFileFormat,
    parseFoliaPlaylistFile,
    previewFoliaPlaylistFile,
    serializeFoliaPlaylistFile,
    type FoliaFileNavidromeUrls,
    type FoliaPlaylistFileError,
    type FoliaPlaylistFileExport,
    type FoliaPlaylistFilePreview,
} from './foliaPlaylistFile';
import { matchM3uPathsToLocalSongs, parseM3uPlaylist, serializeFoliaPlaylistToM3u8, type FoliaPlaylistM3uExport } from './foliaPlaylistM3u';
import {
    addLocalSongsToFoliaPlaylist,
    addSongsToFoliaPlaylist,
    createFoliaPlaylistFromEntries,
    createFoliaPlaylistFromLocalSongs,
} from './foliaPlaylistService';

// src/services/foliaPlaylist/foliaPlaylistFileIo.ts
// 歌单文件的进出：导出成 JSON 或 M3U8（下载），读一个文件并认出是哪种、给出预览，确认之后才写歌单。
// 规则在 foliaPlaylistFile.ts（JSON）与 foliaPlaylistM3u.ts（M3U）；这里接上曲库、音源的状态、Navidrome 的配置和下载。
// 读文件只读不写：预览出来之前、用户取消、文件不对，歌单都不动。

const downloadText = (content: string, fileName: string, mimeType: string): void => {
    const url = createSafeObjectUrl(new Blob([content], { type: mimeType }));
    if (!url) throw new Error('Failed to create playlist download');
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** 导出之前先算一遍两种格式各写得进几首（导出窗口里要写明）。 */
export const describeFoliaPlaylistExports = (
    playlist: FoliaPlaylist,
    localSongs: readonly LocalSong[],
    name: string,
): { json: FoliaPlaylistFileExport; m3u: FoliaPlaylistM3uExport } => ({
    json: serializeFoliaPlaylistFile(playlist, localSongs, { name }),
    m3u: serializeFoliaPlaylistToM3u8({ ...playlist, name }, [...localSongs]),
});

/** 下载歌单的 JSON 文件；`name` 是给人看的歌单名（「我喜欢的音乐」用翻译过的名字）。 */
export const downloadFoliaPlaylistJson = (playlist: FoliaPlaylist, localSongs: readonly LocalSong[], name: string): FoliaPlaylistFileExport => {
    const exported = serializeFoliaPlaylistFile(playlist, localSongs, { name });
    downloadText(exported.content, `${sanitizeDownloadFileName(name, 'playlist')}${FOLIA_PLAYLIST_FILE_EXTENSION}`, 'application/json;charset=utf-8');
    return exported;
};

/** 下载歌单的 .m3u8（只有本地歌）。 */
export const downloadFoliaPlaylistM3u = (playlist: FoliaPlaylist, localSongs: readonly LocalSong[], name: string): FoliaPlaylistM3uExport => {
    const exported = serializeFoliaPlaylistToM3u8({ ...playlist, name }, [...localSongs]);
    downloadText(exported.content, `${sanitizeDownloadFileName(name, 'playlist')}.m3u8`, 'application/vnd.apple.mpegurl;charset=utf-8');
    return exported;
};

export type PlaylistFileReadError = FoliaPlaylistFileError | 'unknown-format' | 'unreadable';

export type PlaylistFileReading =
    | { format: 'json'; preview: FoliaPlaylistFilePreview }
    | {
        format: 'm3u';
        /** 文件里写的歌单名；没写就是 ''。 */
        name: string;
        /** 文件里的路径数。 */
        total: number;
        /** 对上了曲库里唯一一首歌的，按文件里的顺序。 */
        matchedSongs: LocalSong[];
        /** 没对上的，和对上不止一首的。 */
        skippedCount: number;
    }
    | { format: 'error'; error: PlaylistFileReadError };

const availabilityDeps = (): FoliaEntryAvailabilityDeps => ({
    hasLocalSong: () => true,
    isSourceRegistered: sourceId => omni.getProviderNaming(sourceId) !== null,
    isSourceSwitchedOn: sourceId => omni.isSourceSwitchedOn(sourceId),
    isNavidromeConfigured: () => getNavidromeConfig() !== null,
});

const navidromeUrls = (): FoliaFileNavidromeUrls | null => {
    const config = getNavidromeConfig();
    return config ? {
        stream: songId => navidromeApi.getStreamUrl(config, songId),
        coverArt: coverArtId => navidromeApi.getCoverArtUrl(config, coverArtId, 600),
    } : null;
};

/** 认出一段文件内容是哪种歌单并给出预览。不写任何东西。 */
export const readPlaylistFileText = (text: string, localSongs: readonly LocalSong[]): PlaylistFileReading => {
    const format = detectPlaylistFileFormat(text);
    if (format === 'json') {
        const parsed = parseFoliaPlaylistFile(text);
        if (!parsed.ok) return { format: 'error', error: parsed.error };
        return { format: 'json', preview: previewFoliaPlaylistFile(parsed.file, localSongs, availabilityDeps(), navidromeUrls()) };
    }
    if (format === 'm3u') {
        const parsed = parseM3uPlaylist(text);
        // 和 JSON 一样的条目上限：每条路径都要对着曲库找一遍。
        if (parsed.paths.length > FOLIA_PLAYLIST_FILE_MAX_ENTRIES) return { format: 'error', error: 'too-large' };
        const matched = matchM3uPathsToLocalSongs(parsed.paths, [...localSongs]);
        const songsById = new Map(localSongs.map(song => [song.id, song]));
        return {
            format: 'm3u',
            name: parsed.name?.trim() ?? '',
            total: parsed.paths.length,
            matchedSongs: matched.matchedSongIds.flatMap(songId => songsById.get(songId) ?? []),
            skippedCount: matched.unmatchedPaths.length + matched.ambiguousPaths.length,
        };
    }
    return { format: 'error', error: 'unknown-format' };
};

/** 读一个歌单文件：先看大小，再按内容认格式（不只看扩展名）。不写任何东西。 */
export const readPlaylistFile = async (file: File, localSongs: readonly LocalSong[]): Promise<PlaylistFileReading> => {
    if (file.size > FOLIA_PLAYLIST_FILE_MAX_BYTES) return { format: 'error', error: 'too-large' };
    try {
        return readPlaylistFileText(await file.text(), localSongs);
    } catch (error) {
        // 读不出文件，或者预览时出了错（比如 Navidrome 的服务器地址写坏了，拼不出地址）。
        console.warn('[FoliaPlaylist] Could not read a playlist file', error);
        return { format: 'error', error: 'unreadable' };
    }
};

/** 一次读入里能写进歌单的歌数。 */
export const countImportableSongs = (reading: PlaylistFileReading): number => (
    reading.format === 'json' ? reading.preview.entries.length : reading.format === 'm3u' ? reading.matchedSongs.length : 0
);

/**
 * 把预览过的文件写成歌单。`mergeInto` 给了：并进那张已有的歌单（已在里面的不重复加，并进去的算用户自己加的，
 * 不带「跟着原歌单」的标记，也不改那张歌单的出处）；没给：新建一张，条目带着文件里的加入时间、换过来源的记号和出处
 * （出处由服务层标成「文件说的、还没确认」）。
 */
export const importPlaylistFileReading = async (
    reading: Exclude<PlaylistFileReading, { format: 'error' }>,
    options: { name: string; mergeInto?: string },
): Promise<{ playlist: FoliaPlaylistSummary | null; result: FoliaPlaylistAddResult }> => {
    if (options.mergeInto) {
        return reading.format === 'json'
            ? addSongsToFoliaPlaylist(options.mergeInto, reading.preview.entries.map(entry => entry.song))
            : addLocalSongsToFoliaPlaylist(options.mergeInto, reading.matchedSongs);
    }
    const playlist = reading.format === 'json'
        ? await createFoliaPlaylistFromEntries(options.name, reading.preview.entries, { origin: reading.preview.origin })
        : await createFoliaPlaylistFromLocalSongs(options.name, reading.matchedSongs);
    return { playlist, result: { added: playlist.entryCount, duplicates: 0, rejected: 0 } };
};
