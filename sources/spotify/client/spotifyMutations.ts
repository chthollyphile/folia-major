import type { FoliumSourceCollection, FoliumSourceMutations, FoliumSourceSong } from '@folia/folium';
import { SPOTIFY_LIKED_ID, requireSpotifySong, spotifyId, spotifyUri } from './spotifyNormalize';
import { requestSpotify, spotifyError } from './spotifyTransport';
import type { SpotifyWireMadePlaylist } from './spotifyTransport';

// sources/spotify/client/spotifyMutations.ts
// Changes to the signed-in account: the songs it likes, the albums it keeps, the playlists of
// other people it follows, and the songs of its own playlists, which it can also make here.
// Each was made and undone against the real service on 2026-10-08.

// The desktop side takes this many songs in one request.
const SONGS_PER_REQUEST = 100;

const songId = (song: string | FoliumSourceSong): string => (typeof song === 'object' ? requireSpotifySong(song) : song);

// A playlist whose songs the account may change. Its liked songs are not one: a song goes in
// and out of them by its heart.
// (The host hands a source only its own lists.)
const isOwnPlaylist = (collection: FoliumSourceCollection): boolean => (
    collection.type === 'playlist' && collection.id !== SPOTIFY_LIKED_ID && collection.isOwned === true
);
// A playlist the account can follow: not one of its own, and not its liked songs.
const isFollowable = (collection: FoliumSourceCollection): boolean => (
    collection.type === 'playlist' && collection.id !== SPOTIFY_LIKED_ID && collection.isOwned !== true
);

const keep = (uri: string, saved: boolean) => requestSpotify('library', { uri, saved });

export const spotifyMutations: FoliumSourceMutations = {
    canAddToPlaylist: isOwnPlaylist,
    canSubscribe: collection => collection.type === 'album' || isFollowable(collection),
    // The song then shows among the account's liked songs in every Spotify app.
    async likeSong(song, liked) {
        await keep(spotifyUri('track', songId(song)), liked);
    },
    async subscribeAlbum(id, subscribed) {
        await keep(spotifyUri('album', id), subscribed);
    },
    async subscribePlaylist(playlist, subscribed) {
        await keep(spotifyUri('playlist', typeof playlist === 'object' ? playlist.id : playlist), subscribed);
    },
    // A song already in the playlist is not added a second time; removing a song takes every copy of it.
    async updatePlaylistTracks(operation, playlist, tracks) {
        if (typeof playlist === 'object' && !isOwnPlaylist(playlist)) {
            throw spotifyError('unsupported', 'Playlist is not one the account may change the songs of');
        }
        const id = typeof playlist === 'object' ? playlist.id : playlist;
        const ids = tracks.map(songId);
        for (let start = 0; start < ids.length; start += SONGS_PER_REQUEST) {
            await requestSpotify('playlist_edit', { id, action: operation === 'add' ? 'add' : 'remove', tracks: ids.slice(start, start + SONGS_PER_REQUEST) });
        }
    },
    // The playlist then shows in the account's library in every Spotify app.
    async createPlaylist(name) {
        const made = await requestSpotify<SpotifyWireMadePlaylist>('playlist_create', { name });
        const id = spotifyId(made?.uri, 'playlist');
        if (!id) throw spotifyError('invalid-response', 'Spotify did not name the new playlist');
        return { id, type: 'playlist', name: name.trim(), coverUrl: '', description: '', trackCount: 0, isOwned: true };
    },
};
