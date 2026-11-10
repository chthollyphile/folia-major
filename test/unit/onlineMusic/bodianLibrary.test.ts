import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/bodianLibrary.test.ts

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/bodian/bodianTransport', () => ({ requestBodian: request }));
import { bodianCollectionItems, bodianLibrary, clearBodianLibraryCache } from '@/services/onlineMusic/bodian/bodianLibrary';

beforeEach(() => { request.mockReset(); clearBodianLibraryCache(); });

describe('Bodian library adapter', () => {
    it('continues after an album-only upstream page to find later collected playlists', async () => {
        request.mockResolvedValueOnce({ liked: {}, owned: {}, collected: {
            playLists: [], bodianPagination: { nextOffset: 100, hasMore: true },
        } }).mockResolvedValueOnce({ liked: {}, owned: {}, collected: {
            playLists: [{ id: 3, name: 'Later playlist', sourceType: 4 }],
            bodianPagination: { nextOffset: 101, hasMore: false },
        } });
        const page = await bodianLibrary.getUserPlaylists('100', 50, 0);
        expect(page.items.map(item => item.id)).toEqual(['3']);
        expect(page.hasMore).toBe(false);
        expect(request).toHaveBeenLastCalledWith('user_playlists', { limit: 100, offset: 100 });
    });

    it('preserves an empty album page cursor and normalizes album identity on the following page', async () => {
        request.mockResolvedValueOnce({ albumList: [], bodianPagination: { nextOffset: 50, hasMore: true } })
            .mockResolvedValueOnce({ albumList: [{ id: 999, albumId: 123, name: 'Album', artist: 'Artist', sourceType: 6,
                musicCount: 10, pic: 'http://img1.kwcdn.kuwo.cn/album.jpg' }],
            bodianPagination: { nextOffset: 51, hasMore: false } });
        const first = await bodianLibrary.getUserAlbums!('100', 50, 0);
        expect(first).toMatchObject({ items: [], nextOffset: 50, hasMore: true });
        const last = await bodianLibrary.getUserAlbums!('100', 50, first.nextOffset);
        expect(last.items[0]).toMatchObject({ providerId: 'bodian', id: '123', type: 'album', name: 'Album', trackCount: 10,
            artists: [{ name: 'Artist' }], coverUrl: 'http://img1.kwcdn.kuwo.cn/album.jpg' });
        expect(last).toMatchObject({ nextOffset: 51, hasMore: false });
        expect(last.total).toBeUndefined();
    });
    it('combines owned, liked and collected playlists once then pages the stable snapshot', async () => {
        request.mockResolvedValue({
            liked: { id: 1, name: '喜欢', sourceType: 5, isFond: 1 },
            owned: { playLists: [{ id: 2, name: '自建', sourceType: 1 }] },
            collected: { playLists: [{ id: 3, name: '收藏', sourceType: 4 }], total: 1 },
        });
        const first = await bodianLibrary.getUserPlaylists('100', 2, 0);
        expect(first).toMatchObject({ total: 3, hasMore: true, nextOffset: 2 });
        expect(first.items.every(item => item.isOwned)).toBe(true);
        const second = await bodianLibrary.getUserPlaylists('100', 2, 2);
        expect(second.items[0]).toMatchObject({ id: '3', isOwned: false, providerData: { source: 4 } });
        expect(second.hasMore).toBe(false);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('keeps users separate and refreshes the first page instead of retaining stale data', async () => {
        request.mockResolvedValue({ liked: {}, owned: { playLists: [] }, collected: {} });
        await bodianLibrary.getUserPlaylists('100', 50, 0);
        await bodianLibrary.getUserPlaylists('100', 50, 0);
        await bodianLibrary.getUserPlaylists('200', 50, 50);
        expect(request).toHaveBeenCalledTimes(3);
    });

    it('treats observed empty containers as empty but rejects malformed nonempty responses', () => {
        expect(bodianCollectionItems({}, 'playLists')).toEqual([]);
        expect(bodianCollectionItems([], 'playLists')).toEqual([]);
        expect(() => bodianCollectionItems({ error: 'rejected' }, 'playLists')).toThrow();
    });

    it('stops a stale-total liked page when it contains no tracks, and does not call the list whole', async () => {
        request.mockResolvedValueOnce({ list: [{ id: 1 }, { id: 2 }], total: 1000 })
            .mockResolvedValueOnce({ list: [], total: 1000 });
        await expect(bodianLibrary.getLikedSongIds!('100')).resolves.toEqual({ ids: ['1', '2'], whole: false });
        expect(request).toHaveBeenLastCalledWith('liked_songs', { limit: 100, offset: 2 });
    });

    it('calls the liked songs whole when the list ends at its own count, and fails on an answer without the list', async () => {
        request.mockResolvedValueOnce({ list: [{ id: 1 }, { id: 2 }], total: 2 });
        await expect(bodianLibrary.getLikedSongIds!('100')).resolves.toEqual({ ids: ['1', '2'], whole: true });

        request.mockResolvedValueOnce({});
        await expect(bodianLibrary.getLikedSongIds!('100')).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('counts the liked songs by the count the first page of the list gives, and gives none where it names none', async () => {
        request.mockResolvedValueOnce({ list: [{ id: 1 }, { id: 2 }], total: 5 });
        await expect(bodianLibrary.getLikedSongCount!('100')).resolves.toBe(5);
        expect(request.mock.calls).toEqual([['liked_songs', { limit: 100, offset: 0 }]]);

        request.mockResolvedValueOnce({ list: [{ id: 1 }] });
        await expect(bodianLibrary.getLikedSongCount!('100')).resolves.toBeNull();
    });
});
