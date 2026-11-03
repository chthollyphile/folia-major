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
    const duration = attributes.durationInMillis;
    const providerData: Record<string, JsonValue> = {
        resourceType: type,
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
        artists: artistName ? [{ id: '', name: artistName }] : [],
        album: { id: '', name: text(attributes.albumName), coverUrl: artworkUrl(attributes.artwork) },
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
