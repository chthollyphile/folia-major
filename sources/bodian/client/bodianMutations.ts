import type { FoliumSourceCollection, FoliumSourceMutations, FoliumSourceSong } from '@folia/folium';
import { bodianError, requestBodian } from './bodianTransport';
import { clearBodianLibraryCache } from './bodianLibrary';

// sources/bodian/client/bodianMutations.ts
// 红心与歌单增删。宿主只把波点自己的歌和歌单交到这里（omni 按歌的音源分派），给的是 DTO 或只给 id。

const songId = (song: string | FoliumSourceSong): string => (typeof song === 'object' ? song.id : song);

function playlistId(playlist: string | FoliumSourceCollection): string {
    if (typeof playlist !== 'object') return playlist;
    if (playlist.type !== 'playlist' || !playlist.isOwned) {
        throw bodianError('unsupported', 'Playlist is not an owned Bodian playlist');
    }
    return playlist.id;
}

const likeSong = async (song: string | FoliumSourceSong, liked: boolean): Promise<void> => {
    try { await requestBodian('like_song', { id: songId(song), liked }); }
    finally { clearBodianLibraryCache(); }
};

export const bodianMutations: FoliumSourceMutations = {
    canAddToPlaylist: playlist => playlist.type === 'playlist' && playlist.isOwned === true,
    likeSong,
    async updatePlaylistTracks(operation, playlist, tracks) {
        if (!tracks.length) return;
        // The package verifies ownership, including the account's built-in liked playlist.
        if (tracks.length > 100) throw bodianError('unsupported', 'Select at most 100 tracks per operation');
        const id = playlistId(playlist);
        const trackIds = tracks.map(songId).join(',');
        try { await requestBodian(operation === 'add' ? 'playlist_tracks_add' : 'playlist_tracks_del', { id, trackIds }); }
        finally { clearBodianLibraryCache(); }
    },
};
