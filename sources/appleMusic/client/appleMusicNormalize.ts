import type { FoliumJsonValue, FoliumSourceCollection, FoliumSourceNamedRef, FoliumSourceSong, FoliumSourceUser } from '@folia/folium';
import { appleMusicError } from './appleMusicTransport';

// Convert Apple Music catalog and library resources into the source DTOs (mods/folium.d.ts) the host takes: the
// host turns them into its own songs and collections, naming this source on them. `data` is what the built-in
// provider kept as `providerData`, field for field, so songs saved before the source became a mod read the same.

const record = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
const text = (value: unknown): string => typeof value === 'string' ? value : '';

// Apple supplies artwork as a template rather than a ready-to-display image URL.
const artworkUrl = (value: unknown): string => text(record(value).url)
    .replaceAll('{w}', '512')
    .replaceAll('{h}', '512');

// A per-profile pseudonym keeps account snapshots separate without exposing an Apple identifier.
export const normalizeAppleMusicUser = (value: unknown): FoliumSourceUser => {
    const user = record(value);
    const id = text(user.id);
    if (!/^[a-f0-9]{64}$/.test(id)) {
        throw appleMusicError('invalid-response', 'Apple Music account identity is unavailable');
    }
    const avatarUrl = text(user.avatarUrl).replaceAll('{w}', '128').replaceAll('{h}', '128');
    return { id, nickname: text(user.nickname) || 'Apple Music', ...(avatarUrl ? { avatarUrl } : {}) };
};

// Keep the library identity and catalog identity separately: both can be needed for playback and lyrics.
export const normalizeAppleMusicSong = (value: unknown): FoliumSourceSong => {
    const resource = record(value);
    const id = text(resource.id);
    const type = text(resource.type);
    if (!id || (type !== 'songs' && type !== 'library-songs')) {
        throw appleMusicError('invalid-response', 'Apple Music song identity is missing or unsupported');
    }
    const attributes = record(resource.attributes);
    const params = record(attributes.playParams);
    const artistName = text(attributes.artistName);
    const catalogAlbums = Array.isArray(attributes.catalogAlbums) ? attributes.catalogAlbums.map(record).filter(item => /^\d{1,40}$/.test(text(item.id))) : [];
    const catalogArtists = Array.isArray(attributes.catalogArtists) ? attributes.catalogArtists.map(record).filter(item => /^\d{1,40}$/.test(text(item.id))) : [];
    const albumId = text(catalogAlbums[0]?.id);
    const duration = attributes.durationInMillis;
    const data: Record<string, FoliumJsonValue> = {
        resourceType: type,
        ...(catalogArtists.length ? { catalogArtistIds: catalogArtists.map(item => text(item.id)) } : {}),
        ...(typeof attributes.playbackAvailable === 'boolean' ? { playbackAvailable: attributes.playbackAvailable } : {}),
        ...(text(params.id) ? { playbackId: text(params.id) } : {}),
        ...(text(params.kind) ? { playbackKind: text(params.kind) } : {}),
        ...(text(params.catalogId) ? { catalogId: text(params.catalogId) } : {}),
        ...(typeof params.isLibrary === 'boolean' ? { isLibrary: params.isLibrary } : {}),
        ...(text(attributes.isrc) ? { isrc: text(attributes.isrc) } : {}),
    };
    const coverUrl = artworkUrl(attributes.artwork);
    // A catalog artist opens its page; a name with no id does not (an empty id makes no catalog link).
    const artists: FoliumSourceNamedRef[] = catalogArtists.length && catalogArtists.every(item => text(item.name))
        ? catalogArtists.map(item => ({ id: text(item.id), name: text(item.name) }))
        : artistName ? [{ id: '', name: artistName }] : [];
    return {
        id,
        title: text(attributes.name),
        artists,
        album: { id: albumId, name: text(attributes.albumName), ...(coverUrl ? { coverUrl } : {}) },
        durationMs: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0,
        data,
    };
};

// Preserve library playlist IDs so the companion can request their tracks without guessing a catalog ID.
export const normalizeAppleMusicPlaylist = (value: unknown): FoliumSourceCollection => {
    const resource = record(value);
    const id = text(resource.id);
    const type = text(resource.type);
    if (!id || (type !== 'playlists' && type !== 'library-playlists')) {
        throw appleMusicError('invalid-response', 'Apple Music playlist identity is missing or unsupported');
    }
    const attributes = record(resource.attributes);
    const coverUrl = artworkUrl(attributes.artwork);
    return {
        id,
        type: 'playlist',
        ...(attributes.isFavoritePlaylist === true ? { isLiked: true } : {}),
        name: text(attributes.name),
        ...(coverUrl ? { coverUrl } : {}),
        data: { resourceType: type, ...(typeof attributes.canEdit === 'boolean' ? { canEdit: attributes.canEdit } : {}) },
    };
};

// Keep the library album identity so its own tracks can be fetched without guessing a catalog ID.
export const normalizeAppleMusicLibraryAlbum = (value: unknown): FoliumSourceCollection => {
    const resource = record(value);
    const id = text(resource.id);
    if (!/^l\.[a-zA-Z0-9._-]{1,198}$/.test(id) || resource.type !== 'library-albums') {
        throw appleMusicError('invalid-response', 'Apple Music library album identity is invalid');
    }
    const attributes = record(resource.attributes);
    // A library album names its artist but gives no catalog ID: shown on the album page, not openable.
    const artistName = text(attributes.artistName);
    const coverUrl = artworkUrl(attributes.artwork);
    return { id, type: 'album', name: text(attributes.name),
        ...(coverUrl ? { coverUrl } : {}),
        ...(artistName ? { artists: [{ id: '', name: artistName }] } : {}),
        ...(typeof attributes.trackCount === 'number' && Number.isSafeInteger(attributes.trackCount) && attributes.trackCount >= 0 ? { trackCount: attributes.trackCount } : {}),
        data: { resourceType: 'library-albums' } };
};

// An album's artists: named catalog artists open their pages; a lone unnamed ID takes the album's
// artist name; several unnamed IDs keep the combined name (not openable) and pass the IDs on so the
// album detail can name each one rather than assigning the combined name to the wrong artist.
const catalogAlbumArtists = (attributes: Record<string, unknown>): { artists?: FoliumSourceNamedRef[]; data?: Record<string, FoliumJsonValue> } => {
    const artistName = text(attributes.artistName);
    const catalogArtists = Array.isArray(attributes.catalogArtists) ? attributes.catalogArtists.map(record).filter(item => /^\d{1,40}$/.test(text(item.id))) : [];
    if (catalogArtists.length && catalogArtists.every(item => text(item.name))) {
        return { artists: catalogArtists.map(item => ({ id: text(item.id), name: text(item.name) })) };
    }
    if (catalogArtists.length === 1 && artistName) return { artists: [{ id: text(catalogArtists[0].id), name: artistName }] };
    return {
        ...(artistName ? { artists: [{ id: '', name: artistName }] } : {}),
        ...(catalogArtists.length > 1 ? { data: { catalogArtistIds: catalogArtists.map(item => text(item.id)) } } : {}),
    };
};

// Catalog albums and artists use numeric Apple IDs, distinct from local library albums.
export const normalizeAppleMusicCatalogCollection = (value: unknown): FoliumSourceCollection => {
    const resource = record(value);
    const id = text(resource.id);
    if (!/^\d{1,40}$/.test(id) || (resource.type !== 'albums' && resource.type !== 'artists')) {
        throw appleMusicError('invalid-response', 'Apple Music catalog identity is invalid');
    }
    const attributes = record(resource.attributes);
    const albumArtists = resource.type === 'albums' ? catalogAlbumArtists(attributes) : {};
    const coverUrl = artworkUrl(attributes.artwork);
    return { id, type: resource.type === 'albums' ? 'album' : 'artist',
        name: text(attributes.name), ...(coverUrl ? { coverUrl } : {}),
        ...(albumArtists.artists ? { artists: albumArtists.artists } : {}),
        data: { resourceType: resource.type, ...albumArtists.data } };
};
