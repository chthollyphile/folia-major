import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearBrowserCacheByCategory, getBrowserCacheUsageByCategory } from '@/services/repositories/cacheRepository';
import { appDatabase } from '@/services/appDatabase';
import { saveSongAudioLevel } from '@/services/onlineMusic/resourceCache';
import type { SongResult } from '@/types';

// test/unit/cache/audioLevelCategory.test.ts
// The quality level a cached song was fetched at is filed, counted and cleared with that song.
//
// The key is built in resourceCache.ts and matched by its prefix in cacheRepository.ts, and nothing
// but these tests ties the two together. A prefix the router does not know falls into the api_cache
// bucket and into no category, where no button on the settings page reaches it. Cleared with any
// other category it would be worse than an orphan: the copy would become one of an unknown level,
// which answers for every level, and the song would play at a level the quality option did not ask
// for with nothing to show it.

const song = {
    id: '42',
    name: 'Song',
    sourceRef: { kind: 'online', providerId: 'ytm', mediaId: '42' },
} as unknown as SongResult;

const rowsIn = async () => ({
    api: await appDatabase.api_cache.count(),
    media: await appDatabase.media_cache.count(),
    metadata: await appDatabase.metadata_cache.count(),
    user: await appDatabase.user_cache.count(),
});

describe('the saved level of a cached song', () => {
    beforeEach(async () => {
        await Promise.all([
            appDatabase.api_cache.clear(),
            appDatabase.media_cache.clear(),
            appDatabase.metadata_cache.clear(),
            appDatabase.user_cache.clear(),
        ]);
        await saveSongAudioLevel(song, 'standard');
    });

    it('is filed with the song\'s other metadata', async () => {
        expect(await rowsIn()).toEqual({ api: 0, media: 0, metadata: 1, user: 0 });
    });

    it('counts towards the songs, without counting as a song', async () => {
        const usage = await getBrowserCacheUsageByCategory();

        expect(usage.media).toBeGreaterThan(0);
        expect(usage.mediaCount).toBe(0);
        expect(usage.playlist + usage.lyrics + usage.cover + usage.analysis).toBe(0);
    });

    it('is cleared with the songs', async () => {
        await clearBrowserCacheByCategory('media');

        expect((await rowsIn()).metadata).toBe(0);
    });

    it('survives every other button', async () => {
        for (const category of ['playlist', 'lyrics', 'cover', 'analysis'] as const) {
            await clearBrowserCacheByCategory(category);
        }

        expect((await rowsIn()).metadata).toBe(1);
    });
});
