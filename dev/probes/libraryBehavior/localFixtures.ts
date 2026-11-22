import type { LocalSong } from '../../../src/types';
import type { FoliaPlaylistSummary } from '../../../src/types/foliaPlaylist';
import { getLocalSongs, saveLocalSongs } from '../../../src/services/db';
import { createFoliaPlaylistFromLocalSongs, getFoliaPlaylistSummaries } from '../../../src/services/foliaPlaylist/foliaPlaylistService';
import {
    LOCAL_BASE_TIME,
    LOCAL_PLAYLIST_NAME,
    LOCAL_PLAYLIST_SONGS,
    LOCAL_SONG_COUNT,
    localAlbumName,
    localFolderName,
    localLastModified,
    localSongId,
    localSongTitle,
    localTrackNumber,
    range,
} from './fixtureRules';

// dev/probes/libraryBehavior/localFixtures.ts
// 本地曲库 fixture。非沙盒模式只放在内存里；沙盒模式才写进 IndexedDB，让本地歌单删歌、
// 专辑实体这些依赖真实存储的路径也能跑到。

/** 一首本地歌：文件名、修改时间、专辑号三种排序各给出不同的顺序。 */
export const makeLocalSong = (index: number): LocalSong => {
    const title = localSongTitle(index);
    const folderName = localFolderName(index);
    const fileName = `${String(index).padStart(2, '0')} - ${title}.mp3`;
    return {
        id: localSongId(index),
        fileName,
        filePath: `${folderName}/${fileName}`,
        duration: 200000 + index * 1000,
        fileSize: 1024,
        fileLastModified: localLastModified(index),
        mimeType: 'audio/mpeg',
        addedAt: LOCAL_BASE_TIME + index,
        title,
        titleOrigin: 'import',
        importedMetadata: {
            title,
            titleSource: 'embedded',
            artistNames: ['Local Artist'],
            albumName: localAlbumName(index),
        },
        trackNumber: localTrackNumber(index),
        folderName,
    };
};

export const LOCAL_FIXTURE_SONGS: LocalSong[] = range(LOCAL_SONG_COUNT, 1).map(makeLocalSong);

/** 非沙盒模式下的内存歌单：只有摘要（库里没有它的条目），只用来看首页上的那张卡。 */
export const IN_MEMORY_LOCAL_PLAYLIST: FoliaPlaylistSummary = {
    id: 'probe-memory-playlist',
    name: LOCAL_PLAYLIST_NAME,
    entryCount: LOCAL_PLAYLIST_SONGS.length,
    coverLocalSongIds: LOCAL_PLAYLIST_SONGS.map(index => makeLocalSong(index).id),
    createdAt: LOCAL_BASE_TIME,
    updatedAt: LOCAL_BASE_TIME,
};

/** 把 fixture 写进 IndexedDB（可重复调用），返回存储里的曲目与歌单。 */
export const seedLocalLibrary = async (): Promise<{ songs: LocalSong[]; playlists: FoliaPlaylistSummary[] }> => {
    const stored = await getLocalSongs();
    const storedIds = new Set(stored.map(song => song.id));
    const missing = LOCAL_FIXTURE_SONGS.filter(song => !storedIds.has(song.id));
    if (missing.length > 0) {
        await saveLocalSongs(missing);
    }
    const playlists = await getFoliaPlaylistSummaries();
    if (!playlists.some(playlist => playlist.name === LOCAL_PLAYLIST_NAME)) {
        await createFoliaPlaylistFromLocalSongs(LOCAL_PLAYLIST_NAME, LOCAL_PLAYLIST_SONGS.map(index => makeLocalSong(index)));
    }
    return readLocalLibrary();
};

/** 从 IndexedDB 读回探针用到的曲目与歌单（只取 fixture 自己的那部分）。 */
export const readLocalLibrary = async (): Promise<{ songs: LocalSong[]; playlists: FoliaPlaylistSummary[] }> => {
    const fixtureIds = new Set(LOCAL_FIXTURE_SONGS.map(song => song.id));
    const [songs, playlists] = await Promise.all([getLocalSongs(), getFoliaPlaylistSummaries()]);
    return {
        songs: songs.filter(song => fixtureIds.has(song.id)),
        playlists: playlists.filter(playlist => playlist.name === LOCAL_PLAYLIST_NAME),
    };
};
