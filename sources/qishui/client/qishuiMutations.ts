import type { FoliumSourceCollection, FoliumSourceMutations, FoliumSourceSong } from '@folia/folium';
import { qishuiError, requestQishui } from './qishuiTransport';

// sources/qishui/client/qishuiMutations.ts
// 红心与自建歌单的增删。宿主只把汽水自己的歌和歌单交到这里（按歌的音源分派），这里只看歌单是不是能改的自建歌单。

/** The track id of a song handed as a DTO or as its id. */
export const qishuiSongId = (song: string | FoliumSourceSong): string => (typeof song === 'object' ? song.id : song);

const editable = (playlist: FoliumSourceCollection) => playlist.type === 'playlist' && playlist.isOwned === true && playlist.isLiked !== true;

export const qishuiMutations: FoliumSourceMutations = {
    canAddToPlaylist: editable,
    canEditPlaylistTracks: editable,
    async likeSong(song, liked) {
        await requestQishui('like_song', { id: qishuiSongId(song), liked });
        console.info('[Qishui] Song like changed', { liked });
    },
    async updatePlaylistTracks(operation, playlist, tracks) {
        if (typeof playlist !== 'object' || !editable(playlist)) {
            throw qishuiError('unsupported', 'Playlist is not an owned Qishui playlist');
        }
        if (!tracks.length) return;
        if (tracks.length > 100) throw qishuiError('unsupported', 'Select at most 100 tracks per operation');
        await requestQishui(operation === 'add' ? 'playlist_add_tracks' : 'playlist_remove_tracks', {
            id: playlist.id, ids: tracks.map(qishuiSongId),
        });
        console.info('[Qishui] Playlist tracks changed', { operation, count: tracks.length });
    },
};
