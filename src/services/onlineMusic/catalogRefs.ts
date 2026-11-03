import type { Album, Artist, UnifiedSong } from '../../types';
import type { ProviderCatalogEntityKind, ProviderCatalogRef, ProviderNamedCatalogRef, ProviderSongCatalogRefs } from '../../types/onlineMusic';
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
    requested: CatalogTarget | null | undefined,
): boolean => {
    if (!requested) return false;
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

// Where the requested artist stands among the song's artists before the provider resolves the song.
const originalArtistIndexOf = (song: UnifiedSong, kind: 'album' | 'artist', requested: CatalogTarget): number => (
    kind === 'artist'
        ? song.artists.findIndex(artist => (
            artist === requested
            || artist.id === requested.id
            || artist.name === requested.name
        ))
        : -1
);

// The ref of one display entity of `song`. `resolvedSong`: the song as the provider's resolver
// answered it, or null where the provider has no resolver.
const catalogRefOf = (
    song: UnifiedSong,
    resolvedSong: UnifiedSong | null,
    kind: 'album' | 'artist',
    requested: CatalogTarget,
    originalArtistIndex: number,
): { ref: ProviderCatalogRef; target: CatalogTarget } | null => {
    const sourceRef = song.sourceRef;
    if (sourceRef?.kind !== 'online') return null;
    if (resolvedSong) {
        const resolvedTarget = findResolvedTarget(resolvedSong, kind, requested, originalArtistIndex);
        return isMatchingRef(resolvedTarget?.catalogRef, sourceRef.providerId, kind)
            ? { ref: resolvedTarget.catalogRef, target: resolvedTarget }
            : null;
    }

    if (isMatchingRef(requested.catalogRef, sourceRef.providerId, kind)) {
        return { ref: requested.catalogRef, target: requested };
    }

    if (requested.id === '') return null;
    return { ref: { providerId: sourceRef.providerId, kind, id: requested.id }, target: requested };
};

// Resolves a display entity to the canonical catalog id required by its online provider.
export const resolveSongCatalogRef = async (
    song: UnifiedSong,
    kind: 'album' | 'artist',
    requested: CatalogTarget | null | undefined,
): Promise<ProviderCatalogRef | null> => {
    if (!requested) return null;
    const sourceRef = song.sourceRef;
    if (sourceRef?.kind !== 'online') return null;

    const provider = getOnlineMusicProvider(sourceRef.providerId);
    const resolver = provider?.catalog?.resolveSongCatalogRefs;
    const originalArtistIndex = originalArtistIndexOf(song, kind, requested);
    const resolvedSong = resolver ? await resolver(song) : null;
    return catalogRefOf(song, resolvedSong, kind, requested, originalArtistIndex)?.ref ?? null;
};

// The refs of a song's album and of each of its artists, as `resolveSongCatalogRef` makes them one
// at a time, from one answer of the provider's resolver: it is asked once for the song, and not at
// all where none of them can be resolved (`canResolveSongCatalogRef`). `kinds` leaves out what the
// caller will not open. An artist's ref that an earlier artist already has is given once.
export const resolveSongCatalogRefSet = async (
    song: UnifiedSong,
    kinds: { album: boolean; artists: boolean },
): Promise<ProviderSongCatalogRefs> => {
    const none: ProviderSongCatalogRefs = { album: null, artists: [] };
    const sourceRef = song.sourceRef;
    if (sourceRef?.kind !== 'online') return none;

    const album = kinds.album && canResolveSongCatalogRef(song, 'album', song.album) ? song.album : null;
    const artists = kinds.artists
        ? (song.artists ?? []).filter(artist => canResolveSongCatalogRef(song, 'artist', artist))
        : [];
    if (!album && artists.length === 0) return none;

    const resolver = getOnlineMusicProvider(sourceRef.providerId)?.catalog?.resolveSongCatalogRefs;
    const artistIndexes = artists.map(artist => originalArtistIndexOf(song, 'artist', artist));
    const resolvedSong = resolver ? await resolver(song) : null;
    const named = (
        found: { ref: ProviderCatalogRef; target: CatalogTarget } | null,
        requested: CatalogTarget,
    ): ProviderNamedCatalogRef | null => (found ? {
        providerId: found.ref.providerId,
        kind: found.ref.kind,
        id: found.ref.id,
        name: found.target.name.trim() || requested.name.trim(),
    } : null);

    const artistRefs: ProviderNamedCatalogRef[] = [];
    const seen = new Set<string>();
    artists.forEach((artist, index) => {
        const ref = named(catalogRefOf(song, resolvedSong, 'artist', artist, artistIndexes[index]), artist);
        if (!ref || seen.has(String(ref.id))) return;
        seen.add(String(ref.id));
        artistRefs.push(ref);
    });
    return {
        album: album ? named(catalogRefOf(song, resolvedSong, 'album', album, -1), album) : null,
        artists: artistRefs,
    };
};
