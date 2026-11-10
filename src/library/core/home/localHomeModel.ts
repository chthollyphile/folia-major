import type { TFunction } from 'i18next';
import { LocalLibraryGroup, LocalPlaylist, LocalSong } from '../../../types';
import { sortLocalAlbumSongs, sortLocalFolderSongs } from '../../../utils/localSongSorting';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../../../types/localLibrary';
import { getActiveEntities } from '../../../utils/localLibraryIndex';
import type { LibraryDirectorySelectionType } from '../directory/directory.contract';
import type { LibraryHomeActionsSnapshot, LibraryHomeCard, LibraryHomeListAction } from './homeModel.contract';
import { isHomeImportBusy } from './homeSources';

// src/library/core/home/localHomeModel.ts
// Builds local-library overview groups for the desktop Grid3D surface.
// P3.3 起放在 core（原 suites/grid/home/localGrid3DModel.ts）：本地页签的分组（文件夹含虚拟「全部歌曲」、专辑、
// 歌手、歌单）、四个 section 的定义、卡片视图模型、批量 section、右上角三个导入动作——任何 suite 的首页共用。
// 本地封面的 URL 由调用方注入（解析封面资源要看运行环境，属于 service），这里保持纯函数。

/** 本地封面资源 id → URL（services/localCoverAssetUrl 的 getLocalCoverAssetUrl）。 */
export type LocalCoverAssetUrlResolver = (assetId: string | undefined, size?: number) => string | null;

/** 一组本地歌的自动封面（最近加入、带封面的那首的封面）。集合封面对话框预览「恢复默认」后的样子也用它。 */
export const getLocalCoverUrl = (songs: LocalSong[], coverAssetUrl: LocalCoverAssetUrlResolver): string | undefined => {
    const sortedSongs = [...songs].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const preferredSong = sortedSongs.find(song => {
        const hasEmbeddedCover = Boolean(coverAssetUrl(song.localCoverAssetId));
        if (song.useOnlineCover) {
            return song.onlineMetadata?.coverUrl || hasEmbeddedCover;
        }
        return hasEmbeddedCover || song.onlineMetadata?.coverUrl;
    });

    if (!preferredSong) return undefined;

    const localCoverUrl = coverAssetUrl(preferredSong.localCoverAssetId, 512) || undefined;
    if (preferredSong.useOnlineCover) {
        return preferredSong.onlineMetadata?.coverUrl || localCoverUrl;
    }

    return localCoverUrl || preferredSong.onlineMetadata?.coverUrl;
};

/** 文件夹页签最前面那张虚拟的「全部歌曲」卡的 id。 */
export const LOCAL_ALL_SONGS_ID = 'folder-__all-songs__';

const sortByName = <T extends { name: string }>(items: T[]) => (
    items.sort((a, b) => a.name.localeCompare(b.name))
);

/** 本地页签的四组条目。catalog（曲库实体）读好之前按歌曲的原始标签分专辑 / 歌手。 */
export const buildLocalHomeGroups = (
    localSongs: LocalSong[],
    localPlaylists: LocalPlaylist[],
    t: TFunction,
    catalog: { entities: LocalLibraryEntity[]; assignments: LocalLibraryAssignment[]; } | undefined,
    coverAssetUrl: LocalCoverAssetUrlResolver,
) => {
    const getLocalCoverUrlOf = (songs: LocalSong[]) => getLocalCoverUrl(songs, coverAssetUrl);
    const folders: Record<string, LocalSong[]> = {};
    const albums: Record<string, LocalSong[]> = {};
    const artists: Record<string, LocalSong[]> = {};

    localSongs.forEach(song => {
        if (song.folderName) {
            folders[song.folderName] = folders[song.folderName] || [];
            folders[song.folderName].push(song);
        }

        if (!catalog) {
            const albumName = song.onlineMetadata?.album?.name || song.importedMetadata.albumName || t('localMusic.unknownAlbum');
            const albumKey = song.onlineMetadata?.albumId ? `matched-${song.onlineMetadata.albumId}` : albumName;
            albums[albumKey] = albums[albumKey] || [];
            albums[albumKey].push(song);

            const artistName = song.onlineMetadata?.artists.map(artist => artist.name).join(', ')
                || song.importedMetadata.artistNames.join(', ')
                || t('localMusic.unknownArtist');
            artists[artistName] = artists[artistName] || [];
            artists[artistName].push(song);
        }
    });

    const folderList: LocalLibraryGroup[] = sortByName(Object.entries(folders).map(([name, songs]) => ({
        type: 'folder' as const,
        name,
        songs: sortLocalFolderSongs(songs),
        coverUrl: getLocalCoverUrlOf(songs),
        id: `folder-${name}`,
        trackCount: songs.length,
        description: t('localMusic.folder'),
    })));

    if (localSongs.length > 0) {
        folderList.unshift({
            type: 'folder',
            name: t('localMusic.allSongs') || 'All Songs',
            songs: sortLocalFolderSongs(localSongs),
            coverUrl: getLocalCoverUrlOf(localSongs),
            id: LOCAL_ALL_SONGS_ID,
            isVirtual: true,
            trackCount: localSongs.length,
            description: t('localMusic.folder'),
        });
    }

    const legacyAlbumList: LocalLibraryGroup[] = sortByName(Object.entries(albums).map(([key, songs]) => {
        const firstSong = songs[0];
        const albumName = firstSong?.onlineMetadata?.album?.name || firstSong?.importedMetadata.albumName || t('localMusic.unknownAlbum');
        return {
            type: 'album' as const,
            name: albumName,
            songs: sortLocalAlbumSongs(songs),
            coverUrl: getLocalCoverUrlOf(songs),
            id: `album-${key}`,
            trackCount: songs.length,
            description: firstSong?.onlineMetadata?.artists.map(artist => artist.name).join(', ')
                || firstSong?.importedMetadata.artistNames.join(', ')
                || t('localMusic.unknownArtist'),
            albumId: typeof firstSong?.onlineMetadata?.albumId === 'number' ? firstSong.onlineMetadata.albumId : undefined,
        };
    }));

    const legacyArtistList: LocalLibraryGroup[] = sortByName(Object.entries(artists).map(([name, songs]) => ({
        type: 'artist' as const,
        name,
        songs,
        coverUrl: getLocalCoverUrlOf(songs),
        id: `artist-${name}`,
        trackCount: songs.length,
        description: t('localMusic.artists'),
    })));

    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const assignmentsByEntityId = new Map<string, LocalSong[]>();
    catalog?.assignments.forEach(assignment => {
        const song = songsById.get(assignment.songId);
        if (!song) return;
        assignment.artistEntityIds.forEach(entityId => {
            assignmentsByEntityId.set(entityId, [...(assignmentsByEntityId.get(entityId) || []), song]);
        });
        if (assignment.albumEntityId) {
            assignmentsByEntityId.set(assignment.albumEntityId, [...(assignmentsByEntityId.get(assignment.albumEntityId) || []), song]);
        }
    });

    const entityAlbumList: LocalLibraryGroup[] = catalog
        ? getActiveEntities(catalog.entities, 'album').flatMap(entity => {
            const songs = assignmentsByEntityId.get(entity.id) || [];
            return songs.length ? [{
                type: 'album' as const,
                name: entity.displayName,
                songs: sortLocalAlbumSongs(songs),
                coverUrl: getLocalCoverUrlOf(songs),
                id: entity.id,
                entityId: entity.id,
                trackCount: songs.length,
                description: t('localMusic.albums'),
            }] : [];
        })
        : legacyAlbumList;

    const entityArtistList: LocalLibraryGroup[] = catalog
        ? getActiveEntities(catalog.entities, 'artist').flatMap(entity => {
            const songs = assignmentsByEntityId.get(entity.id) || [];
            return songs.length ? [{
                type: 'artist' as const,
                name: entity.displayName,
                songs,
                coverUrl: getLocalCoverUrlOf(songs),
                id: entity.id,
                entityId: entity.id,
                trackCount: songs.length,
                description: t('localMusic.artists'),
            }] : [];
        })
        : legacyArtistList;

    const assignmentBySongId = new Map(catalog?.assignments.map(assignment => [assignment.songId, assignment]));
    const unknownAlbumSongs = catalog
        ? localSongs.filter(song => !assignmentBySongId.get(song.id)?.albumEntityId)
        : [];
    const unknownArtistSongs = catalog
        ? localSongs.filter(song => !(assignmentBySongId.get(song.id)?.artistEntityIds.length))
        : [];
    if (unknownAlbumSongs.length > 0) {
        entityAlbumList.push({
            type: 'album',
            id: 'album-__unknown__',
            name: t('localMusic.unknownAlbum'),
            songs: sortLocalAlbumSongs(unknownAlbumSongs),
            coverUrl: getLocalCoverUrlOf(unknownAlbumSongs),
            trackCount: unknownAlbumSongs.length,
            isVirtual: true,
        });
    }
    if (unknownArtistSongs.length > 0) {
        entityArtistList.push({
            type: 'artist',
            id: 'artist-__unknown__',
            name: t('localMusic.unknownArtist'),
            songs: unknownArtistSongs,
            coverUrl: getLocalCoverUrlOf(unknownArtistSongs),
            trackCount: unknownArtistSongs.length,
            isVirtual: true,
        });
    }
    const albumList = sortByName(entityAlbumList);
    const artistList = sortByName(entityArtistList);

    const playlistList: LocalLibraryGroup[] = localPlaylists.map(playlist => {
        const playlistSongs = playlist.songIds
            .map(songId => songsById.get(songId))
            .filter((song): song is LocalSong => Boolean(song));

        return {
            type: 'playlist' as const,
            name: playlist.name,
            songs: playlistSongs,
            coverUrl: getLocalCoverUrlOf(playlistSongs),
            id: `playlist-${playlist.id}`,
            playlistId: playlist.id,
            trackCount: playlistSongs.length,
            description: playlist.isFavorite ? t('localMusic.favoritePlaylist') : t('home.playlists'),
            isVirtual: playlist.isFavorite,
        };
    });

    return {
        folders: folderList,
        albums: albumList,
        artists: artistList,
        playlists: playlistList,
    };
};

export type LocalHomeGroups = ReturnType<typeof buildLocalHomeGroups>;

/** 本地页签的 section（顺序即 activeRow 0–3）。 */
export type LocalHomeSectionKey = 'folders' | 'albums' | 'artists' | 'playlists';
export type LocalHomeRow = 0 | 1 | 2 | 3;

export type LocalHomeSectionDefinition = {
    key: LocalHomeSectionKey;
    row: LocalHomeRow;
    labelKey: string;
    /** labelKey 翻译为空时改用的 key。 */
    fallbackLabelKey?: string;
    emptyKey: string;
};

export const LOCAL_HOME_SECTIONS: readonly LocalHomeSectionDefinition[] = [
    { key: 'folders', row: 0, labelKey: 'localMusic.foldersAndPlaylists', emptyKey: 'localMusic.noFoldersFound' },
    { key: 'albums', row: 1, labelKey: 'localMusic.albums', emptyKey: 'localMusic.noAlbumsFound' },
    { key: 'artists', row: 2, labelKey: 'localMusic.artists', emptyKey: 'localMusic.noArtistsFound' },
    { key: 'playlists', row: 3, labelKey: 'localMusic.customPlaylists', fallbackLabelKey: 'home.playlists', emptyKey: 'localMusic.noPlaylistsFound' },
];

/** activeRow 对应的 section（越界时回到 folders）。 */
export const localHomeSectionOfRow = (row: number): LocalHomeSectionDefinition => (
    LOCAL_HOME_SECTIONS.find(section => section.row === row) ?? LOCAL_HOME_SECTIONS[0]
);

/** 本地分组 → 首页卡片（带歌曲 id，批量范围按它去重保序；raw 是分组本身，打开集合时用）。 */
export const buildLocalHomeCards = (groups: readonly LocalLibraryGroup[]): LibraryHomeCard[] => groups.map(group => ({
    id: group.id,
    name: group.name,
    coverUrl: typeof group.coverUrl === 'string' ? group.coverUrl : undefined,
    description: group.description,
    trackCount: group.trackCount,
    type: group.type,
    isVirtual: group.isVirtual,
    trackIds: group.songs.map(song => song.id),
    raw: group,
}));

/** 支持批量的本地 section（文件夹、专辑、歌手）；歌单没有批量。 */
export const localBatchSelectionType = (section: LocalHomeSectionKey): LibraryDirectorySelectionType | null => (
    section === 'folders' || section === 'albums' || section === 'artists' ? section : null
);

/** 本地页签右上角的三个导入动作：文案随进行中的动作变，任何一个在进行或扫描中时都禁用。 */
export const resolveLocalHomeActions = (snapshot: LibraryHomeActionsSnapshot): LibraryHomeListAction[] => {
    const busy = isHomeImportBusy(snapshot);
    const scanning = Boolean(snapshot.scan?.active) || snapshot.refreshingFolders;
    return [
        {
            id: 'import-folder',
            labelKey: snapshot.importingFolder ? 'localMusic.importing' : 'localMusic.importFolder',
            titleKey: 'localMusic.importFolder',
            pending: snapshot.importingFolder,
            disabled: busy,
        },
        {
            id: 'refresh-folders',
            labelKey: scanning ? 'options.scanning' : 'options.refresh',
            titleKey: 'options.refresh',
            pending: scanning,
            disabled: busy,
        },
        {
            id: 'import-playlist',
            labelKey: snapshot.importingPlaylist ? 'localMusic.importingPlaylist' : 'localMusic.importPlaylist',
            titleKey: 'localMusic.importPlaylist',
            pending: snapshot.importingPlaylist,
            disabled: busy || snapshot.importingPlaylist,
        },
    ];
};
