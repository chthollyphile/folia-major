import type { Album, Artist, UnifiedSong } from '../../../types';
import type { ProviderCatalogRef, ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/appleMusic/normalize.ts

type Attributes = {
    name?: string; artistName?: string; albumName?: string; durationInMillis?: number;
    artwork?: { url?: string }; description?: { standard?: string; short?: string };
    editorialNotes?: { standard?: string; short?: string }; trackCount?: number;
    playParams?: { id?: string; catalogId?: string }; url?: string;
    releaseDate?: string; recordLabel?: string; canEdit?: boolean;
};
type Relationship = { data?: AppleResource[] };
export interface AppleResource { id: string; type: string; attributes?: Attributes; relationships?: Record<string, Relationship | undefined> }
export interface ApplePage { data: AppleResource[]; next?: string }

export const artworkUrl = (artwork?: { url?: string }): string | undefined => artwork?.url
    ?.replace(/\{w\}|\{h\}/g, '600').replace('{f}', 'jpg');

const appleCatalogRef = (kind: 'album' | 'artist', id: string): ProviderCatalogRef => ({ providerId: 'applemusic', kind, id });

// Only catalog relationships (`artists`, `albums`) can open a detail page; library ones (`r.`, `l.`) are skipped.
const relatedCatalog = (item: AppleResource, key: 'artists' | 'albums'): AppleResource[] => (
    (item.relationships?.[key]?.data ?? []).filter(related => related.type === key && typeof related.id === 'string' && related.id !== '')
);

export function normalizeAppleSong(raw: unknown): UnifiedSong {
    const item = raw as AppleResource;
    if (!item || typeof item.id !== 'string' || !item.attributes?.name) throw new OnlineProviderError('invalid-response', 'Invalid Apple Music song.', 'applemusic');
    const a = item.attributes;
    const relatedArtists = relatedCatalog(item, 'artists');
    const relatedAlbum = relatedCatalog(item, 'albums')[0];
    const artists: Artist[] = relatedArtists.length > 0
        ? relatedArtists.map(artist => ({ id: artist.id, name: artist.attributes?.name || a.artistName || '', catalogRef: appleCatalogRef('artist', artist.id) }))
        : [{ id: 0, name: a.artistName || '' }];
    const album: Album = {
        id: relatedAlbum?.id ?? 0, name: a.albumName || relatedAlbum?.attributes?.name || '', coverUrl: artworkUrl(a.artwork),
        ...(relatedAlbum ? { catalogRef: appleCatalogRef('album', relatedAlbum.id) } : {}),
    };
    return {
        id: item.id, name: a.name!, artists, album,
        durationMs: Number.isFinite(a.durationInMillis) ? a.durationInMillis! : 0,
        sourceRef: { kind: 'online', providerId: 'applemusic', mediaId: item.id,
            providerData: { catalogId: a.playParams?.catalogId || item.id, url: a.url || '' } },
    };
}

const collectionType = (item: AppleResource, type?: string): 'playlist' | 'album' | 'artist' => {
    if (type === 'album' || type === 'artist') return type;
    if (type === 'playlist') return 'playlist';
    return item.type.includes('album') ? 'album' : item.type.includes('artist') ? 'artist' : 'playlist';
};

// Playlists, albums and artists share one resource envelope; `type` disambiguates when the caller knows it.
export function normalizeAppleCollection(raw: unknown, type?: string): ProviderCollection {
    const item = raw as AppleResource;
    if (!item?.id || !item.attributes?.name) throw new OnlineProviderError('invalid-response', 'Invalid Apple Music collection.', 'applemusic');
    const a = item.attributes;
    const resolved = collectionType(item, type);
    const description = a.description?.standard || a.editorialNotes?.standard || a.editorialNotes?.short;
    const base: ProviderCollection = { providerId: 'applemusic', id: item.id, type: resolved, name: a.name!, coverUrl: artworkUrl(a.artwork), description };
    if (resolved === 'artist') return base;
    if (resolved === 'album') {
        const artist = relatedCatalog(item, 'artists')[0];
        const publishedAt = a.releaseDate ? Date.parse(a.releaseDate) : NaN;
        return {
            ...base, trackCount: a.trackCount,
            ...(a.artistName ? { artists: [{ id: artist?.id ?? 0, name: a.artistName, ...(artist ? { catalogRef: appleCatalogRef('artist', artist.id) } : {}) }] } : {}),
            ...(Number.isFinite(publishedAt) ? { publishedAt } : {}),
            ...(a.recordLabel ? { publisher: a.recordLabel } : {}),
            providerData: { catalogId: a.playParams?.catalogId || item.id },
        };
    }
    // `canEdit` marks the user's own library playlists, the only ones Apple lets clients append to.
    return { ...base, trackCount: a.trackCount, isOwned: false, providerData: { canEdit: a.canEdit === true, catalogId: a.playParams?.catalogId || item.id } };
}

export function applePage<T>(raw: ApplePage, offset: number, normalize: (item: unknown) => T): ProviderPage<T> {
    if (!Array.isArray(raw?.data)) throw new OnlineProviderError('invalid-response', 'Invalid Apple Music page.', 'applemusic');
    const items = raw.data.map(normalize);
    const nextOffset = raw.next ? Number(new URL(raw.next, 'https://api.music.apple.com').searchParams.get('offset')) : NaN;
    return { items, hasMore: Boolean(raw.next) && items.length > 0,
        nextOffset: Number.isFinite(nextOffset) && nextOffset > offset ? nextOffset : offset + items.length };
}
