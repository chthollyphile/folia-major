import type { UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineCatalogProvider, ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import {
    SPOTIFY_LIKED_ID, present, spotifyAlbumOf, spotifyArtistOf, spotifyPage, spotifyPlaylistOf, spotifySongOf, spotifyUri,
} from './spotifyNormalize';
import type { SpotifyAlbum, SpotifyArtistRow, SpotifyPlaylist, SpotifyTrack } from './spotifyNormalize';
import type { SpotifyLikedAnswer } from './spotifyLibrary';
import { querySpotify } from './spotifyTransport';

// src/services/onlineMusic/spotify/spotifyCatalog.ts
// Playlists, albums and artists. Spotify pages a playlist and an album by offset and gives as
// many rows as asked for (343 asked of a list of 50 was answered whole, 2026-10-08).

const PAGE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_PAGES = 32;
const MAX_ROWS = 100;
const MAX_PAGES_WITHOUT_SONGS = 5;

interface PlaylistAnswer {
    playlistV2?: SpotifyPlaylist & { following?: boolean; content?: { totalCount?: number; items?: Array<{ itemV2?: { data?: SpotifyTrack } }> } };
}
interface AlbumAnswer {
    albumUnion?: SpotifyAlbum & { tracksV2?: { totalCount?: number; items?: Array<{ track?: SpotifyTrack }> } };
}
interface ArtistAnswer {
    artistUnion?: SpotifyArtistRow & {
        __typename?: string;
        discography?: { topTracks?: { items?: Array<{ track?: SpotifyTrack }> }; albums?: { totalCount?: number }; singles?: { totalCount?: number } };
    };
}
interface DiscographyAnswer {
    artistUnion?: { discography?: { all?: { totalCount?: number; items?: Array<{ releases?: { items?: SpotifyAlbum[] } }> } } };
}

// An artist's page answers two calls, an album's first rows answer its header and its list; keep each briefly.
const createPageCache = <T>(load: (id: string) => Promise<T>) => {
    const pages = new Map<string, { at: number; value: Promise<T> }>();
    return {
        get(id: string): Promise<T> {
            const cached = pages.get(id);
            if (cached && Date.now() - cached.at < PAGE_TTL_MS) return cached.value;
            const value = load(id);
            pages.set(id, { at: Date.now(), value });
            value.catch(() => { if (pages.get(id)?.value === value) pages.delete(id); });
            while (pages.size > MAX_CACHED_PAGES) pages.delete(pages.keys().next().value as string);
            return value;
        },
        clear(): void { pages.clear(); },
    };
};

const albumRows = (id: string, offset: number, limit: number) => (
    querySpotify<AlbumAnswer>('getAlbum', { uri: spotifyUri('album', id), locale: '', offset, limit })
);
const albumHeads = createPageCache(id => albumRows(id, 0, MAX_ROWS));
const artistPages = createPageCache(id => querySpotify<ArtistAnswer>('queryArtistOverview', { uri: spotifyUri('artist', id), locale: '', preReleaseV2: false }));

export const clearSpotifyCatalogCache = (): void => {
    albumHeads.clear();
    artistPages.clear();
};

const albumOf = (answer: AlbumAnswer, id: string): ProviderCollection => {
    const album = spotifyAlbumOf(answer.albumUnion);
    if (!album) throw new OnlineProviderError('unavailable', `Spotify has no album ${id}`, 'spotify');
    return album;
};

// One page of a list's songs. The app takes a page without songs for the end of a list, and a
// page of Spotify's may hold nothing but rows that are no songs (podcast episodes, files of the
// owner's own computer). Such a page is read past, at most `MAX_PAGES_WITHOUT_SONGS` in one call.
const songPage = async (
    offset: number,
    read: (offset: number) => Promise<{ songs: UnifiedSong[]; rows: number; total: number | undefined }>,
): Promise<ProviderPage<UnifiedSong>> => {
    for (let at = offset, pages = 1; ; pages++) {
        const { songs, rows, total } = await read(at);
        const page = spotifyPage(songs, at, rows, total);
        if (songs.length > 0 || !page.hasMore || pages >= MAX_PAGES_WITHOUT_SONGS) return page;
        at = page.nextOffset;
    }
};

// The songs of a playlist. `uri` is given by a caller that holds one already (a song's radio).
export const spotifyPlaylistTracks = (id: string, limit: number, offset: number, uri = spotifyUri('playlist', id)) => songPage(offset, async at => {
    const answer = await querySpotify<PlaylistAnswer>('fetchPlaylist', { uri, offset: at, limit: Math.min(limit, MAX_ROWS), enableWatchFeedEntrypoint: false });
    const list = answer.playlistV2;
    if (!list?.content) throw new OnlineProviderError('unavailable', `Spotify has no playlist ${id}`, 'spotify');
    const rows = list.content.items ?? [];
    return { songs: rows.map(row => spotifySongOf(row.itemV2?.data)).filter(present), rows: rows.length, total: list.content.totalCount };
});

export const spotifyCatalog: OnlineCatalogProvider = {
    async getPlaylistTracks(id, limit, offset) {
        if (id !== SPOTIFY_LIKED_ID) return spotifyPlaylistTracks(String(id), limit, offset);
        return songPage(offset, async at => {
            const tracks = (await querySpotify<SpotifyLikedAnswer>('fetchLibraryTracks', { offset: at, limit: Math.min(limit, MAX_ROWS) })).me?.library?.tracks;
            const rows = tracks?.items ?? [];
            return { songs: rows.map(row => spotifySongOf(row.track?.data, { uri: row.track?._uri })).filter(present), rows: rows.length, total: tracks?.totalCount };
        });
    },
    // A card of the library or of the explore page already holds what the playlist's page would add.
    async getPlaylistDetail(id, collection) {
        if (collection || id === SPOTIFY_LIKED_ID) return collection ?? null;
        const answer = await querySpotify<PlaylistAnswer>('fetchPlaylist', { uri: spotifyUri('playlist', String(id)), offset: 0, limit: 1, enableWatchFeedEntrypoint: false });
        return spotifyPlaylistOf(answer.playlistV2);
    },
    // Whether the account keeps the album, or follows the playlist. Its own playlists and its
    // liked songs are not things it can save.
    async getSubscriptionStatus(type, id, collection) {
        if (type === 'album') {
            const answer = await querySpotify<{ lookup?: Array<{ data?: { saved?: boolean } }> }>('areEntitiesInLibrary', { uris: [spotifyUri('album', String(id))] });
            return answer.lookup?.[0]?.data?.saved === true;
        }
        if (id === SPOTIFY_LIKED_ID || collection?.isOwned) return false;
        const answer = await querySpotify<PlaylistAnswer>('fetchPlaylist', { uri: spotifyUri('playlist', String(id)), offset: 0, limit: 1, enableWatchFeedEntrypoint: false });
        return answer.playlistV2?.following === true;
    },
    // An album's tracks do not name their album; it is the one they were read from.
    async getAlbumTracks(id, limit = 50, offset = 0) {
        const head = await albumHeads.get(String(id));
        const album = albumOf(head, String(id));
        const answer = offset === 0 ? head : await albumRows(String(id), offset, Math.min(limit, MAX_ROWS));
        const rows = (answer.albumUnion?.tracksV2?.items ?? []).slice(0, offset === 0 ? limit : undefined);
        const of = { id: album.id, name: album.name, coverUrl: album.coverUrl, catalogRef: { providerId: 'spotify', kind: 'album', id: album.id } as const };
        return spotifyPage(rows.map(row => spotifySongOf(row.track, { album: of })).filter(present), offset, rows.length, head.albumUnion?.tracksV2?.totalCount);
    },
    async getAlbumDetail(id) {
        return albumOf(await albumHeads.get(String(id)), String(id));
    },
    async getArtistDetail(id) {
        const artist = (await artistPages.get(String(id))).artistUnion;
        const card = spotifyArtistOf(artist);
        if (!card) throw new OnlineProviderError('unavailable', `Spotify has no artist ${id}`, 'spotify');
        return { ...card, albumCount: (artist?.discography?.albums?.totalCount ?? 0) + (artist?.discography?.singles?.totalCount ?? 0) };
    },
    // Spotify gives an artist's ten most played songs and no further page of them.
    async getArtistSongs(id, limit, offset) {
        const rows = (await artistPages.get(String(id))).artistUnion?.discography?.topTracks?.items ?? [];
        const page = rows.slice(offset, offset + limit);
        return spotifyPage(page.map(row => spotifySongOf(row.track)).filter(present), offset, page.length, rows.length);
    },
    async getArtistAlbums(id, limit, offset) {
        const answer = await querySpotify<DiscographyAnswer>('queryArtistDiscographyAll', { uri: spotifyUri('artist', String(id)), offset, limit: Math.min(limit, MAX_ROWS), order: 'DATE_DESC' });
        const all = answer.artistUnion?.discography?.all;
        const rows = all?.items ?? [];
        return spotifyPage(rows.map(row => spotifyAlbumOf(row.releases?.items?.[0])).filter(present), offset, rows.length, all?.totalCount);
    },
};
