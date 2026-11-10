import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { SongResult } from '@/types';
import type { OmniCollection } from '@/types/onlineMusic';
import type { OnlineGridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';
import { createCollectionTrackSnapshot } from '@/library/core/collection/resource/collectionTrackSnapshot.service';
import { createOnlineCollectionResource } from '@/library/core/collection/resource/onlineCollectionResource.service';
import { createRadioFeed } from '@/library/core/home/online/onlineHomeFeeds.service';
import { buildOnlineRadioCards } from '@/library/core/home/homeCards';

// test/unit/library/core/onlinePaginationCompatibility.test.ts
// 保留 main 的混合分页游标缓存与每日推荐能力语义，不让目录迁移退回按可见行数恢复。

const song = (id: string): SongResult => ({
    id, name: id, artists: [], album: { id: 0, name: '' }, durationMs: 1,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
} as SongResult);
const collection: OnlineGridViewCollectionDescriptor = {
    source: 'online', providerId: 'bodian', type: 'playlist', id: 'mixed', name: 'Mixed',
    trackCount: 500, tracksUpdatedAt: 1000,
};
const settle = async () => {
    for (let index = 0; index < 60; index += 1) await Promise.resolve();
};
const deps = (cached: ReturnType<typeof createCollectionTrackSnapshot<SongResult>>) => ({
    getCollectionTracks: vi.fn(async (_collection: OmniCollection, _page: { limit: number; offset: number }) => ({ items: [song('last')], nextOffset: 500, hasMore: false, total: 500 })),
    getCollectionDetail: vi.fn(async () => null),
    getPersonalFm: vi.fn(async () => []), getDailySongs: vi.fn(async () => []),
    readCache: vi.fn(async () => cached), writeCache: vi.fn(async () => {}), wait: async () => {},
});

describe('main pagination compatibility in Library Core', () => {
    it('resumes a sparse cached page from its raw cursor rather than its visible row count', async () => {
        const cached = createCollectionTrackSnapshot({ items: [song('a'), song('b')], nextOffset: 150, hasMore: true, total: 500 }, 1000);
        const ports = deps(cached);
        const resource = createOnlineCollectionResource('mixed', ports);
        resource.ensure(collection, {});
        await settle();
        expect(ports.getCollectionTracks.mock.calls).toEqual([[collection, { limit: 1000, offset: 150 }]]);
        expect(resource.getSnapshot().tracks.map(track => track.id)).toEqual(['a', 'b', 'last']);
        resource.dispose();
    });

    it('does not resume a complete cached page even when the collection count is larger', async () => {
        const cached = createCollectionTrackSnapshot({ items: [song('a')], nextOffset: 300, hasMore: false, total: 300 }, 1000);
        const ports = deps(cached);
        const resource = createOnlineCollectionResource('complete', ports);
        resource.ensure(collection, {});
        await settle();
        expect(ports.getCollectionTracks).not.toHaveBeenCalled();
        expect(resource.getSnapshot().tracks.map(track => track.id)).toEqual(['a']);
        resource.dispose();
    });

    it('persists the original cursor and completion state after background paging', async () => {
        const cached = createCollectionTrackSnapshot({ items: [song('a')], nextOffset: 150, hasMore: true, total: 500 }, 1000);
        const ports = deps(cached);
        const resource = createOnlineCollectionResource('write', ports);
        resource.ensure(collection, {});
        await settle();
        expect(ports.writeCache).toHaveBeenLastCalledWith(
            expect.any(String), [song('a'), song('last')], 1000,
            { nextOffset: 500, hasMore: false, total: 500 },
        );
        resource.dispose();
    });

    it('does not expose Daily Recommendations when the owning provider lacks it', async () => {
        const feed = createRadioFeed({
            getHomeFeed: async () => ({ personalFm: [song('fm')], dailySongs: [], recommendedCollections: [] }),
            songCoverUrl: () => '', supportsDailySongs: () => false,
        });
        feed.setOwner({ providerId: 'bodian', userId: 'u' });
        await feed.ensure();
        const t = ((key: string) => key) as unknown as TFunction;
        expect(buildOnlineRadioCards(feed.getSnapshot().data, { t }).map(card => card.id)).toEqual(['personal_fm']);
    });

    it('continues after an empty first page when upstream has a later playable page', async () => {
        const ports = deps(createCollectionTrackSnapshot({ items: [], nextOffset: 0, hasMore: false }, 0));
        ports.getCollectionTracks.mockImplementation(async (_collection, page) => page.offset === 0
            ? { items: [], nextOffset: 150, hasMore: true, total: 500 }
            : { items: [song('last')], nextOffset: 500, hasMore: false, total: 500 });
        const resource = createOnlineCollectionResource('empty-first-page', ports);
        resource.ensure(collection, {});
        await settle();
        expect(ports.getCollectionTracks.mock.calls.map(([, page]) => page.offset)).toEqual([0, 150]);
        expect(resource.getSnapshot().tracks.map(track => track.id)).toEqual(['last']);
        resource.dispose();
    });
});
