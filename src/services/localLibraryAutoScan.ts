import { getDirHandles } from './db';
import { LOCAL_MUSIC_UPDATED_EVENT, LocalFolderUnavailableError, resyncFolder } from './localMusicService';
import { summarizeLocalLibraryChanges } from '../utils/localLibraryWatchRecords';
import { useLocalLibrarySettingsStore } from '../stores/useLocalLibrarySettingsStore';
import type {
    FileSystemObserverConstructor,
    FileSystemObserverLike,
    LocalLibraryAutoScanRootState,
    LocalLibraryAutoScanState,
    LocalLibraryChangeRecordLike,
} from '../types/localLibraryWatch';

// src/services/localLibraryAutoScan.ts
// Drives the "watch the imported folders and rescan them automatically" setting.
//
// Observation runs on FileSystemObserver against the very directory handles the import flow
// persisted, so nothing has to translate a handle into an OS path - that translation is not
// possible from a renderer, which is also why this app's transcode fallback ships local audio as
// bytes rather than as a path. Desktop gets the observer through Electron's Chromium; browsers get
// it wherever it has shipped.
//
// One observer per root, because FileSystemObserver has no `unobserve`: dropping a single root from
// a shared observer would mean disconnecting and re-attaching all the others.

/** A batch closes after this much quiet, so copying 300 files rescans once instead of 300 times. */
const QUIET_PERIOD_MS = 1500;
/** ...but never waits longer than this, so a still-running long copy still gets an intermediate scan. */
const MAX_BATCH_DELAY_MS = 20000;
/** Re-reading the handle list on every library mutation would thrash; the scans themselves fire it. */
const ROOT_REFRESH_DEBOUNCE_MS = 1200;

type PermissionAwareDirectoryHandle = FileSystemDirectoryHandle & {
    queryPermission?: (descriptor: { mode: 'read' | 'readwrite'; }) => Promise<PermissionState>;
};

interface RootWatch {
    rootFolderName: string;
    handle: FileSystemDirectoryHandle;
    observer: FileSystemObserverLike;
    recursive: boolean;
    pendingCount: number;
    quietTimer: ReturnType<typeof setTimeout> | null;
    maxTimer: ReturnType<typeof setTimeout> | null;
}

const createInitialState = (): LocalLibraryAutoScanState => ({
    supported: false,
    enabled: useLocalLibrarySettingsStore.getState().autoScanEnabled,
    scanning: false,
    attaching: false,
    roots: [],
    lastScanAt: null,
    lastScanRootFolderName: null,
    lastError: null,
});

let state: LocalLibraryAutoScanState = createInitialState();
const listeners = new Set<() => void>();

const emit = () => {
    listeners.forEach(listener => {
        try {
            listener();
        } catch (error) {
            console.error('[LocalLibraryWatch] A state listener threw:', error);
        }
    });
};

const patchState = (patch: Partial<LocalLibraryAutoScanState>) => {
    state = { ...state, ...patch };
    emit();
};

const patchRootState = (rootFolderName: string, patch: Partial<LocalLibraryAutoScanRootState>) => {
    let changed = false;
    const roots = state.roots.map(root => {
        if (root.rootFolderName !== rootFolderName) return root;
        changed = true;
        return { ...root, ...patch };
    });

    if (changed) patchState({ roots });
};

export const getLocalLibraryAutoScanState = (): LocalLibraryAutoScanState => state;

export const subscribeLocalLibraryAutoScan = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const getFileSystemObserverConstructor = (): FileSystemObserverConstructor | null => {
    if (typeof window === 'undefined') return null;
    const candidate = (window as unknown as { FileSystemObserver?: FileSystemObserverConstructor; }).FileSystemObserver;
    return typeof candidate === 'function' ? candidate : null;
};

/** Whether this browser or desktop build ships FileSystemObserver at all. */
export const isLocalLibraryAutoScanSupported = (): boolean => getFileSystemObserverConstructor() !== null;

// ---------------------------------------------------------------------------
// Incremental rescans
// ---------------------------------------------------------------------------

const pendingScanRoots = new Set<string>();
let scanRunning = false;

/** Runs the queued rescans one at a time, coalescing repeat requests for the same root. */
const drainScanQueue = async (): Promise<void> => {
    if (scanRunning) return;

    scanRunning = true;
    patchState({ scanning: true });

    try {
        while (pendingScanRoots.size > 0) {
            const rootFolderName = pendingScanRoots.values().next().value as string;
            pendingScanRoots.delete(rootFolderName);

            try {
                // 文件夹读不到时不弹提示（没有人在等这次扫描），原因只记在 lastError 里。
                await resyncFolder(rootFolderName, { announceUnavailable: false });
                patchState({ lastScanAt: Date.now(), lastScanRootFolderName: rootFolderName, lastError: null });
            } catch (error) {
                if (error instanceof LocalFolderUnavailableError) {
                    // 盘没插、NAS 离线：扫描已经整个放弃，曲库没有动。不算故障，记一行就够。
                    console.warn(`[LocalLibraryWatch] "${rootFolderName}" is not readable right now; the auto rescan was skipped and the library left as it is.`);
                    patchState({ lastScanAt: Date.now(), lastScanRootFolderName: rootFolderName, lastError: error.message });
                    continue;
                }
                console.error(`[LocalLibraryWatch] Auto rescan failed for "${rootFolderName}":`, error);
                patchState({
                    lastScanAt: Date.now(),
                    lastScanRootFolderName: rootFolderName,
                    lastError: (error as Error)?.message || 'scan-failed',
                });
            }
        }
    } finally {
        scanRunning = false;
        patchState({ scanning: false });
    }
};

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

const watches = new Map<string, RootWatch>();

const clearWatchTimers = (watch: RootWatch) => {
    if (watch.quietTimer) {
        clearTimeout(watch.quietTimer);
        watch.quietTimer = null;
    }
    if (watch.maxTimer) {
        clearTimeout(watch.maxTimer);
        watch.maxTimer = null;
    }
};

const flushWatch = (watch: RootWatch) => {
    clearWatchTimers(watch);
    const changeCount = watch.pendingCount;
    watch.pendingCount = 0;

    if (changeCount === 0 || watches.get(watch.rootFolderName) !== watch) return;

    console.log(`[LocalLibraryWatch] ${changeCount} change(s) under "${watch.rootFolderName}", queueing an incremental rescan.`);
    pendingScanRoots.add(watch.rootFolderName);
    void drainScanQueue();
};

const scheduleWatchFlush = (watch: RootWatch) => {
    if (watch.quietTimer) clearTimeout(watch.quietTimer);
    watch.quietTimer = setTimeout(() => flushWatch(watch), QUIET_PERIOD_MS);
    if (!watch.maxTimer) {
        watch.maxTimer = setTimeout(() => flushWatch(watch), MAX_BATCH_DELAY_MS);
    }
};

const detachWatch = (rootFolderName: string) => {
    const watch = watches.get(rootFolderName);
    if (!watch) return;

    clearWatchTimers(watch);
    try {
        watch.observer.disconnect();
    } catch (error) {
        console.warn(`[LocalLibraryWatch] Failed to disconnect the observer for "${rootFolderName}":`, error);
    }
    watches.delete(rootFolderName);
};

const detachAllWatches = () => {
    [...watches.keys()].forEach(detachWatch);
};

const handleRecords = (rootFolderName: string, records: readonly LocalLibraryChangeRecordLike[]) => {
    const watch = watches.get(rootFolderName);
    if (!watch || !state.enabled) return;

    const summary = summarizeLocalLibraryChanges(records);

    if (summary.errored) {
        // The observation itself stopped. Drop it and let the next root refresh re-attach, which is
        // also what recovers a folder that was temporarily unavailable.
        detachWatch(rootFolderName);
        patchRootState(rootFolderName, { watching: false, skipReason: 'error', error: 'observer-errored' });
        scheduleRefresh();
        return;
    }

    if (summary.relevantCount === 0) return;

    watch.pendingCount += summary.relevantCount;
    scheduleWatchFlush(watch);
};

/**
 * Attaches one observer, preferring a recursive observation and falling back to the root level.
 * Recursive observation is not available on every platform and filesystem, and a root-level watch
 * still catches files dropped straight into the folder.
 */
const attachWatch = async (
    rootFolderName: string,
    handle: FileSystemDirectoryHandle,
): Promise<LocalLibraryAutoScanRootState> => {
    const FileSystemObserverCtor = getFileSystemObserverConstructor();
    if (!FileSystemObserverCtor) {
        return { rootFolderName, watching: false, recursive: false, skipReason: 'unsupported', error: null };
    }

    const observer = new FileSystemObserverCtor(records => handleRecords(rootFolderName, records));
    const register = async (recursive: boolean) => {
        await observer.observe(handle, { recursive });
        watches.set(rootFolderName, {
            rootFolderName,
            handle,
            observer,
            recursive,
            pendingCount: 0,
            quietTimer: null,
            maxTimer: null,
        });
    };

    try {
        await register(true);
        return { rootFolderName, watching: true, recursive: true, skipReason: null, error: null };
    } catch (recursiveError) {
        try {
            await register(false);
            console.warn(
                `[LocalLibraryWatch] Recursive observation unavailable for "${rootFolderName}", watching the root only:`,
                recursiveError,
            );
            return { rootFolderName, watching: true, recursive: false, skipReason: null, error: null };
        } catch (error) {
            try {
                observer.disconnect();
            } catch {
                // An observer that never attached has nothing to release.
            }
            return {
                rootFolderName,
                watching: false,
                recursive: false,
                skipReason: 'error',
                error: (error as Error)?.message || 'observe-failed',
            };
        }
    }
};

// ---------------------------------------------------------------------------
// Root refresh
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<void> | null = null;
let refreshQueued = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
/** Mount count for the runtime; see startLocalLibraryAutoScan. Zero means nothing should be observed. */
let startCount = 0;

const runRefresh = async (): Promise<void> => {
    // A refresh already in flight when the runtime was torn down must not re-attach observers.
    if (startCount === 0) {
        detachAllWatches();
        return;
    }

    if (!isLocalLibraryAutoScanSupported()) {
        detachAllWatches();
        patchState({ supported: false, roots: [], attaching: false });
        return;
    }

    if (!state.enabled) {
        detachAllWatches();
        patchState({ supported: true, roots: [], attaching: false });
        return;
    }

    patchState({ supported: true, attaching: true });

    try {
        const dirHandles = await getDirHandles();
        const rootFolderNames = Object.keys(dirHandles).sort((a, b) => a.localeCompare(b));

        for (const rootFolderName of [...watches.keys()]) {
            if (!(rootFolderName in dirHandles)) detachWatch(rootFolderName);
        }

        const roots: LocalLibraryAutoScanRootState[] = [];
        for (const rootFolderName of rootFolderNames) {
            // Attaching is awaited per root, so the runtime can be torn down mid-loop.
            if (startCount === 0) {
                detachAllWatches();
                patchState({ roots: [], attaching: false });
                return;
            }

            const handle = dirHandles[rootFolderName];
            const existing = watches.get(rootFolderName);
            if (existing && existing.handle === handle) {
                roots.push({
                    rootFolderName,
                    watching: true,
                    recursive: existing.recursive,
                    skipReason: null,
                    error: null,
                });
                continue;
            }

            // A re-import replaces the stored handle; the old observer points at the previous one.
            if (existing) detachWatch(rootFolderName);

            const permissionAware = handle as PermissionAwareDirectoryHandle;
            let permission: PermissionState = 'granted';
            try {
                permission = (await permissionAware.queryPermission?.({ mode: 'read' })) ?? 'granted';
            } catch {
                permission = 'denied';
            }

            if (permission !== 'granted') {
                // Never prompt from here: requesting permission needs a user gesture, and this runs
                // unattended. The folder stays unwatched until the next manual import.
                roots.push({ rootFolderName, watching: false, recursive: false, skipReason: 'permission', error: null });
                continue;
            }

            roots.push(await attachWatch(rootFolderName, handle));
        }

        patchState({ roots, attaching: false });
    } catch (error) {
        console.error('[LocalLibraryWatch] Failed to refresh the watched roots:', error);
        patchState({ attaching: false, lastError: (error as Error)?.message || 'refresh-failed' });
    }
};

/** Serialises refreshes and collapses the ones that pile up behind an in-flight run. */
const refreshRoots = (): Promise<void> => {
    if (refreshInFlight) {
        refreshQueued = true;
        return refreshInFlight;
    }

    refreshInFlight = (async () => {
        try {
            await runRefresh();
            while (refreshQueued) {
                refreshQueued = false;
                await runRefresh();
            }
        } finally {
            refreshInFlight = null;
        }
    })();

    return refreshInFlight;
};

function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshRoots();
    }, ROOT_REFRESH_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let unsubscribeSettings: (() => void) | null = null;
let libraryUpdatedListener: (() => void) | null = null;

/**
 * Attaches the watcher runtime. Reference counted so React StrictMode's double mount, or two
 * mounted consumers, cannot leave the subscriptions half torn down.
 */
export const startLocalLibraryAutoScan = (): void => {
    startCount += 1;
    if (startCount > 1) return;

    if (!isLocalLibraryAutoScanSupported()) {
        patchState({ supported: false });
        return;
    }

    unsubscribeSettings = useLocalLibrarySettingsStore.subscribe((next, previous) => {
        if (next.autoScanEnabled === previous.autoScanEnabled) return;
        patchState({ enabled: next.autoScanEnabled });
        if (!next.autoScanEnabled) pendingScanRoots.clear();
        void refreshRoots();
    });

    // Imports, folder removals and re-grants all land as this event; the root list follows them.
    libraryUpdatedListener = () => scheduleRefresh();
    window.addEventListener(LOCAL_MUSIC_UPDATED_EVENT, libraryUpdatedListener);

    patchState({ supported: true, enabled: useLocalLibrarySettingsStore.getState().autoScanEnabled });
    void refreshRoots();
};

export const stopLocalLibraryAutoScan = (): void => {
    startCount = Math.max(0, startCount - 1);
    if (startCount > 0) return;

    unsubscribeSettings?.();
    unsubscribeSettings = null;
    if (libraryUpdatedListener) {
        window.removeEventListener(LOCAL_MUSIC_UPDATED_EVENT, libraryUpdatedListener);
        libraryUpdatedListener = null;
    }
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }

    pendingScanRoots.clear();
    detachAllWatches();
    patchState({ roots: [], attaching: false });
};

/** Manual "check the folders again" entry point for the settings panel. */
export const refreshLocalLibraryAutoScanRoots = (): Promise<void> => refreshRoots();
