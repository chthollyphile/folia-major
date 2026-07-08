import { sanitizeDualTheme } from '../themeSanitizer';
import {
    SYNC_SCHEMA_VERSION,
    type SyncRemoteState,
    type SyncThemeBucketSummary,
    type SyncThemeManifest,
    type SyncedSettingsRecord,
    type SyncedThemeRecord,
} from './syncTypes';

// src/services/sync/syncSchema.ts
// Defensive parsing for JSON returned by user-hosted sync servers.

const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isIsoDateString = (value: unknown): value is string => (
    typeof value === 'string' && !Number.isNaN(Date.parse(value))
);

const isSchemaCompatible = (value: unknown) => value === SYNC_SCHEMA_VERSION;

export const parseSyncedSettingsRecord = (value: unknown): SyncedSettingsRecord | null => {
    if (!isRecord(value) || !isSchemaCompatible(value.schemaVersion) || !isIsoDateString(value.updatedAt) || !isRecord(value.data)) {
        return null;
    }

    return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        updatedAt: value.updatedAt,
        data: value.data as SyncedSettingsRecord['data'],
    };
};

export const parseSyncedThemeRecord = (value: unknown): SyncedThemeRecord | null => {
    if (!isRecord(value) || typeof value.fingerprint !== 'string' || !value.fingerprint || !isIsoDateString(value.updatedAt)) {
        return null;
    }

    return {
        fingerprint: value.fingerprint,
        theme: sanitizeDualTheme(value.theme),
        updatedAt: value.updatedAt,
        source: value.source === 'auto' || value.source === 'fallback' || value.source === 'edited'
            ? value.source
            : 'manual',
    };
};

export const parseSyncedThemeRecords = (value: unknown): SyncedThemeRecord[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(parseSyncedThemeRecord)
        .filter((record): record is SyncedThemeRecord => Boolean(record));
};

export const parseSyncRemoteState = (value: unknown): SyncRemoteState | null => {
    if (!isRecord(value) || !isSchemaCompatible(value.schemaVersion)) {
        return null;
    }

    const settingsUpdatedAt = typeof value.settingsUpdatedAt === 'string' ? value.settingsUpdatedAt : null;
    const themesUpdatedAt = typeof value.themesUpdatedAt === 'string' ? value.themesUpdatedAt : null;
    if ((value.settingsUpdatedAt != null && !isIsoDateString(settingsUpdatedAt))
        || (value.themesUpdatedAt != null && !isIsoDateString(themesUpdatedAt))
        || typeof value.themeCount !== 'number'
        || !Number.isFinite(value.themeCount)
    ) {
        return null;
    }

    return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        settingsUpdatedAt,
        themesUpdatedAt,
        themeCount: Math.max(0, Math.trunc(value.themeCount)),
    };
};

const parseThemeBucketSummary = (value: unknown): SyncThemeBucketSummary | null => {
    if (!isRecord(value)
        || typeof value.bucketId !== 'number'
        || !Number.isInteger(value.bucketId)
        || value.bucketId < 0
        || typeof value.count !== 'number'
        || !Number.isFinite(value.count)
        || typeof value.hash !== 'string'
    ) {
        return null;
    }

    const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null;
    if (value.updatedAt != null && !isIsoDateString(updatedAt)) {
        return null;
    }

    return {
        bucketId: value.bucketId,
        count: Math.max(0, Math.trunc(value.count)),
        hash: value.hash,
        updatedAt,
    };
};

export const parseSyncThemeManifest = (value: unknown): SyncThemeManifest | null => {
    if (!isRecord(value)
        || !isSchemaCompatible(value.schemaVersion)
        || typeof value.bucketCount !== 'number'
        || !Number.isInteger(value.bucketCount)
        || !Array.isArray(value.buckets)
    ) {
        return null;
    }

    const buckets = value.buckets.map(parseThemeBucketSummary);
    if (buckets.some(bucket => !bucket)) {
        return null;
    }

    return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        bucketCount: value.bucketCount,
        buckets: buckets as SyncThemeBucketSummary[],
    };
};
