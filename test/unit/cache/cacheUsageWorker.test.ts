import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getBrowserCacheUsageByCategory, putCacheEntry } from '@/services/repositories/cacheRepository';
import { appDatabase } from '@/services/appDatabase';
import { countCacheUsageIn } from '@/workers/cacheUsage.worker';

// test/unit/cache/cacheUsageWorker.test.ts
// The sizes on the settings page are counted on a worker in the app, and on the page where there is
// no worker (as here). The worker reads the database without Dexie, so the two are held to the same
// answer: a row the worker read differently would show a wrong size with nothing to say so.

const TABLES = ['api_cache', 'user_cache', 'media_cache', 'metadata_cache'];

describe('the cache count on a worker', () => {
    beforeEach(async () => {
        await Promise.all(TABLES.map(name => appDatabase.table(name).clear()));
        await putCacheEntry('user_playlists', [{ id: 1, name: 'Mine' }]);
        await putCacheEntry('playlist_detail_7', { id: 7, tracks: [1, 2, 3] });
        await putCacheEntry('lyric_42', { lrc: '[00:01.00]hello' });
        await putCacheEntry('automix_profile_42', { bpm: 120, beats: [0.5, 1, 1.5] });
        await putCacheEntry('audio_42', new Blob([new Uint8Array(300)]));
        await putCacheEntry('replayGain_42', { gain: -6.2 });
        await putCacheEntry('last_song', { id: 42 });
    });

    it('gives the answer the page gives', async () => {
        const onPage = await getBrowserCacheUsageByCategory();
        expect(onPage.mediaCount).toBe(1);
        expect(onPage.media).toBeGreaterThan(300);
        expect(onPage.playlist).toBeGreaterThan(0);
        expect(onPage.lyrics).toBeGreaterThan(0);
        expect(onPage.analysis).toBeGreaterThan(0);
        expect(await countCacheUsageIn(appDatabase.name, TABLES)).toEqual(onPage);
    });

    // Not seeing the database is not "the cache is empty": the page counts it itself then.
    it('answers null for a database that is not there, without making one', async () => {
        expect(await countCacheUsageIn('NoSuchDatabase', TABLES)).toBeNull();
        expect((await indexedDB.databases()).map(database => database.name)).not.toContain('NoSuchDatabase');
    });
});
