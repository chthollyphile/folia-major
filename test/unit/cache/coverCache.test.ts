import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheLocalSongOnlineCover, getCachedCoverUrl, loadCachedOrFetchCover } from '@/services/coverCache';
import { getFromCache, removeFromCache, saveToCache } from '@/services/db';
import { readCoverAsset, removeCoverAsset, writeCoverAsset } from '@/services/binaryAssetStore';

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(),
    removeFromCache: vi.fn(),
    saveToCache: vi.fn()
}));
vi.mock('@/services/binaryAssetStore', () => ({
    clearCoverAssets: vi.fn(),
    getCoverAssetUsage: vi.fn(),
    readCoverAsset: vi.fn(),
    removeCoverAsset: vi.fn(),
    writeCoverAsset: vi.fn(),
}));

describe('coverCache', () => {
    const getFromCacheMock = vi.mocked(getFromCache);
    const saveToCacheMock = vi.mocked(saveToCache);
    const removeFromCacheMock = vi.mocked(removeFromCache);
    const readCoverAssetMock = vi.mocked(readCoverAsset);
    const removeCoverAssetMock = vi.mocked(removeCoverAsset);
    const writeCoverAssetMock = vi.mocked(writeCoverAsset);
    const originalFetch = globalThis.fetch;
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL');

    beforeEach(() => {
        getFromCacheMock.mockReset();
        saveToCacheMock.mockReset();
        removeFromCacheMock.mockReset();
        readCoverAssetMock.mockReset().mockResolvedValue(null);
        removeCoverAssetMock.mockReset();
        writeCoverAssetMock.mockReset().mockResolvedValue(null);
        createObjectUrlSpy.mockReset();
        createObjectUrlSpy.mockReturnValue('blob:cached-cover');
        globalThis.fetch = vi.fn() as typeof fetch;
    });

    it('returns a blob URL when cover is already cached', async () => {
        const blob = new Blob(['cover']);
        getFromCacheMock.mockResolvedValueOnce(blob);

        await expect(getCachedCoverUrl('cover_1')).resolves.toBe('blob:cached-cover');
        expect(getFromCacheMock).toHaveBeenCalledWith('cover_1');
        expect(createObjectUrlSpy).toHaveBeenCalledWith(blob);
    });

    it('returns null when no cover URL is provided', async () => {
        await expect(loadCachedOrFetchCover('cover_1', null)).resolves.toBeNull();
        expect(getFromCacheMock).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('reuses cached cover URLs without fetching', async () => {
        const blob = new Blob(['cached']);
        getFromCacheMock.mockResolvedValueOnce(blob);

        await expect(loadCachedOrFetchCover('cover_2', 'https://img.test/cover.png')).resolves.toBe('blob:cached-cover');
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(saveToCacheMock).not.toHaveBeenCalled();
    });

    it('fetches and saves cover blobs on cache miss', async () => {
        const blob = new Blob(['fresh'], { type: 'image/png' });
        const descriptor = { backend: 'opfs' as const, mimeType: 'image/png', size: blob.size, updatedAt: 1 };
        writeCoverAssetMock.mockResolvedValue(descriptor);
        getFromCacheMock.mockResolvedValueOnce(null);
        const fetchMock = vi.fn().mockResolvedValue({
            blob: vi.fn().mockResolvedValue(blob)
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(loadCachedOrFetchCover('cover_3', 'https://img.test/fresh.png')).resolves.toBe('blob:cached-cover');
        expect(fetchMock).toHaveBeenCalledWith('https://img.test/fresh.png', { mode: 'cors' });
        expect(writeCoverAssetMock).toHaveBeenCalledWith('cover_3', blob);
        expect(saveToCacheMock).toHaveBeenCalledWith('cover_3', descriptor);
        expect(createObjectUrlSpy).toHaveBeenCalledWith(blob);
    });

    it('falls back to the original URL when caching fails', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        getFromCacheMock.mockRejectedValueOnce(new Error('cache failed'));

        await expect(loadCachedOrFetchCover('cover_4', 'https://img.test/fallback.png')).resolves.toBe('https://img.test/fallback.png');
        expect(warnSpy).toHaveBeenCalled();

        warnSpy.mockRestore();
    });

    it('replaces the stable local-song cover cache', async () => {
        const blob = new Blob(['matched-cover'], { type: 'image/png' });
        const descriptor = { backend: 'opfs' as const, mimeType: 'image/png', size: blob.size, updatedAt: 1 };
        writeCoverAssetMock.mockResolvedValue(descriptor);
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) }) as typeof fetch;
        await expect(cacheLocalSongOnlineCover('song-id', 'https://img.test/matched.png')).resolves.toBe(true);
        expect(removeFromCacheMock).toHaveBeenCalledWith('cover_local_song-id');
        expect(removeCoverAssetMock).toHaveBeenCalledWith('cover_local_song-id');
        expect(saveToCacheMock).toHaveBeenCalledWith('cover_local_song-id', descriptor);
    });

    it('fetches QQ cover blobs through the same-origin proxy in web builds', async () => {
        const blob = new Blob(['qq-cover'], { type: 'image/jpeg' });
        const descriptor = { backend: 'opfs' as const, mimeType: 'image/jpeg', size: blob.size, updatedAt: 1 };
        writeCoverAssetMock.mockResolvedValue(descriptor);
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const coverUrl = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg?max_age=2592000';

        await expect(cacheLocalSongOnlineCover('qq-song', coverUrl)).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            `/api/lyric-proxy?url=${encodeURIComponent(coverUrl)}`,
            { mode: 'cors' },
        );
        expect(saveToCacheMock).toHaveBeenCalledWith('cover_local_qq-song', descriptor);
    });

    it('fetches KuGou cover blobs through the same-origin proxy in web builds', async () => {
        const blob = new Blob(['kugou-cover'], { type: 'image/jpeg' });
        const descriptor = { backend: 'opfs' as const, mimeType: 'image/jpeg', size: blob.size, updatedAt: 1 };
        writeCoverAssetMock.mockResolvedValue(descriptor);
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const coverUrl = 'https://imge.kugou.com/stdmusic/400/cover.jpg';

        await expect(cacheLocalSongOnlineCover('kugou-song', coverUrl)).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            `/api/lyric-proxy?url=${encodeURIComponent(coverUrl)}`,
            { mode: 'cors' },
        );
        expect(saveToCacheMock).toHaveBeenCalledWith('cover_local_kugou-song', descriptor);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
});
