import type { SongResult } from '../../../types';
import type { MediaId, OnlineMutationProvider, ProviderCollection } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { SPOTIFY_LIKED_ID, requireSpotifySong, spotifyId, spotifyUri } from './spotifyNormalize';
import { requestSpotify } from './spotifyTransport';
import type { SpotifyWireMadePlaylist } from './spotifyTransport';

// src/services/onlineMusic/spotify/spotifyMutations.ts
// Changes to the signed-in account: the songs it likes, the albums it keeps, the playlists of
// other people it follows, and the songs of its own playlists, which it can also make here.
// Each was made and undone against the real service on 2026-10-08.

// The desktop side takes this many songs in one request.
const SONGS_PER_REQUEST = 100;

const songId = (song: MediaId | SongResult): string => (typeof song === 'object' ? requireSpotifySong(song) : String(song));

// A playlist whose songs the account may change. Its liked songs are not one: a song goes in
// and out of them by its heart.
const isOwnPlaylist = (collection: ProviderCollection): boolean => (
    collection.providerId === 'spotify' && collection.type === 'playlist' && collection.id !== SPOTIFY_LIKED_ID && collection.isOwned === true
);
// A playlist the account can follow: not one of its own, and not its liked songs.
const isFollowable = (collection: ProviderCollection): boolean => (
    collection.type === 'playlist' && collection.id !== SPOTIFY_LIKED_ID && collection.isOwned !== true
);

const keep = (uri: string, saved: boolean) => requestSpotify('library', { uri, saved });

export const spotifyMutations: OnlineMutationProvider = {
    canAddToPlaylist: isOwnPlaylist,
    canSubscribe: collection => collection.type === 'album' || isFollowable(collection),
    // The song then shows among the account's liked songs in every Spotify app.
    async likeSong(song, liked) {
        await keep(spotifyUri('track', songId(song)), liked);
    },
    async subscribeAlbum(id, subscribed) {
        await keep(spotifyUri('album', String(id)), subscribed);
    },
    async subscribePlaylist(playlist, subscribed) {
        await keep(spotifyUri('playlist', String(typeof playlist === 'object' ? playlist.id : playlist)), subscribed);
    },
    // A song already in the playlist is not added a second time; removing a song takes every copy of it.
    async updatePlaylistTracks(operation, playlist, tracks) {
        if (typeof playlist === 'object' && !isOwnPlaylist(playlist)) {
            throw new OnlineProviderError('unsupported', 'Playlist is not one the account may change the songs of', 'spotify');
        }
        const id = String(typeof playlist === 'object' ? playlist.id : playlist);
        const ids = tracks.map(songId);
        for (let start = 0; start < ids.length; start += SONGS_PER_REQUEST) {
            await requestSpotify('playlist_edit', { id, action: operation === 'add' ? 'add' : 'remove', tracks: ids.slice(start, start + SONGS_PER_REQUEST) });
        }
    },
    // The playlist then shows in the account's library in every Spotify app.
    async createPlaylist(name) {
        const made = await requestSpotify<SpotifyWireMadePlaylist>('playlist_create', { name });
        const id = spotifyId(made?.uri, 'playlist');
        if (!id) throw new OnlineProviderError('invalid-response', 'Spotify did not name the new playlist', 'spotify');
        return { providerId: 'spotify', id, type: 'playlist', name: name.trim(), coverUrl: '', description: '', trackCount: 0, isOwned: true };
    },
};
