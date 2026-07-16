import { AmllDbPlatform, LocalSong, LyricProviderSource, SongResult, UnifiedSong } from '../types';
import { NavidromeSong } from '../types/navidrome';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../types/localLibrary';
import { buildLocalLibraryIndex, followEntityRedirect, type LocalLibraryIndex } from '../utils/localLibraryIndex';

export type LocalLibraryDisplayCatalog = {
    entities: LocalLibraryEntity[];
    assignments: LocalLibraryAssignment[];
};

export type ResolvedLocalSongMetadata = {
    artists: Array<{ entityId: string; name: string }>;
    album?: { entityId: string; name: string };
};

// Resolves the canonical artist and album display from stable entity assignments only.
export const resolveLocalSongMetadata = (
    songId: string,
    catalog: LocalLibraryDisplayCatalog,
    preparedIndex?: LocalLibraryIndex,
): ResolvedLocalSongMetadata => {
    const index = preparedIndex || buildLocalLibraryIndex(catalog.entities, catalog.assignments);
    const assignment = index.assignmentsBySongId.get(songId);
    const artists = assignment?.artistEntityIds.flatMap(entityId => {
        const activeEntityId = followEntityRedirect(entityId, index.entitiesById);
        const entity = activeEntityId ? index.entitiesById.get(activeEntityId) : undefined;
        return entity?.kind === 'artist' ? [{ entityId: entity.id, name: entity.displayName }] : [];
    }) || [];
    const activeAlbumId = assignment?.albumEntityId
        ? followEntityRedirect(assignment.albumEntityId, index.entitiesById)
        : undefined;
    const albumEntity = activeAlbumId ? index.entitiesById.get(activeAlbumId) : undefined;
    return {
        artists,
        album: albumEntity?.kind === 'album'
            ? { entityId: albumEntity.id, name: albumEntity.displayName }
            : undefined,
    };
};

const resolveLocalLibraryDisplayArtists = (
    songId: string,
    catalog?: LocalLibraryDisplayCatalog,
    preparedIndex?: LocalLibraryIndex,
) => {
    if (!catalog) return [];

    const resolved = resolveLocalSongMetadata(songId, catalog, preparedIndex);
    const seenEntityIds = new Set<string>();
    return resolved.artists.flatMap(entity => {
        if (seenEntityIds.has(entity.entityId)) return [];
        seenEntityIds.add(entity.entityId);
        return [{ id: 0, entityId: entity.entityId, name: entity.name }];
    });
};

// Replaces legacy joined artist text with the song's stable local-library artist entities.
export const applyLocalLibraryArtistDisplay = <T extends SongResult>(
    song: T,
    catalog?: LocalLibraryDisplayCatalog,
    preparedIndex?: LocalLibraryIndex,
): T => {
    const songId = (song as UnifiedSong).localRef?.songId;
    if (!songId) return song;

    const artists = resolveLocalLibraryDisplayArtists(songId, catalog, preparedIndex);
    if (artists.length === 0) return song;

    return {
        ...song,
        artists,
        ar: artists,
    };
};

// Maps a local song's album assignment onto both album fields used by GridView and player surfaces.
const applyLocalLibraryAlbumDisplay = <T extends SongResult>(
    song: T,
    catalog?: LocalLibraryDisplayCatalog,
    preparedIndex?: LocalLibraryIndex,
): T => {
    const songId = (song as UnifiedSong).localRef?.songId;
    if (!songId || !catalog) return song;

    const entity = resolveLocalSongMetadata(songId, catalog, preparedIndex).album;
    if (!entity) return song;

    return {
        ...song,
        album: {
            ...song.album,
            entityId: entity.entityId,
            name: entity.name,
        },
        al: {
            ...(song.al || song.album),
            entityId: entity.entityId,
            name: entity.name,
        },
    };
};

// Applies the complete local entity display model used by cards, queues, and CoverTab.
export const applyLocalLibraryEntityDisplay = <T extends SongResult>(
    song: T,
    catalog?: LocalLibraryDisplayCatalog,
    preparedIndex?: LocalLibraryIndex,
): T => applyLocalLibraryAlbumDisplay(
    applyLocalLibraryArtistDisplay(song, catalog, preparedIndex),
    catalog,
    preparedIndex,
);

// Applies a resolved local cover URL to both API-compatible album fields used by song cards.
export const applyLocalSongCoverDisplay = <T extends SongResult>(song: T, coverUrl: string): T => ({
    ...song,
    al: song.al ? { ...song.al, picUrl: coverUrl } : { id: 0, name: song.album?.name || '', picUrl: coverUrl },
    album: song.album ? { ...song.album, picUrl: coverUrl } : { id: 0, name: '', picUrl: coverUrl },
});

export const getLocalSongId = (localSong: LocalSong): number => {
    // Generate a reliable 52-bit hash from the string ID to avoid parsing long digits and losing precision or colliding.
    // DJB2 style hash into two parts to create a safe integer
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5;
    
    for (let i = 0; i < localSong.id.length; i++) {
        const char = localSong.id.charCodeAt(i);
        h1 ^= char;
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= char;
        h2 = Math.imul(h2, 0x10a9055);
    }
    
    // Combine into a 53-bit safe positive integer, then make it negative
    const high = (h1 & 0x1FFFFF) * 0x100000000;
    const low = (h2 >>> 0);
    const combined = high + low;
    return combined === 0 ? -1 : -combined;
};

export function buildUnifiedLocalSong({
    localSong,
    matchedSong,
    coverUrl,
    preferOnlineMetadata,
}: {
    localSong: LocalSong;
    matchedSong: SongResult | null;
    coverUrl: string | null;
    preferOnlineMetadata: boolean;
}): UnifiedSong {
    const useMatchedLyrics =
        localSong.lyricsSource === 'online'
        || (!localSong.lyricsSource && !localSong.hasLocalLyrics && !localSong.hasEmbeddedLyrics);
    const displayTitle = localSong.title;
    const displayArtists = (localSong.titleOrigin === 'import'
        ? localSong.importedMetadata.artistNames
        : localSong.onlineMetadata?.artists.map(artist => artist.name) || localSong.importedMetadata.artistNames)
        .map(name => ({ id: 0, name }));
    const displayAlbum = localSong.titleOrigin === 'import'
        ? localSong.importedMetadata.albumName
        : localSong.onlineMetadata?.album?.name || localSong.importedMetadata.albumName;

    const unifiedSong: UnifiedSong = {
        id: getLocalSongId(localSong),
        name: displayTitle,
        artists: displayArtists,
        album: displayAlbum ? { id: 0, name: displayAlbum } : { id: 0, name: '' },
        duration: localSong.duration,
        isPureMusic: useMatchedLyrics ? localSong.matchedIsPureMusic : false,
        ar: displayArtists,
        al: displayAlbum ? {
            id: 0,
            name: displayAlbum,
            picUrl: coverUrl || undefined
        } : coverUrl ? {
            id: 0,
            name: '',
            picUrl: coverUrl
        } : undefined,
        dt: localSong.duration,
        isLocal: true,
        localRef: { songId: localSong.id },
    };

    if (!matchedSong) {
        return unifiedSong;
    }

    if (coverUrl) {
        if (unifiedSong.album) unifiedSong.album.picUrl = coverUrl;
        if (unifiedSong.al) unifiedSong.al.picUrl = coverUrl;
    }

    return unifiedSong;
}

export function buildLocalQueue(
    queue: LocalSong[],
    currentSong?: UnifiedSong,
    catalog?: LocalLibraryDisplayCatalog,
): UnifiedSong[] {
    const catalogIndex = catalog
        ? buildLocalLibraryIndex(catalog.entities, catalog.assignments)
        : undefined;
    const convertedQueue = queue.map(song => {
        return applyLocalLibraryEntityDisplay(buildUnifiedLocalSong({
            localSong: song,
            matchedSong: null,
            coverUrl: song.useOnlineCover ? song.onlineMetadata?.coverUrl || null : null,
            preferOnlineMetadata: false,
        }), catalog, catalogIndex);
    });

    if (!currentSong) {
        return convertedQueue;
    }

    return convertedQueue.map(song => {
        if (song.id === currentSong.id) {
            return applyLocalLibraryEntityDisplay(currentSong, catalog, catalogIndex);
        }
        return song;
    });
}

export function buildUnifiedNavidromeSong(
    navidromeSong: NavidromeSong,
    options?: {
        coverUrl?: string;
        useOnlineMetadata?: boolean;
        matchedArtists?: string;
        matchedAlbumName?: string;
        matchedLyricsSource?: LyricProviderSource;
        matchedLyricsProviderPlatform?: AmllDbPlatform;
    }
): SongResult {
    const displayArtists = (options?.useOnlineMetadata && options.matchedArtists)
        ? [{ id: 0, name: options.matchedArtists }]
        : (navidromeSong.artists || navidromeSong.ar || []);
    const displayAlbum = navidromeSong.album || (navidromeSong.al ? {
        id: navidromeSong.al.id,
        name: navidromeSong.al.name,
        picUrl: navidromeSong.al.picUrl
    } : { id: 0, name: '' });
    const displayAl = options?.coverUrl
        ? { ...(navidromeSong.al || displayAlbum || { id: 0, name: '' }), picUrl: options.coverUrl }
        : (navidromeSong.al || displayAlbum);

    return {
        id: navidromeSong.id,
        name: (options?.useOnlineMetadata && options.matchedAlbumName) ? options.matchedAlbumName : navidromeSong.name,
        artists: displayArtists,
        album: displayAlbum,
        duration: navidromeSong.duration || navidromeSong.dt || 0,
        isPureMusic: navidromeSong.lyricsSource === 'online' ? navidromeSong.matchedIsPureMusic : false,
        ar: navidromeSong.ar || displayArtists,
        al: displayAl,
        dt: navidromeSong.dt,
        isNavidrome: true,
        navidromeData: navidromeSong,
        matchedLyricsSource: options?.matchedLyricsSource,
        matchedLyricsProviderPlatform: options?.matchedLyricsProviderPlatform
    } as any;
}

export function buildNavidromeQueue(queue: NavidromeSong[], currentSong?: SongResult): SongResult[] {
    const convertedQueue = queue.map(song => ({
        id: song.id,
        name: song.name,
        artists: song.artists || song.ar || [],
        album: song.album || (song.al ? { id: song.al.id, name: song.al.name, picUrl: song.al.picUrl } : { id: 0, name: '' }),
        duration: song.duration || song.dt || 0,
        isPureMusic: song.lyricsSource === 'online' ? song.matchedIsPureMusic : false,
        ar: song.ar || [],
        al: song.al,
        dt: song.dt,
        isNavidrome: true,
        navidromeData: song
    } as any));

    if (!currentSong) {
        return convertedQueue;
    }

    return convertedQueue.map(song => song.id === currentSong.id ? currentSong : song);
}
