import type { SongResult, UnifiedSong } from '../../../types';
import type { MediaId, OnlineMutationProvider, ProviderCollection } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { isSavableYtmPlaylist, ytmAlbumSaveParams } from './ytmCatalog';
import { requireYtmSong } from './ytmNormalize';
import { requestYtm } from './ytmTransport';

// src/services/onlineMusic/ytm/ytmMutations.ts
// Changes to the signed-in account: the albums and other people's playlists of its library, the
// songs of its own playlists, and the songs it likes.

// The desktop side takes this many songs in one request.
const SONGS_PER_REQUEST = 100;

const songId = (song: MediaId | SongResult): string => (typeof song === 'object' ? requireYtmSong(song) : String(song));

// A playlist the account made itself. The liked-music list is not one: YouTube refuses to edit
// it, and a song goes in and out of it by its heart.
const isOwnPlaylist = (playlist: ProviderCollection): boolean => (
    playlist.providerId === 'ytm' && playlist.type === 'playlist' && playlist.isOwned === true && playlist.isLiked !== true
);

export const ytmMutations: OnlineMutationProvider = {
    canAddToPlaylist: isOwnPlaylist,
    canSubscribe: collection => collection.type === 'album' || isSavableYtmPlaylist(collection),
    // The song then shows in the liked music of the account's YouTube Music, or leaves it.
    async likeSong(song, liked) {
        await requestYtm('song_like', { id: songId(song), liked: String(liked) });
    },
    // The album then shows under the albums of the account's YouTube Music library.
    async subscribeAlbum(id, subscribed) {
        await requestYtm('list_save', { ...await ytmAlbumSaveParams(String(id)), saved: String(subscribed) });
    },
    // The playlist then shows among the playlists of the library.
    async subscribePlaylist(playlist, subscribed) {
        await requestYtm('list_save', { id: String(typeof playlist === 'object' ? playlist.id : playlist), saved: String(subscribed) });
    },
    // A song already in the playlist is not added a second time. Removing a song takes the row it
    // was read from, and the playlist's other rows of it stay; a song read without its row (as a
    // guest, or kept from before rows were read) goes with every row of it.
    async updatePlaylistTracks(operation, playlist, tracks) {
        if (typeof playlist === 'object' && !isOwnPlaylist(playlist)) {
            throw new OnlineProviderError('unsupported', 'Playlist is not one of the account\'s own YouTube Music playlists', 'ytm');
        }
        const id = String(typeof playlist === 'object' ? playlist.id : playlist);
        const ids = tracks.map(songId);
        // The rows to remove, where the songs were read with them (`collectionRowId`).
        const rows = tracks.map(track => (typeof track === 'object' && (track as UnifiedSong).collectionRowId) || '');
        const named = operation === 'del' && rows.some(Boolean);
        for (let start = 0; start < ids.length; start += SONGS_PER_REQUEST) {
            await requestYtm('playlist_edit', {
                id, action: operation === 'add' ? 'add' : 'remove', videoIds: ids.slice(start, start + SONGS_PER_REQUEST).join(','),
                ...(named ? { setVideoIds: rows.slice(start, start + SONGS_PER_REQUEST).join(',') } : {}),
            });
        }
    },
};
