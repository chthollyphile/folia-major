import type { TFunction } from 'i18next';
import { LocalLibraryGroup, LocalPlaylist, LocalSong } from '../../../types';
import { isBlob } from '../../../utils/blobGuards';
import { sortLocalAlbumSongs, sortLocalFolderSongs } from '../../../utils/localSongSorting';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../../../types/localLibrary';
import { getActiveEntities } from '../../../utils/localLibraryIndex';

// src/components/app/home/localGrid3DModel.ts
// Builds local-library overview groups for the desktop Grid3D surface.

const getLocalCoverUrl = (songs: LocalSong[]): Blob | string | undefined => {
    const sortedSongs = [...songs].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const preferredSong = sortedSongs.find(song => {
        const hasEmbeddedCover = isBlob(song.embeddedCover);
        if (song.useOnlineCover) {
            return song.onlineMetadata?.coverUrl || hasEmbeddedCover;
        }
        return hasEmbeddedCover || song.onlineMetadata?.coverUrl;
    });

    if (!preferredSong) return undefined;

    const embeddedCover = isBlob(preferredSong.embeddedCover) ? preferredSong.embeddedCover : undefined;
    if (preferredSong.useOnlineCover) {
        return preferredSong.onlineMetadata?.coverUrl || embeddedCover;
    }

    return embeddedCover || preferredSong.onlineMetadata?.coverUrl;
};

const sortByName = <T extends { name: string }>(items: T[]) => (
    items.sort((a, b) => a.name.localeCompare(b.name))
);

export const buildLocalGrid3DGroups = (
    localSongs: LocalSong[],
    localPlaylists: LocalPlaylist[],
    t: TFunction,
    catalog?: { entities: LocalLibraryEntity[]; assignments: LocalLibraryAssignment[]; },
) => {
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
        coverUrl: getLocalCoverUrl(songs),
        id: `folder-${name}`,
        trackCount: songs.length,
        description: t('localMusic.folder'),
    })));

    if (localSongs.length > 0) {
        folderList.unshift({
            type: 'folder',
            name: t('localMusic.allSongs') || 'All Songs',
            songs: sortLocalFolderSongs(localSongs),
            coverUrl: getLocalCoverUrl(localSongs),
            id: 'folder-__all-songs__',
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
            coverUrl: getLocalCoverUrl(songs),
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
        coverUrl: getLocalCoverUrl(songs),
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
                coverUrl: getLocalCoverUrl(songs),
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
                coverUrl: getLocalCoverUrl(songs),
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
            coverUrl: getLocalCoverUrl(unknownAlbumSongs),
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
            coverUrl: getLocalCoverUrl(unknownArtistSongs),
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
            coverUrl: getLocalCoverUrl(playlistSongs),
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
