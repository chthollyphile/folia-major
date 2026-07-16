import { describe, expect, it } from 'vitest';
import {
    createSearchAlbumCollection,
    createSearchArtistCollection,
} from '@/components/app/search/searchCollectionAdapters';
import type { UnifiedSong } from '@/types';

// Verifies all search sources produce GridView-native collection descriptors.

const baseTrack = (): UnifiedSong => ({
    id: 1,
    name: 'Track',
    artists: [{ id: 2, name: 'Artist' }],
    album: { id: 3, name: 'Album', picUrl: 'https://example.com/cover.jpg' },
    duration: 1000,
});

describe('search collection adapters', () => {
    it('creates NetEase artist and album descriptors', () => {
        const track = baseTrack();
        expect(createSearchArtistCollection(track, 'Artist', 2)).toEqual(expect.objectContaining({
            source: 'netease',
            id: 2,
            type: 'artist',
        }));
        expect(createSearchAlbumCollection(track, 'Album', 3)).toEqual(expect.objectContaining({
            source: 'netease',
            id: 3,
            type: 'album',
        }));
    });

    it('uses stable local entity ids and refuses unresolved local links', () => {
        const track = {
            ...baseTrack(),
            isLocal: true,
            localRef: { songId: 'song-1' },
        };
        expect(createSearchArtistCollection(track, 'Artist', 0, 'artist-1')).toEqual(expect.objectContaining({
            source: 'local',
            id: 'artist-1',
            entityId: 'artist-1',
            songIds: ['song-1'],
        }));
        expect(createSearchAlbumCollection(track, 'Album')).toBeNull();
    });

    it('uses Navidrome source ids from the playback carrier', () => {
        const track = {
            ...baseTrack(),
            isNavidrome: true,
            navidromeData: {
                ...baseTrack(),
                id: 'song-1',
                isNavidrome: true,
                artistId: 'artist-1',
                albumId: 'album-1',
            } as any,
        };
        expect(createSearchArtistCollection(track, 'Artist')).toEqual(expect.objectContaining({
            source: 'navidrome',
            id: 'artist-1',
        }));
        expect(createSearchAlbumCollection(track, 'Album')).toEqual(expect.objectContaining({
            source: 'navidrome',
            id: 'album-1',
        }));
    });
});
