import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import type { GridViewCollectionDescriptor } from '../home/gridViewCollectionAdapters';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';

// src/components/app/search/searchCollectionAdapters.ts

const getTrackCoverUrl = (track: UnifiedSong) => track.al?.picUrl || track.album?.picUrl;

export const createSearchArtistCollection = (
    track: UnifiedSong,
    artistName: string,
    artistId?: MediaId,
    entityId?: string,
): GridViewCollectionDescriptor | null => {
    const coverUrl = getTrackCoverUrl(track);

    if (track.isLocal) {
        const songId = track.localRef?.songId;
        if (!songId || !entityId) return null;
        return {
            source: 'local',
            id: entityId,
            entityId,
            name: artistName,
            type: 'artist',
            coverUrl,
            songIds: [songId],
        };
    }

    if (track.isNavidrome) {
        const navidromeArtistId = track.navidromeData?.artistId;
        if (!navidromeArtistId) return null;
        return {
            source: 'navidrome',
            id: navidromeArtistId,
            name: artistName,
            type: 'artist',
            coverUrl,
        };
    }

    if (!artistId) return null;
    const sourceRef = getPlaybackSourceRef(track);
    if (sourceRef.kind !== 'online') return null;
    return {
        source: 'online',
        providerId: sourceRef.providerId,
        id: artistId,
        name: artistName,
        type: 'artist',
        coverUrl,
    };
};

export const createSearchAlbumCollection = (
    track: UnifiedSong,
    albumName: string,
    albumId?: MediaId,
    entityId?: string,
): GridViewCollectionDescriptor | null => {
    const coverUrl = getTrackCoverUrl(track);

    if (track.isLocal) {
        const songId = track.localRef?.songId;
        if (!songId || !entityId) return null;
        return {
            source: 'local',
            id: entityId,
            entityId,
            name: albumName,
            type: 'album',
            coverUrl,
            songIds: [songId],
        };
    }

    if (track.isNavidrome) {
        const navidromeAlbumId = track.navidromeData?.albumId;
        if (!navidromeAlbumId) return null;
        return {
            source: 'navidrome',
            id: navidromeAlbumId,
            name: albumName,
            type: 'album',
            coverUrl,
        };
    }

    if (!albumId) return null;
    const sourceRef = getPlaybackSourceRef(track);
    if (sourceRef.kind !== 'online') return null;
    return {
        source: 'online',
        providerId: sourceRef.providerId,
        id: albumId,
        name: albumName,
        type: 'album',
        coverUrl,
    };
};
