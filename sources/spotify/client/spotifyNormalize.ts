import type { FoliumSourceAlbumRef, FoliumSourceCollection, FoliumSourceNamedRef, FoliumSourcePage, FoliumSourceSong, FoliumSourceUser } from '@folia/folium';
import { spotifyError } from './spotifyTransport';

// sources/spotify/client/spotifyNormalize.ts
// Spotify's query answers, as far as this source reads them (measured 2026-10-08), and the public contract's DTOs
// they become. Everything Spotify names has a uri, `spotify:<kind>:<id>`; the id is the last part. An artist or
// album whose uri is not read has an empty id and opens nothing in the catalogue (`ref: false`).

export interface SpotifyPicture { url?: string; width?: number | null }
export interface SpotifyArtistRow { uri?: string; profile?: { name?: string }; visuals?: { avatarImage?: { sources?: SpotifyPicture[] } | null } }
// A track is the same thing under every query, each leaving out some of it: a liked song has its
// uri beside it, an album's track has no album, an artist's top track has an album without a name.
export interface SpotifyTrack {
    __typename?: string;
    uri?: string;
    name?: string;
    artists?: { items?: SpotifyArtistRow[] };
    albumOfTrack?: { uri?: string; name?: string; coverArt?: { sources?: SpotifyPicture[] } };
    duration?: { totalMilliseconds?: number };
    trackDuration?: { totalMilliseconds?: number };
}
export interface SpotifyAlbum {
    __typename?: string;
    uri?: string;
    name?: string;
    coverArt?: { sources?: SpotifyPicture[] };
    artists?: { items?: SpotifyArtistRow[] };
    date?: { isoString?: string; year?: number };
    /** ALBUM, SINGLE, EP or COMPILATION: a card of the home page and a new release say it. */
    albumType?: string;
    tracks?: { totalCount?: number };
    tracksV2?: { totalCount?: number };
}
export interface SpotifyPlaylist {
    __typename?: string;
    uri?: string;
    name?: string;
    description?: string;
    images?: { items?: Array<{ sources?: SpotifyPicture[] }> };
    ownerV2?: { data?: { name?: string } };
    currentUserCapabilities?: { canEditItems?: boolean };
    content?: { totalCount?: number };
}
export type SpotifyEntity = SpotifyTrack | SpotifyAlbum | SpotifyPlaylist | SpotifyArtistRow;

// The list of the account's liked songs has no uri of its own; this stands for it as a playlist id.
export const SPOTIFY_LIKED_ID = 'liked';

type SpotifyKind = 'track' | 'album' | 'artist' | 'playlist';
// The id of a uri of the kind expected, '' for anything else: an older playlist uri names its
// owner first (`spotify:user:<name>:playlist:<id>`), a file of the owner's own computer has no id.
export const spotifyId = (uri: unknown, kind: SpotifyKind): string => (
    typeof uri === 'string' ? new RegExp(`^spotify:(?:user:[^:]+:)?${kind}:([0-9A-Za-z]{22})$`).exec(uri)?.[1] ?? '' : ''
);
export const spotifyUri = (kind: SpotifyKind, id: string): string => `spotify:${kind}:${id}`;

// A name with where it opens in the catalogue; an empty id opens nothing.
const named = (id: string, name: string): FoliumSourceNamedRef => ({ id, name, ...(id ? {} : { ref: false }) });

// Spotify lists a picture in several sizes, or in one size it does not state.
const pictureOf = (sources: SpotifyPicture[] | undefined): string => (
    (sources ?? []).reduce<SpotifyPicture | null>((best, source) => (
        source?.url && (!best || (source.width ?? 0) > (best.width ?? 0)) ? source : best
    ), null)?.url ?? ''
);

const artistsOf = (rows: SpotifyArtistRow[] | undefined): FoliumSourceNamedRef[] => (rows ?? [])
    .filter(row => row?.profile?.name)
    .map(row => named(spotifyId(row.uri, 'artist'), row.profile!.name!));

// A playlist's description is a line of HTML: links to other playlists, and escaped characters.
const plainText = (html: string | undefined): string => (html ?? '').replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_all, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#x27': '\'', '#39': '\'' })[name] ?? '');

// The Spotify track id of one of this source's songs (the host hands the source only its own).
export const requireSpotifySong = (song: Pick<FoliumSourceSong, 'id'> | null | undefined): string => {
    const id = typeof song?.id === 'string' ? song.id : '';
    if (!id) throw spotifyError('unsupported', 'Song does not belong to Spotify');
    return id;
};

// `beside` is what the row around the track says of it where the track itself does not: its uri,
// or the album it was read from. Answers null for a row that is not a song (a podcast episode, a
// track Spotify has withdrawn).
export const spotifySongOf = (
    track: SpotifyTrack | null | undefined,
    beside: { uri?: string; album?: FoliumSourceAlbumRef } = {},
): FoliumSourceSong | null => {
    const id = spotifyId(track?.uri ?? beside.uri, 'track');
    if (!track || !id || !track.name || (track.__typename && track.__typename !== 'Track')) return null;
    const albumId = spotifyId(track.albumOfTrack?.uri, 'album');
    return {
        id,
        title: track.name,
        artists: artistsOf(track.artists?.items),
        album: beside.album ?? { ...named(albumId, track.albumOfTrack?.name || ''), coverUrl: pictureOf(track.albumOfTrack?.coverArt?.sources) },
        durationMs: Math.max(0, Number(track.duration?.totalMilliseconds ?? track.trackDuration?.totalMilliseconds) || 0),
    };
};

export const normalizeSpotifyUser = (raw: unknown): FoliumSourceUser => {
    const item = (raw ?? {}) as Partial<FoliumSourceUser>;
    return {
        id: String(item.id ?? ''),
        nickname: String(item.nickname ?? ''),
        avatarUrl: item.avatarUrl || '',
        ...(item.vipType === undefined ? {} : { vipType: Number(item.vipType) || 0 }),
    };
};

export const spotifyPlaylistOf = (playlist: SpotifyPlaylist | null | undefined): FoliumSourceCollection | null => {
    const id = spotifyId(playlist?.uri, 'playlist');
    if (!playlist || !id || (playlist.__typename && playlist.__typename !== 'Playlist')) return null;
    const owner = playlist.ownerV2?.data?.name;
    return {
        id, type: 'playlist', name: playlist.name || '',
        coverUrl: pictureOf(playlist.images?.items?.[0]?.sources),
        description: plainText(playlist.description),
        ...(owner ? { creator: { id: '', nickname: owner } } : {}),
        ...(playlist.content?.totalCount === undefined ? {} : { trackCount: playlist.content.totalCount }),
        // The account may change the songs of its own playlists, and of the ones it was invited to.
        ...(playlist.currentUserCapabilities?.canEditItems ? { isOwned: true } : {}),
    };
};

export const spotifyAlbumOf = (album: SpotifyAlbum | null | undefined): FoliumSourceCollection | null => {
    const id = spotifyId(album?.uri, 'album');
    if (!album || !id || (album.__typename && album.__typename !== 'Album')) return null;
    const publishedAt = album.date?.isoString ? Date.parse(album.date.isoString) : album.date?.year ? Date.UTC(album.date.year, 0, 1) : NaN;
    const trackCount = album.tracksV2?.totalCount ?? album.tracks?.totalCount;
    return {
        id, type: 'album', name: album.name || '',
        coverUrl: pictureOf(album.coverArt?.sources), description: '',
        artists: artistsOf(album.artists?.items),
        ...(trackCount === undefined ? {} : { trackCount }),
        ...(Number.isFinite(publishedAt) ? { publishedAt } : {}),
    };
};

export const spotifyArtistOf = (artist: SpotifyArtistRow | null | undefined): FoliumSourceCollection | null => {
    const id = spotifyId(artist?.uri, 'artist');
    if (!artist || !id || !artist.profile?.name) return null;
    return {
        id, type: 'artist', name: artist.profile.name,
        coverUrl: pictureOf(artist.visuals?.avatarImage?.sources ?? undefined), description: '',
    };
};

// Spotify pages by offset, as the app does. `read` is how many rows the answer held before the
// ones that are not songs were left out: the next page begins after them.
export const spotifyPage = <T>(items: T[], offset: number, read: number, total: number | undefined): FoliumSourcePage<T> => {
    const nextOffset = offset + read;
    return { items, ...(total === undefined ? {} : { total }), nextOffset, hasMore: read > 0 && (total === undefined || nextOffset < total) };
};

export const present = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;
