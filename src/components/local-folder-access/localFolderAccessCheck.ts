import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from '../../stores/storagePrimitives';
import { getLocalLibraryAvailability } from '../../services/localLibraryAvailability';
import type { LocalRootReauthorizeResult } from '../../services/localMusicService';

// src/components/local-folder-access/localFolderAccessCheck.ts
// The one-time local folder access check at the end of the start sequence. Electron 43.8.12 (Folia 0.8.1) took
// in a Chromium change that drops every folder handle an earlier version saved, so after that update every
// imported folder's songs stop playing after a restart, and 0.8.1 could not save new handles beside the dead
// ones. The first start of a fixed version checks each imported root once; when some cannot be reached, the
// start sequence ends with a page that asks for those folders again (reauthorizeLocalRoot keeps every song's id).
// Once the check found nothing, or the page was closed, it is never run again on this install.

const CHECKED_STORAGE_KEY = 'folia_local_folder_access_checked';

// The library service is large and the start sequence imports this file: it is loaded only when the check runs.
const loadLocalMusicService = () => import('../../services/localMusicService');

/** One imported root on the page. */
export interface LocalFolderAccessRow {
    rootFolderName: string;
    songCount: number;
    /** What picking it again came to; null until it is tried. 'scanning' while the rescan runs. */
    result: LocalRootReauthorizeResult | 'scanning' | null;
}

/** 'unknown' until the check ran; 'owed' while the page is to be shown. */
export type LocalFolderAccessStatus = 'unknown' | 'owed' | 'none';

interface LocalFolderAccessState {
    status: LocalFolderAccessStatus;
    isOpen: boolean;
    rows: readonly LocalFolderAccessRow[];
}

export const useLocalFolderAccessStore = create<LocalFolderAccessState>(() => ({
    status: 'unknown',
    isOpen: false,
    rows: [],
}));

const markChecked = () => setStoredBoolean(CHECKED_STORAGE_KEY, true);

let checking: Promise<void> | null = null;

/** Runs the check once per install (and once per run). Never rejects. */
export const loadLocalFolderAccessCheck = (): Promise<void> => {
    checking ??= (async () => {
        if (getStoredBoolean(CHECKED_STORAGE_KEY, false) || !getLocalLibraryAvailability().supported) {
            useLocalFolderAccessStore.setState({ status: 'none' });
            return;
        }
        const { probeLocalRootAccess } = await loadLocalMusicService();
        const roots = await probeLocalRootAccess();
        const lost = roots.filter(root => root.access !== 'ok');
        if (lost.length === 0) {
            markChecked();
            useLocalFolderAccessStore.setState({ status: 'none' });
            console.info(`[LocalFolderAccess] all ${roots.length} imported folder(s) reachable; not checking again`);
            return;
        }
        useLocalFolderAccessStore.setState({
            status: 'owed',
            rows: lost.map(root => ({ rootFolderName: root.rootFolderName, songCount: root.songCount, result: null })),
        });
        console.info(`[LocalFolderAccess] ${lost.length} of ${roots.length} imported folder(s) need picking again: ${lost.map(root => `${root.rootFolderName} (${root.access})`).join(', ')}`);
    })().catch((error: unknown) => {
        console.warn('[LocalFolderAccess] checking the imported folders failed', error);
        useLocalFolderAccessStore.setState({ status: 'none' });
    });
    return checking;
};

export const openLocalFolderAccessPrompt = () => useLocalFolderAccessStore.setState({ isOpen: true });

/** Closes the page for good: the check is not run again, whatever was restored. */
export const closeLocalFolderAccessPrompt = () => {
    markChecked();
    const { rows } = useLocalFolderAccessStore.getState();
    console.info(`[LocalFolderAccess] page closed: ${rows.filter(row => row.result === 'restored').length} of ${rows.length} folder(s) restored`);
    useLocalFolderAccessStore.setState({ isOpen: false, status: 'none' });
};

const setRowResult = (rootFolderName: string, result: LocalFolderAccessRow['result']) => {
    useLocalFolderAccessStore.setState(state => ({
        rows: state.rows.map(row => row.rootFolderName === rootFolderName ? { ...row, result } : row),
    }));
};

/** Picks one root's folder again. Call it straight from the click: the picker needs its user activation. */
export const reauthorizeFolder = async (rootFolderName: string): Promise<void> => {
    // Already loaded by the check that opened the page, so the picker still opens within the click.
    const picking = loadLocalMusicService().then(service => service.reauthorizeLocalRoot(rootFolderName));
    setRowResult(rootFolderName, 'scanning');
    try {
        setRowResult(rootFolderName, await picking);
    } catch (error) {
        console.warn(`[LocalFolderAccess] picking "${rootFolderName}" again failed`, error);
        setRowResult(rootFolderName, 'failed');
    }
};
