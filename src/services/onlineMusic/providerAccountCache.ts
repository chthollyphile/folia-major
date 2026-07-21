import type { MediaId, OnlineProviderId, ProviderCollection, ProviderUser } from '../../types/onlineMusic';
import { getFromCache, removeFromCache, saveToCache } from '../db';
import { getProviderCacheKey } from './providerStorage';

// src/services/onlineMusic/providerAccountCache.ts

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_CACHE_NAME = 'user_home_snapshot';

export type ProviderAccountSnapshot = {
    version: 1;
    savedAt: number;
    user: ProviderUser;
    collections: ProviderCollection[];
    likedSongIds: MediaId[];
};

export const getProviderAccountSnapshotCacheKey = (providerId: OnlineProviderId): string => (
    getProviderCacheKey(providerId, SNAPSHOT_CACHE_NAME)
);

export const loadProviderAccountSnapshot = async (
    providerId: OnlineProviderId,
): Promise<ProviderAccountSnapshot | null> => {
    const cached = await getFromCache<ProviderAccountSnapshot>(getProviderAccountSnapshotCacheKey(providerId));
    if (!cached || cached.version !== SNAPSHOT_VERSION || !cached.user) return null;
    if (!Array.isArray(cached.collections) || !Array.isArray(cached.likedSongIds)) return null;
    return cached;
};

export const saveProviderAccountSnapshot = async (
    providerId: OnlineProviderId,
    snapshot: Omit<ProviderAccountSnapshot, 'version' | 'savedAt'>,
): Promise<ProviderAccountSnapshot> => {
    const value: ProviderAccountSnapshot = {
        version: SNAPSHOT_VERSION,
        savedAt: Date.now(),
        ...snapshot,
    };
    await saveToCache(getProviderAccountSnapshotCacheKey(providerId), value);
    return value;
};

export const clearProviderAccountSnapshot = async (providerId: OnlineProviderId): Promise<void> => {
    await removeFromCache(getProviderAccountSnapshotCacheKey(providerId));
};
