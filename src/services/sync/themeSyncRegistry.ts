import type { SongResult } from '../../types';
import { createNeteaseSongIdFingerprint, createSongSyncFingerprint } from './syncFingerprint';
import type { SyncedThemeSource } from './syncTypes';

// src/services/sync/themeSyncRegistry.ts
// Tracks local AI theme cache entries that can be safely mapped to remote sync fingerprints.

const THEME_SYNC_REGISTRY_KEY = 'folia_sync_theme_registry_v1';
const DUAL_THEME_CACHE_PREFIX = 'dual_theme_';

export type ThemeSyncRegistryRecord = {
    fingerprint: string;
    cacheKey: string;
    updatedAt: string;
    source: SyncedThemeSource;
};

const isBrowser = () => typeof window !== 'undefined';

const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const parseRegistryRecord = (value: unknown): ThemeSyncRegistryRecord | null => {
    if (!isRecord(value)
        || typeof value.fingerprint !== 'string'
        || typeof value.cacheKey !== 'string'
        || typeof value.updatedAt !== 'string'
    ) {
        return null;
    }

    return {
        fingerprint: value.fingerprint,
        cacheKey: value.cacheKey,
        updatedAt: value.updatedAt,
        source: value.source === 'auto' || value.source === 'fallback' || value.source === 'edited'
            ? value.source
            : 'manual',
    };
};

export const readThemeSyncRegistry = (): Record<string, ThemeSyncRegistryRecord> => {
    if (!isBrowser()) {
        return {};
    }

    try {
        const raw = window.localStorage.getItem(THEME_SYNC_REGISTRY_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!isRecord(parsed)) {
            return {};
        }

        const records: Record<string, ThemeSyncRegistryRecord> = {};
        Object.entries(parsed).forEach(([fingerprint, value]) => {
            const record = parseRegistryRecord(value);
            if (record && record.fingerprint === fingerprint) {
                records[fingerprint] = record;
            }
        });
        return records;
    } catch {
        return {};
    }
};

const writeThemeSyncRegistry = (records: Record<string, ThemeSyncRegistryRecord>) => {
    if (isBrowser()) {
        window.localStorage.setItem(THEME_SYNC_REGISTRY_KEY, JSON.stringify(records));
    }
};

export const upsertThemeSyncRecords = (records: ThemeSyncRegistryRecord[]) => {
    const validRecords = records.filter(record => record.fingerprint && record.cacheKey);
    if (validRecords.length === 0) {
        return;
    }

    const registry = readThemeSyncRegistry();
    validRecords.forEach((record) => {
        registry[record.fingerprint] = record;
    });
    writeThemeSyncRegistry(registry);
};

export const upsertThemeSyncRecord = (record: ThemeSyncRegistryRecord) => {
    upsertThemeSyncRecords([record]);
};

export const registerThemeSyncRecordForSong = (
    song: SongResult | null,
    source: SyncedThemeSource,
    updatedAt = new Date().toISOString(),
) => {
    const fingerprint = createSongSyncFingerprint(song);
    if (!fingerprint || song?.id == null) {
        return null;
    }

    const record: ThemeSyncRegistryRecord = {
        fingerprint,
        cacheKey: `${DUAL_THEME_CACHE_PREFIX}${song.id}`,
        updatedAt,
        source,
    };
    upsertThemeSyncRecord(record);
    return record;
};

export const registerThemeSyncRecordForSongIfMissing = (
    song: SongResult | null,
    source: SyncedThemeSource,
) => {
    const fingerprint = createSongSyncFingerprint(song);
    if (!fingerprint || readThemeSyncRegistry()[fingerprint]) {
        return null;
    }

    return registerThemeSyncRecordForSong(song, source);
};

export const createLegacyNeteaseThemeSyncRecord = (
    cacheKey: string,
    timestamp: number,
): ThemeSyncRegistryRecord | null => {
    const match = /^dual_theme_(\d+)$/.exec(cacheKey);
    if (!match) {
        return null;
    }

    const fingerprint = createNeteaseSongIdFingerprint(match[1]);
    if (!fingerprint) {
        return null;
    }

    return {
        fingerprint,
        cacheKey,
        updatedAt: new Date(timestamp || Date.now()).toISOString(),
        source: 'manual',
    };
};

export const getNeteaseThemeCacheKeyFromFingerprint = (fingerprint: string) => {
    const match = /^netease:id:(\d+)$/.exec(fingerprint);
    return match ? `${DUAL_THEME_CACHE_PREFIX}${match[1]}` : null;
};

export const getThemeCacheKeyFromFingerprint = (fingerprint: string) => (
    getNeteaseThemeCacheKeyFromFingerprint(fingerprint)
    ?? `${DUAL_THEME_CACHE_PREFIX}sync_${encodeURIComponent(fingerprint)}`
);

export const getThemeSyncRegistryRecords = () => Object.values(readThemeSyncRegistry());
