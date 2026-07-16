import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_DATABASE_NAME, appDatabase } from '../../../src/services/appDatabase';
import { getFromCache, getSessionData, getThemeRegistryEntries } from '../../../src/services/db';

// test/unit/services/appDatabaseMigration.test.ts
// Verifies a native IndexedDB v6 database remains readable when Dexie opens and upgrades it to v0.8.

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

        expect(appDatabase.verno).toBe(0.8);
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
        ]));
    });
});

