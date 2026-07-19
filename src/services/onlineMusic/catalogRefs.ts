import type { Album, Artist, UnifiedSong } from '../../types';
import type { ProviderCatalogEntityKind, ProviderCatalogRef } from '../../types/onlineMusic';
import { getOnlineMusicProvider } from './providerRegistry';

// src/services/onlineMusic/catalogRefs.ts

type CatalogTarget = Album | Artist;

const isMatchingRef = (
    ref: ProviderCatalogRef | undefined,
    providerId: string,
    kind: ProviderCatalogEntityKind,
): ref is ProviderCatalogRef => Boolean(
    ref
    && ref.providerId === providerId
    && ref.kind === kind
    && ref.id !== '',
);

export const canResolveSongCatalogRef = (
    song: UnifiedSong,
    kind: 'album' | 'artist',
    requested: CatalogTarget,
): boolean => {
    const sourceRef = song.sourceRef;
    if (sourceRef?.kind !== 'online') return false;
    if (isMatchingRef(requested.catalogRef, sourceRef.providerId, kind)) return true;

    const catalog = getOnlineMusicProvider(sourceRef.providerId)?.catalog;
    if (catalog?.canResolveSongCatalogRefs) return catalog.canResolveSongCatalogRefs(song);
    if (catalog?.resolveSongCatalogRefs) return true;
    return requested.id !== '';
};

const findResolvedTarget = (
    song: UnifiedSong,
    kind: 'album' | 'artist',
    requested: CatalogTarget,
    originalArtistIndex: number,
): CatalogTarget | undefined => {
    if (kind === 'album') return song.album;

    const requestedName = requested.name.trim().toLocaleLowerCase();
    return song.artists.find(artist => (
        requestedName
        && artist.name.trim().toLocaleLowerCase() === requestedName
    )) ?? song.artists.find(artist => artist.id === requested.id)
        ?? (originalArtistIndex >= 0 ? song.artists[originalArtistIndex] : undefined);
};

// Resolves a display entity to the canonical catalog id required by its online provider.
export const resolveSongCatalogRef = async (
    song: UnifiedSong,
    kind: 'album' | 'artist',
    requested: CatalogTarget,
): Promise<ProviderCatalogRef | null> => {
    const sourceRef = song.sourceRef;
    if (sourceRef?.kind !== 'online') return null;

    const provider = getOnlineMusicProvider(sourceRef.providerId);
    const resolver = provider?.catalog?.resolveSongCatalogRefs;
    if (resolver) {
        const originalArtistIndex = kind === 'artist'
            ? song.artists.findIndex(artist => (
                artist === requested
                || artist.id === requested.id
                || artist.name === requested.name
            ))
            : -1;
        const resolvedSong = await resolver(song);
        const resolvedTarget = findResolvedTarget(resolvedSong, kind, requested, originalArtistIndex);
        return isMatchingRef(resolvedTarget?.catalogRef, sourceRef.providerId, kind)
            ? resolvedTarget.catalogRef
            : null;
    }

    if (isMatchingRef(requested.catalogRef, sourceRef.providerId, kind)) {
        return requested.catalogRef;
    }

    if (requested.id === '') return null;
    return { providerId: sourceRef.providerId, kind, id: requested.id };
};
