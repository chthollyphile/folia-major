import { describe, expect, it, vi } from 'vitest';
import type { CollectionResourceContext } from '@/library/core/shared/resource.contract';
import { createCollectionResourceRegistry, invalidateLibrarySongsResources } from '@/library/core/collection/resource/collectionResourceRegistry.service';
import type { OnlineGridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';

// Keep account isolation checks at the resource assembly boundary without starting live services.
vi.mock('@/services/onlineMusic/omni', () => ({ omni: {
    getCollectionTracks: vi.fn(async () => ({ items: [], hasMore: false, nextOffset: 0 })),
} }));
vi.mock('@/services/db', () => ({ saveToCache: vi.fn(), getFromCache: vi.fn() }));
vi.mock('@/library/core/collection/resource/navidromeCollectionResource.service', () => ({ createNavidromeCollectionResource: vi.fn() }));
vi.mock('@/library/core/collection/resource/navidromeCollectionTracks.service', () => ({ resolveNavidromeServerScope: () => 'server' }));

const { resolveCollectionResourceKey, createCollectionResource, acquireCollectionResource } = await import('@/library/core/collection/resource/createCollectionResource.service');
const { getFromCache, saveToCache } = await import('@/services/db');
const { omni } = await import('@/services/onlineMusic/omni');

const playlist = (overrides: Partial<OnlineGridViewCollectionDescriptor> = {}): OnlineGridViewCollectionDescriptor => ({
    source: 'online', providerId: 'p', type: 'playlist', id: 'pl', name: 'Playlist', ...overrides,
});

describe('online collection resource account scope', () => {
    it('separates unversioned collections for signed out and different signed in accounts', () => {
        const descriptor = playlist();
        const keys = [undefined, 'alice', 'bob'].map(user => resolveCollectionResourceKey(descriptor, user));
        expect(new Set(keys).size).toBe(3);
        expect(resolveCollectionResourceKey(descriptor, 'alice')).toBe(keys[1]);
    });

    it('keeps the existing resource identity for versioned playlists', () => {
        const descriptor = playlist({ updatedAt: 1000 });
        expect(resolveCollectionResourceKey(descriptor)).toBe(resolveCollectionResourceKey(descriptor, 'alice'));
        expect(resolveCollectionResourceKey(descriptor, 'bob')).toBe(resolveCollectionResourceKey(descriptor, 'alice'));
    });

    it('always isolates library songs by account even when descriptors acquire a version', () => {
        const descriptor = playlist({ type: 'library_songs', updatedAt: 1000 });
        expect(resolveCollectionResourceKey(descriptor, 'alice')).not.toBe(resolveCollectionResourceKey(descriptor, 'bob'));
    });

    it('assembles library songs without reading or writing the ordinary online disk cache', async () => {
        const descriptor = playlist({ type: 'library_songs', id: 'alice', updatedAt: 1000 });
        const resource = createCollectionResource(resolveCollectionResourceKey(descriptor, 'alice'), descriptor);
        resource.ensure(descriptor, { currentUserId: 'alice', librarySongsScope: { providerId: 'p', userId: 'alice' } });
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
        expect(resource.getSnapshot().librarySongs?.complete).toBe(true);
        expect(omni.getCollectionTracks).toHaveBeenCalledWith(descriptor, { limit: 100, offset: 0 });
        expect(getFromCache).not.toHaveBeenCalled();
        expect(saveToCache).not.toHaveBeenCalled();
        resource.dispose();
    });

    it.each<CollectionResourceContext>([
        { currentUserId: null, librarySongsScope: null },
        { currentUserId: 'alice' },
        { currentUserId: 'alice', librarySongsScope: null },
        { currentUserId: 'bob', librarySongsScope: { providerId: 'p', userId: 'bob' } },
        { currentUserId: 'alice', librarySongsScope: { providerId: 'other', userId: 'alice' } },
        { currentUserId: 'alice', librarySongsScope: { providerId: 'p', userId: 'bob' } },
    ])('rejects stale library descriptors before registry lookup or creation: %j', context => {
        const registry = createCollectionResourceRegistry();
        const peek = vi.spyOn(registry, 'peekOrCreate');
        const descriptor = playlist({ type: 'library_songs', id: 'alice' });
        try {
            const resource = acquireCollectionResource(resolveCollectionResourceKey(descriptor, context.currentUserId), descriptor, context, registry);
            expect(resource).toBeNull();
            expect(peek).not.toHaveBeenCalled();
            expect(registry.size()).toEqual({ live: 0, retained: 0 });
        } finally {
            registry.invalidate(() => true);
        }
    });

    it('does not recreate a history-restored library after expiry or source/provider invalidation', async () => {
        const registry = createCollectionResourceRegistry();
        const descriptor = playlist({ type: 'library_songs', id: 'alice' });
        const context = { currentUserId: 'alice', librarySongsScope: { providerId: 'p', userId: 'alice' } };
        const key = resolveCollectionResourceKey(descriptor, context.currentUserId);
        const initial = acquireCollectionResource(key, descriptor, context, registry)!;
        initial.ensure(descriptor, context);
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
        const readCount = vi.mocked(omni.getCollectionTracks).mock.calls.length;
        invalidateLibrarySongsResources(null, registry);
        const peek = vi.spyOn(registry, 'peekOrCreate');
        try {
            for (const nextContext of [
                { currentUserId: null, librarySongsScope: null },
                { ...context, librarySongsScope: null },
                { ...context, librarySongsScope: { providerId: 'other', userId: 'alice' } },
            ]) {
                const restored = acquireCollectionResource(key, descriptor, nextContext, registry);
                restored?.ensure(descriptor, nextContext);
                expect(restored).toBeNull();
            }
            expect(peek).not.toHaveBeenCalled();
            expect(omni.getCollectionTracks).toHaveBeenCalledTimes(readCount);
            expect(registry.size()).toEqual({ live: 0, retained: 0 });
        } finally {
            registry.invalidate(() => true);
        }
    });

    it('continues to acquire ordinary collections without an active signed-in library scope', () => {
        const registry = createCollectionResourceRegistry();
        const descriptor = playlist();
        try {
            expect(acquireCollectionResource(resolveCollectionResourceKey(descriptor), descriptor, {}, registry)).not.toBeNull();
        } finally {
            registry.invalidate(() => true);
        }
    });

    it('continues to isolate cloud collections even when they have a version', () => {
        const descriptor = playlist({ type: 'cloud', id: 'cloud', updatedAt: 1000 });
        expect(resolveCollectionResourceKey(descriptor, 'alice')).not.toBe(resolveCollectionResourceKey(descriptor, 'bob'));
    });
});
