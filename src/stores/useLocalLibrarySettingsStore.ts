import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

// src/stores/useLocalLibrarySettingsStore.ts
// Local-library behaviour settings. Currently one: whether the app watches the imported folders and
// rescans them by itself. The watcher runtime lives in services/localLibraryAutoScan.ts and
// subscribes to this store rather than being driven by the settings UI.

const AUTO_SCAN_STORAGE_KEY = 'local_library_auto_scan';

export type LocalLibrarySettingsState = {
    /** On by default (the maintainer's call, 2026-11-22): new files in the imported folders show up without a manual rescan. A stored choice is kept. */
    autoScanEnabled: boolean;
    setAutoScanEnabled: (enabled: boolean) => void;
    toggleAutoScan: () => void;
};

export const useLocalLibrarySettingsStore = create<LocalLibrarySettingsState>((set, get) => ({
    autoScanEnabled: getStoredBoolean(AUTO_SCAN_STORAGE_KEY, true),

    setAutoScanEnabled: (enabled) => {
        setStoredBoolean(AUTO_SCAN_STORAGE_KEY, enabled);
        set({ autoScanEnabled: enabled });
    },

    toggleAutoScan: () => get().setAutoScanEnabled(!get().autoScanEnabled),
}));
