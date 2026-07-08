import { useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { getSyncConfig, isSyncConfigured, setSyncStatus } from './syncConfig';
import { getRemoteState, testSyncConnection } from './syncClient';
import type { SyncProviderConfig } from './syncTypes';
import { applySyncedVisualSettings, buildSyncedSettingsRecord, getSyncedSettingsSignature } from './settingsSnapshot';
import {
    fetchRemoteSyncState,
    fetchRemoteSettingsIfNewer,
    listAllRemoteThemeRecords,
    mergeLocalThemesIntoRecords,
    pushMissingLocalThemesToRemote,
    pushRemoteSettings,
    pushSyncLibraryBundleToRemote,
    saveSyncLibraryBundleToLocalCache,
} from './syncRepository';
import type { SyncLibraryExportBundle, SyncRemoteState } from './syncTypes';
import { SYNC_SCHEMA_VERSION } from './syncTypes';

// src/services/sync/syncCoordinator.ts
// Coordinates startup sync, settings auto-upload, and manual sync commands.

const LOCAL_SETTINGS_UPDATED_AT_KEY = 'folia_sync_local_settings_updated_at_v1';
const SETTINGS_UPLOAD_DEBOUNCE_MS = 2500;

let unsubscribeSettings: (() => void) | null = null;
let settingsUploadTimer: number | null = null;
let lastSettingsSignature: string | null = null;
let applyingRemoteSettings = false;

const isBrowser = () => typeof window !== 'undefined';

const getLocalSettingsUpdatedAt = () => (
    isBrowser() ? window.localStorage.getItem(LOCAL_SETTINGS_UPDATED_AT_KEY) : null
);

const setLocalSettingsUpdatedAt = (updatedAt: string) => {
    if (isBrowser()) {
        window.localStorage.setItem(LOCAL_SETTINGS_UPDATED_AT_KEY, updatedAt);
    }
};

const clearSettingsUploadTimer = () => {
    if (settingsUploadTimer != null && isBrowser()) {
        window.clearTimeout(settingsUploadTimer);
    }
    settingsUploadTimer = null;
};

const pushCurrentSettings = async () => {
    if (!isSyncConfigured()) {
        return false;
    }

    const updatedAt = new Date().toISOString();
    const record = buildSyncedSettingsRecord(useSettingsUiStore.getState(), updatedAt);
    setLocalSettingsUpdatedAt(updatedAt);
    lastSettingsSignature = getSyncedSettingsSignature(useSettingsUiStore.getState());
    return await pushRemoteSettings(record);
};

const scheduleSettingsUpload = () => {
    if (!isBrowser() || !isSyncConfigured() || applyingRemoteSettings) {
        return;
    }

    clearSettingsUploadTimer();
    settingsUploadTimer = window.setTimeout(() => {
        settingsUploadTimer = null;
        void pushCurrentSettings().catch((error) => {
            console.error('[sync] Failed to upload settings:', error);
            setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        });
    }, SETTINGS_UPLOAD_DEBOUNCE_MS);
};

export const initializeSyncCoordinator = () => {
    if (unsubscribeSettings) {
        return unsubscribeSettings;
    }

    lastSettingsSignature = getSyncedSettingsSignature(useSettingsUiStore.getState());
    unsubscribeSettings = useSettingsUiStore.subscribe((state) => {
        const nextSignature = getSyncedSettingsSignature(state);
        if (nextSignature !== lastSettingsSignature) {
            lastSettingsSignature = nextSignature;
            scheduleSettingsUpload();
        }
    });

    void syncNow({ applyRemoteSettings: true, pushSettings: false });

    return () => {
        unsubscribeSettings?.();
        unsubscribeSettings = null;
        clearSettingsUploadTimer();
    };
};

export const testSyncProviderConnection = async (config: SyncProviderConfig) => {
    const response = await testSyncConnection(config);
    if (!response.ok) {
        return false;
    }

    return Boolean(await getRemoteState(config));
};

export const pullRemoteVisualSettings = async (remoteState?: SyncRemoteState | null) => {
    if (!isSyncConfigured()) {
        return false;
    }

    const remoteSettings = await fetchRemoteSettingsIfNewer(getLocalSettingsUpdatedAt(), remoteState);
    if (!remoteSettings) {
        return false;
    }

    applyingRemoteSettings = true;
    try {
        applySyncedVisualSettings(useSettingsUiStore.getState(), remoteSettings.data);
        setLocalSettingsUpdatedAt(remoteSettings.updatedAt);
        lastSettingsSignature = getSyncedSettingsSignature(useSettingsUiStore.getState());
        return true;
    } finally {
        applyingRemoteSettings = false;
    }
};

export const syncNow = async (options: { applyRemoteSettings?: boolean; pushSettings?: boolean } = {}) => {
    const config = getSyncConfig();
    if (!isSyncConfigured(config)) {
        return false;
    }

    setSyncStatus({ state: 'syncing', lastError: null });
    try {
        const remoteState = await fetchRemoteSyncState();
        const themeSyncResult = await pushMissingLocalThemesToRemote(remoteState);
        let appliedRemoteSettings = false;
        let pushedLocalSettings = false;
        if (options.applyRemoteSettings ?? true) {
            appliedRemoteSettings = await pullRemoteVisualSettings(remoteState);
        }
        if (options.pushSettings ?? true) {
            pushedLocalSettings = await pushCurrentSettings();
        }
        setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
        console.info('[sync] Sync completed', {
            uploadedThemeCount: themeSyncResult.uploadedCount,
            downloadedThemeCount: themeSyncResult.downloadedCount,
            checkedLocalThemeCount: themeSyncResult.checkedLocalThemeCount,
            diffBucketCount: themeSyncResult.diffBucketCount,
            skippedRemoteThemeScan: themeSyncResult.skippedRemoteThemeScan,
            appliedRemoteSettings,
            pushedLocalSettings,
        });
        return true;
    } catch (error) {
        console.error('[sync] Sync failed:', error);
        setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        return false;
    }
};

export const exportSyncLibraryBundle = async (): Promise<SyncLibraryExportBundle> => {
    setSyncStatus({ state: 'syncing', lastError: null });
    try {
        const settings = buildSyncedSettingsRecord(useSettingsUiStore.getState(), new Date().toISOString());
        const themes = await mergeLocalThemesIntoRecords(await listAllRemoteThemeRecords());
        const bundle: SyncLibraryExportBundle = {
            kind: 'folia-sync-export',
            schemaVersion: SYNC_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            settings,
            themes,
        };
        setSyncStatus({ state: 'success', lastSyncAt: bundle.exportedAt, lastError: null });
        console.info('[sync] Export completed', {
            themeCount: bundle.themes.length,
        });
        return bundle;
    } catch (error) {
        setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        throw error;
    }
};

export const isSyncLibraryExportBundle = (value: unknown): value is SyncLibraryExportBundle => (
    Boolean(value)
    && typeof value === 'object'
    && (value as SyncLibraryExportBundle).kind === 'folia-sync-export'
    && (value as SyncLibraryExportBundle).schemaVersion === SYNC_SCHEMA_VERSION
    && Array.isArray((value as SyncLibraryExportBundle).themes)
);

export const importSyncLibraryBundle = async (
    bundle: SyncLibraryExportBundle,
    options: { pushRemote?: boolean } = {},
) => {
    if (!isSyncLibraryExportBundle(bundle)) {
        throw new Error('Invalid Folia sync export');
    }

    setSyncStatus({ state: 'syncing', lastError: null });
    try {
        await saveSyncLibraryBundleToLocalCache(bundle);
        if (bundle.settings) {
            applyingRemoteSettings = true;
            try {
                applySyncedVisualSettings(useSettingsUiStore.getState(), bundle.settings.data);
                setLocalSettingsUpdatedAt(bundle.settings.updatedAt);
                lastSettingsSignature = getSyncedSettingsSignature(useSettingsUiStore.getState());
            } finally {
                applyingRemoteSettings = false;
            }
        }
        if (options.pushRemote ?? true) {
            await pushSyncLibraryBundleToRemote(bundle);
        }
        setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
        console.info('[sync] Import completed', {
            pushedRemote: options.pushRemote ?? true,
            themeCount: bundle.themes.length,
            appliedSettings: Boolean(bundle.settings),
        });
        return true;
    } catch (error) {
        setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        throw error;
    }
};
