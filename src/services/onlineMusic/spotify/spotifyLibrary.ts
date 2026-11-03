import i18n from '../../../i18n/config';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineLibraryProvider, ProviderCollection } from '../../../types/onlineMusic';
import { SPOTIFY_LIKED_ID, present, spotifyAlbumOf, spotifyId, spotifyPage, spotifyPlaylistOf, spotifySongOf, spotifyUri } from './spotifyNormalize';
import type { SpotifyAlbum, SpotifyPlaylist, SpotifyTrack } from './spotifyNormalize';
import { querySpotify } from './spotifyTransport';

// src/services/onlineMusic/spotify/spotifyLibrary.ts
// What the account keeps: its playlists (its own and the ones it follows), its albums, and the
// songs it liked, which Spotify keeps as a list of their own and the app shows as one more playlist.

interface LibraryAnswer {
    me?: { libraryV3?: { totalCount?: number; items?: Array<{ item?: { data?: SpotifyPlaylist | SpotifyAlbum } }> } };
}
export interface SpotifyLikedAnswer {
    me?: { library?: { tracks?: { totalCount?: number; items?: Array<{ track?: { _uri?: string; data?: SpotifyTrack } }> } } };
}

// The liked songs are read this many rows a request. A request for 1000 was accepted
// (2026-10-08, on a list of 27, so how many Spotify gives at once is not known); the reading
// goes on by the rows given, to the end of the list or this many rows, however many requests that
// takes. The rows bound the read: a list that never ends stops there too, and the last request
// asks only for the rows left.
const LIKED_ROWS = 500;
const LIKED_MAX_ROWS = 20_000;

// Folders are opened out into the playlists they hold; a folder itself is a row that is no playlist.
const libraryVariables = (kind: 'Playlists' | 'Albums', limit: number, offset: number) => ({
    filters: [kind], order: null, textFilter: '', features: [], limit, offset, flatten: true,
    expandedFolders: [], folderUri: null, includeFoldersWhenFlattening: true,
});

// The first row of the liked songs, with Spotify's count of them: what the liked card shows and
// what a count of the list is. The card (read with the playlists) and the count (asked at the same
// moment, at the home screen) share the request that is under way; none is answered from a past one.
let likedHeadUnderWay: Promise<SpotifyLikedAnswer> | null = null;
const likedHead = (): Promise<SpotifyLikedAnswer> => {
    if (!likedHeadUnderWay) {
        const asked = querySpotify<SpotifyLikedAnswer>('fetchLibraryTracks', { offset: 0, limit: 1 })
            .finally(() => { if (likedHeadUnderWay === asked) likedHeadUnderWay = null; });
        likedHeadUnderWay = asked;
    }
    return likedHeadUnderWay;
};

// The liked songs as a playlist card: how many there are, under the cover of the latest one.
const likedCollection = async (): Promise<ProviderCollection> => {
    const liked = await likedHead();
    const tracks = liked.me?.library?.tracks;
    const latest = tracks?.items?.[0]?.track;
    return {
        providerId: 'spotify', id: SPOTIFY_LIKED_ID, type: 'playlist', name: i18n.t('home.spotifyLikedSongs'),
        coverUrl: spotifySongOf(latest?.data, { uri: latest?._uri })?.album.coverUrl ?? '', description: '',
        trackCount: tracks?.totalCount ?? 0, isLiked: true, isOwned: true,
    };
};

export const spotifyLibrary: OnlineLibraryProvider = {
    // The liked songs come first, on the first page only; `total` counts them in.
    async getUserPlaylists(_userId, limit, offset) {
        const [page, liked] = await Promise.all([
            querySpotify<LibraryAnswer>('libraryV3', libraryVariables('Playlists', limit, offset)),
            offset === 0 ? likedCollection() : null,
        ]);
        const rows = page.me?.libraryV3?.items ?? [];
        const playlists = rows.map(row => spotifyPlaylistOf(row.item?.data as SpotifyPlaylist)).filter(present);
        const listed = spotifyPage(liked ? [liked, ...playlists] : playlists, offset, rows.length, page.me?.libraryV3?.totalCount);
        return { ...listed, ...(listed.total === undefined ? {} : { total: listed.total + 1 }) };
    },
    // The id of every liked song, which is what shows a song's heart as full.
    async getLikedSongIds() {
        const ids: string[] = [];
        let offset = 0;
        let total: number | undefined;
        let whole = false;
        let empty = false;
        while (offset < LIKED_MAX_ROWS) {
            const tracks = (await querySpotify<SpotifyLikedAnswer>('fetchLibraryTracks', { offset, limit: Math.min(LIKED_ROWS, LIKED_MAX_ROWS - offset) })).me?.library?.tracks;
            // An answer without the list is no empty list: the read fails.
            if (!Array.isArray(tracks?.items)) throw new OnlineProviderError('invalid-response', 'Spotify liked songs are missing', 'spotify');
            const rows = tracks.items;
            ids.push(...rows.map(row => spotifyId(row.track?._uri, 'track')).filter(Boolean));
            offset += rows.length;
            total = tracks.totalCount;
            empty = rows.length === 0;
            // Without Spotify's count of the list, the reading goes on until a request brings nothing.
            whole = total === undefined ? empty : offset >= total;
            if (whole || empty) break;
        }
        if (!whole) {
            const stopped = empty ? 'a request brought no rows' : `the read stops at ${LIKED_MAX_ROWS} rows`;
            console.warn(`[Spotify] The liked songs were not read to the end: ${offset} rows read${total === undefined ? '' : ` of ${total}`} (${stopped}), the hearts of the others stay as they were`);
        }
        return { ids, whole };
    },
    // Whether each of these songs is liked, for a list longer than the read above reads: one
    // request for them all. The answer is read as a row for each uri asked, in their order (so it
    // is for one album; for tracks it was not tried). Rows of another number are not matched up.
    async areSongsLiked(ids) {
        const answer = await querySpotify<{ lookup?: Array<{ data?: { saved?: boolean } }> }>('areEntitiesInLibrary', { uris: ids.map(id => spotifyUri('track', String(id))) });
        const rows = answer.lookup?.length === ids.length ? answer.lookup : [];
        const liked: Record<string, boolean> = {};
        ids.forEach((id, at) => {
            const saved = rows[at]?.data?.saved;
            if (typeof saved === 'boolean') liked[String(id)] = saved;
        });
        const said = Object.values(liked);
        console.log(`[Spotify] areEntitiesInLibrary for ${ids.length} tracks: ${said.filter(Boolean).length} liked, ${said.filter(saved => !saved).length} not, ${ids.length - said.length} without an answer`);
        return liked;
    },
    // Spotify's own count of the liked songs, the one the read above goes by: one request for one row.
    async getLikedSongCount() {
        const liked = await likedHead();
        return liked.me?.library?.tracks?.totalCount ?? null;
    },
    async getUserAlbums(_userId, limit, offset) {
        const page = await querySpotify<LibraryAnswer>('libraryV3', libraryVariables('Albums', limit, offset));
        const rows = page.me?.libraryV3?.items ?? [];
        return spotifyPage(rows.map(row => spotifyAlbumOf(row.item?.data as SpotifyAlbum)).filter(present), offset, rows.length, page.me?.libraryV3?.totalCount);
    },
};
