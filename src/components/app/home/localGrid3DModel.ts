import type { TFunction } from 'i18next';
import { LocalLibraryGroup, LocalPlaylist, LocalSong } from '../../../types';

// src/components/app/home/localGrid3DModel.ts
// Builds local-library overview groups for the desktop Grid3D surface.

const getLocalCoverUrl = (songs: LocalSong[]) => (
    songs.find(song => song.useOnlineCover && song.matchedCoverUrl)?.matchedCoverUrl
    || songs.find(song => song.matchedCoverUrl)?.matchedCoverUrl
);

const sortByName = <T extends { name: string }>(items: T[]) => (
    items.sort((a, b) => a.name.localeCompare(b.name))
);

export const buildLocalGrid3DGroups = (
    localSongs: LocalSong[],
    localPlaylists: LocalPlaylist[],
    t: TFunction
) => {
    const folders: Record<string, LocalSong[]> = {};
    const albums: Record<string, LocalSong[]> = {};
    const artists: Record<string, LocalSong[]> = {};

    localSongs.forEach(song => {
        if (song.folderName) {
            folders[song.folderName] = folders[song.folderName] || [];
            folders[song.folderName].push(song);
        }

        const albumName = song.matchedAlbumName || song.album || t('localMusic.unknownAlbum');
        const albumKey = song.matchedAlbumId ? `matched-${song.matchedAlbumId}` : albumName;
        albums[albumKey] = albums[albumKey] || [];
        albums[albumKey].push(song);

        const artistName = song.matchedArtists || song.artist || t('localMusic.unknownArtist');
        artists[artistName] = artists[artistName] || [];
        artists[artistName].push(song);
    });

    const folderList: LocalLibraryGroup[] = sortByName(Object.entries(folders).map(([name, songs]) => ({
        type: 'folder' as const,
        name,
        songs,
        coverUrl: getLocalCoverUrl(songs),
        id: `folder-${name}`,
        trackCount: songs.length,
        description: t('localMusic.folder'),
    })));

    if (localSongs.length > 0) {
        folderList.unshift({
            type: 'folder',
            name: t('localMusic.allSongs') || 'All Songs',
            songs: localSongs,
            coverUrl: getLocalCoverUrl(localSongs),
            id: 'folder-__all-songs__',
            isVirtual: true,
            trackCount: localSongs.length,
            description: t('localMusic.folder'),
        });
    }

    const albumList: LocalLibraryGroup[] = sortByName(Object.entries(albums).map(([key, songs]) => {
        const firstSong = songs[0];
        const albumName = firstSong?.matchedAlbumName || firstSong?.album || t('localMusic.unknownAlbum');
        return {
            type: 'album' as const,
            name: albumName,
            songs,
            coverUrl: getLocalCoverUrl(songs),
            id: `album-${key}`,
            trackCount: songs.length,
            description: firstSong?.matchedArtists || firstSong?.artist || t('localMusic.unknownArtist'),
            albumId: firstSong?.matchedAlbumId,
        };
    }));

    const artistList: LocalLibraryGroup[] = sortByName(Object.entries(artists).map(([name, songs]) => ({
        type: 'artist' as const,
        name,
        songs,
        coverUrl: getLocalCoverUrl(songs),
        id: `artist-${name}`,
        trackCount: songs.length,
        description: t('localMusic.artists'),
    })));

    const songsById = new Map(localSongs.map(song => [song.id, song]));
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
