import type React from 'react';
import { LocalLibraryGroup, LocalSong, SongResult } from '../../../types';
import { LIST_ROW_COVER_SIZE, buildLocalQueue } from '../../../services/playbackAdapters';
import { sortLocalFolderSongs } from '../../../utils/localSongSorting';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../../../types/localLibrary';
import type { OnlineProviderId } from '../../../types/onlineMusic';
import type {
    GridViewCollectionDescriptor,
    LocalGridViewCollectionDescriptor,
    NavidromeGridViewCollectionDescriptor,
    NavidromeGridViewCollectionType,
    OnlineGridViewCollectionDescriptor,
} from '../../../library/core/collection/collection.contract';
import { buildLocalLibraryIndex, followEntityRedirect } from '../../../utils/localLibraryIndex';
import { getLocalCoverAssetUrl } from '../../../services/localCoverAssetUrl';

// src/components/app/home/gridViewCollectionAdapters.ts
// Converts home-surface collections into small GridView descriptors and resolves non-Netease tracks outside GridView.

export type {
    BaseGridViewCollectionDescriptor,
    GridViewCollectionDescriptor,
    GridViewCollectionSource,
    LocalGridViewCollectionDescriptor,
    NavidromeGridViewCollectionDescriptor,
    NavidromeGridViewCollectionType,
    OnlineGridViewCollectionDescriptor,
} from '../../../library/core/collection/collection.contract';
// 集合身份搬到了 library/core/collection/collectionIdentity：store 与组件共用一份，在线集合带上 provider。
export { collectionKey } from '../../../library/core/collection/collectionIdentity';

const getDisplayName = (name: React.ReactNode) => (
    typeof name === 'string' || typeof name === 'number'
        ? String(name)
        : ''
);

export const createOnlineGridViewCollection = (
    collection: any,
    providerId: OnlineProviderId,
): OnlineGridViewCollectionDescriptor => {
    const creator = collection.creator;
    return {
        ...collection,
        source: 'online',
        providerId,
        coverUrl: collection.coverUrl,
        trackCount: collection.trackCount,
        albumCount: collection.albumCount,
        isOwned: collection.isOwned,
        artists: collection.artists,
        aliases: collection.aliases,
        publishedAt: collection.publishedAt,
        publisher: collection.publisher,
        playCount: collection.playCount,
        updatedAt: collection.updatedAt,
        tracksUpdatedAt: collection.tracksUpdatedAt,
        isLiked: collection.isLiked,
        creator: creator ? { ...creator } : undefined,
        raw: collection.raw || collection,
    };
};

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
    publishedAt: item.albumYear ? new Date(item.albumYear, 0, 1).getTime() : undefined,
    editable: Boolean((item as { editable?: boolean }).editable),
});

// Resolves the ordered, deduplicated artist entity names represented by a local album's songs.
export const resolveLocalAlbumArtistDisplay = (
    songIds: string[],
    catalog: { entities: LocalLibraryEntity[]; assignments: LocalLibraryAssignment[]; },
): string => {
    const index = buildLocalLibraryIndex(catalog.entities, catalog.assignments);
    const songIdSet = new Set(songIds);
    const seenArtistIds = new Set<string>();
    const names: string[] = [];

    catalog.assignments.forEach(assignment => {
        if (!songIdSet.has(assignment.songId)) return;
        assignment.artistEntityIds.forEach(artistEntityId => {
            const activeArtistId = followEntityRedirect(artistEntityId, index.entitiesById);
            const artistEntity = activeArtistId ? index.entitiesById.get(activeArtistId) : undefined;
            if (!artistEntity || artistEntity.kind !== 'artist' || seenArtistIds.has(artistEntity.id)) return;
            seenArtistIds.add(artistEntity.id);
            names.push(artistEntity.displayName);
        });
    });

    return names.join(', ');
};

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
                ? assignment.artistEntityIds.some(artistEntityId => (
                    followEntityRedirect(artistEntityId, index.entitiesById) === entity.id
                ))
                : Boolean(assignment.albumEntityId && (
                    followEntityRedirect(assignment.albumEntityId, index.entitiesById) === entity.id
                )))
            .map(assignment => assignment.songId);
        const songIdSet = new Set(songIds);
        const currentSongs = localSongs.filter(song => songIdSet.has(song.id));
        const refreshedSongs = entity.kind === 'album' ? sortLocalFolderSongs(currentSongs) : currentSongs;
        const albumArtist = entity.kind === 'album'
            ? resolveLocalAlbumArtistDisplay(songIds, catalog)
            : undefined;
        return {
            ...descriptor,
            id: entity.id,
            entityId: entity.id,
            name: entity.displayName,
            songIds: refreshedSongs.map(song => song.id),
            trackCount: refreshedSongs.length,
            ...(albumArtist ? { albumArtist, description: albumArtist } : {}),
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
    localSongs: LocalSong[],
    catalog?: { entities: LocalLibraryEntity[]; assignments: LocalLibraryAssignment[]; },
): SongResult[] => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const orderedSongs = descriptor.songIds
        .map(songId => songsById.get(songId))
        .filter((song): song is LocalSong => Boolean(song));

    // Row-sized covers: GridView renders these as list thumbnails, never full-bleed.
    return buildLocalQueue(orderedSongs, undefined, catalog, LIST_ROW_COVER_SIZE) as SongResult[];
};

const getLocalGridViewCoverSource = (songs: LocalSong[]): string | undefined => {
    const sortedSongs = [...songs].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const preferredSong = sortedSongs.find(song => {
        const hasEmbeddedCover = Boolean(getLocalCoverAssetUrl(song.localCoverAssetId));
        if (song.useOnlineCover) {
            return song.onlineMetadata?.coverUrl || hasEmbeddedCover;
        }
        return hasEmbeddedCover || song.onlineMetadata?.coverUrl;
    });

    if (!preferredSong) {
        return undefined;
    }

    const localCoverUrl = getLocalCoverAssetUrl(preferredSong.localCoverAssetId, 512) || undefined;
    if (preferredSong.useOnlineCover) {
        return preferredSong.onlineMetadata?.coverUrl || localCoverUrl;
    }

    return localCoverUrl || preferredSong.onlineMetadata?.coverUrl;
};

export const resolveLocalGridViewCoverSource = (
    descriptor: LocalGridViewCollectionDescriptor,
    localSongs: LocalSong[]
): string | undefined => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const orderedSongs = descriptor.songIds
        .map(songId => songsById.get(songId))
        .filter((song): song is LocalSong => Boolean(song));

    return getLocalGridViewCoverSource(orderedSongs);
};

// Navidrome 曲目的加载搬到了 library/core/collection/resource/navidromeCollectionTracks.service；资源直接使用它，这里只适配集合描述与本地数据。

export const isLocalGridViewCollection = (
    collection: GridViewCollectionDescriptor
): collection is LocalGridViewCollectionDescriptor => collection.source === 'local';

export const isNavidromeGridViewCollection = (
    collection: GridViewCollectionDescriptor
): collection is NavidromeGridViewCollectionDescriptor => collection.source === 'navidrome';
