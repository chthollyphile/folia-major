import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import {
    applyMatchedMetadata,
    applyManualMetadata,
    assignImportedSongs,
    ensureLocalLibraryInitialized,
    mergeEntities,
    moveEntityMembersToExistingEntity,
    splitEntity,
} from '../../../src/services/localLibraryCatalogService';
import type { LocalSong } from '../../../src/types';

// test/unit/localLibrary/localLibraryCatalogService.test.ts
// Verifies folder album heuristics, structured matches, protected origins, merge/split, and rollback.

type SongPatch = Partial<LocalSong> & { artist?: string; album?: string };
const song = (id: string, patch: SongPatch = {}): LocalSong => {
    const { artist = 'Local Artist', album = 'Shared Album', importedMetadata, ...rest } = patch;
    return {
        id,
        fileName: `${id}.flac`,
        filePath: `Library/Album/${id}.flac`,
        folderName: 'Library',
        title: id,
        titleOrigin: 'import',
        importedMetadata: importedMetadata || {
            title: id,
            titleSource: 'filename',
            artistNames: artist ? [artist] : [],
            albumName: album,
        },
        duration: 1,
        fileSize: 1,
        mimeType: 'audio/flac',
        addedAt: 1,
        ...rest,
    };
};

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

    it('assigns semicolon/slash-separated imported and manual artists as separate entities', async () => {
        await assignImportedSongs([song('duet', { artist: '小山百代/三森すずこ' })]);
        expect((await appDatabase.local_library_assignments.get('duet'))?.artistEntityIds).toHaveLength(2);

        await applyManualMetadata('duet', ['佐藤日向；岩田陽葵'], 'Shared Album');
        const assignment = await appDatabase.local_library_assignments.get('duet');
        expect(assignment?.artistEntityIds).toHaveLength(2);
        expect(assignment?.artistOrigin).toBe('manual');
        const artists = await appDatabase.local_library_entities.bulkGet(assignment?.artistEntityIds || []);
        expect(artists.map(entity => entity?.displayName)).toEqual(['佐藤日向', '岩田陽葵']);
    });

    it('does not rewrite existing assignments during initialization', async () => {
        const joinedEntity = {
            id: 'joined-artist',
            kind: 'artist' as const,
            displayName: '小山百代/三森すずこ',
            aliases: ['小山百代/三森すずこ'],
            normalizedAliases: ['小山百代/三森すずこ'],
            createdAt: 1,
            updatedAt: 1,
        };
        await appDatabase.local_music.bulkPut([
            song('legacy-duet', { artist: '小山百代/三森すずこ' }),
            song('explicit-split', { artist: '小山百代/三森すずこ' }),
        ]);
        await appDatabase.local_library_entities.put(joinedEntity);
        await appDatabase.local_library_assignments.bulkPut([
            {
                songId: 'legacy-duet',
                artistEntityIds: [joinedEntity.id],
                artistOrigin: 'import',
                albumOrigin: 'import',
                updatedAt: 1,
            },
            {
                songId: 'explicit-split',
                artistEntityIds: [joinedEntity.id],
                artistOrigin: 'split',
                albumOrigin: 'import',
                updatedAt: 1,
            },
        ]);

        await ensureLocalLibraryInitialized();

        expect((await appDatabase.local_library_assignments.get('legacy-duet'))?.artistEntityIds).toEqual([joinedEntity.id]);
        expect((await appDatabase.local_library_assignments.get('explicit-split'))?.artistEntityIds).toEqual([joinedEntity.id]);
    });

    it('creates separate structured matched artist assignments', async () => {
        await assignImportedSongs([song('duet')]);
        await applyMatchedMetadata('duet', {
            source: 'netease',
            songId: 1,
            artists: [{ id: 1, name: 'Artist One' }, { id: 2, name: 'Artist Two' }],
            album: { id: 10, name: 'Online Album' },
        });
        const assignment = await appDatabase.local_library_assignments.get('duet');
        const stored = await appDatabase.local_music.get('duet');
        expect(assignment?.artistOrigin).toBe('auto-match');
        expect(assignment?.artistEntityIds).toHaveLength(2);
        expect(stored?.onlineMetadata?.artists).toEqual([
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
            artistOrigin: 'auto-match',
            albumOrigin: 'auto-match',
        });
    });

    it('recovers a missing bootstrap marker without rewriting existing assignments', async () => {
        await assignImportedSongs([song('marker')]);
        await applyMatchedMetadata('marker', { artists: [{ name: 'Online Artist' }] });
        await appDatabase.api_cache.clear();
        await ensureLocalLibraryInitialized();
        expect(await appDatabase.local_library_assignments.get('marker')).toMatchObject({
            artistOrigin: 'auto-match',
        });
    });

    it('preserves the imported artist assignment when matched metadata only supplies an album', async () => {
        await assignImportedSongs([song('album-only')]);
        const imported = await appDatabase.local_library_assignments.get('album-only');
        await applyMatchedMetadata('album-only', { album: { name: 'Online Album' } });
        expect(await appDatabase.local_library_assignments.get('album-only')).toMatchObject({
            artistEntityIds: imported?.artistEntityIds,
            artistOrigin: 'import',
            albumOrigin: 'auto-match',
        });
    });

    it('protects manual artist relationships while filling an unprotected album', async () => {
        await assignImportedSongs([song('protected', { album: undefined })]);
        const imported = await appDatabase.local_library_assignments.get('protected');
        await appDatabase.local_library_assignments.update('protected', { artistOrigin: 'manual' });
        await applyMatchedMetadata('protected', {
            source: 'qq',
            songId: 'qq-song-mid',
            title: 'Online Title',
            artists: [{ id: 9, name: 'Online Artist' }],
            album: { id: 'qq-album', name: 'Online Album' },
        }, { protectOrigins: ['manual', 'split'] });
        expect(await appDatabase.local_library_assignments.get('protected')).toMatchObject({
            artistEntityIds: imported?.artistEntityIds,
            artistOrigin: 'manual',
            albumOrigin: 'auto-match',
        });
        expect(await appDatabase.local_music.get('protected')).toMatchObject({
            title: 'Online Title',
            titleOrigin: 'auto-match',
            onlineMetadata: {
                source: 'qq',
                songId: 'qq-song-mid',
                albumId: 'qq-album',
                title: 'Online Title',
            },
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

    it('moves selected album members into an existing album without merging either entity', async () => {
        await assignImportedSongs([
            song('source-one', { album: 'Source Album' }),
            song('source-two', { album: 'Source Album' }),
            song('target-one', { album: 'Target Album' }),
        ]);
        const sourceAssignment = await appDatabase.local_library_assignments.get('source-one');
        const targetAssignment = await appDatabase.local_library_assignments.get('target-one');
        const sourceAlbumId = sourceAssignment?.albumEntityId;
        const targetAlbumId = targetAssignment?.albumEntityId;
        expect(sourceAlbumId).toBeTruthy();
        expect(targetAlbumId).toBeTruthy();
        const entityCount = await appDatabase.local_library_entities.count();

        const target = await moveEntityMembersToExistingEntity(sourceAlbumId!, targetAlbumId!, ['source-one']);

        expect(target.id).toBe(targetAlbumId);
        expect(await appDatabase.local_library_assignments.get('source-one')).toMatchObject({
            albumEntityId: targetAlbumId,
            albumOrigin: 'split',
        });
        expect(await appDatabase.local_library_assignments.get('source-two')).toMatchObject({
            albumEntityId: sourceAlbumId,
        });
        expect((await appDatabase.local_library_entities.get(sourceAlbumId!))?.mergedInto).toBeUndefined();
        expect((await appDatabase.local_library_entities.get(targetAlbumId!))?.mergedInto).toBeUndefined();
        expect(await appDatabase.local_library_entities.count()).toBe(entityCount);
    });

    it('rolls back song writes when an assignment write fails', async () => {
        vi.spyOn(appDatabase.local_library_assignments, 'bulkPut').mockRejectedValueOnce(new Error('forced failure'));
        await expect(assignImportedSongs([song('rollback')])).rejects.toThrow('forced failure');
        expect(await appDatabase.local_music.get('rollback')).toBeUndefined();
        expect(await appDatabase.local_library_entities.count()).toBe(0);
    });
});
