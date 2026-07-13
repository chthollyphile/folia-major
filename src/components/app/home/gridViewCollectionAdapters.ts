import type React from 'react';
import { LocalLibraryGroup, LocalSong, SongResult } from '../../../types';
import { navidromeApi, getNavidromeConfig } from '../../../services/navidromeService';
import { buildLocalQueue, buildNavidromeQueue } from '../../../services/playbackAdapters';
import { SubsonicSong } from '../../../types/navidrome';
import { isBlob } from '../../../utils/blobGuards';
import { sortLocalFolderSongs } from '../../../utils/localSongSorting';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../../../types/localLibrary';
import { buildLocalLibraryIndex, followEntityRedirect } from '../../../utils/localLibraryIndex';

// src/components/app/home/gridViewCollectionAdapters.ts
// Converts home-surface collections into small GridView descriptors and resolves non-Netease tracks outside GridView.

export type GridViewCollectionSource = 'netease' | 'local' | 'navidrome';
export type NavidromeGridViewCollectionType = 'album' | 'playlist' | 'artist' | 'random' | 'favorites';

export interface BaseGridViewCollectionDescriptor {
    source: GridViewCollectionSource;
    id: string | number;
    name: string;
    type: string;
    coverUrl?: string;
    coverImgUrl?: string;
    picUrl?: string;
    description?: string;
    trackCount?: number;
    albumArtist?: string;
    albumYear?: number;
    albumGenre?: string;
    albumDuration?: number;
    albumCompany?: string;
    albumPublishTime?: number;
    returnToPlayerOnClose?: boolean;
}

export interface LocalGridViewCollectionDescriptor extends BaseGridViewCollectionDescriptor {
    source: 'local';
    type: LocalLibraryGroup['type'];
    id: string;
    songIds: string[];
    entityId?: string;
    playlistId?: string;
    isVirtual?: boolean;
}

export interface NavidromeGridViewCollectionDescriptor extends BaseGridViewCollectionDescriptor {
    source: 'navidrome';
    type: NavidromeGridViewCollectionType;
    id: string;
    editable?: boolean;
}

export type GridViewCollectionDescriptor =
    | (BaseGridViewCollectionDescriptor & { source: 'netease'; raw?: any; })
    | LocalGridViewCollectionDescriptor
    | NavidromeGridViewCollectionDescriptor;

const getDisplayName = (name: React.ReactNode) => (
    typeof name === 'string' || typeof name === 'number'
        ? String(name)
        : ''
);

export const createNeteaseGridViewCollection = (collection: any): GridViewCollectionDescriptor => ({
    ...collection,
    source: 'netease',
    albumArtist: collection.type === 'album'
        ? collection.raw?.artists?.map((artist: { name?: string }) => artist.name).filter(Boolean).join(' / ') || collection.description
        : collection.albumArtist,
    albumPublishTime: collection.type === 'album' ? collection.raw?.publishTime : collection.albumPublishTime,
    albumCompany: collection.type === 'album' ? collection.raw?.company : collection.albumCompany,
});

export const createLocalGridViewCollection = (group: LocalLibraryGroup): LocalGridViewCollectionDescriptor => ({
    source: 'local',
    id: group.id,
    name: group.name,
    type: group.type,
    coverUrl: typeof group.coverUrl === 'string' ? group.coverUrl : undefined,
    description: group.description,
    trackCount: group.trackCount ?? group.songs.length,
    songIds: group.songs.map(song => song.id),
    ...(group.entityId ? { entityId: group.entityId } : {}),
    playlistId: group.playlistId,
    isVirtual: group.isVirtual,
});

export const createNavidromeGridViewCollection = (
    item: {
        id: string | number;
        name: React.ReactNode;
        coverUrl?: string;
        description?: string;
        trackCount?: number;
        albumArtist?: string;
        albumYear?: number;
        albumGenre?: string;
        albumDuration?: number;
    },
    type: NavidromeGridViewCollectionType
): NavidromeGridViewCollectionDescriptor => ({
    source: 'navidrome',
    id: String(item.id),
    name: getDisplayName(item.name),
    type,
    coverUrl: item.coverUrl,
    description: item.description,
    trackCount: item.trackCount,
    albumArtist: item.albumArtist,
    albumYear: item.albumYear,
    albumGenre: item.albumGenre,
    albumDuration: item.albumDuration,
    editable: Boolean((item as { editable?: boolean }).editable),
});

export const refreshLocalGridViewCollection = (
    descriptor: LocalGridViewCollectionDescriptor,
    localSongs: LocalSong[],
    catalog?: { entities: LocalLibraryEntity[]; assignments: LocalLibraryAssignment[]; },
): LocalGridViewCollectionDescriptor => {
    if (descriptor.entityId && catalog) {
        const index = buildLocalLibraryIndex(catalog.entities, catalog.assignments);
        const entityId = followEntityRedirect(descriptor.entityId, index.entitiesById);
        const entity = entityId ? index.entitiesById.get(entityId) : undefined;
        if (!entity || entity.mergedInto) {
            return { ...descriptor, songIds: [], trackCount: 0 };
        }
        const songIds = catalog.assignments
            .filter(assignment => entity.kind === 'artist'
                ? assignment.artistEntityIds.includes(entity.id)
                : assignment.albumEntityId === entity.id)
            .map(assignment => assignment.songId);
        const songIdSet = new Set(songIds);
        const currentSongs = localSongs.filter(song => songIdSet.has(song.id));
        const refreshedSongs = entity.kind === 'album' ? sortLocalFolderSongs(currentSongs) : currentSongs;
        return {
            ...descriptor,
            id: entity.id,
            entityId: entity.id,
            name: entity.displayName,
            songIds: refreshedSongs.map(song => song.id),
            trackCount: refreshedSongs.length,
        };
    }

    if (descriptor.playlistId || descriptor.type !== 'folder') {
        return descriptor;
    }

    const currentSongs = descriptor.isVirtual
        ? localSongs
        : localSongs.filter(song => song.folderName === descriptor.name);
    const refreshedSongs = sortLocalFolderSongs(currentSongs);

    return {
        ...descriptor,
        songIds: refreshedSongs.map(song => song.id),
        trackCount: refreshedSongs.length,
    };
};

// Rebuilds a local GridView queue from descriptor ids while preserving descriptor order.
export const resolveLocalGridViewTracks = (
    descriptor: LocalGridViewCollectionDescriptor,
    localSongs: LocalSong[]
): SongResult[] => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const orderedSongs = descriptor.songIds
        .map(songId => songsById.get(songId))
        .filter((song): song is LocalSong => Boolean(song));

    return buildLocalQueue(orderedSongs) as SongResult[];
};

const getLocalGridViewCoverSource = (songs: LocalSong[]): Blob | string | undefined => {
    const sortedSongs = [...songs].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const preferredSong = sortedSongs.find(song => {
        const hasEmbeddedCover = isBlob(song.embeddedCover);
        if (song.useOnlineCover) {
            return song.matchedCoverUrl || hasEmbeddedCover;
        }
        return hasEmbeddedCover || song.matchedCoverUrl;
    });

    if (!preferredSong) {
        return undefined;
    }

    const embeddedCover = isBlob(preferredSong.embeddedCover) ? preferredSong.embeddedCover : undefined;
    if (preferredSong.useOnlineCover) {
        return preferredSong.matchedCoverUrl || embeddedCover;
    }

    return embeddedCover || preferredSong.matchedCoverUrl;
};

export const resolveLocalGridViewCoverSource = (
    descriptor: LocalGridViewCollectionDescriptor,
    localSongs: LocalSong[]
): Blob | string | undefined => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const orderedSongs = descriptor.songIds
        .map(songId => songsById.get(songId))
        .filter((song): song is LocalSong => Boolean(song));

    return getLocalGridViewCoverSource(orderedSongs);
};

// Loads Navidrome tracks for GridView without moving Navidrome service logic into GridView itself.
export const resolveNavidromeGridViewTracks = async (
    descriptor: NavidromeGridViewCollectionDescriptor
): Promise<SongResult[]> => {
    const config = getNavidromeConfig();
    if (!config) {
        return [];
    }

    let subsonicSongs: SubsonicSong[] = [];

    if (descriptor.type === 'album') {
        const albumDetail = await navidromeApi.getAlbum(config, descriptor.id);
        subsonicSongs = albumDetail?.song || [];
    } else if (descriptor.type === 'playlist') {
        const playlistDetail = await navidromeApi.getPlaylist(config, descriptor.id);
        subsonicSongs = playlistDetail?.entry || [];
    } else if (descriptor.type === 'artist') {
        const artistDetail = await navidromeApi.getArtist(config, descriptor.id);
        const albums = artistDetail?.album || [];
        const albumResults = await Promise.all(albums.map(album => navidromeApi.getAlbum(config, album.id)));
        subsonicSongs = albumResults.flatMap(album => album?.song || []);
    } else if (descriptor.type === 'random') {
        subsonicSongs = await navidromeApi.getRandomSongs(config, 100);
    } else if (descriptor.type === 'favorites') {
        subsonicSongs = await navidromeApi.getStarred2(config);
    }

    const navidromeSongs = subsonicSongs.map(song => navidromeApi.toNavidromeSong(config, song));
    return buildNavidromeQueue(navidromeSongs);
};

export const isLocalGridViewCollection = (
    collection: GridViewCollectionDescriptor
): collection is LocalGridViewCollectionDescriptor => collection.source === 'local';

export const isNavidromeGridViewCollection = (
    collection: GridViewCollectionDescriptor
): collection is NavidromeGridViewCollectionDescriptor => collection.source === 'navidrome';

export const isNeteaseGridViewCollection = (
    collection: GridViewCollectionDescriptor
) => collection.source === 'netease';
