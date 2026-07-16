import type { LocalSong } from '../../types';
import type { LocalLibraryEntity, LocalLibraryEntityKind } from '../../types/localLibrary';
import {
    cleanLocalLibraryName,
    getImportedArtistNames,
    getMatchedArtistNames,
    normalizeLocalLibraryName,
} from '../../utils/localLibraryNames';

// src/components/local-library-entity/entityEditorModel.ts
// Builds input-driven suggestions for the local-library entity editor.

export type EntityNameSuggestion = {
    name: string;
    count: number;
};

const getSongEntityNames = (kind: LocalLibraryEntityKind, song: LocalSong): string[] => {
    if (kind === 'artist') {
        return [
            ...getImportedArtistNames(song),
            ...getMatchedArtistNames(song),
        ];
    }

    return [song.importedMetadata.albumName, song.onlineMetadata?.album?.name]
        .map(cleanLocalLibraryName)
        .filter((name): name is string => Boolean(name));
};

export const buildEntityNameSuggestions = (
    kind: LocalLibraryEntityKind,
    songs: LocalSong[],
): EntityNameSuggestion[] => {
    const namesByNormalizedValue = new Map<string, EntityNameSuggestion>();
    songs.forEach(song => {
        const seenInSong = new Set<string>();
        getSongEntityNames(kind, song).forEach(value => {
            const name = cleanLocalLibraryName(value);
            if (!name) return;
            const normalizedName = normalizeLocalLibraryName(name);
            if (seenInSong.has(normalizedName)) return;
            seenInSong.add(normalizedName);
            const current = namesByNormalizedValue.get(normalizedName);
            namesByNormalizedValue.set(normalizedName, {
                name: current?.name || name,
                count: (current?.count || 0) + 1,
            });
        });
    });

    return Array.from(namesByNormalizedValue.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

export const filterMergeEntitySuggestions = (
    entities: LocalLibraryEntity[],
    currentEntityId: string,
    query: string,
    limit = 8,
): LocalLibraryEntity[] => {
    const normalizedQuery = normalizeLocalLibraryName(query);
    return entities
        .filter(entity => entity.id !== currentEntityId && !entity.mergedInto)
        .filter(entity => {
            if (!normalizedQuery) return true;
            return [entity.displayName, ...entity.aliases]
                .some(name => normalizeLocalLibraryName(name).includes(normalizedQuery));
        })
        .sort((a, b) => {
            if (!normalizedQuery) return a.displayName.localeCompare(b.displayName);
            const aExact = [a.displayName, ...a.aliases]
                .some(name => normalizeLocalLibraryName(name) === normalizedQuery);
            const bExact = [b.displayName, ...b.aliases]
                .some(name => normalizeLocalLibraryName(name) === normalizedQuery);
            const aStartsWith = normalizeLocalLibraryName(a.displayName).startsWith(normalizedQuery);
            const bStartsWith = normalizeLocalLibraryName(b.displayName).startsWith(normalizedQuery);
            return Number(bExact) - Number(aExact)
                || Number(bStartsWith) - Number(aStartsWith)
                || a.displayName.localeCompare(b.displayName);
        })
        .slice(0, limit);
};

export const findExactEntitySuggestion = (
    entities: LocalLibraryEntity[],
    query: string,
): LocalLibraryEntity | undefined => {
    const normalizedQuery = normalizeLocalLibraryName(query);
    if (!normalizedQuery) return undefined;
    return entities.find(entity => (
        [entity.displayName, ...entity.aliases]
            .some(name => normalizeLocalLibraryName(name) === normalizedQuery)
    ));
};

export const filterEntityMemberSongs = (songs: LocalSong[], query: string): LocalSong[] => {
    const normalizedQuery = normalizeLocalLibraryName(query);
    if (!normalizedQuery) return songs;
    return songs.filter(song => (
        [
            song.title,
            song.fileName,
            ...song.importedMetadata.artistNames,
            song.importedMetadata.albumName,
            ...song.onlineMetadata?.artists.map(artist => artist.name) || [],
            song.onlineMetadata?.album?.name,
        ]
            .filter((value): value is string => Boolean(value))
            .some(value => normalizeLocalLibraryName(value).includes(normalizedQuery))
    ));
};
