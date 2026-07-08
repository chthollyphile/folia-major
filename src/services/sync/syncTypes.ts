import type { DualTheme, Theme, VisualizerBackgroundMode, VisualizerMode } from '../../types';

// src/services/sync/syncTypes.ts
// Shared contracts for Folia's user-hosted sync server API.

export const SYNC_SCHEMA_VERSION = 1;
export const SYNC_PROVIDER = 'sync-server' as const;

export type SyncProvider = typeof SYNC_PROVIDER;
export type SyncStatusState = 'idle' | 'syncing' | 'success' | 'error';
export type SyncedThemeSource = 'manual' | 'auto' | 'fallback' | 'edited';

export type SyncProviderConfig = {
    provider: SyncProvider;
    enabled: boolean;
    workerBaseUrl: string;
    authToken: string;
};

export type SyncRuntimeStatus = {
    state: SyncStatusState;
    lastSyncAt: string | null;
    lastError: string | null;
};

export type SyncedVisualSettings = {
    visualizerMode?: VisualizerMode;
    visualizerBackgroundMode?: VisualizerBackgroundMode | null;
    backgroundOpacity?: number;
    visualizerOpacity?: number;
    hidePlayerTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    lyricsFontStyle?: Theme['fontStyle'];
    lyricsFontScale?: number;
    lyricsFontFallbackFamilies?: string[];
    subtitleFontInheritsLyrics?: boolean;
    subtitleFontStyle?: Theme['fontStyle'];
    subtitleFontFamily?: string | null;
    subtitleFontFallbackFamilies?: string[];
    classicTuning?: unknown;
    cadenzaTuning?: unknown;
    partitaTuning?: unknown;
    fumeTuning?: unknown;
    claddaghTuning?: unknown;
    cappellaTuning?: unknown;
    tiltTuning?: unknown;
    monetBackgroundTuning?: unknown;
    monetTuning?: unknown;
    urlBackgroundList?: unknown[];
    urlBackgroundSelectedId?: string | null;
    homeLayoutStyle?: 'carousel' | 'grid';
    grid3dCardStyle?: 'image' | 'card';
};

export type SyncedSettingsRecord = {
    schemaVersion: number;
    updatedAt: string;
    data: SyncedVisualSettings;
};

export type SyncedThemeRecord = {
    fingerprint: string;
    theme: DualTheme;
    updatedAt: string;
    source: SyncedThemeSource;
};

export type SyncThemeBucketSummary = {
    bucketId: number;
    count: number;
    hash: string;
    updatedAt: string | null;
};

export type SyncThemeManifest = {
    schemaVersion: number;
    bucketCount: number;
    buckets: SyncThemeBucketSummary[];
};

export type SyncRemoteState = {
    schemaVersion: number;
    settingsUpdatedAt: string | null;
    themesUpdatedAt: string | null;
    themeCount: number;
};

export type WorkerHealthResponse = {
    ok: boolean;
    schemaVersion?: number;
    backend?: string;
};

export type SyncLibraryExportBundle = {
    kind: 'folia-sync-export';
    schemaVersion: number;
    exportedAt: string;
    settings: SyncedSettingsRecord | null;
    themes: SyncedThemeRecord[];
};
