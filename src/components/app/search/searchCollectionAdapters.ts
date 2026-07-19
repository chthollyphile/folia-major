import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import type { GridViewCollectionDescriptor } from '../home/gridViewCollectionAdapters';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { resolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';

// src/components/app/search/searchCollectionAdapters.ts

const getTrackCoverUrl = (track: UnifiedSong) => track.al?.picUrl || track.album?.picUrl;

export const createSearchArtistCollection = (
    track: UnifiedSong,
    artistName: string,
    artistId?: MediaId,
    entityId?: string,
): Promise<GridViewCollectionDescriptor | null> => {
    const coverUrl = getTrackCoverUrl(track);

    if (track.isLocal) {
        const songId = track.localRef?.songId;
        if (!songId || !entityId) return Promise.resolve(null);
        return Promise.resolve({
            source: 'local',
            id: entityId,
            entityId,
            name: artistName,
            type: 'artist',
            coverUrl,
            songIds: [songId],
        });
    }

    if (track.isNavidrome) {
        const navidromeArtistId = track.navidromeData?.artistId;
        if (!navidromeArtistId) return Promise.resolve(null);
        return Promise.resolve({
            source: 'navidrome',
            id: navidromeArtistId,
            name: artistName,
            type: 'artist',
            coverUrl,
        });
    }

    const sourceRef = getPlaybackSourceRef(track);
    if (sourceRef.kind !== 'online') return Promise.resolve(null);
    return resolveSongCatalogRef(track, 'artist', {
        id: artistId ?? '',
        name: artistName,
        ...(entityId ? { entityId } : {}),
    }).then(ref => ref ? ({
        source: 'online' as const,
        providerId: ref.providerId,
        id: ref.id,
        name: artistName,
        type: 'artist',
        coverUrl,
    }) : null);
};

export const createSearchAlbumCollection = (
    track: UnifiedSong,
    albumName: string,
    albumId?: MediaId,
    entityId?: string,
): Promise<GridViewCollectionDescriptor | null> => {
    const coverUrl = getTrackCoverUrl(track);

    if (track.isLocal) {
        const songId = track.localRef?.songId;
        if (!songId || !entityId) return Promise.resolve(null);
        return Promise.resolve({
            source: 'local',
            id: entityId,
            entityId,
            name: albumName,
            type: 'album',
            coverUrl,
            songIds: [songId],
        });
    }

    if (track.isNavidrome) {
        const navidromeAlbumId = track.navidromeData?.albumId;
        if (!navidromeAlbumId) return Promise.resolve(null);
        return Promise.resolve({
            source: 'navidrome',
            id: navidromeAlbumId,
            name: albumName,
            type: 'album',
            coverUrl,
        });
    }

    const sourceRef = getPlaybackSourceRef(track);
    if (sourceRef.kind !== 'online') return Promise.resolve(null);
    return resolveSongCatalogRef(track, 'album', {
        id: albumId ?? '',
        name: albumName,
        picUrl: coverUrl,
        ...(entityId ? { entityId } : {}),
    }).then(ref => ref ? ({
        source: 'online' as const,
        providerId: ref.providerId,
        id: ref.id,
        name: albumName,
        type: 'album',
        coverUrl,
    }) : null);
};
