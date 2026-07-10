import type { SongResult, DualTheme } from '../../types';
import { getCacheEntriesByPrefix, getFromCache, saveToCache } from '../db';
import { sanitizeDualTheme } from '../themeSanitizer';
import { getSyncConfig, isSyncConfigured, setSyncStatus } from './syncConfig';
import {
    getRemoteState,
    getRemoteSettings,
    getRemoteThemes,
    getRemoteThemeManifest,
    getRemoteThemesByBuckets,
    listRemoteThemes,
    putRemoteSettings,
    putRemoteThemes,
} from './syncClient';
import { createSongSyncFingerprint, createSongSyncFingerprintCandidates } from './syncFingerprint';
import { buildThemeBucketSummaries, getThemeBucketId } from './syncMerkle';
import {
    createLegacyNeteaseThemeSyncRecord,
    readThemeSyncRegistry,
    getThemeCacheKeyFromFingerprint,
    getThemeSyncRegistryRecords,
    registerThemeSyncRecordForSong,
    upsertThemeSyncRecord,
    upsertThemeSyncRecords,
} from './themeSyncRegistry';
import type {
    SyncLibraryExportBundle,
    SyncRemoteState,
    SyncedSettingsRecord,
    SyncedThemeRecord,
    SyncedThemeSource,
} from './syncTypes';

// src/services/sync/syncRepository.ts
// High-level sync operations for settings and row-addressed AI theme records.

const DUAL_THEME_CACHE_PREFIX = 'dual_theme_';
const THEME_SYNC_WATERMARK_KEY = 'folia_sync_theme_watermark_v1';
const THEME_BATCH_SIZE = 100;
const THEME_BUCKET_FETCH_SIZE = 32;
const LIST_PAGE_SIZE = 500;

type ThemeSyncWatermark = {
    remoteThemesUpdatedAt: string | null;
    remoteThemeCount: number;
    localRegistrySignature: string;
};

export type ThemeSyncUploadResult = {
    uploadedCount: number;
    downloadedCount: number;
    checkedLocalThemeCount: number;
    diffBucketCount: number;
    skippedRemoteThemeScan: boolean;
};

const isBrowser = () => typeof window !== 'undefined';

const getConfiguredSync = () => {
    const config = getSyncConfig();
    return isSyncConfigured(config) ? config : null;
};

const isRemoteNewer = (remoteUpdatedAt: string | null | undefined, localUpdatedAt: string | null | undefined) => (
    Boolean(remoteUpdatedAt) && (!localUpdatedAt || Date.parse(remoteUpdatedAt) > Date.parse(localUpdatedAt))
);

const readThemeSyncWatermark = (): ThemeSyncWatermark | null => {
    if (!isBrowser()) {
        return null;
    }

    try {
        const parsed = JSON.parse(window.localStorage.getItem(THEME_SYNC_WATERMARK_KEY) ?? 'null') as Partial<ThemeSyncWatermark> | null;
        if (!parsed || typeof parsed.localRegistrySignature !== 'string') {
            return null;
        }

        return {
            remoteThemesUpdatedAt: typeof parsed.remoteThemesUpdatedAt === 'string' ? parsed.remoteThemesUpdatedAt : null,
            remoteThemeCount: typeof parsed.remoteThemeCount === 'number' ? parsed.remoteThemeCount : -1,
            localRegistrySignature: parsed.localRegistrySignature,
        };
    } catch {
        return null;
    }
};

const writeThemeSyncWatermark = (watermark: ThemeSyncWatermark) => {
    if (isBrowser()) {
        window.localStorage.setItem(THEME_SYNC_WATERMARK_KEY, JSON.stringify(watermark));
    }
};

const getLocalThemeRegistrySignature = (records: ReturnType<typeof getThemeSyncRegistryRecords>) => {
    let latestUpdatedAt = '';
    let hash = 2166136261;
    const tokens = records
        .map(record => `${record.fingerprint}\u0000${record.cacheKey}\u0000${record.updatedAt}\u0000${record.source}`)
        .sort();

    tokens.forEach((token) => {
        for (let index = 0; index < token.length; index += 1) {
            hash ^= token.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
    });
    records.forEach((record) => {
        if (record.updatedAt > latestUpdatedAt) {
            latestUpdatedAt = record.updatedAt;
        }
    });

    return `${records.length}:${latestUpdatedAt}:${hash >>> 0}`;
};

const areThemeBucketsEqual = (
    localBucket: ReturnType<typeof buildThemeBucketSummaries>[number],
    remoteBucket: ReturnType<typeof buildThemeBucketSummaries>[number],
) => (
    localBucket.count === remoteBucket.count
    && localBucket.hash === remoteBucket.hash
    && localBucket.updatedAt === remoteBucket.updatedAt
);

const areDualThemesEqual = (left: DualTheme, right: DualTheme) => (
    JSON.stringify(sanitizeDualTheme(left)) === JSON.stringify(sanitizeDualTheme(right))
);

const isThemeWatermarkFresh = (
    watermark: ThemeSyncWatermark | null,
    remoteState: SyncRemoteState,
    localRegistrySignature: string,
) => (
    Boolean(watermark)
    && watermark.remoteThemesUpdatedAt === remoteState.themesUpdatedAt
    && watermark.remoteThemeCount === remoteState.themeCount
    && watermark.localRegistrySignature === localRegistrySignature
);

export const fetchRemoteSyncState = async (): Promise<SyncRemoteState | null> => {
    const config = getConfiguredSync();
    if (!config) {
        return null;
    }

    const state = await getRemoteState(config);
    if (!state) {
        throw new Error('Invalid sync state response');
    }
    return state;
};

export const fetchRemoteSettingsIfNewer = async (
    localUpdatedAt: string | null,
    remoteState?: SyncRemoteState | null,
): Promise<SyncedSettingsRecord | null> => {
    const config = getConfiguredSync();
    if (!config) {
        return null;
    }
    if (remoteState && !isRemoteNewer(remoteState.settingsUpdatedAt, localUpdatedAt)) {
        return null;
    }

    const remoteSettings = await getRemoteSettings(config);
    if (!remoteSettings || !isRemoteNewer(remoteSettings.updatedAt, localUpdatedAt)) {
        return null;
    }

    return remoteSettings;
};

export const pushRemoteSettings = async (record: SyncedSettingsRecord) => {
    const config = getConfiguredSync();
    if (!config) {
        return false;
    }

    await putRemoteSettings(config, record);
    setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
    return true;
};

const saveRemoteThemeToLocalCache = async (
    record: SyncedThemeRecord,
    preferredCacheKey?: string,
    skipRegistryUpdate = false,
) => {
    const cacheKey = preferredCacheKey ?? getThemeCacheKeyFromFingerprint(record.fingerprint);
    if (!cacheKey) {
        return null;
    }

    await saveToCache(cacheKey, sanitizeDualTheme(record.theme));
    const registryRecord = {
        fingerprint: record.fingerprint,
        cacheKey,
        updatedAt: record.updatedAt,
        source: record.source,
    };
    if (!skipRegistryUpdate) {
        upsertThemeSyncRecord(registryRecord);
    }
    return registryRecord;
};

export const getSyncedThemeForSong = async (song: SongResult | null): Promise<DualTheme | null> => {
    const config = getConfiguredSync();
    if (!config) {
        return null;
    }

    const fingerprints = createSongSyncFingerprintCandidates(song);
    if (fingerprints.length === 0) {
        return null;
    }

    const records = await getRemoteThemes(config, fingerprints);
    const recordByFingerprint = new Map(records.map(record => [record.fingerprint, record]));
    const matched = fingerprints.map(fingerprint => recordByFingerprint.get(fingerprint)).find(Boolean);
    if (!matched) {
        return null;
    }

    const theme = sanitizeDualTheme(matched.theme);
    if (song?.id != null) {
        await saveToCache(`dual_theme_${song.id}`, theme);
    }
    await saveRemoteThemeToLocalCache(matched);
    return theme;
};

export const saveSyncedThemeForSong = async (
    song: SongResult | null,
    theme: DualTheme,
    source: SyncedThemeSource,
) => {
    const config = getConfiguredSync();
    const fingerprint = createSongSyncFingerprint(song);
    const updatedAt = new Date().toISOString();
    if (fingerprint) {
        registerThemeSyncRecordForSong(song, source, updatedAt);
    }
    if (!config || !fingerprint) {
        return false;
    }

    const record = {
        fingerprint,
        theme: sanitizeDualTheme(theme),
        source,
        updatedAt,
    };
    await putRemoteThemes(config, [record]);
    setSyncStatus({ state: 'success', lastSyncAt: updatedAt, lastError: null });
    console.info('[sync] Theme uploaded', {
        fingerprint,
        source,
        updatedAt,
    });
    return true;
};

const hydrateLegacyNeteaseThemeSyncRecords = async () => {
    const entries = await getCacheEntriesByPrefix<DualTheme>(DUAL_THEME_CACHE_PREFIX);
    const registry = readThemeSyncRegistry();
    const recordsToUpsert: NonNullable<ReturnType<typeof createLegacyNeteaseThemeSyncRecord>>[] = [];
    entries.forEach((entry) => {
        const record = createLegacyNeteaseThemeSyncRecord(entry.key, entry.timestamp);
        if (record && !registry[record.fingerprint]) {
            recordsToUpsert.push(record);
        }
    });
    if (recordsToUpsert.length > 0) {
        upsertThemeSyncRecords(recordsToUpsert);
    }
};

const collectLocalThemeUploadEntries = async (
    remoteRecords: Map<string, SyncedThemeRecord>,
    localRecords = getThemeSyncRegistryRecords(),
) => {
    const uploadEntries: SyncedThemeRecord[] = [];

    for (const record of localRecords) {
        const remoteRecord = remoteRecords.get(record.fingerprint);
        if (remoteRecord && !isRemoteNewer(record.updatedAt, remoteRecord.updatedAt)) {
            continue;
        }

        const theme = await getFromCache<DualTheme>(record.cacheKey);
        if (!theme) {
            continue;
        }
        if (remoteRecord && areDualThemesEqual(theme, remoteRecord.theme)) {
            upsertThemeSyncRecord({
                ...record,
                updatedAt: remoteRecord.updatedAt,
                source: remoteRecord.source,
            });
            continue;
        }

        uploadEntries.push({
            fingerprint: record.fingerprint,
            theme: sanitizeDualTheme(theme),
            source: record.source,
            updatedAt: record.updatedAt,
        });
    }

    return uploadEntries;
};

const getRemoteThemesForBuckets = async (bucketIds: number[]) => {
    const config = getConfiguredSync();
    if (!config || bucketIds.length === 0) {
        return [];
    }

    const remoteRecords: SyncedThemeRecord[] = [];
    for (let index = 0; index < bucketIds.length; index += THEME_BUCKET_FETCH_SIZE) {
        remoteRecords.push(...await getRemoteThemesByBuckets(config, bucketIds.slice(index, index + THEME_BUCKET_FETCH_SIZE)));
    }
    return remoteRecords;
};

export const pushMissingLocalThemesToRemote = async (
    remoteState?: SyncRemoteState | null,
): Promise<ThemeSyncUploadResult> => {
    const config = getConfiguredSync();
    if (!config) {
        return {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: 0,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
    }

    const state = remoteState ?? await fetchRemoteSyncState();
    if (!state) {
        return {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: 0,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
    }

    await hydrateLegacyNeteaseThemeSyncRecords();
    const localRecords = getThemeSyncRegistryRecords();
    const localRegistrySignature = getLocalThemeRegistrySignature(localRecords);
    const existingWatermark = readThemeSyncWatermark();
    if (isThemeWatermarkFresh(existingWatermark, state, localRegistrySignature)) {
        return {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: localRecords.length,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
    }

    const remoteManifest = await getRemoteThemeManifest(config);
    if (!remoteManifest) {
        throw new Error('Invalid theme manifest response');
    }

    const localBuckets = buildThemeBucketSummaries(localRecords);
    const remoteBuckets = new Map(remoteManifest.buckets.map(bucket => [bucket.bucketId, bucket]));
    const diffBucketIds = localBuckets
        .filter(localBucket => !areThemeBucketsEqual(localBucket, remoteBuckets.get(localBucket.bucketId) ?? {
            bucketId: localBucket.bucketId,
            count: 0,
            hash: '0',
            updatedAt: null,
        }))
        .map(bucket => bucket.bucketId);
    if (diffBucketIds.length === 0) {
        writeThemeSyncWatermark({
            remoteThemesUpdatedAt: state.themesUpdatedAt,
            remoteThemeCount: state.themeCount,
            localRegistrySignature,
        });
        return {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: localRecords.length,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
    }

    const diffBucketIdSet = new Set(diffBucketIds);
    const affectedLocalRecords = localRecords.filter(record => diffBucketIdSet.has(getThemeBucketId(record.fingerprint)));
    const remoteRecords = await getRemoteThemesForBuckets(diffBucketIds);
    const remoteRecordMap = new Map(remoteRecords.map(record => [record.fingerprint, record]));
    const localRecordMap = new Map(localRecords.map(record => [record.fingerprint, record]));
    let downloadedCount = 0;
    const downloadedRegistryRecords: NonNullable<Awaited<ReturnType<typeof saveRemoteThemeToLocalCache>>>[] = [];

    for (const remoteRecord of remoteRecords) {
        const localRecord = localRecordMap.get(remoteRecord.fingerprint);
        if (localRecord && !isRemoteNewer(remoteRecord.updatedAt, localRecord.updatedAt)) {
            continue;
        }

        const registryRecord = await saveRemoteThemeToLocalCache(remoteRecord, localRecord?.cacheKey, true);
        if (registryRecord) {
            downloadedRegistryRecords.push(registryRecord);
            downloadedCount += 1;
        }
    }
    if (downloadedRegistryRecords.length > 0) {
        upsertThemeSyncRecords(downloadedRegistryRecords);
    }

    const uploadEntries = await collectLocalThemeUploadEntries(remoteRecordMap, affectedLocalRecords);
    for (let index = 0; index < uploadEntries.length; index += THEME_BATCH_SIZE) {
        await putRemoteThemes(config, uploadEntries.slice(index, index + THEME_BATCH_SIZE));
    }

    if (uploadEntries.length === 0) {
        const nextLocalRecords = getThemeSyncRegistryRecords();
        const nextLocalBuckets = buildThemeBucketSummaries(nextLocalRecords);
        const bucketsAreNowEqual = diffBucketIds.every((bucketId) => {
            const remoteBucket = remoteBuckets.get(bucketId);
            return Boolean(remoteBucket) && areThemeBucketsEqual(nextLocalBuckets[bucketId], remoteBucket);
        });
        if (bucketsAreNowEqual) {
            writeThemeSyncWatermark({
                remoteThemesUpdatedAt: state.themesUpdatedAt,
                remoteThemeCount: state.themeCount,
                localRegistrySignature: getLocalThemeRegistrySignature(nextLocalRecords),
            });
        }
    }

    if (uploadEntries.length > 0) {
        setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
    }
    return {
        uploadedCount: uploadEntries.length,
        downloadedCount,
        checkedLocalThemeCount: localRecords.length,
        diffBucketCount: diffBucketIds.length,
        skippedRemoteThemeScan: false,
    };
};

export const listAllRemoteThemeRecords = async () => {
    const config = getConfiguredSync();
    if (!config) {
        return [];
    }

    const themes: SyncedThemeRecord[] = [];
    let cursor: string | null = null;
    do {
        const page = await listRemoteThemes(config, { cursor, limit: LIST_PAGE_SIZE });
        themes.push(...page.themes);
        cursor = page.cursor;
    } while (cursor);
    return themes;
};

export const mergeLocalThemesIntoRecords = async (
    remoteThemes: SyncedThemeRecord[],
) => {
    await hydrateLegacyNeteaseThemeSyncRecords();
    const recordMap = new Map(remoteThemes.map(record => [record.fingerprint, record]));
    const localUploads = await collectLocalThemeUploadEntries(recordMap);
    localUploads.forEach(record => recordMap.set(record.fingerprint, record));
    return Array.from(recordMap.values()).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
};

export const saveSyncLibraryBundleToLocalCache = async (bundle: SyncLibraryExportBundle) => {
    const registryRecords: NonNullable<Awaited<ReturnType<typeof saveRemoteThemeToLocalCache>>>[] = [];
    for (const record of bundle.themes) {
        const registryRecord = await saveRemoteThemeToLocalCache(record, undefined, true);
        if (registryRecord) {
            registryRecords.push(registryRecord);
        }
    }
    if (registryRecords.length > 0) {
        upsertThemeSyncRecords(registryRecords);
    }
};

export const pushSyncLibraryBundleToRemote = async (bundle: SyncLibraryExportBundle) => {
    const config = getConfiguredSync();
    if (!config) {
        return false;
    }

    if (bundle.settings) {
        await putRemoteSettings(config, bundle.settings);
    }
    for (let index = 0; index < bundle.themes.length; index += THEME_BATCH_SIZE) {
        await putRemoteThemes(config, bundle.themes.slice(index, index + THEME_BATCH_SIZE));
    }
    setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
    return true;
};
