import { describe, expect, it } from 'vitest';
import {
    createLocalGridViewCollection,
    createNavidromeGridViewCollection,
    refreshLocalGridViewCollection,
    resolveLocalGridViewCoverSource,
    resolveLocalGridViewTracks,
} from '../../../src/components/app/home/gridViewCollectionAdapters';
import { buildLocalGrid3DGroups } from '../../../src/components/app/home/localGrid3DModel';
import type { LocalLibraryGroup, LocalSong } from '../../../src/types';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../../../src/types/localLibrary';

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

        expect(tracks.map(track => (track as any).localData?.id)).toEqual(['song-c', 'song-a']);
        expect(tracks.every(track => (track as any).isLocal)).toBe(true);
    });

    it('refreshes virtual all songs descriptors from the current local song list', () => {
        const originalSongs = [
            buildLocalSong('song-a', 'A'),
        ];
        const descriptor = createLocalGridViewCollection({
            id: 'folder-__all-songs__',
            name: 'All Songs',
            type: 'folder',
            songs: originalSongs,
            isVirtual: true,
        });
        const refreshed = refreshLocalGridViewCollection(descriptor, [
            ...originalSongs,
            buildLocalSong('song-b', 'B'),
        ]);

        expect(refreshed.songIds).toEqual(['song-a', 'song-b']);
        expect(refreshed.trackCount).toBe(2);
    });

    it('keeps folder tracks in natural file-name order when GridView is opened or refreshed', () => {
        const folderName = 'Soundtrack';
        const songs = [
            { ...buildLocalSong('track-04', '1-04 School Days'), fileName: '1-04 School Days.wav', folderName },
            { ...buildLocalSong('track-10', '1-10 Fua'), fileName: '1-10 Fua.wav', folderName },
            { ...buildLocalSong('track-02', '1-02 Title'), fileName: '1-02 Title.wav', folderName },
            { ...buildLocalSong('track-01', '1-01 Game'), fileName: '1-01 Game.wav', folderName },
        ];
        const groups = buildLocalGrid3DGroups(songs, [], ((key: string) => key) as any);
        const folder = groups.folders.find(group => group.name === folderName)!;
        const descriptor = createLocalGridViewCollection(folder);

        expect(descriptor.songIds).toEqual(['track-01', 'track-02', 'track-04', 'track-10']);

        const refreshed = refreshLocalGridViewCollection(descriptor, songs);
        expect(refreshed.songIds).toEqual(['track-01', 'track-02', 'track-04', 'track-10']);
    });

    it('refreshes folder descriptors without pulling nested folders into the open folder view', () => {
        const descriptor = createLocalGridViewCollection({
            id: 'folder-Music/Disc 1',
            name: 'Music/Disc 1',
            type: 'folder',
            songs: [buildLocalSong('song-a', 'A')],
        });
        const directSong = {
            ...buildLocalSong('song-b', 'B'),
            folderName: 'Music/Disc 1',
        };
        const nestedSong = {
            ...buildLocalSong('song-c', 'C'),
            folderName: 'Music/Disc 1/Sub',
        };

        const refreshed = refreshLocalGridViewCollection(descriptor, [directSong, nestedSong]);

        expect(refreshed.songIds).toEqual(['song-b']);
        expect(refreshed.trackCount).toBe(1);
    });

    it('refreshes entity descriptors from live UUID assignments and follows redirects', () => {
        const songs = [buildLocalSong('song-a', 'A'), buildLocalSong('song-b', 'B')];
        const entities: LocalLibraryEntity[] = [
            {
                id: 'old-album',
                kind: 'album',
                displayName: 'Old',
                aliases: ['Old'],
                normalizedAliases: ['old'],
                mergedInto: 'album-1',
                createdAt: 1,
                updatedAt: 2,
            },
            {
                id: 'album-1',
                kind: 'album',
                displayName: 'Current Album',
                aliases: ['Current Album'],
                normalizedAliases: ['current album'],
                createdAt: 1,
                updatedAt: 2,
            },
        ];
        const assignments: LocalLibraryAssignment[] = [{
            songId: 'song-b',
            artistEntityIds: [],
            artistOrigin: 'import',
            albumEntityId: 'album-1',
            albumOrigin: 'import',
            updatedAt: 1,
        }];
        const descriptor = createLocalGridViewCollection({
            id: 'old-album',
            entityId: 'old-album',
            name: 'Old',
            type: 'album',
            songs: [songs[0]],
        });

        expect(refreshLocalGridViewCollection(descriptor, songs, { entities, assignments })).toMatchObject({
            id: 'album-1',
            entityId: 'album-1',
            name: 'Current Album',
            songIds: ['song-b'],
            trackCount: 1,
        });
    });

    it('ignores non-Blob embedded covers when resolving local collection covers', () => {
        const songs = [
            {
                ...buildLocalSong('song-a', 'A'),
                addedAt: 2,
                embeddedCover: { size: 20, type: 'image/png' } as unknown as Blob,
                matchedCoverUrl: 'https://example.com/a.jpg',
            },
            {
                ...buildLocalSong('song-b', 'B'),
                addedAt: 1,
            },
        ];
        const descriptor = createLocalGridViewCollection({
            id: 'folder-music',
            name: 'Music',
            type: 'folder',
            songs,
        });

        expect(resolveLocalGridViewCoverSource(descriptor, songs)).toBe('https://example.com/a.jpg');
    });

    it('prefers matched covers when online covers are enabled', () => {
        const embeddedCover = new Blob(['cover'], { type: 'image/png' });
        const songs = [
            {
                ...buildLocalSong('song-a', 'A'),
                embeddedCover,
                matchedCoverUrl: 'https://example.com/online.jpg',
                useOnlineCover: true,
            },
        ];
        const descriptor = createLocalGridViewCollection({
            id: 'folder-music',
            name: 'Music',
            type: 'folder',
            songs,
        });

        expect(resolveLocalGridViewCoverSource(descriptor, songs)).toBe('https://example.com/online.jpg');
    });

    it('returns no local cover source when only invalid embedded covers are available', () => {
        const songs = [
            {
                ...buildLocalSong('song-a', 'A'),
                embeddedCover: { size: 20, type: 'image/png' } as unknown as Blob,
            },
        ];
        const descriptor = createLocalGridViewCollection({
            id: 'folder-music',
            name: 'Music',
            type: 'folder',
            songs,
        });

        expect(resolveLocalGridViewCoverSource(descriptor, songs)).toBeUndefined();
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
        const playlistItem = { ...baseItem, editable: true };
        expect(createNavidromeGridViewCollection(playlistItem, 'playlist')).toMatchObject({
            type: 'playlist',
            editable: true,
        });
        expect(createNavidromeGridViewCollection(baseItem, 'artist').type).toBe('artist');
        expect(createNavidromeGridViewCollection(baseItem, 'random').type).toBe('random');
        expect(createNavidromeGridViewCollection(baseItem, 'favorites').type).toBe('favorites');
    });
});
