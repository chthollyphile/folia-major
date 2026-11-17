import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_DATABASE_NAME, appDatabase } from '../../../src/services/appDatabase';
import { getFromCache, getSessionData, getThemeRegistryEntries } from '../../../src/services/db';

// test/unit/services/appDatabaseMigration.test.ts
// Verifies legacy native databases remain readable when Dexie opens and upgrades them to v1.

const openNativeV6 = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(APP_DATABASE_NAME, 6);
    request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('session');
        db.createObjectStore('api_cache', { keyPath: 'key' });
        db.createObjectStore('user_cache', { keyPath: 'key' });
        db.createObjectStore('media_cache', { keyPath: 'key' });
        db.createObjectStore('metadata_cache', { keyPath: 'key' });
        db.createObjectStore('local_music', { keyPath: 'id' });
        db.createObjectStore('theme_registry', { keyPath: 'fingerprint' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
});

const openNativeV8 = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(APP_DATABASE_NAME, 8);
    request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('session');
        db.createObjectStore('api_cache', { keyPath: 'key' });
        db.createObjectStore('user_cache', { keyPath: 'key' });
        db.createObjectStore('media_cache', { keyPath: 'key' });
        db.createObjectStore('metadata_cache', { keyPath: 'key' });
        db.createObjectStore('local_music', { keyPath: 'id' });
        db.createObjectStore('theme_registry', { keyPath: 'fingerprint' });
        db.createObjectStore('local_library_entities', { keyPath: 'id' });
        db.createObjectStore('local_library_assignments', { keyPath: 'songId' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
});

const completeTransaction = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
});

describe('AppDatabase native v6 migration', () => {
    beforeEach(async () => {
        await appDatabase.delete();
    });

    afterEach(async () => {
        await appDatabase.delete();
    });

    it('preserves native v6 stores and out-of-line session keys', async () => {
        const nativeDb = await openNativeV6();
        const transaction = nativeDb.transaction(
            ['session', 'api_cache', 'user_cache', 'local_music', 'theme_registry'],
            'readwrite',
        );
        transaction.objectStore('session').put('song.mp3', 'fileName');
        transaction.objectStore('api_cache').put({ key: 'last_song', data: { id: 42 }, timestamp: 1 });
        transaction.objectStore('user_cache').put({ key: 'user_profile', data: { userId: 7 }, timestamp: 1 });
        transaction.objectStore('local_music').put({
            id: 'song-1',
            fileName: 'song.mp3',
            filePath: 'Music/song.mp3',
            duration: 1,
            fileSize: 1,
            mimeType: 'audio/mpeg',
            addedAt: 1,
        });
        transaction.objectStore('theme_registry').put({ fingerprint: 'theme:1', cacheKey: 'theme_1' });
        await completeTransaction(transaction);
        nativeDb.close();

        await appDatabase.open();

        expect(appDatabase.verno).toBe(1);
        expect(await getSessionData()).toMatchObject({ fileName: 'song.mp3' });
        expect(await getFromCache('last_song')).toEqual({ id: 42 });
        expect(await getFromCache('user_profile')).toEqual({ userId: 7 });
        expect(await appDatabase.local_music.get('song-1')).toMatchObject({
            id: 'song-1',
            title: 'song',
            titleOrigin: 'import',
            importedMetadata: { title: 'song', titleSource: 'filename', artistNames: [] },
        });
        expect(await getThemeRegistryEntries()).toEqual([{ fingerprint: 'theme:1', cacheKey: 'theme_1' }]);
        expect(appDatabase.tables.map(table => table.name)).toEqual(expect.arrayContaining([
            'local_library_entities',
            'local_library_assignments',
            'local_cover_assets',
        ]));
    });

    it('upgrades v0.8 without rewriting legacy embedded cover blobs', async () => {
        const nativeDb = await openNativeV8();
        const embeddedCover = new Blob(['legacy-cover'], { type: 'image/png' });
        const transaction = nativeDb.transaction('local_music', 'readwrite');
        transaction.objectStore('local_music').put({
            id: 'legacy-cover-song',
            fileName: 'legacy.flac',
            filePath: 'Music/legacy.flac',
            title: 'Legacy',
            titleOrigin: 'import',
            importedMetadata: { title: 'Legacy', titleSource: 'filename', artistNames: [] },
            duration: 1,
            fileSize: 1,
            mimeType: 'audio/flac',
            addedAt: 1,
            embeddedCover,
        });
        await completeTransaction(transaction);
        nativeDb.close();

        await appDatabase.open();

        const storedSong = await appDatabase.local_music.get('legacy-cover-song');
        expect(appDatabase.verno).toBe(1);
        expect((storedSong as typeof storedSong & { embeddedCover?: Blob })?.embeddedCover).toBeInstanceOf(Blob);
        expect(appDatabase.local_music.schema.indexes.map(index => index.name)).toContain('localCoverAssetId');
        expect(await appDatabase.local_cover_assets.count()).toBe(0);
    });

    it('backfills the indexed album context key when upgrading from v0.9', async () => {
        const previous = new Dexie(APP_DATABASE_NAME);
        previous.version(0.9).stores({
            session: '',
            api_cache: 'key',
            user_cache: 'key',
            media_cache: 'key',
            metadata_cache: 'key',
            local_music: 'id, localCoverAssetId',
            theme_registry: 'fingerprint',
            local_library_entities: 'id, kind, *normalizedAliases, mergedInto, needsReview, createdAt',
            local_library_assignments: 'songId, *artistEntityIds, albumEntityId, artistOrigin, albumOrigin',
            local_cover_assets: 'id',
        });
        const base = {
            fileName: 'a.flac',
            titleOrigin: 'import',
            duration: 1,
            fileSize: 1,
            mimeType: 'audio/flac',
            addedAt: 1,
        };
        await previous.table('local_music').bulkPut([
            {
                ...base,
                id: 'with-album',
                filePath: 'Lib/Artist/Album/a.flac',
                folderName: 'Lib/Artist/Album',
                title: 'A',
                importedMetadata: { title: 'A', titleSource: 'embedded', artistNames: ['Artist'], albumName: 'Album' },
            },
            {
                ...base,
                id: 'without-album',
                filePath: 'Lib/Loose/b.flac',
                folderName: 'Lib/Loose',
                title: 'B',
                importedMetadata: { title: 'B', titleSource: 'filename', artistNames: [] },
            },
        ]);
        previous.close();

        await appDatabase.open();

        const key = 'lib/artist/album\u0000\u0000album';
        expect(appDatabase.verno).toBe(1);
        expect(appDatabase.local_music.schema.indexes.map(index => index.name)).toContain('albumContextKey');
        expect((await appDatabase.local_music.get('with-album'))?.albumContextKey).toBe(key);
        expect((await appDatabase.local_music.get('without-album'))?.albumContextKey).toBeUndefined();
        expect(await appDatabase.local_music.where('albumContextKey').equals(key).primaryKeys()).toEqual(['with-album']);
    });
});

