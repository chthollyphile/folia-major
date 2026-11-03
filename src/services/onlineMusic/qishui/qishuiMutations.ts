import type { SongResult } from '../../../types';
import type { MediaId, OnlineMutationProvider, ProviderCollection } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { requestQishui } from './qishuiTransport';

// Account writes use Omni's source identity and only expose editing for ordinary owned playlists.
export function qishuiSongId(song: MediaId | SongResult): string {
    if (typeof song !== 'object') return String(song);
    const source = getPlaybackSourceRef(song);
    if (source.kind !== 'online' || source.providerId !== 'qishui') {
        throw new OnlineProviderError('unsupported', 'Song does not belong to Qishui', 'qishui');
    }
    return source.mediaId;
}
const editable = (playlist: ProviderCollection) => playlist.providerId === 'qishui'
    && playlist.type === 'playlist' && playlist.isOwned === true && playlist.isLiked !== true;

export const qishuiMutations: OnlineMutationProvider = {
    canAddToPlaylist: editable,
    canEditPlaylistTracks: editable,
    async likeSong(song, liked) {
        await requestQishui('like_song', { id: qishuiSongId(song), liked });
        console.info('[Qishui] Song like changed', { liked });
    },
    async updatePlaylistTracks(operation, playlist, tracks) {
        if (typeof playlist !== 'object' || !editable(playlist)) {
            throw new OnlineProviderError('unsupported', 'Playlist is not an owned Qishui playlist', 'qishui');
        }
        if (!tracks.length) return;
        if (tracks.length > 100) throw new OnlineProviderError('unsupported', 'Select at most 100 tracks per operation', 'qishui');
        await requestQishui(operation === 'add' ? 'playlist_add_tracks' : 'playlist_remove_tracks', {
            id: String(playlist.id), ids: tracks.map(qishuiSongId),
        });
        console.info('[Qishui] Playlist tracks changed', { operation, count: tracks.length });
    },
};
