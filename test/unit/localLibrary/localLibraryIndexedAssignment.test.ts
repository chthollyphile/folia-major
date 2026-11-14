import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import { saveLocalSongs } from '../../../src/services/db';
import {
    assignImportedSongs,
    ensureLocalLibraryInitialized,
    mergeEntities,
    splitEntity,
} from '../../../src/services/localLibraryCatalogService';
import type { LocalSong } from '../../../src/types';
import type { LocalLibraryEntity } from '../../../src/types/localLibrary';

// test/unit/localLibrary/localLibraryIndexedAssignment.test.ts
// Covers import assignment reading by index: the stored album context key, merge redirect chains, the three
// disambiguation rules for repeated names, and that assigning a batch never reads the whole song table.

let serial = 0;
const song = (folder: string, artist: string | undefined, album: string | undefined, id?: string): LocalSong => {
    const n = serial++;
    return {
        id: id || `song-${String(n).padStart(4, '0')}`,
        fileName: `${n}.flac`,
        filePath: `${folder}/${n}.flac`,
        folderName: folder,
        title: `Track ${n}`,
        titleOrigin: 'import',
        importedMetadata: { title: `Track ${n}`, titleSource: 'embedded', artistNames: artist ? [artist] : [], albumName: album },
        duration: 1,
        fileSize: 1,
        mimeType: 'audio/flac',
        addedAt: 1,
    };
};

const activeEntitiesNamed = async (kind: LocalLibraryEntity['kind'], name: string) => (
    (await appDatabase.local_library_entities.where('kind').equals(kind).toArray())
        .filter(entity => !entity.mergedInto && entity.displayName === name)
);

const assignmentOf = async (songId: string) => appDatabase.local_library_assignments.get(songId);

describe('indexed import assignment', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await appDatabase.delete();
    });

    it('stores the album context key on every write and drops it with the album', async () => {
        const track = song('Lib/A/Album', 'Artist A', 'Album', 'keyed');
        await assignImportedSongs([track]);
        expect((await appDatabase.local_music.get('keyed'))?.albumContextKey).toBe('lib/a/album\u0000\u0000album');

        await assignImportedSongs([{ ...track, importedMetadata: { ...track.importedMetadata, albumName: 'Renamed' } }]);
        expect((await appDatabase.local_music.get('keyed'))?.albumContextKey).toBe('lib/a/album\u0000\u0000renamed');

        await assignImportedSongs([{ ...track, importedMetadata: { ...track.importedMetadata, albumName: undefined } }]);
        expect((await appDatabase.local_music.get('keyed'))?.albumContextKey).toBeUndefined();
    });

    it('assigns a batch without reading the whole song, entity or assignment table', async () => {
        await saveLocalSongs(Array.from({ length: 30 }, (_, i) => song(`Lib/Artist ${i % 5}/Album ${i % 6}`, `Artist ${i % 5}`, `Album ${i % 6}`)));
        const songsToArray = vi.spyOn(appDatabase.local_music, 'toArray');
        const entitiesToArray = vi.spyOn(appDatabase.local_library_entities, 'toArray');
        const assignmentsToArray = vi.spyOn(appDatabase.local_library_assignments, 'toArray');

        await saveLocalSongs([song('Lib/Artist 1/Album 1', 'Artist 1', 'Album 1'), song('Lib/New/Album', 'Artist 9', 'Greatest Hits')]);

        expect(songsToArray).not.toHaveBeenCalled();
        expect(entitiesToArray).not.toHaveBeenCalled();
        expect(assignmentsToArray).not.toHaveBeenCalled();
    });

    it('follows a merge chain from a merged-away name to the final entity', async () => {
        await assignImportedSongs([
            song('Lib/A/One', 'Artist A', 'One'),
            song('Lib/B/Two', 'Artist B', 'Two'),
            song('Lib/C/Three', 'Artist C', 'Three'),
        ]);
        const [a] = await activeEntitiesNamed('artist', 'Artist A');
        const [b] = await activeEntitiesNamed('artist', 'Artist B');
        const [c] = await activeEntitiesNamed('artist', 'Artist C');
        await mergeEntities(b.id, [a.id]);
        await mergeEntities(c.id, [b.id]);

        await assignImportedSongs([song('Lib/A/Four', 'Artist A', 'Four', 'late-a')]);

        expect((await assignmentOf('late-a'))?.artistEntityIds).toEqual([c.id]);
        expect(await activeEntitiesNamed('artist', 'Artist A')).toHaveLength(0);
    });

    it('joins the same folder\'s album when the album name is ambiguous', async () => {
        await assignImportedSongs([
            song('Lib/A/Greatest Hits', 'Artist A', 'Greatest Hits', 'a-1'),
            song('Lib/B/Greatest Hits', 'Artist B', 'Greatest Hits', 'b-1'),
            // A second album each, so the artist alone cannot tell which Greatest Hits is meant.
            song('Lib/A/Debut', 'Artist A', 'Debut A'),
            song('Lib/B/Debut', 'Artist B', 'Debut B'),
        ]);
        const [shared] = await activeEntitiesNamed('album', 'Greatest Hits');
        const separated = await splitEntity(shared.id, ['b-1'], 'Greatest Hits');

        await assignImportedSongs([song('Lib/B/Greatest Hits', 'Artist B', 'Greatest Hits', 'b-2')]);
        await assignImportedSongs([song('Lib/A/Greatest Hits', 'Artist A', 'Greatest Hits', 'a-2')]);

        expect((await assignmentOf('b-2'))?.albumEntityId).toBe(separated.id);
        expect((await assignmentOf('a-2'))?.albumEntityId).toBe(shared.id);
        expect(await activeEntitiesNamed('album', 'Greatest Hits')).toHaveLength(2);
    });

    it('uses the artist\'s only album when an ambiguous album name arrives in a new folder', async () => {
        await assignImportedSongs([
            song('Lib/A/Live', 'Artist A', 'Live', 'a-1'),
            song('Lib/B/Live', 'Artist B', 'Live', 'b-1'),
        ]);
        const [shared] = await activeEntitiesNamed('album', 'Live');
        const separated = await splitEntity(shared.id, ['b-1'], 'Live');

        await assignImportedSongs([song('Lib/B/Live (Disc 2)', 'Artist B', 'Live', 'b-disc-2')]);

        expect((await assignmentOf('b-disc-2'))?.albumEntityId).toBe(separated.id);
    });

    it('picks the album\'s own artist when the artist name is ambiguous', async () => {
        await assignImportedSongs([
            song('Lib/Mika/First', 'Mika', 'First', 'first-1'),
            song('Lib/Mika/Second', 'Mika', 'Second', 'second-1'),
        ]);
        const [mika] = await activeEntitiesNamed('artist', 'Mika');
        // The user decides the two albums are by different people with the same name.
        const otherMika = await splitEntity(mika.id, ['second-1'], 'Mika');

        await saveLocalSongs([
            song('Lib/Mika/Second', 'Mika', 'Second', 'second-2'),
            song('Lib/Mika/First', 'Mika', 'First', 'first-2'),
        ]);

        expect((await assignmentOf('second-2'))?.artistEntityIds).toEqual([otherMika.id]);
        expect((await assignmentOf('first-2'))?.artistEntityIds).toEqual([mika.id]);
    });

    it('reuses an entity created earlier in the same batch', async () => {
        await assignImportedSongs([
            song('Lib/New/Debut', 'Newcomer', 'Debut', 'debut-1'),
            song('Lib/New/Debut', 'Newcomer', 'Debut', 'debut-2'),
        ]);

        expect(await activeEntitiesNamed('artist', 'Newcomer')).toHaveLength(1);
        expect(await activeEntitiesNamed('album', 'Debut')).toHaveLength(1);
        expect((await assignmentOf('debut-1'))?.albumEntityId).toBe((await assignmentOf('debut-2'))?.albumEntityId);
    });

    it('assigns songs that lost their assignment when initializing', async () => {
        await assignImportedSongs([song('Lib/A/One', 'Artist A', 'One', 'kept'), song('Lib/A/One', 'Artist A', 'One', 'lost')]);
        await appDatabase.local_library_assignments.delete('lost');

        await ensureLocalLibraryInitialized();

        expect((await assignmentOf('lost'))?.albumEntityId).toBe((await assignmentOf('kept'))?.albumEntityId);
        expect((await assignmentOf('lost'))?.artistEntityIds).toEqual((await assignmentOf('kept'))?.artistEntityIds);
    });
});
