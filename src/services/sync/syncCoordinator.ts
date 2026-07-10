import { useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { getSyncConfig, isSyncConfigured, setSyncStatus } from './syncConfig';
import { getRemoteState, testSyncConnection } from './syncClient';
import type { SyncProviderConfig } from './syncTypes';
import { applySyncedVisualSettings, buildSyncedSettingsRecord } from './settingsSnapshot';
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
import { parseSyncLibraryExportBundle } from './syncSchema';
import type { SyncLibraryExportBundle, SyncRemoteState } from './syncTypes';
import { SYNC_SCHEMA_VERSION } from './syncTypes';

// src/services/sync/syncCoordinator.ts
// Coordinates startup theme sync and user-triggered manual sync commands.

const LOCAL_SETTINGS_UPDATED_AT_KEY = 'folia_sync_local_settings_updated_at_v1';
let applyingRemoteSettings = false;
let isSyncingInProgress = false;

const isBrowser = () => typeof window !== 'undefined';

const getLocalSettingsUpdatedAt = () => (
    isBrowser() ? window.localStorage.getItem(LOCAL_SETTINGS_UPDATED_AT_KEY) : null
);

const setLocalSettingsUpdatedAt = (updatedAt: string) => {
    if (isBrowser()) {
        window.localStorage.setItem(LOCAL_SETTINGS_UPDATED_AT_KEY, updatedAt);
    }
};

const pushCurrentSettings = async () => {
    if (!isSyncConfigured()) {
        return false;
    }

    const updatedAt = new Date().toISOString();
    const record = buildSyncedSettingsRecord(useSettingsUiStore.getState(), updatedAt);
    setLocalSettingsUpdatedAt(updatedAt);
    return await pushRemoteSettings(record);
};

export const initializeSyncCoordinator = () => {
    void syncNow({ syncThemes: true, applyRemoteSettings: false, pushSettings: false });

    return () => {};
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
        return true;
    } finally {
        applyingRemoteSettings = false;
    }
};

export type SyncNowResult = {
    uploadedThemeCount: number;
    downloadedThemeCount: number;
    checkedLocalThemeCount: number;
    diffBucketCount: number;
    skippedRemoteThemeScan: boolean;
    appliedRemoteSettings: boolean;
    pushedLocalSettings: boolean;
};

export const syncNow = async (options: { syncThemes?: boolean; applyRemoteSettings?: boolean; pushSettings?: boolean } = {}): Promise<SyncNowResult | null> => {
    if (isSyncingInProgress) {
        return null;
    }

    const config = getSyncConfig();
    if (!isSyncConfigured(config)) {
        return null;
    }

    isSyncingInProgress = true;
    setSyncStatus({ state: 'syncing', lastError: null });
    try {
        const remoteState = await fetchRemoteSyncState();
        let themeSyncResult = {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: 0,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
        if (options.syncThemes ?? true) {
            themeSyncResult = await pushMissingLocalThemesToRemote(remoteState);
        }
        
        let appliedRemoteSettings = false;
        let pushedLocalSettings = false;
        if (options.applyRemoteSettings) {
            appliedRemoteSettings = await pullRemoteVisualSettings(remoteState);
        }
        if (options.pushSettings) {
            pushedLocalSettings = await pushCurrentSettings();
        }
        setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
        const summary = {
            uploadedThemeCount: themeSyncResult.uploadedCount,
            downloadedThemeCount: themeSyncResult.downloadedCount,
            checkedLocalThemeCount: themeSyncResult.checkedLocalThemeCount,
            diffBucketCount: themeSyncResult.diffBucketCount,
            skippedRemoteThemeScan: themeSyncResult.skippedRemoteThemeScan,
            appliedRemoteSettings,
            pushedLocalSettings,
        };
        console.info('[sync] Sync completed', summary);
        if (summary.downloadedThemeCount > 0 && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('folia-themes-synced'));
        }
        return summary;
    } catch (error) {
        console.error('[sync] Sync failed:', error);
        setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        return null;
    } finally {
        isSyncingInProgress = false;
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
    parseSyncLibraryExportBundle(value) !== null
);

export const importSyncLibraryBundle = async (
    bundle: unknown,
    options: { pushRemote?: boolean } = {},
) => {
    const validatedBundle = parseSyncLibraryExportBundle(bundle);
    if (!validatedBundle) {
        throw new Error('Invalid Folia sync export');
    }

    setSyncStatus({ state: 'syncing', lastError: null });
    try {
        await saveSyncLibraryBundleToLocalCache(validatedBundle);
        if (validatedBundle.settings) {
            applyingRemoteSettings = true;
            try {
                applySyncedVisualSettings(useSettingsUiStore.getState(), validatedBundle.settings.data);
                setLocalSettingsUpdatedAt(validatedBundle.settings.updatedAt);
            } finally {
                applyingRemoteSettings = false;
            }
        }
        if (options.pushRemote ?? true) {
            await pushSyncLibraryBundleToRemote(validatedBundle);
        }
        setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
        console.info('[sync] Import completed', {
            pushedRemote: options.pushRemote ?? true,
            themeCount: validatedBundle.themes.length,
            appliedSettings: Boolean(validatedBundle.settings),
        });
        return true;
    } catch (error) {
        setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        throw error;
    }
};
