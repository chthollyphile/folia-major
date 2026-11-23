import { create } from 'zustand';
import {
    allowExpiredModRange,
    getMarketCatalog,
    getMarketReadme,
    installFromMarket,
    isModsBridgeAvailable,
    revokeExpiredModRange,
    subscribeMarketProgress,
    uninstallMod,
} from '../ipc';
import type { ModMarketCatalog, ModMarketProgress, ModRuntimeInfo } from '../types';
import { useModsStore } from '../useModsStore';
import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from '../../stores/storagePrimitives';
import { compareModVersions } from './marketModel';

// src/mods/market/useModMarketStore.ts
// The window's half of the mod market: the catalog the main process keeps (market.cjs), each install's
// progress, README texts, and the background update check. Installing, uninstalling and loading past an
// expired range all end in a new mod list, which goes to useModsStore.

/** Whether the app looks for mod updates by itself (default on). */
export const MOD_UPDATE_CHECK_KEY = 'folia_mod_update_check';
/** When it last did (epoch ms). */
export const MOD_UPDATE_CHECKED_AT_KEY = 'folia_mod_update_checked_at';

const UPDATE_CHECK_DELAY_MS = 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// The checked-at time; nothing stored (or not readable) is "never".
const readCheckedAt = (): number => Number(getStoredString(MOD_UPDATE_CHECKED_AT_KEY, '0')) || 0;

type Answer = { ok: boolean; error?: string; mods?: ModRuntimeInfo[] };

interface ModMarketState {
    catalog: ModMarketCatalog | null;
    loading: boolean;
    /** Why the last read failed (with no catalog at all) or why the shown one is old. */
    error: string | null;
    stale: boolean;
    fetchedAt: number | null;
    /** Installs under way or just ended, by mod id. */
    progress: Record<string, ModMarketProgress>;
    /** README texts by URL; `null` while one is being read. */
    readmes: Record<string, { text: string | null; error: string | null }>;
    /** How many installed mods the catalog has a newer version of (for the tab's mark). */
    updateCount: number;
    autoCheck: boolean;
    /** A search another place asked the mods view to show (a palette command); the view takes it once. */
    requestedQuery: string | null;
    requestQuery: (query: string) => void;
    takeRequestedQuery: () => string | null;
    load: (options?: { force?: boolean }) => Promise<void>;
    loadReadme: (url: string) => Promise<void>;
    install: (modId: string) => Promise<Answer>;
    updateAll: (modIds: string[]) => Promise<Answer[]>;
    uninstall: (modId: string) => Promise<Answer>;
    allowExpired: (modIds: string[]) => Promise<Answer>;
    revokeExpired: (modId: string) => Promise<Answer>;
    setAutoCheck: (enabled: boolean) => void;
}

const countUpdates = (catalog: ModMarketCatalog | null, mods: readonly ModRuntimeInfo[]): number => {
    if (!catalog) return 0;
    const byId = new Map(catalog.mods.map((entry) => [entry.id, entry]));
    return mods.filter((mod) => {
        const entry = byId.get(mod.id);
        return entry && (mod.tier === 'user' || mod.tier === 'override') && compareModVersions(entry.version, mod.version) > 0
            && entry.hostRange !== 'too-old' && entry.hostRange !== 'invalid';
    }).length;
};

// A mod list that came back with an answer replaces the one shown.
const takeMods = (answer: Answer) => {
    if (Array.isArray(answer.mods) && answer.mods.length > 0) {
        useModsStore.setState({ mods: answer.mods });
    }
};

let progressBound = false;

export const useModMarketStore = create<ModMarketState>((set, get) => ({
    catalog: null,
    loading: false,
    error: null,
    stale: false,
    fetchedAt: null,
    progress: {},
    readmes: {},
    updateCount: 0,
    autoCheck: getStoredBoolean(MOD_UPDATE_CHECK_KEY, true),
    requestedQuery: null,
    requestQuery: (query) => set({ requestedQuery: query }),
    takeRequestedQuery: () => {
        const query = get().requestedQuery;
        if (query !== null) set({ requestedQuery: null });
        return query;
    },

    load: async (options) => {
        if (!isModsBridgeAvailable()) return;
        if (!progressBound) {
            progressBound = true;
            subscribeMarketProgress((progress) => set((state) => ({ progress: { ...state.progress, [progress.id]: progress } })));
        }
        set({ loading: true });
        const result = await getMarketCatalog(options);
        if (result.ok) {
            set({
                catalog: result.catalog,
                stale: result.stale,
                error: result.stale ? result.error ?? null : null,
                fetchedAt: result.fetchedAt,
                loading: false,
                updateCount: countUpdates(result.catalog, useModsStore.getState().mods),
            });
            setStoredString(MOD_UPDATE_CHECKED_AT_KEY, String(Date.now()));
        } else {
            set({ error: result.error, loading: false });
        }
    },

    loadReadme: async (url) => {
        // Read already, or being read; a failed read is tried again.
        const { readmes } = get();
        if (Object.hasOwn(readmes, url) && (readmes[url].text !== null || readmes[url].error === null)) return;
        set((state) => ({ readmes: { ...state.readmes, [url]: { text: null, error: null } } }));
        const result = await getMarketReadme(url);
        set((state) => ({
            readmes: {
                ...state.readmes,
                [url]: result.ok ? { text: result.text ?? '', error: null } : { text: null, error: result.error ?? 'market-readme-failed' },
            },
        }));
    },

    install: async (modId) => {
        set((state) => ({ progress: { ...state.progress, [modId]: { id: modId, phase: 'download', received: 0 } } }));
        const answer = await installFromMarket(modId);
        takeMods(answer);
        if (answer.ok) await useModsStore.getState().refresh();
        set((state) => {
            const progress = answer.ok
                ? Object.fromEntries(Object.entries(state.progress).filter(([id]) => id !== modId))
                : { ...state.progress, [modId]: { id: modId, phase: 'error' as const, error: answer.error } };
            return { progress, updateCount: countUpdates(state.catalog, useModsStore.getState().mods) };
        });
        return answer;
    },

    // One after another: each install reloads the mods.
    updateAll: async (modIds) => {
        const answers: Answer[] = [];
        for (const modId of modIds) {
            answers.push(await get().install(modId));
        }
        return answers;
    },

    uninstall: async (modId) => {
        const answer = await uninstallMod(modId);
        takeMods(answer);
        if (answer.ok) await useModsStore.getState().refresh();
        set((state) => ({ updateCount: countUpdates(state.catalog, useModsStore.getState().mods) }));
        return answer;
    },

    allowExpired: async (modIds) => {
        const answer = await allowExpiredModRange(modIds);
        takeMods(answer);
        return answer;
    },

    revokeExpired: async (modId) => {
        const answer = await revokeExpiredModRange(modId);
        takeMods(answer);
        return answer;
    },

    setAutoCheck: (enabled) => {
        setStoredBoolean(MOD_UPDATE_CHECK_KEY, enabled);
        set({ autoCheck: enabled });
    },
}));

// The tab's mark follows the installed list too (an install from a zip, a reload).
useModsStore.subscribe((state, previous) => {
    if (state.mods !== previous.mods) {
        const count = countUpdates(useModMarketStore.getState().catalog, state.mods);
        if (count !== useModMarketStore.getState().updateCount) useModMarketStore.setState({ updateCount: count });
    }
});

let updateCheckTimer: ReturnType<typeof setTimeout> | null = null;

/*
 * The background update check of the main window: a minute after the start, then at most every six hours, while
 * the setting is on and the mod system runs. It only reads the catalog; nothing is installed without the user.
 */
export const startModUpdateCheck = (isModSystemEnabled: () => boolean): (() => void) => {
    if (!isModsBridgeAvailable() || updateCheckTimer) return () => {};
    const run = async () => {
        updateCheckTimer = null;
        const due = readCheckedAt() + UPDATE_CHECK_INTERVAL_MS;
        if (useModMarketStore.getState().autoCheck && isModSystemEnabled() && Date.now() >= due) {
            await useModsStore.getState().refresh();
            await useModMarketStore.getState().load();
        }
        // Next time the last read is six hours old (a read the user made counts too).
        const next = readCheckedAt() + UPDATE_CHECK_INTERVAL_MS - Date.now();
        updateCheckTimer = setTimeout(() => { void run(); }, Math.min(UPDATE_CHECK_INTERVAL_MS, Math.max(UPDATE_CHECK_DELAY_MS, next)));
    };
    updateCheckTimer = setTimeout(() => { void run(); }, UPDATE_CHECK_DELAY_MS);
    return () => {
        if (updateCheckTimer) clearTimeout(updateCheckTimer);
        updateCheckTimer = null;
    };
};
