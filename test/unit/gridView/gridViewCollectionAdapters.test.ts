import { describe, expect, it } from 'vitest';
import {
    createLocalGridViewCollection,
    createNavidromeGridViewCollection,
    resolveLocalGridViewTracks,
} from '../../../src/components/app/home/gridViewCollectionAdapters';
import type { LocalLibraryGroup, LocalSong } from '../../../src/types';

// test/unit/gridView/gridViewCollectionAdapters.test.ts
// Verifies that GridView descriptors stay serializable and resolve local queues by id.

const buildLocalSong = (id: string, title: string): LocalSong => ({
    id,
    fileName: `${title}.mp3`,
    filePath: `/music/${title}.mp3`,
    title,
    artist: 'Artist',
    album: 'Album',
    duration: 180000,
    fileSize: 1024,
    mimeType: 'audio/mpeg',
    addedAt: 1,
});

describe('gridViewCollectionAdapters', () => {
    it('creates a local descriptor without embedding song objects', () => {
        const songs = [
            buildLocalSong('song-a', 'A'),
            buildLocalSong('song-b', 'B'),
        ];
        const group: LocalLibraryGroup = {
            id: 'folder-music',
            name: 'Music',
            type: 'folder',
            songs,
            coverUrl: 'blob:cover',
            trackCount: songs.length,
            description: 'Folder',
        };

        const descriptor = createLocalGridViewCollection(group);

        expect(descriptor).toEqual({
            source: 'local',
            id: 'folder-music',
            name: 'Music',
            type: 'folder',
            coverUrl: 'blob:cover',
            description: 'Folder',
            trackCount: 2,
            songIds: ['song-a', 'song-b'],
            playlistId: undefined,
            isVirtual: undefined,
        });
        expect('songs' in descriptor).toBe(false);
    });

    it('resolves local tracks from descriptor ids in descriptor order', () => {
        const songs = [
            buildLocalSong('song-a', 'A'),
            buildLocalSong('song-b', 'B'),
            buildLocalSong('song-c', 'C'),
        ];
        const descriptor = createLocalGridViewCollection({
            id: 'playlist-1',
            name: 'Ordered',
            type: 'playlist',
            songs: [songs[2], songs[0]],
        });

        const tracks = resolveLocalGridViewTracks(descriptor, songs);

        expect(tracks.map(track => track.localData?.id)).toEqual(['song-c', 'song-a']);
        expect(tracks.every(track => track.isLocal)).toBe(true);
    });

    it('creates Navidrome descriptors for every GridView collection type', () => {
        const baseItem = {
            id: 'navi-1',
            name: 'Navi Item',
            coverUrl: 'cover.jpg',
            description: 'Remote collection',
            trackCount: 12,
        };

        expect(createNavidromeGridViewCollection(baseItem, 'album')).toMatchObject({
            source: 'navidrome',
            id: 'navi-1',
            name: 'Navi Item',
            type: 'album',
        });
        expect(createNavidromeGridViewCollection({ ...baseItem, editable: true }, 'playlist')).toMatchObject({
            type: 'playlist',
            editable: true,
        });
        expect(createNavidromeGridViewCollection(baseItem, 'artist').type).toBe('artist');
        expect(createNavidromeGridViewCollection(baseItem, 'random').type).toBe('random');
        expect(createNavidromeGridViewCollection(baseItem, 'favorites').type).toBe('favorites');
    });
});
