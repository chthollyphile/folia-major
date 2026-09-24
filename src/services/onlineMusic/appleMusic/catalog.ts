import type { UnifiedSong } from '../../../types';
import type { MediaId, ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { applePage, normalizeAppleCollection, normalizeAppleSong, type ApplePage } from './normalize';
import { appleAlbumPath, applePath, getStorefront, requestApple } from './transport';

// src/services/onlineMusic/appleMusic/catalog.ts

const encode = (id: MediaId) => encodeURIComponent(String(id));
const pageSize = (limit: number, max = 100) => Math.max(1, Math.min(max, Math.floor(limit)));
const hasCatalogRefs = (song: UnifiedSong) => Boolean(song.album.catalogRef) && song.artists.every(artist => artist.catalogRef);

export const canResolveAppleSongCatalogRefs = (song: UnifiedSong) => song.sourceRef.kind === 'online' && song.sourceRef.providerId === 'applemusic';

// Search and playlist tracks omit relationships; fetch the catalog song once to learn its album and artist ids.
export async function resolveAppleSongCatalogRefs(song: UnifiedSong): Promise<UnifiedSong> {
    if (hasCatalogRefs(song) || song.sourceRef.kind !== 'online') return song;
    const storefront = await getStorefront();
    let id = String(song.sourceRef.providerData?.catalogId || song.sourceRef.mediaId);
    if (id.startsWith('i.')) {
        const catalog = await requestApple<ApplePage>(applePath(id, storefront, '/catalog'));
        id = catalog.data?.[0]?.id ?? '';
        if (!id) return song;
    }
    const detail = await requestApple<ApplePage>(`${applePath(id, storefront)}?include=albums,artists`);
    if (!detail.data?.[0]) return song;
    const resolved = normalizeAppleSong(detail.data[0]);
    return {
        ...song,
        artists: resolved.artists.some(artist => artist.catalogRef) ? resolved.artists : song.artists,
        album: {
            ...song.album,
            ...(resolved.album.catalogRef ? { id: resolved.album.id, catalogRef: resolved.album.catalogRef } : {}),
            name: song.album.name || resolved.album.name,
            coverUrl: song.album.coverUrl || resolved.album.coverUrl,
        },
    };
}

export async function getAppleAlbumDetail(id: MediaId, existing?: ProviderCollection): Promise<ProviderCollection | null> {
    const result = await requestApple<ApplePage>(appleAlbumPath(String(id), await getStorefront()));
    if (!result.data?.[0]) return existing ?? null;
    const album = normalizeAppleCollection(result.data[0], 'album');
    return { ...existing, ...album, coverUrl: album.coverUrl || existing?.coverUrl, description: album.description || existing?.description };
}

export async function getAppleAlbumTracks(id: MediaId, limit = 100, offset = 0, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>> {
    const albumId = String(id);
    const path = appleAlbumPath(albumId, await getStorefront(), `/tracks?limit=${pageSize(limit)}&offset=${Math.max(0, offset)}`);
    const page = applePage(await requestApple<ApplePage>(path), offset, normalizeAppleSong);
    // Album tracks arrive without relationships; the album itself is already known to the caller.
    const catalogRef = albumId.startsWith('l.') ? undefined : { providerId: 'applemusic' as const, kind: 'album' as const, id: albumId };
    return {
        ...page,
        items: page.items.map(song => ({ ...song, album: {
            ...song.album, id: catalogRef ? albumId : song.album.id, name: song.album.name || collection?.name || '',
            coverUrl: song.album.coverUrl || collection?.coverUrl, ...(catalogRef ? { catalogRef } : {}),
        } })),
    };
}

export async function getAppleArtistDetail(id: MediaId): Promise<ProviderCollection | null> {
    const result = await requestApple<ApplePage>(`/v1/catalog/${await getStorefront()}/artists/${encode(id)}`);
    return result.data?.[0] ? normalizeAppleCollection(result.data[0], 'artist') : null;
}

// Apple exposes an artist's songs only through the `top-songs` view, which caps each page at 20.
export async function getAppleArtistSongs(id: MediaId, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
    const path = `/v1/catalog/${await getStorefront()}/artists/${encode(id)}/view/top-songs?limit=${pageSize(limit, 20)}&offset=${Math.max(0, offset)}`;
    return applePage(await requestApple<ApplePage>(path), offset, normalizeAppleSong);
}

export async function getAppleArtistAlbums(id: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> {
    const path = `/v1/catalog/${await getStorefront()}/artists/${encode(id)}/albums?limit=${pageSize(limit)}&offset=${Math.max(0, offset)}`;
    return applePage(await requestApple<ApplePage>(path), offset, item => normalizeAppleCollection(item, 'album'));
}

export async function getAppleUserAlbums(limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> {
    const path = `/v1/me/library/albums?limit=${pageSize(limit)}&offset=${Math.max(0, offset)}`;
    return applePage(await requestApple<ApplePage>(path), offset, item => normalizeAppleCollection(item, 'album'));
}

// ISRC is an exact identity, so one lookup replaces fuzzy title matching for tagged local files.
export async function searchAppleSongsByIsrc(isrc: string): Promise<UnifiedSong[]> {
    const code = isrc.trim().toUpperCase();
    if (!/^[A-Z0-9]{12}$/.test(code)) return [];
    const result = await requestApple<ApplePage>(`/v1/catalog/${await getStorefront()}/songs?filter[isrc]=${code}`);
    return (Array.isArray(result.data) ? result.data : []).map(normalizeAppleSong);
}

// The user's whole library, exposed as the provider's "cloud" collection.
export async function getAppleLibrarySongs(limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
    const path = `/v1/me/library/songs?limit=${pageSize(limit)}&offset=${Math.max(0, offset)}`;
    return applePage(await requestApple<ApplePage>(path), offset, normalizeAppleSong);
}
