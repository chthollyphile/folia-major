import type { OnlineProviderId } from '../../types/onlineMusic';
import { getFromCache, saveToCache } from '../db';

// src/services/onlineMusic/providerStorage.ts

export const getProviderCacheKey = (providerId: OnlineProviderId, key: string): string => (
    `online_provider_${providerId}_${key}`
);

export const getProviderSessionKey = (providerId: OnlineProviderId, key: string): string => (
    `online_provider:${providerId}:${key}`
);

// Reads an old unscoped cache once, then stores the value in the provider namespace.
export const getProviderCacheWithLegacyMigration = async <T>(
    providerId: OnlineProviderId,
    key: string,
    legacyKeys: string[] = [],
): Promise<T | null> => {
    const namespacedKey = getProviderCacheKey(providerId, key);
    const current = await getFromCache<T>(namespacedKey);
    if (current != null) return current;

    for (const legacyKey of legacyKeys) {
        const legacy = await getFromCache<T>(legacyKey);
        if (legacy == null) continue;
        await saveToCache(namespacedKey, legacy);
        return legacy;
    }
    return null;
};

export const readProviderSessionValue = (
    providerId: OnlineProviderId,
    key: string,
    legacyKeys: string[] = [],
): string | null => {
    if (typeof localStorage === 'undefined') return null;
    const namespacedKey = getProviderSessionKey(providerId, key);
    const current = localStorage.getItem(namespacedKey);
    if (current != null) return current;

    for (const legacyKey of legacyKeys) {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy == null) continue;
        localStorage.setItem(namespacedKey, legacy);
        return legacy;
    }
    return null;
};

export const writeProviderSessionValue = (providerId: OnlineProviderId, key: string, value: string): void => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(getProviderSessionKey(providerId, key), value);
};

export const removeProviderSessionValue = (
    providerId: OnlineProviderId,
    key: string,
    legacyKeys: string[] = [],
): void => {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(getProviderSessionKey(providerId, key));
    legacyKeys.forEach(legacyKey => localStorage.removeItem(legacyKey));
};
