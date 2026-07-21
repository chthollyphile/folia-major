import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFromCache, removeFromCache, saveToCache } from '@/services/db';
import {
    clearProviderAccountSnapshot,
    getProviderAccountSnapshotCacheKey,
    loadProviderAccountSnapshot,
    saveProviderAccountSnapshot,
} from '@/services/onlineMusic/providerAccountCache';

// test/unit/onlineMusic/providerAccountCache.test.ts

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(),
    removeFromCache: vi.fn(),
    saveToCache: vi.fn(),
}));

describe('provider account snapshot cache', () => {
    beforeEach(() => vi.clearAllMocks());

    it('stores one atomic provider-scoped home snapshot', async () => {
        vi.mocked(saveToCache).mockResolvedValue(undefined);
        const snapshot = await saveProviderAccountSnapshot('kugou', {
            user: { id: 'user', nickname: 'Listener' },
            collections: [{ providerId: 'kugou', id: 'list', name: 'Playlist', type: 'playlist' }],
            likedSongIds: ['song'],
        });

        expect(snapshot).toMatchObject({ version: 1, user: { id: 'user' } });
        expect(saveToCache).toHaveBeenCalledWith(
            getProviderAccountSnapshotCacheKey('kugou'),
            snapshot,
        );
    });

    it('rejects incomplete snapshots instead of hydrating a partial home page', async () => {
        vi.mocked(getFromCache).mockResolvedValue({ version: 1, user: { id: 'user' } });
        await expect(loadProviderAccountSnapshot('kugou')).resolves.toBeNull();
    });

    it('clears only the requested provider snapshot', async () => {
        vi.mocked(removeFromCache).mockResolvedValue(undefined);
        await clearProviderAccountSnapshot('netease');
        expect(removeFromCache).toHaveBeenCalledWith(getProviderAccountSnapshotCacheKey('netease'));
    });
});
