import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { putCacheEntry, readCacheEntriesByKey, readCacheEntriesByPrefix } from '@/services/repositories/cacheRepository';
import { appDatabase } from '@/services/appDatabase';

// test/unit/cache/cacheEntriesByPrefix.test.ts
// A prefix read used to load every row of every cache table and keep those with the prefix. It now
// lists keys first and reads only those rows; what it returns, and in what order, must not change.

const TABLES = ['api_cache', 'user_cache', 'media_cache', 'metadata_cache'];

// The old read, kept here as the answer the new one is held to.
const wholeTableRead = async (prefix: string) => {
    const rows = (await Promise.all(TABLES.map(name => appDatabase.table(name).toArray()))).flat();
    const byKey = new Map<string, { key: string; data: unknown; timestamp: number }>();
    rows.forEach(entry => {
        if (entry.key.startsWith(prefix)) {
            byKey.set(entry.key, { key: entry.key, data: entry.data, timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : 0 });
        }
    });
    return Array.from(byKey.values());
};

describe('reading cache entries by key prefix', () => {
    beforeEach(async () => {
        await Promise.all(TABLES.map(name => appDatabase.table(name).clear()));
        await putCacheEntry('dual_theme_b', { light: 'b' });
        await putCacheEntry('dual_theme_a', { light: 'a' });
        await putCacheEntry('playlist_detail_7', { id: 7 });
        await putCacheEntry('playlist_tracks_7', [1, 2, 3]);
        await putCacheEntry('audio_42', new Blob([new Uint8Array(300)]));
        // A key left in api_cache by an older version and also in its own table now: the later table wins.
        await appDatabase.api_cache.put({ key: 'playlist_detail_9', data: { from: 'api' }, timestamp: 1 });
        await appDatabase.metadata_cache.put({ key: 'playlist_detail_9', data: { from: 'metadata' }, timestamp: 2 });
        // A row written without a timestamp reads as 0.
        await appDatabase.api_cache.put({ key: 'dual_theme_c', data: { light: 'c' } } as never);
    });

    it('returns what the whole-table read returned', async () => {
        for (const prefix of ['dual_theme_', 'playlist_', 'playlist_detail_', 'audio_', 'nothing_']) {
            expect(await readCacheEntriesByPrefix(prefix)).toEqual(await wholeTableRead(prefix));
        }
        expect((await readCacheEntriesByPrefix('dual_theme_')).map(entry => entry.key)).toEqual(['dual_theme_a', 'dual_theme_b', 'dual_theme_c']);
        expect((await readCacheEntriesByPrefix('playlist_detail_9'))[0].data).toEqual({ from: 'metadata' });
        expect((await readCacheEntriesByPrefix('dual_theme_c'))[0].timestamp).toBe(0);
    });
});

// The lyric export reads every `lyric_` row of two tables. The rows are now read fifty at a time
// with a pause between; the answer must be the one a single read of all of them gave.
describe('reading many cache entries by key', () => {
    const isLyric = (key: string) => key.startsWith('lyric_');
    const EXPORT_TABLES = ['metadata_cache', 'api_cache'] as const;

    // The read before the batches, kept here as the answer: keys, then one bulkGet of every match.
    const oneReadOfEveryRow = async () => {
        const perTable = await Promise.all(EXPORT_TABLES.map(async name => {
            const table = appDatabase.table(name);
            const keys = (await table.toCollection().primaryKeys()).map(String).filter(isLyric);
            return (await table.bulkGet(keys)).filter(Boolean);
        }));
        const byKey = new Map<string, { key: string; data: unknown; timestamp: number }>();
        perTable.flat().forEach(entry => {
            byKey.set(entry.key, { key: entry.key, data: entry.data, timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : 0 });
        });
        return Array.from(byKey.values());
    };

    beforeEach(async () => {
        await Promise.all(TABLES.map(name => appDatabase.table(name).clear()));
        await appDatabase.metadata_cache.bulkPut(Array.from({ length: 130 }, (_, i) => ({
            key: `lyric_online:netease:${i}${i % 3 === 0 ? '_state' : ''}`, data: { lines: [{ text: `line ${i}` }] }, timestamp: i,
        })));
        // Older copies left in api_cache, some under the same key: the later table wins.
        await appDatabase.api_cache.bulkPut(Array.from({ length: 60 }, (_, i) => ({
            key: `lyric_${i * 2}`, data: { lines: [{ text: `old ${i}` }] }, timestamp: 1000 + i,
        })));
        await appDatabase.api_cache.put({ key: 'lyric_online:netease:5', data: { from: 'api' }, timestamp: 1 });
        await appDatabase.metadata_cache.put({ key: 'playlist_detail_1', data: { id: 1 }, timestamp: 1 });
    });

    it('returns what one read of every row returned, in the same order', async () => {
        const rows = await readCacheEntriesByKey(isLyric, [...EXPORT_TABLES]);
        expect(rows).toHaveLength(190);
        expect(rows).toEqual(await oneReadOfEveryRow());
        expect(rows.find(row => row.key === 'lyric_online:netease:5')?.data).toEqual({ from: 'api' });
    });
});
