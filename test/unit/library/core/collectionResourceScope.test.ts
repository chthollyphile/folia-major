import { describe, expect, it, vi } from 'vitest';
import type { OnlineGridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';

// Keep account isolation checks at the resource assembly boundary without starting live services.
vi.mock('@/services/onlineMusic/omni', () => ({ omni: {} }));
vi.mock('@/services/db', () => ({ saveToCache: vi.fn(), getFromCache: vi.fn() }));
vi.mock('@/library/core/collection/resource/navidromeCollectionResource.service', () => ({ createNavidromeCollectionResource: vi.fn() }));
vi.mock('@/library/core/collection/resource/navidromeCollectionTracks.service', () => ({ resolveNavidromeServerScope: () => 'server' }));

const { resolveCollectionResourceKey } = await import('@/library/core/collection/resource/createCollectionResource.service');

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

    it('continues to isolate cloud collections even when they have a version', () => {
        const descriptor = playlist({ type: 'cloud', id: 'cloud', updatedAt: 1000 });
        expect(resolveCollectionResourceKey(descriptor, 'alice')).not.toBe(resolveCollectionResourceKey(descriptor, 'bob'));
    });
});
