import type { MediaId } from '../../../types';
import type { OnlineMutationProvider, ProviderCollection } from '../../../types/onlineMusic';
import { requestSoda } from './sodaTransport';

// src/services/onlineMusic/soda/sodaMutations.ts
//
// 汽水账号的写入：红心、歌单加删歌、新建歌单。「我喜欢」不当作普通歌单编辑，红心走 like/unlike。

const idOf = (value: MediaId | { id: MediaId }): string => String(typeof value === 'object' ? value.id : value);

const idsOf = (tracks: Array<MediaId | { id: MediaId }>): string[] => tracks.map(idOf).filter(Boolean);

export const sodaMutations: OnlineMutationProvider = {
    canAddToPlaylist: (playlist: ProviderCollection) => !playlist.isLiked,

    async likeSong(song, liked) {
        await requestSoda('like', { songId: idOf(song), liked });
    },

    async updatePlaylistTracks(operation, playlist, tracks) {
        const playlistId = idOf(playlist);
        const trackIds = idsOf(tracks);
        if (!playlistId || trackIds.length === 0) return;
        await requestSoda(operation === 'add' ? 'playlist_append' : 'playlist_remove', { playlistId, trackIds });
    },

    async createPlaylist(name) {
        const created = await requestSoda<{ id?: string; name?: string; coverUrl?: string; trackCount?: number }>('playlist_create', { name });
        return {
            providerId: 'soda',
            id: String(created?.id ?? ''),
            type: 'playlist',
            name: String(created?.name || name),
            ...(created?.coverUrl ? { coverUrl: String(created.coverUrl) } : {}),
            trackCount: 0,
        };
    },
};
