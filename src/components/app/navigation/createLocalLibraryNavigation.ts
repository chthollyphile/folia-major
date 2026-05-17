import type { Dispatch, SetStateAction } from 'react';
import type { LocalLibraryGroup, LocalSong, SongResult } from '../../../types';
import { isLocalPlaybackSong } from '../../../utils/appPlaybackGuards';

// src/components/app/navigation/createLocalLibraryNavigation.ts

type LocalMusicState = {
    activeRow: 0 | 1 | 2 | 3;
    selectedGroup: LocalLibraryGroup | null;
    detailStack: LocalLibraryGroup[];
    detailOriginView: 'home' | 'player' | null;
    focusedFolderIndex: number;
    focusedAlbumIndex: number;
    focusedArtistIndex: number;
    focusedPlaylistIndex: number;
};

type CreateLocalLibraryNavigationParams = {
    currentView: string;
    currentSong: SongResult | null;
    localSongs: LocalSong[];
    setHomeViewTab: (tab: string) => void;
    setLocalMusicState: Dispatch<SetStateAction<LocalMusicState>>;
    navigateDirectHome: (options?: { clearContext?: boolean }) => void;
};

// Creates local library navigation helpers for album and artist drill-in flows.
export const createLocalLibraryNavigation = ({
    currentView,
    currentSong,
    localSongs,
    setHomeViewTab,
    setLocalMusicState,
    navigateDirectHome,
}: CreateLocalLibraryNavigationParams) => {
    const openLocalLibraryGroup = (group: LocalLibraryGroup, row: 0 | 1 | 2 | 3) => {
        setHomeViewTab('local');
        setLocalMusicState(prev => ({
            ...prev,
            activeRow: row,
            selectedGroup: group,
            detailStack: prev.selectedGroup && prev.selectedGroup.id !== group.id
                ? [...prev.detailStack, prev.selectedGroup]
                : prev.selectedGroup
                    ? prev.detailStack
                    : [],
            detailOriginView: prev.selectedGroup
                ? prev.detailOriginView
                : (currentView === 'player' ? 'player' : null),
        }));
        navigateDirectHome({ clearContext: false });
    };

    const openCurrentLocalAlbum = () => {
        if (!isLocalPlaybackSong(currentSong) || !currentSong.localData) {
            return;
        }

        const localSong = currentSong.localData;
        const albumName = currentSong.al?.name || currentSong.album?.name || localSong.matchedAlbumName || localSong.album;
        if (!albumName) {
            return;
        }

        const songs = localSongs.filter(song => {
            const candidateAlbum = song.matchedAlbumName || song.album || '';
            return candidateAlbum === albumName;
        });

        if (!songs.length) {
            return;
        }

        openLocalLibraryGroup({
            type: 'album',
            id: `album-current-${albumName}`,
            name: albumName,
            songs,
            coverUrl: currentSong.al?.picUrl || currentSong.album?.picUrl,
            albumId: localSong.matchedAlbumId,
            description: currentSong.ar?.map(artist => artist.name).join(', '),
        }, 1);
    };

    const openCurrentLocalArtist = () => {
        if (!isLocalPlaybackSong(currentSong) || !currentSong.localData) {
            return;
        }

        const artistName = currentSong.ar?.[0]?.name || currentSong.artists?.[0]?.name || currentSong.localData.matchedArtists || currentSong.localData.artist;
        if (!artistName) {
            return;
        }

        const songs = localSongs.filter(song => {
            const candidateArtist = song.matchedArtists || song.artist || '';
            return candidateArtist === artistName;
        });

        if (!songs.length) {
            return;
        }

        openLocalLibraryGroup({
            type: 'artist',
            id: `artist-current-${artistName}`,
            name: artistName,
            songs,
            coverUrl: currentSong.al?.picUrl || currentSong.album?.picUrl,
            description: `${songs.length} 首歌曲`,
        }, 2);
    };

    const openLocalAlbumByName = (albumName: string) => {
        if (!albumName) {
            return;
        }

        const songs = localSongs.filter(song => {
            const candidateAlbum = song.matchedAlbumName || song.album || '';
            return candidateAlbum === albumName;
        });

        if (!songs.length) {
            return;
        }

        openLocalLibraryGroup({
            type: 'album',
            id: `album-by-name-${albumName}`,
            name: albumName,
            songs,
            coverUrl: songs.find(song => song.matchedCoverUrl)?.matchedCoverUrl,
            albumId: songs.find(song => song.matchedAlbumId)?.matchedAlbumId,
            description: songs[0]?.matchedArtists || songs[0]?.artist,
        }, 1);
    };

    const openLocalArtistByName = (artistName: string) => {
        if (!artistName) {
            return;
        }

        const songs = localSongs.filter(song => {
            const candidateArtist = song.matchedArtists || song.artist || '';
            return candidateArtist === artistName;
        });

        if (!songs.length) {
            return;
        }

        openLocalLibraryGroup({
            type: 'artist',
            id: `artist-by-name-${artistName}`,
            name: artistName,
            songs,
            coverUrl: songs.find(song => song.matchedCoverUrl)?.matchedCoverUrl,
            description: `${songs.length} 首歌曲`,
        }, 2);
    };

    return {
        openCurrentLocalAlbum,
        openCurrentLocalArtist,
        openLocalAlbumByName,
        openLocalArtistByName,
    };
};
