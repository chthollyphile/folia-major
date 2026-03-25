import { getFromCache, saveToCache } from './db';

export async function getCachedCoverUrl(cacheKey: string): Promise<string | null> {
    const cachedCover = await getFromCache<Blob>(cacheKey);
    return cachedCover ? URL.createObjectURL(cachedCover) : null;
}

export async function loadCachedOrFetchCover(cacheKey: string, coverUrl?: string | null): Promise<string | null> {
    if (!coverUrl) return null;

    try {
        const cachedCoverUrl = await getCachedCoverUrl(cacheKey);
        if (cachedCoverUrl) {
            return cachedCoverUrl;
        }

        const response = await fetch(coverUrl, { mode: 'cors' });
        const coverBlob = await response.blob();
        await saveToCache(cacheKey, coverBlob);
        return URL.createObjectURL(coverBlob);
    } catch (error) {
        console.warn('Failed to cache cover:', error);
        return coverUrl;
    }
}
