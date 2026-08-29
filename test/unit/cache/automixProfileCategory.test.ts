import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearBrowserCacheByCategory,
    getBrowserCacheUsageByCategory,
    putCacheEntry,
    readCacheEntry,
} from '@/services/repositories/cacheRepository';
import { appDatabase } from '@/services/appDatabase';

// test/unit/cache/automixProfileCategory.test.ts
// Automix profiles as a cache category of their own, and the move that got them there.
//
// The prefix shipped unregistered, which services/onlineMusic/README.md names as its own failure
// mode: an unregistered prefix falls into the api_cache bucket, counts towards no category, and no
// button on the settings page can reach it. Silent, because the entries are a couple of hundred
// bytes each and never add up to a number a person would question.

const KEY = 'automix_profile_song-42';
const PROFILE = { version: 9, bpm: 120 };

const clearAll = () => Promise.all([
    appDatabase.api_cache.clear(),
    appDatabase.media_cache.clear(),
    appDatabase.metadata_cache.clear(),
    appDatabase.user_cache.clear(),
]);

describe('automix profiles are their own cache category', () => {
    beforeEach(clearAll);

    it('counts towards analysis rather than towards nothing', async () => {
        await putCacheEntry(KEY, PROFILE);
        const usage = await getBrowserCacheUsageByCategory();

        expect(usage.analysis).toBeGreaterThan(0);
        expect(usage.playlist + usage.lyrics + usage.cover + usage.media).toBe(0);
        expect(usage.mediaCount).toBe(0);
    });

    it('is cleared by its own button', async () => {
        await putCacheEntry(KEY, PROFILE);
        await clearBrowserCacheByCategory('analysis');

        expect(await readCacheEntry(KEY)).toBeNull();
    });

    it('survives every other button, media included', async () => {
        // The point of not riding with the audio. A profile costs a decode and a model pass to
        // rebuild and stays true whether or not the bytes are still here, so reclaiming five
        // gigabytes of audio must not quietly throw it away too.
        await putCacheEntry(KEY, PROFILE);
        for (const category of ['playlist', 'lyrics', 'cover', 'media'] as const) {
            await clearBrowserCacheByCategory(category);
        }

        expect(await readCacheEntry(KEY)).toEqual(PROFILE);
    });
});

describe('profiles written before the prefix was registered', () => {
    beforeEach(clearAll);

    // They are sitting in api_cache, which is not where the key resolves any more. Rebuilding one
    // is a full decode plus a model pass, so they are moved rather than abandoned.
    const writeLegacyEntry = () => appDatabase.api_cache.put({ key: KEY, data: PROFILE, timestamp: 1 });

    it('are found on the way past and moved', async () => {
        await writeLegacyEntry();

        expect(await readCacheEntry(KEY)).toEqual(PROFILE);
        expect(await appDatabase.api_cache.get(KEY)).toBeUndefined();
        expect(await appDatabase.metadata_cache.get(KEY)).toBeTruthy();
    });

    it('are clearable where they lie, even if nothing ever reads them again', async () => {
        await writeLegacyEntry();
        await clearBrowserCacheByCategory('analysis');

        expect(await appDatabase.api_cache.get(KEY)).toBeUndefined();
    });

    it('are counted where they lie', async () => {
        await writeLegacyEntry();

        expect((await getBrowserCacheUsageByCategory()).analysis).toBeGreaterThan(0);
    });
});
