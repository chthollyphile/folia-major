import type { SongResult } from '../../types';
import { getThemeRegistryEntries, upsertThemeRegistryEntries } from '../db';
import { createNeteaseSongIdFingerprint, createSongSyncFingerprint } from './syncFingerprint';
import type { SyncedThemeSource } from './syncTypes';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// src/services/sync/themeSyncRegistry.ts
// Tracks local AI theme cache entries that can be safely mapped to remote sync fingerprints.

const THEME_SYNC_REGISTRY_KEY = 'folia_sync_theme_registry_v1';
const DUAL_THEME_CACHE_PREFIX = 'dual_theme_';
let legacyMigrationPromise: Promise<void> | null = null;

export type ThemeSyncRegistryRecord = {
    fingerprint: string;
    cacheKey: string;
    updatedAt: string;
    source: SyncedThemeSource;
};

const hasIndexedDb = () => typeof indexedDB !== 'undefined';

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

const readLegacyThemeSyncRegistry = () => {
    if (typeof window === 'undefined') {
        return { raw: null, records: [] as ThemeSyncRegistryRecord[] };
    }

    const raw = window.localStorage.getItem(THEME_SYNC_REGISTRY_KEY);
    if (!raw) {
        return { raw: null, records: [] as ThemeSyncRegistryRecord[] };
    }

    try {
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) {
            return { raw, records: [] as ThemeSyncRegistryRecord[] };
        }

        const records = Object.entries(parsed).flatMap(([fingerprint, value]) => {
            const record = parseRegistryRecord(value);
            return record && record.fingerprint === fingerprint ? [record] : [];
        });
        return { raw, records };
    } catch {
        return { raw, records: [] as ThemeSyncRegistryRecord[] };
    }
};

// Moves the legacy localStorage registry once, without overwriting newer IndexedDB rows.
const migrateLegacyThemeSyncRegistry = async () => {
    const legacy = readLegacyThemeSyncRegistry();
    if (!legacy.raw) {
        return;
    }

    const storedRecords = await getThemeRegistryEntries<unknown>();
    const storedByFingerprint = new Map<string, ThemeSyncRegistryRecord>();
    storedRecords.forEach((value) => {
        const record = parseRegistryRecord(value);
        if (record) {
            storedByFingerprint.set(record.fingerprint, record);
        }
    });
    const recordsToMigrate = legacy.records.filter((record) => {
        const stored = storedByFingerprint.get(record.fingerprint);
        return !stored || Date.parse(record.updatedAt) > Date.parse(stored.updatedAt);
    });
    await upsertThemeRegistryEntries(recordsToMigrate);

    if (typeof window !== 'undefined'
        && window.localStorage.getItem(THEME_SYNC_REGISTRY_KEY) === legacy.raw
    ) {
        window.localStorage.removeItem(THEME_SYNC_REGISTRY_KEY);
    }
};

const ensureLegacyThemeSyncRegistryMigrated = async () => {
    if (!legacyMigrationPromise) {
        legacyMigrationPromise = migrateLegacyThemeSyncRegistry().catch((error) => {
            legacyMigrationPromise = null;
            throw error;
        });
    }
    await legacyMigrationPromise;
};

export const readThemeSyncRegistry = async (): Promise<Record<string, ThemeSyncRegistryRecord>> => {
    if (!hasIndexedDb()) {
        return {};
    }

    try {
        await ensureLegacyThemeSyncRegistryMigrated();
        const storedRecords = await getThemeRegistryEntries<unknown>();
        const records: Record<string, ThemeSyncRegistryRecord> = {};
        storedRecords.forEach((value) => {
            const record = parseRegistryRecord(value);
            if (record) {
                records[record.fingerprint] = record;
            }
        });
        return records;
    } catch {
        return {};
    }
};

export const upsertThemeSyncRecords = async (records: ThemeSyncRegistryRecord[]) => {
    const validRecords = records.filter(record => record.fingerprint && record.cacheKey);
    if (validRecords.length === 0) {
        return;
    }

    await ensureLegacyThemeSyncRegistryMigrated();
    await upsertThemeRegistryEntries(validRecords);
};

export const upsertThemeSyncRecord = async (record: ThemeSyncRegistryRecord) => {
    await upsertThemeSyncRecords([record]);
};

export const registerThemeSyncRecordForSong = async (
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
        cacheKey: `${DUAL_THEME_CACHE_PREFIX}${getPlaybackSongKey(song)}`,
        updatedAt,
        source,
    };
    await upsertThemeSyncRecord(record);
    return record;
};

export const registerThemeSyncRecordForSongIfMissing = async (
    song: SongResult | null,
    source: SyncedThemeSource,
) => {
    const fingerprint = createSongSyncFingerprint(song);
    if (!fingerprint || (await readThemeSyncRegistry())[fingerprint]) {
        return null;
    }

    return await registerThemeSyncRecordForSong(song, source);
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

export const getThemeSyncRegistryRecords = async () => Object.values(await readThemeSyncRegistry());
