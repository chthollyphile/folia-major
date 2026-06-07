import type React from 'react';
import { LocalLibraryGroup, LocalSong, SongResult } from '../../../types';
import { navidromeApi, getNavidromeConfig } from '../../../services/navidromeService';
import { buildLocalQueue, buildNavidromeQueue } from '../../../services/playbackAdapters';
import { SubsonicSong } from '../../../types/navidrome';

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
}

export interface LocalGridViewCollectionDescriptor extends BaseGridViewCollectionDescriptor {
    source: 'local';
    type: LocalLibraryGroup['type'];
    id: string;
    songIds: string[];
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
    editable: Boolean((item as { editable?: boolean }).editable),
});

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
