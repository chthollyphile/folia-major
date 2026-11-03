import type { Artist, UnifiedSong } from '../../../types';
import type { ProviderCatalogRef, ProviderCollection, ProviderPage, ProviderUser } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/spotify/spotifyNormalize.ts
// Spotify's query answers, as far as this adapter reads them (measured 2026-10-08), and what they
// become in the app. Everything Spotify names has a uri, `spotify:<kind>:<id>`; the id is the last part.

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

const ref = (kind: 'album' | 'artist', id: string): ProviderCatalogRef | undefined => (
    id ? { providerId: 'spotify', kind, id } : undefined
);

// Spotify lists a picture in several sizes, or in one size it does not state.
const pictureOf = (sources: SpotifyPicture[] | undefined): string => (
    (sources ?? []).reduce<SpotifyPicture | null>((best, source) => (
        source?.url && (!best || (source.width ?? 0) > (best.width ?? 0)) ? source : best
    ), null)?.url ?? ''
);

const artistsOf = (rows: SpotifyArtistRow[] | undefined): Artist[] => (rows ?? [])
    .filter(row => row?.profile?.name)
    .map(row => ({ id: spotifyId(row.uri, 'artist'), name: row.profile!.name!, catalogRef: ref('artist', spotifyId(row.uri, 'artist')) }));

// A playlist's description is a line of HTML: links to other playlists, and escaped characters.
const plainText = (html: string | undefined): string => (html ?? '').replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_all, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#x27': '\'', '#39': '\'' })[name] ?? '');

// The Spotify track id of a song that belongs to this provider.
export const requireSpotifySong = (song: { sourceRef?: UnifiedSong['sourceRef'] }): string => {
    const source = song.sourceRef;
    if (source?.kind !== 'online' || source.providerId !== 'spotify') {
        throw new OnlineProviderError('unsupported', 'Song does not belong to Spotify', 'spotify');
    }
    return source.mediaId;
};

// `beside` is what the row around the track says of it where the track itself does not: its uri,
// or the album it was read from. Answers null for a row that is not a song (a podcast episode, a
// track Spotify has withdrawn).
export const spotifySongOf = (
    track: SpotifyTrack | null | undefined,
    beside: { uri?: string; album?: UnifiedSong['album'] } = {},
): UnifiedSong | null => {
    const id = spotifyId(track?.uri ?? beside.uri, 'track');
    if (!track || !id || !track.name || (track.__typename && track.__typename !== 'Track')) return null;
    const albumId = spotifyId(track.albumOfTrack?.uri, 'album');
    return {
        id,
        name: track.name,
        artists: artistsOf(track.artists?.items),
        album: beside.album ?? {
            id: albumId, name: track.albumOfTrack?.name || '', coverUrl: pictureOf(track.albumOfTrack?.coverArt?.sources), catalogRef: ref('album', albumId),
        },
        durationMs: Math.max(0, Number(track.duration?.totalMilliseconds ?? track.trackDuration?.totalMilliseconds) || 0),
        sourceRef: { kind: 'online', providerId: 'spotify', mediaId: id },
    };
};

// Cached canonical songs pass through unchanged.
export const normalizeSpotifySong = (raw: unknown): UnifiedSong => {
    const item = (raw ?? {}) as SpotifyTrack & { sourceRef?: UnifiedSong['sourceRef'] };
    if (item.sourceRef?.kind === 'online' && item.sourceRef.providerId === 'spotify') return item as unknown as UnifiedSong;
    const song = spotifySongOf(item);
    if (!song) throw new OnlineProviderError('invalid-response', 'Spotify song has no id', 'spotify');
    return song;
};

export const normalizeSpotifyUser = (raw: unknown): ProviderUser => {
    const item = (raw ?? {}) as Partial<ProviderUser>;
    return {
        id: String(item.id ?? ''),
        nickname: String(item.nickname ?? ''),
        avatarUrl: item.avatarUrl || '',
        ...(item.vipType === undefined ? {} : { vipType: Number(item.vipType) || 0 }),
    };
};

export const spotifyPlaylistOf = (playlist: SpotifyPlaylist | null | undefined): ProviderCollection | null => {
    const id = spotifyId(playlist?.uri, 'playlist');
    if (!playlist || !id || (playlist.__typename && playlist.__typename !== 'Playlist')) return null;
    const owner = playlist.ownerV2?.data?.name;
    return {
        providerId: 'spotify', id, type: 'playlist', name: playlist.name || '',
        coverUrl: pictureOf(playlist.images?.items?.[0]?.sources),
        description: plainText(playlist.description),
        ...(owner ? { creator: { id: '', nickname: owner } } : {}),
        ...(playlist.content?.totalCount === undefined ? {} : { trackCount: playlist.content.totalCount }),
        // The account may change the songs of its own playlists, and of the ones it was invited to.
        ...(playlist.currentUserCapabilities?.canEditItems ? { isOwned: true } : {}),
    };
};

export const spotifyAlbumOf = (album: SpotifyAlbum | null | undefined): ProviderCollection | null => {
    const id = spotifyId(album?.uri, 'album');
    if (!album || !id || (album.__typename && album.__typename !== 'Album')) return null;
    const publishedAt = album.date?.isoString ? Date.parse(album.date.isoString) : album.date?.year ? Date.UTC(album.date.year, 0, 1) : NaN;
    const trackCount = album.tracksV2?.totalCount ?? album.tracks?.totalCount;
    return {
        providerId: 'spotify', id, type: 'album', name: album.name || '',
        coverUrl: pictureOf(album.coverArt?.sources), description: '',
        artists: artistsOf(album.artists?.items),
        ...(trackCount === undefined ? {} : { trackCount }),
        ...(Number.isFinite(publishedAt) ? { publishedAt } : {}),
    };
};

export const spotifyArtistOf = (artist: SpotifyArtistRow | null | undefined): ProviderCollection | null => {
    const id = spotifyId(artist?.uri, 'artist');
    if (!artist || !id || !artist.profile?.name) return null;
    return {
        providerId: 'spotify', id, type: 'artist', name: artist.profile.name,
        coverUrl: pictureOf(artist.visuals?.avatarImage?.sources ?? undefined), description: '',
    };
};

// Cached canonical collections pass through unchanged; anything else is one of Spotify's rows.
export const normalizeSpotifyCollection = (raw: unknown, type = 'playlist'): ProviderCollection => {
    const item = (raw ?? {}) as SpotifyEntity & { providerId?: string };
    if (item.providerId === 'spotify') return item as unknown as ProviderCollection;
    const collection = type === 'album' ? spotifyAlbumOf(item as SpotifyAlbum)
        : type === 'artist' ? spotifyArtistOf(item as SpotifyArtistRow) : spotifyPlaylistOf(item as SpotifyPlaylist);
    if (!collection) throw new OnlineProviderError('invalid-response', 'Spotify collection has no id', 'spotify');
    return collection;
};

// Spotify pages by offset, as the app does. `read` is how many rows the answer held before the
// ones that are not songs were left out: the next page begins after them.
export const spotifyPage = <T>(items: T[], offset: number, read: number, total: number | undefined): ProviderPage<T> => {
    const nextOffset = offset + read;
    return { items, ...(total === undefined ? {} : { total }), nextOffset, hasMore: read > 0 && (total === undefined || nextOffset < total) };
};

export const present = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;
