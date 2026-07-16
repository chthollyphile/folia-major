import { getFromCache, removeFromCache, saveToCache } from './db';
import { createSafeObjectUrl, isBlob } from '../utils/blobGuards';
import {
    clearCoverAssets,
    getCoverAssetUsage,
    readCoverAsset,
    removeCoverAsset,
    writeCoverAsset,
    type BinaryAssetWriteResult,
} from './binaryAssetStore';

interface StoredCoverDescriptor extends BinaryAssetWriteResult { }

const isStoredCoverDescriptor = (value: unknown): value is StoredCoverDescriptor => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<StoredCoverDescriptor>;
    return (candidate.backend === 'opfs' || candidate.backend === 'electron')
        && typeof candidate.mimeType === 'string'
        && typeof candidate.size === 'number'
        && typeof candidate.updatedAt === 'number';
};

const buildCoverRequestUrl = (coverUrl: string): string => {
    if (typeof window !== 'undefined' && window.electron) return coverUrl;
    try {
        const hostname = new URL(coverUrl).hostname;
        if (hostname === 'y.gtimg.cn') {
            return `/api/lyric-proxy?url=${encodeURIComponent(coverUrl)}`;
        }
    } catch {
        return coverUrl;
    }
    return coverUrl;
};

const fetchCoverBlob = async (coverUrl: string): Promise<Blob> => {
    const response = await fetch(buildCoverRequestUrl(coverUrl), { mode: 'cors' });
    if (response.ok === false) throw new Error(`Cover request failed: ${response.status}`);
    return await response.blob();
};

export async function getCachedCoverUrl(cacheKey: string): Promise<string | null> {
    const stored = await getFromCache<unknown>(cacheKey);
    if (isBlob(stored)) {
        const descriptor = await writeCoverAsset(cacheKey, stored).catch(() => null);
        if (!descriptor) {
            return createSafeObjectUrl(stored);
        }
        await saveToCache(cacheKey, descriptor);
        return createSafeObjectUrl(stored);
    }

    if (stored !== null && !isStoredCoverDescriptor(stored)) {
        await removeFromCache(cacheKey);
        await removeCoverAsset(cacheKey);
        return null;
    }

    const cachedCover = await readCoverAsset(cacheKey, isStoredCoverDescriptor(stored) ? stored.mimeType : undefined);
    if (!cachedCover) {
        if (stored) await removeFromCache(cacheKey);
        return null;
    }
    return createSafeObjectUrl(cachedCover);
}

export async function loadCachedOrFetchCover(cacheKey: string, coverUrl?: string | null): Promise<string | null> {
    if (!coverUrl) return null;

    try {
        const cachedCoverUrl = await getCachedCoverUrl(cacheKey);
        if (cachedCoverUrl) {
            return cachedCoverUrl;
        }

        const coverBlob = await fetchCoverBlob(coverUrl);
        const descriptor = await writeCoverAsset(cacheKey, coverBlob).catch(() => null);
        if (descriptor) await saveToCache(cacheKey, descriptor);
        return createSafeObjectUrl(coverBlob) || coverUrl;
    } catch (error) {
        console.warn('Failed to cache cover:', error);
        return coverUrl;
    }
}

// Replaces the cached online cover used by local-song playback without changing the audio file.
export async function cacheLocalSongOnlineCover(songId: string, coverUrl: string): Promise<boolean> {
    const cacheKey = `cover_local_${songId}`;
    await removeCachedCover(cacheKey);
    try {
        const descriptor = await writeCoverAsset(cacheKey, await fetchCoverBlob(coverUrl));
        if (!descriptor) return false;
        await saveToCache(cacheKey, descriptor);
        return true;
    } catch (error) {
        console.warn('[LocalMusic] Failed to cache matched cover:', error);
        return false;
    }
}

export async function removeCachedCover(cacheKey: string): Promise<void> {
    await Promise.all([removeFromCache(cacheKey), removeCoverAsset(cacheKey)]);
}

export { clearCoverAssets, getCoverAssetUsage };
