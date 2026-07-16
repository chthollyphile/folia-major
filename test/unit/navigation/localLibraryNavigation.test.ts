import { describe, expect, it, vi } from 'vitest';
import { createLocalLibraryNavigation } from '@/components/app/navigation/createLocalLibraryNavigation';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '@/types/localLibrary';
import type { LocalSong } from '@/types';

// Verifies search-result navigation uses the clicked song's stable catalog assignments.

const localSong = (id: string): LocalSong => ({
    id,
    fileName: `${id}.mp3`,
    filePath: `/${id}.mp3`,
    duration: 1000,
    fileSize: 1,
    mimeType: 'audio/mpeg',
    addedAt: 1,
    title: id,
    titleOrigin: 'import',
    importedMetadata: { title: id, titleSource: 'filename', artistNames: ['Shared Artist'], albumName: 'Shared Album' },
});

const entity = (id: string, kind: 'artist' | 'album', name: string): LocalLibraryEntity => ({
    id,
    kind,
    displayName: name,
    aliases: [name],
    normalizedAliases: [name.toLocaleLowerCase()],
    createdAt: 1,
    updatedAt: 1,
});

describe('createLocalLibraryNavigation', () => {
    it('opens the artist and album assigned to the clicked local search result when names are ambiguous', () => {
        const songs = [localSong('song-a'), localSong('song-b')];
        const entities = [
            entity('artist-a', 'artist', 'Shared Artist'),
            entity('artist-b', 'artist', 'Shared Artist'),
            entity('album-a', 'album', 'Shared Album'),
            entity('album-b', 'album', 'Shared Album'),
        ];
        const assignments: LocalLibraryAssignment[] = [
            { songId: 'song-a', artistEntityIds: ['artist-a'], albumEntityId: 'album-a', artistOrigin: 'import', albumOrigin: 'import', updatedAt: 1 },
            { songId: 'song-b', artistEntityIds: ['artist-b'], albumEntityId: 'album-b', artistOrigin: 'import', albumOrigin: 'import', updatedAt: 1 },
        ];
        const onOpenCollection = vi.fn();
        const navigation = createLocalLibraryNavigation({
            currentSong: null,
            localSongs: songs,
            localLibraryCatalog: { entities, assignments, ready: true, reload: vi.fn() },
            setHomeViewTab: vi.fn(),
            onOpenCollection,
            t: key => key,
        });

        navigation.openLocalArtistByName('Shared Artist', 'song-b');
        navigation.openLocalAlbumByName('Shared Album', 'song-b');

        expect(onOpenCollection).toHaveBeenNthCalledWith(1, expect.objectContaining({
            id: 'artist-b',
            entityId: 'artist-b',
            type: 'artist',
            songIds: ['song-b'],
        }));
        expect(onOpenCollection).toHaveBeenNthCalledWith(2, expect.objectContaining({
            id: 'album-b',
            entityId: 'album-b',
            type: 'album',
            songIds: ['song-b'],
        }));
    });

    it('opens the assigned entity through GridView when the grid home layout is active', () => {
        const songs = [localSong('song-a')];
        const entities = [
            entity('artist-a', 'artist', 'Shared Artist'),
            entity('album-a', 'album', 'Shared Album'),
        ];
        const assignments: LocalLibraryAssignment[] = [{
            songId: 'song-a',
            artistEntityIds: ['artist-a'],
            albumEntityId: 'album-a',
            artistOrigin: 'import',
            albumOrigin: 'import',
            updatedAt: 1,
        }];
        const setHomeViewTab = vi.fn();
        const onOpenCollection = vi.fn();
        const navigation = createLocalLibraryNavigation({
            currentSong: null,
            localSongs: songs,
            localLibraryCatalog: { entities, assignments, ready: true, reload: vi.fn() },
            setHomeViewTab,
            onOpenCollection,
            t: key => key,
        });

        navigation.openLocalAlbumByName('Shared Album', 'song-a');

        expect(setHomeViewTab).toHaveBeenCalledWith('local');
        expect(onOpenCollection).toHaveBeenCalledWith(expect.objectContaining({
            source: 'local',
            id: 'album-a',
            entityId: 'album-a',
            type: 'album',
            songIds: ['song-a'],
        }));
    });
});
