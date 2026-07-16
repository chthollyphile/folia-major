import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    appDatabase,
    LOCAL_LIBRARY_ARTIST_SPLIT_MARKER_KEY,
    LOCAL_LIBRARY_BOOTSTRAP_MARKER_KEY,
} from '../../../src/services/appDatabase';
import {
    clearCache,
    getCacheEntriesByPrefix,
    getCacheKeysByPrefix,
    getFromCache,
    removeCacheEntriesByPrefix,
    saveToCache,
} from '../../../src/services/db';

// test/unit/services/dbDexieCompatibility.test.ts
// Verifies cache routing, legacy fallback migration, prefix APIs, and selective cleanup through Dexie.

describe('db Dexie compatibility facade', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
    });

    afterEach(async () => {
        await appDatabase.delete();
    });

    it('routes cache values and migrates legacy user entries atomically', async () => {
        await appDatabase.api_cache.put({ key: 'user_profile', data: { userId: 9 }, timestamp: 1 });
        await expect(getFromCache('user_profile')).resolves.toEqual({ userId: 9 });
        expect(await appDatabase.user_cache.get('user_profile')).toMatchObject({ data: { userId: 9 } });
        expect(await appDatabase.api_cache.get('user_profile')).toBeUndefined();
    });

    it('scans and removes multiple prefixes across routed tables', async () => {
        await saveToCache('playlist_tracks_1', [1]);
        await saveToCache('playlist_detail_1', { id: 1 });
        await saveToCache('cover_1', new Blob(['cover']));

        expect(await getCacheKeysByPrefix(['playlist_tracks_', 'playlist_detail_'])).toEqual(expect.arrayContaining([
            'playlist_tracks_1',
            'playlist_detail_1',
        ]));
        expect(await getCacheEntriesByPrefix('playlist_')).toHaveLength(2);

        await removeCacheEntriesByPrefix(['playlist_tracks_', 'playlist_detail_']);
        expect(await getCacheKeysByPrefix(['playlist_'])).toEqual([]);
        expect(await getFromCache('cover_1')).toBeInstanceOf(Blob);
    });

    it('preserves requested keys during a full cache cleanup', async () => {
        await saveToCache('last_song', { id: 1 });
        await saveToCache('theme_1', { name: 'theme' });
        await appDatabase.api_cache.put({
            key: LOCAL_LIBRARY_BOOTSTRAP_MARKER_KEY,
            data: { completedAt: 1 },
            timestamp: 1,
        });
        await appDatabase.api_cache.put({
            key: LOCAL_LIBRARY_ARTIST_SPLIT_MARKER_KEY,
            data: { completedAt: 1 },
            timestamp: 1,
        });
        await clearCache(['last_song']);
        expect(await getFromCache('last_song')).toEqual({ id: 1 });
        expect(await getFromCache('theme_1')).toBeNull();
        expect(await appDatabase.api_cache.get(LOCAL_LIBRARY_BOOTSTRAP_MARKER_KEY)).toBeTruthy();
        expect(await appDatabase.api_cache.get(LOCAL_LIBRARY_ARTIST_SPLIT_MARKER_KEY)).toBeTruthy();
    });
});
