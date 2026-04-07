import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedCoverUrl, loadCachedOrFetchCover } from '@/services/coverCache';
import { getFromCache, saveToCache } from '@/services/db';

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(),
    saveToCache: vi.fn()
}));

describe('coverCache', () => {
    const getFromCacheMock = vi.mocked(getFromCache);
    const saveToCacheMock = vi.mocked(saveToCache);
    const originalFetch = globalThis.fetch;
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL');

    beforeEach(() => {
        getFromCacheMock.mockReset();
        saveToCacheMock.mockReset();
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
        const blob = new Blob(['fresh']);
        getFromCacheMock.mockResolvedValueOnce(null);
        const fetchMock = vi.fn().mockResolvedValue({
            blob: vi.fn().mockResolvedValue(blob)
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(loadCachedOrFetchCover('cover_3', 'https://img.test/fresh.png')).resolves.toBe('blob:cached-cover');
        expect(fetchMock).toHaveBeenCalledWith('https://img.test/fresh.png', { mode: 'cors' });
        expect(saveToCacheMock).toHaveBeenCalledWith('cover_3', blob);
        expect(createObjectUrlSpy).toHaveBeenCalledWith(blob);
    });

    it('falls back to the original URL when caching fails', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        getFromCacheMock.mockRejectedValueOnce(new Error('cache failed'));

        await expect(loadCachedOrFetchCover('cover_4', 'https://img.test/fallback.png')).resolves.toBe('https://img.test/fallback.png');
        expect(warnSpy).toHaveBeenCalled();

        warnSpy.mockRestore();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
});
