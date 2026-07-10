import { sanitizeDualTheme } from '../themeSanitizer';
import {
    SYNC_SCHEMA_VERSION,
    type SyncLibraryExportBundle,
    type SyncRemoteState,
    type SyncThemeBucketSummary,
    type SyncThemeManifest,
    type SyncedSettingsRecord,
    type SyncedVisualSettings,
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

const isFiniteNumber = (value: unknown): value is number => (
    typeof value === 'number' && Number.isFinite(value)
);

const isStringArray = (value: unknown): value is string[] => (
    Array.isArray(value) && value.every(item => typeof item === 'string')
);

const isFontStyle = (value: unknown): value is SyncedVisualSettings['lyricsFontStyle'] => (
    value === 'sans' || value === 'serif' || value === 'mono'
);

const isVisualizerBackgroundMode = (value: unknown): value is NonNullable<SyncedVisualSettings['visualizerBackgroundMode']> => (
    value === 'common' || value === 'monet' || value === 'url' || value === 'sora'
);

const parseSyncedVisualSettings = (value: Record<string, unknown>): SyncedVisualSettings => {
    const settings: SyncedVisualSettings = {};

    if (typeof value.visualizerMode === 'string' && value.visualizerMode.trim()) settings.visualizerMode = value.visualizerMode;
    if (value.visualizerBackgroundMode === null) settings.visualizerBackgroundMode = null;
    else if (isVisualizerBackgroundMode(value.visualizerBackgroundMode)) settings.visualizerBackgroundMode = value.visualizerBackgroundMode;
    if (isFiniteNumber(value.backgroundOpacity)) settings.backgroundOpacity = value.backgroundOpacity;
    if (isFiniteNumber(value.visualizerOpacity)) settings.visualizerOpacity = value.visualizerOpacity;
    if (typeof value.hidePlayerTranslationSubtitle === 'boolean') settings.hidePlayerTranslationSubtitle = value.hidePlayerTranslationSubtitle;
    if (typeof value.showSubtitleTranslation === 'boolean') settings.showSubtitleTranslation = value.showSubtitleTranslation;
    if (isFontStyle(value.lyricsFontStyle)) settings.lyricsFontStyle = value.lyricsFontStyle;
    if (isFiniteNumber(value.lyricsFontScale)) settings.lyricsFontScale = value.lyricsFontScale;
    if (isStringArray(value.lyricsFontFallbackFamilies)) settings.lyricsFontFallbackFamilies = value.lyricsFontFallbackFamilies;
    if (typeof value.subtitleFontInheritsLyrics === 'boolean') settings.subtitleFontInheritsLyrics = value.subtitleFontInheritsLyrics;
    if (isFontStyle(value.subtitleFontStyle)) settings.subtitleFontStyle = value.subtitleFontStyle;
    if (value.subtitleFontFamily === null) settings.subtitleFontFamily = null;
    else if (typeof value.subtitleFontFamily === 'string') settings.subtitleFontFamily = value.subtitleFontFamily;
    if (isStringArray(value.subtitleFontFallbackFamilies)) settings.subtitleFontFallbackFamilies = value.subtitleFontFallbackFamilies;
    if (value.classicTuning !== undefined) settings.classicTuning = value.classicTuning;
    if (value.cadenzaTuning !== undefined) settings.cadenzaTuning = value.cadenzaTuning;
    if (value.partitaTuning !== undefined) settings.partitaTuning = value.partitaTuning;
    if (value.fumeTuning !== undefined) settings.fumeTuning = value.fumeTuning;
    if (value.claddaghTuning !== undefined) settings.claddaghTuning = value.claddaghTuning;
    if (value.cappellaTuning !== undefined) settings.cappellaTuning = value.cappellaTuning;
    if (value.tiltTuning !== undefined) settings.tiltTuning = value.tiltTuning;
    if (value.monetBackgroundTuning !== undefined) settings.monetBackgroundTuning = value.monetBackgroundTuning;
    if (value.monetTuning !== undefined) settings.monetTuning = value.monetTuning;
    if (Array.isArray(value.urlBackgroundList)) settings.urlBackgroundList = value.urlBackgroundList;
    if (value.urlBackgroundSelectedId === null) settings.urlBackgroundSelectedId = null;
    else if (typeof value.urlBackgroundSelectedId === 'string') settings.urlBackgroundSelectedId = value.urlBackgroundSelectedId;
    if (value.homeLayoutStyle === 'carousel' || value.homeLayoutStyle === 'grid') settings.homeLayoutStyle = value.homeLayoutStyle;
    if (value.grid3dCardStyle === 'image' || value.grid3dCardStyle === 'card') settings.grid3dCardStyle = value.grid3dCardStyle;

    return settings;
};

export const parseSyncedSettingsRecord = (value: unknown): SyncedSettingsRecord | null => {
    if (!isRecord(value) || !isSchemaCompatible(value.schemaVersion) || !isIsoDateString(value.updatedAt) || !isRecord(value.data)) {
        return null;
    }

    return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        updatedAt: value.updatedAt,
        data: parseSyncedVisualSettings(value.data),
    };
};

export const parseSyncedThemeRecord = (value: unknown): SyncedThemeRecord | null => {
    if (!isRecord(value)
        || typeof value.fingerprint !== 'string'
        || !value.fingerprint
        || !isIsoDateString(value.updatedAt)
        || !isRecord(value.theme)
    ) {
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

export const parseSyncLibraryExportBundle = (value: unknown): SyncLibraryExportBundle | null => {
    if (!isRecord(value)
        || value.kind !== 'folia-sync-export'
        || !isSchemaCompatible(value.schemaVersion)
        || !isIsoDateString(value.exportedAt)
        || !Array.isArray(value.themes)
    ) {
        return null;
    }

    const themes = value.themes.map(parseSyncedThemeRecord);
    if (themes.some(theme => !theme)) {
        return null;
    }

    const settings = value.settings === null
        ? null
        : parseSyncedSettingsRecord(value.settings);
    if (value.settings !== null && !settings) {
        return null;
    }

    return {
        kind: 'folia-sync-export',
        schemaVersion: SYNC_SCHEMA_VERSION,
        exportedAt: value.exportedAt,
        settings,
        themes: themes as SyncedThemeRecord[],
    };
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
