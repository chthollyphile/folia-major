import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import {
    applyMatchedMetadata,
    assignImportedSongs,
    ensureLocalLibraryInitialized,
    mergeEntities,
    splitEntity,
} from '../../../src/services/localLibraryCatalogService';
import type { LocalSong } from '../../../src/types';

// test/unit/localLibrary/localLibraryCatalogService.test.ts
// Verifies folder album heuristics, structured matches, protected origins, merge/split, and rollback.

const song = (id: string, patch: Partial<LocalSong> = {}): LocalSong => ({
    id,
    fileName: `${id}.flac`,
    filePath: `Library/Album/${id}.flac`,
    folderName: 'Library',
    title: id,
    artist: 'Local Artist',
    album: 'Shared Album',
    duration: 1,
    fileSize: 1,
    mimeType: 'audio/flac',
    addedAt: 1,
    ...patch,
});

describe('localLibraryCatalogService', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await appDatabase.delete();
    });

    it('groups same-folder same-name albums even when track artists differ', async () => {
        await assignImportedSongs([
            song('one', { artist: 'Artist One' }),
            song('two', { artist: 'Artist Two' }),
        ]);
        const assignments = await appDatabase.local_library_assignments.toArray();
        expect(assignments[0]?.albumEntityId).toBeTruthy();
        expect(assignments[1]?.albumEntityId).toBe(assignments[0]?.albumEntityId);
        expect(assignments[0]?.artistEntityIds).not.toEqual(assignments[1]?.artistEntityIds);
    });

    it('creates separate structured matched artist assignments', async () => {
        await assignImportedSongs([song('duet')]);
        await applyMatchedMetadata('duet', {
            artists: [{ id: 1, name: 'Artist One' }, { id: 2, name: 'Artist Two' }],
            album: { id: 10, name: 'Online Album' },
        });
        const assignment = await appDatabase.local_library_assignments.get('duet');
        const stored = await appDatabase.local_music.get('duet');
        expect(assignment?.artistOrigin).toBe('matched');
        expect(assignment?.artistEntityIds).toHaveLength(2);
        expect(stored?.matchedArtistEntities).toEqual([
            { id: 1, name: 'Artist One' },
            { id: 2, name: 'Artist Two' },
        ]);
    });

    it('does not overwrite matched assignments during a rescan import update', async () => {
        await assignImportedSongs([song('matched')]);
        await applyMatchedMetadata('matched', {
            artists: [{ name: 'Online Artist' }],
            album: { name: 'Online Album' },
        });
        const before = await appDatabase.local_library_assignments.get('matched');
        await assignImportedSongs([song('matched', { artist: 'Changed Tag', album: 'Changed Album' })]);
        expect(await appDatabase.local_library_assignments.get('matched')).toMatchObject({
            artistEntityIds: before?.artistEntityIds,
            albumEntityId: before?.albumEntityId,
            artistOrigin: 'matched',
            albumOrigin: 'matched',
        });
    });

    it('recovers a missing bootstrap marker without rewriting existing assignments', async () => {
        await assignImportedSongs([song('marker')]);
        await applyMatchedMetadata('marker', { artists: [{ name: 'Online Artist' }] });
        await appDatabase.api_cache.clear();
        await ensureLocalLibraryInitialized();
        expect(await appDatabase.local_library_assignments.get('marker')).toMatchObject({
            artistOrigin: 'matched',
        });
    });

    it('preserves the imported artist assignment when matched metadata only supplies an album', async () => {
        await assignImportedSongs([song('album-only')]);
        const imported = await appDatabase.local_library_assignments.get('album-only');
        await applyMatchedMetadata('album-only', { album: { name: 'Online Album' } });
        expect(await appDatabase.local_library_assignments.get('album-only')).toMatchObject({
            artistEntityIds: imported?.artistEntityIds,
            artistOrigin: 'import',
            albumOrigin: 'matched',
        });
    });

    it('merges redirects then splits only selected members with split origin', async () => {
        await assignImportedSongs([
            song('one', { artist: 'First' }),
            song('two', { artist: 'Second' }),
        ]);
        const [one, two] = await appDatabase.local_library_assignments.toArray();
        await mergeEntities(one.artistEntityIds[0], [two.artistEntityIds[0]]);
        expect((await appDatabase.local_library_assignments.get('two'))?.artistEntityIds).toEqual([one.artistEntityIds[0]]);
        expect((await appDatabase.local_library_entities.get(two.artistEntityIds[0]))?.mergedInto).toBe(one.artistEntityIds[0]);

        const split = await splitEntity(one.artistEntityIds[0], ['two'], 'Second Again');
        expect(await appDatabase.local_library_assignments.get('one')).toMatchObject({ artistEntityIds: [one.artistEntityIds[0]] });
        expect(await appDatabase.local_library_assignments.get('two')).toMatchObject({
            artistEntityIds: [split.id],
            artistOrigin: 'split',
        });
    });

    it('rolls back song writes when an assignment write fails', async () => {
        vi.spyOn(appDatabase.local_library_assignments, 'bulkPut').mockRejectedValueOnce(new Error('forced failure'));
        await expect(assignImportedSongs([song('rollback')])).rejects.toThrow('forced failure');
        expect(await appDatabase.local_music.get('rollback')).toBeUndefined();
        expect(await appDatabase.local_library_entities.count()).toBe(0);
    });
});
