import type { UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { JsonValue, ProviderCollection, ProviderUser } from '../../../types/onlineMusic';

// Convert Apple Music catalog and library resources into Folia's provider-aware types.
const PROVIDER_ID = 'appleMusic';

const record = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
const text = (value: unknown): string => typeof value === 'string' ? value : '';

// Apple supplies artwork as a template rather than a ready-to-display image URL.
const artworkUrl = (value: unknown): string => text(record(value).url)
    .replaceAll('{w}', '512')
    .replaceAll('{h}', '512');

// A per-profile pseudonym keeps account snapshots separate without exposing an Apple identifier.
export const normalizeAppleMusicUser = (value: unknown): ProviderUser => {
    const user = record(value);
    const id = text(user.id);
    if (!/^[a-f0-9]{64}$/.test(id)) {
        throw new OnlineProviderError('invalid-response', 'Apple Music account identity is unavailable', PROVIDER_ID);
    }
    const avatarUrl = text(user.avatarUrl).replaceAll('{w}', '128').replaceAll('{h}', '128');
    return { id, nickname: text(user.nickname) || 'Apple Music', ...(avatarUrl ? { avatarUrl } : {}) };
};

// Keep the library identity and catalog identity separately: both can be needed for playback and lyrics.
export const normalizeAppleMusicSong = (value: unknown): UnifiedSong => {
    const resource = record(value);
    const source = record(resource.sourceRef);
    if (source.kind === 'online' && source.providerId === PROVIDER_ID && typeof source.mediaId === 'string') {
        return value as UnifiedSong;
    }
    const id = text(resource.id);
    const type = text(resource.type);
    if (!id || (type !== 'songs' && type !== 'library-songs')) {
        throw new OnlineProviderError('invalid-response', 'Apple Music song identity is missing or unsupported', PROVIDER_ID);
    }
    const attributes = record(resource.attributes);
    const params = record(attributes.playParams);
    const artistName = text(attributes.artistName);
    const catalogAlbums = Array.isArray(attributes.catalogAlbums) ? attributes.catalogAlbums.map(record).filter(item => /^\d{1,40}$/.test(text(item.id))) : [];
    const catalogArtists = Array.isArray(attributes.catalogArtists) ? attributes.catalogArtists.map(record).filter(item => /^\d{1,40}$/.test(text(item.id))) : [];
    const albumId = text(catalogAlbums[0]?.id);
    const duration = attributes.durationInMillis;
    const providerData: Record<string, JsonValue> = {
        resourceType: type,
        ...(catalogArtists.length ? { catalogArtistIds: catalogArtists.map(item => text(item.id)) } : {}),
        ...(typeof attributes.playbackAvailable === 'boolean' ? { playbackAvailable: attributes.playbackAvailable } : {}),
        ...(text(params.id) ? { playbackId: text(params.id) } : {}),
        ...(text(params.kind) ? { playbackKind: text(params.kind) } : {}),
        ...(text(params.catalogId) ? { catalogId: text(params.catalogId) } : {}),
        ...(typeof params.isLibrary === 'boolean' ? { isLibrary: params.isLibrary } : {}),
        ...(text(attributes.isrc) ? { isrc: text(attributes.isrc) } : {}),
    };
    return {
        id,
        name: text(attributes.name),
        artists: catalogArtists.length && catalogArtists.every(item => text(item.name)) ? catalogArtists.map(item => ({ id: text(item.id), name: text(item.name),
            catalogRef: { providerId: PROVIDER_ID, kind: 'artist' as const, id: text(item.id) } })) : artistName ? [{ id: '', name: artistName }] : [],
        album: { id: albumId, name: text(attributes.albumName), coverUrl: artworkUrl(attributes.artwork),
            ...(albumId ? { catalogRef: { providerId: PROVIDER_ID, kind: 'album' as const, id: albumId } } : {}) },
        durationMs: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0,
        sourceRef: { kind: 'online', providerId: PROVIDER_ID, mediaId: id, providerData },
    };
};

// Preserve library playlist IDs so the companion can request their tracks without guessing a catalog ID.
export const normalizeAppleMusicPlaylist = (value: unknown): ProviderCollection => {
    const resource = record(value);
    if (resource.providerId === PROVIDER_ID && resource.type === 'playlist' && typeof resource.id === 'string') {
        return value as ProviderCollection;
    }
    const id = text(resource.id);
    const type = text(resource.type);
    if (!id || (type !== 'playlists' && type !== 'library-playlists')) {
        throw new OnlineProviderError('invalid-response', 'Apple Music playlist identity is missing or unsupported', PROVIDER_ID);
    }
    const attributes = record(resource.attributes);
    return {
        providerId: PROVIDER_ID,
        id,
        type: 'playlist',
        ...(attributes.isFavoritePlaylist === true ? { isLiked: true } : {}),
        name: text(attributes.name),
        coverUrl: artworkUrl(attributes.artwork),
        providerData: { resourceType: type, ...(typeof attributes.canEdit === 'boolean' ? { canEdit: attributes.canEdit } : {}) },
    };
};

// Keep the library album identity so its own tracks can be fetched without guessing a catalog ID.
export const normalizeAppleMusicLibraryAlbum = (value: unknown): ProviderCollection => {
    const resource = record(value);
    const id = text(resource.id);
    if (!/^l\.[a-zA-Z0-9._-]{1,198}$/.test(id) || resource.type !== 'library-albums') {
        throw new OnlineProviderError('invalid-response', 'Apple Music library album identity is invalid', PROVIDER_ID);
    }
    const attributes = record(resource.attributes);
    // A library album names its artist but gives no catalog ID: shown on the album page, not openable.
    const artistName = text(attributes.artistName);
    return { providerId: PROVIDER_ID, id, type: 'album', name: text(attributes.name),
        coverUrl: artworkUrl(attributes.artwork),
        ...(artistName ? { artists: [{ id: '', name: artistName }] } : {}),
        ...(typeof attributes.trackCount === 'number' && Number.isSafeInteger(attributes.trackCount) && attributes.trackCount >= 0 ? { trackCount: attributes.trackCount } : {}),
        providerData: { resourceType: 'library-albums' } };
};

// An album's artists: named catalog artists open their pages; a lone unnamed ID takes the album's
// artist name; several unnamed IDs keep the combined name (not openable) and pass the IDs on so the
// album detail can name each one rather than assigning the combined name to the wrong artist.
const catalogAlbumArtists = (attributes: Record<string, unknown>): Pick<ProviderCollection, 'artists' | 'providerData'> => {
    const artistName = text(attributes.artistName);
    const catalogArtists = Array.isArray(attributes.catalogArtists) ? attributes.catalogArtists.map(record).filter(item => /^\d{1,40}$/.test(text(item.id))) : [];
    const linked = (id: string, name: string) => ({ id, name, catalogRef: { providerId: PROVIDER_ID, kind: 'artist' as const, id } });
    if (catalogArtists.length && catalogArtists.every(item => text(item.name))) {
        return { artists: catalogArtists.map(item => linked(text(item.id), text(item.name))) };
    }
    if (catalogArtists.length === 1 && artistName) return { artists: [linked(text(catalogArtists[0].id), artistName)] };
    return {
        ...(artistName ? { artists: [{ id: '', name: artistName }] } : {}),
        ...(catalogArtists.length > 1 ? { providerData: { catalogArtistIds: catalogArtists.map(item => text(item.id)) } } : {}),
    };
};

// Catalog albums and artists use numeric Apple IDs, distinct from local library albums.
export const normalizeAppleMusicCatalogCollection = (value: unknown): ProviderCollection => {
    const resource = record(value);
    const id = text(resource.id);
    if (!/^\d{1,40}$/.test(id) || (resource.type !== 'albums' && resource.type !== 'artists')) {
        throw new OnlineProviderError('invalid-response', 'Apple Music catalog identity is invalid', PROVIDER_ID);
    }
    const attributes = record(resource.attributes);
    const albumArtists = resource.type === 'albums' ? catalogAlbumArtists(attributes) : {};
    return { providerId: PROVIDER_ID, id, type: resource.type === 'albums' ? 'album' : 'artist',
        name: text(attributes.name), coverUrl: artworkUrl(attributes.artwork),
        ...(albumArtists.artists ? { artists: albumArtists.artists } : {}),
        providerData: { resourceType: resource.type, ...albumArtists.providerData } };
};
