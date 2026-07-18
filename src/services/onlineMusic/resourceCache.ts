import type { SongResult } from '../../types';
import type { MigrationResult } from '../../utils/lyrics/renderHints';
import { getCachedAudioBlob, hasCachedAudio, saveAudioBlob } from '../audioCache';
import { getCachedCoverUrl, saveCoverBlob } from '../coverCache';
import { getFromCache, saveToCache } from '../db';
import { getLegacySongResourceCacheKeys, getSongResourceCacheKey, type SongResourceKind } from './resourceKeys';

// src/services/onlineMusic/resourceCache.ts

const identityMigration = <T>(value: T): MigrationResult<T> => ({ value, changed: false });

// Reads legacy NetEase entries once and writes them back under the provider-aware key.
export const getSongCacheWithLegacyMigration = async <T>(
    kind: SongResourceKind,
    song: SongResult,
    migrate: (value: T) => MigrationResult<T> = identityMigration,
): Promise<T | null> => {
    const cacheKey = getSongResourceCacheKey(kind, song);
    const current = await getFromCache<T>(cacheKey);
    if (current != null) {
        const migrated = migrate(current);
        if (migrated.changed) void saveToCache(cacheKey, migrated.value);
        return migrated.value;
    }

    for (const legacyKey of getLegacySongResourceCacheKeys(kind, song)) {
        const legacy = await getFromCache<T>(legacyKey);
        if (legacy == null) continue;
        const migrated = migrate(legacy);
        await saveToCache(cacheKey, migrated.value);
        return migrated.value;
    }
    return null;
};

export const getCachedSongAudioBlob = async (song: SongResult): Promise<Blob | null> => {
    const cacheKey = getSongResourceCacheKey('audio', song);
    const current = await getCachedAudioBlob(cacheKey);
    if (current) return current;

    for (const legacyKey of getLegacySongResourceCacheKeys('audio', song)) {
        const legacy = await getCachedAudioBlob(legacyKey);
        if (!legacy) continue;
        await saveAudioBlob(cacheKey, legacy);
        return legacy;
    }
    return null;
};

export const hasCachedSongAudio = async (song: SongResult): Promise<boolean> => (
    Boolean(await getCachedSongAudioBlob(song))
);

export const getCachedSongCoverUrl = async (song: SongResult): Promise<string | null> => {
    const cacheKey = getSongResourceCacheKey('cover', song);
    const current = await getCachedCoverUrl(cacheKey);
    if (current) return current;

    for (const legacyKey of getLegacySongResourceCacheKeys('cover', song)) {
        const legacyUrl = await getCachedCoverUrl(legacyKey);
        if (!legacyUrl) continue;
        try {
            const legacyBlob = await (await fetch(legacyUrl)).blob();
            await saveCoverBlob(cacheKey, legacyBlob);
        } catch (error) {
            console.warn('[ResourceCache] Failed to write back legacy cover cache', error);
        }
        return legacyUrl;
    }
    return null;
};
