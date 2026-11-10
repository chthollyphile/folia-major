import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodianCatalog } from '../../../src/services/onlineMusic/bodian/bodianCatalog';
import { createCollectionTrackSnapshot, readCollectionTrackSnapshot } from '../../../src/library/core/collection/resource/collectionTrackSnapshot.service';
import {
    syncRemainingCollectionPages,
    ONLINE_COLLECTION_BACKGROUND_PAGE_SIZE as GRID_BACKGROUND_BATCH_SIZE,
    ONLINE_COLLECTION_FIRST_PAGE_SIZE as GRID_INITIAL_BATCH_SIZE,
} from '../../../src/library/core/collection/resource/onlineCollectionSync.service';
import { createBodianApi } from 'bodian-music-api';

// test/unit/gridView/bodianCollectionPaging.test.ts
// Exercise real transport limits, catalog pagination and the GridView snapshot/resume boundary offline.

const require = createRequire(import.meta.url);
const { createWire } = require('../../helpers/bodianWire.cjs');
const snapshotTime = 1234;
const song = (id: number) => ({ id, name: `Song ${id}`, duration: 120 });

function setup(firstPageSize = 99) {
    const call = vi.fn(async ({ url }: { url: URL }) => ({
        code: 200, data: { total: 121, list: url.searchParams.get('pn') === '1'
            ? Array.from({ length: firstPageSize }, (_, index) => song(index + 1))
            : Array.from({ length: 21 }, (_, index) => song(index + 101)) },
    }));
    const wire = createWire(call);
    const api = createBodianApi({ deviceId: 'a'.repeat(32), requestFactory: wire.factory });
    vi.stubGlobal('window', { electron: {
        bodianRequest: api.request,
    } });
    const fetchPage = (offset: number) => bodianCatalog.getPlaylistTracks!('123', GRID_BACKGROUND_BATCH_SIZE, offset);
    return { call, fetchPage };
}

afterEach(() => vi.unstubAllGlobals());

describe('Bodian collection paging through the GridView cache', () => {
    it.each([99, 100])('continues at the server cursor after a %i-row first page', async firstPageSize => {
        const { call, fetchPage } = setup(firstPageSize);
        const first = await bodianCatalog.getPlaylistTracks!('123', GRID_INITIAL_BATCH_SIZE, 0);
        let cached = createCollectionTrackSnapshot(first, snapshotTime);
        expect(cached.nextOffset).toBe(100);
        const restored = readCollectionTrackSnapshot<typeof first.items[number]>(JSON.parse(JSON.stringify(cached)), snapshotTime)!;
        const result = await syncRemainingCollectionPages({
            initialItems: restored.tracks,
            startOffset: restored.nextOffset,
            total: restored.total,
            fetchPage,
            getKey: item => String(item.id),
            isCancelled: () => false,
            wait: async () => {},
            onPage: (items, nextOffset, hasMore) => {
                cached = createCollectionTrackSnapshot({ items, nextOffset, hasMore, total: first.total }, snapshotTime);
            },
        });
        expect(result).toMatchObject({ status: 'complete', offset: 121 });
        expect(result.items).toHaveLength(firstPageSize + 21);
        expect(call.mock.calls.map(([{ url }]) => [url.searchParams.get('pn'), url.searchParams.get('rn')])).toEqual([
            ['1', '100'], ['2', '100'],
        ]);
        expect(result.items.every(item => item.sourceRef.kind === 'online' && item.sourceRef.providerId === 'bodian')).toBe(true);
        // The server advertises 121 slots but may only return 120 tracks. A completed cache must stay complete.
        expect(readCollectionTrackSnapshot(cached, snapshotTime)).toMatchObject({ nextOffset: 121, hasMore: false });
    });

    it('resumes a failed second page from the saved cursor without skipping or duplicating songs', async () => {
        const { call, fetchPage } = setup();
        const first = await bodianCatalog.getPlaylistTracks!('123', GRID_INITIAL_BATCH_SIZE, 0);
        const initial = createCollectionTrackSnapshot(first, snapshotTime);
        call.mockRejectedValueOnce(new Error('offline'));
        const options = { getKey: (item: typeof first.items[number]) => String(item.id),
            isCancelled: () => false, wait: async () => {}, onPage: () => {}, retryDelaysMs: [] };
        const failed = await syncRemainingCollectionPages({ ...options, initialItems: initial.tracks,
            startOffset: initial.nextOffset, total: initial.total, fetchPage });
        expect(failed).toMatchObject({ status: 'failed', offset: 100 });
        const cached = createCollectionTrackSnapshot({ items: failed.items, nextOffset: failed.offset,
            hasMore: true, total: initial.total }, snapshotTime);
        const restored = readCollectionTrackSnapshot<typeof first.items[number]>(cached, snapshotTime)!;
        const resumed = await syncRemainingCollectionPages({ ...options, initialItems: restored.tracks,
            startOffset: restored.nextOffset, total: restored.total, fetchPage });
        expect(resumed).toMatchObject({ status: 'complete', offset: 121 });
        expect(new Set(resumed.items.map(item => item.id)).size).toBe(120);
    });
});
