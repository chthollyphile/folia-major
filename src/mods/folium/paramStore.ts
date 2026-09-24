import { create } from 'zustand';
import type { FoliumParam, FoliumParamAccess, FoliumParamValues } from './contract';
import { filterFoliumParamPatch, mergeFoliumParamValues } from './params';

// src/mods/folium/paramStore.ts
// Persisted values for every schema-backed Folium surface, keyed by scope:
//   `visualizer:<id>`  visualizer settings
//   `tuning:<id>`      tunings of builtin modes
//   `settings:<id>`    settings sections
// Only raw user-set values are stored; defaults come from the schema at read
// time (mergeFoliumParamValues), so a mod changing a default reaches users who
// never touched that field.
//
// The whole map rides along in visual config import/export and in the export
// window's render config, so exports render with the user's values.

const STORAGE_KEY = 'folia_folium_params_v1';

type ScopeValues = Record<string, unknown>;
type ParamsByScope = Record<string, ScopeValues>;

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/*
 * Keeps only entries whose value is a plain object: a corrupt or foreign
 * payload degrades to "no saved values", never to a crash or to array indexes
 * spread into a scope.
 */
export const normalizeFoliumParamsPayload = (raw: unknown): ParamsByScope => {
    if (!isPlainObject(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, value]) => isPlainObject(value))) as ParamsByScope;
};

const load = (): ParamsByScope => {
    try {
        return normalizeFoliumParamsPayload(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
    } catch {
        return {};
    }
};

/*
 * Debounced persistence: a slider drag calls set() on every tick, and a
 * synchronous stringify + setItem per tick would stutter the drag. Memory
 * updates immediately; disk follows 250ms later and is flushed on pagehide.
 */
const SAVE_DEBOUNCE_MS = 250;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: ParamsByScope | null = null;
// The export window hydrates from its render config and must not overwrite
// the user's saved values with that copy.
let persistenceEnabled = true;

export const flushFoliumParamsSave = () => {
    if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const snapshot = pendingSave;
    pendingSave = null;
    if (!snapshot || !persistenceEnabled) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
        // Quota/private-mode failures must not break a drag; values stay in memory.
    }
};

const save = (byScope: ParamsByScope) => {
    if (!persistenceEnabled) return;
    pendingSave = byScope;
    if (saveTimer !== null) return;
    saveTimer = setTimeout(flushFoliumParamsSave, SAVE_DEBOUNCE_MS);
};

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushFoliumParamsSave);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushFoliumParamsSave();
    });
}

interface FoliumParamStoreState {
    byScope: ParamsByScope;
    setValues: (scope: string, patch: ScopeValues) => void;
    resetScope: (scope: string) => void;
    replaceAll: (byScope: ParamsByScope) => void;
}

export const useFoliumParamStore = create<FoliumParamStoreState>((set) => ({
    byScope: load(),
    setValues: (scope, patch) => set((state) => {
        const byScope = { ...state.byScope, [scope]: { ...(state.byScope[scope] ?? {}), ...patch } };
        save(byScope);
        return { byScope };
    }),
    resetScope: (scope) => set((state) => {
        if (!(scope in state.byScope)) return state;
        const byScope = { ...state.byScope };
        delete byScope[scope];
        save(byScope);
        return { byScope };
    }),
    replaceAll: (byScope) => {
        const next = normalizeFoliumParamsPayload(byScope);
        save(next);
        set({ byScope: next });
    },
}));

/** Raw stored values of every scope; used by config export and the export window. */
export const snapshotFoliumParams = (): ParamsByScope => useFoliumParamStore.getState().byScope;

/** Visual config import: replaces every stored value. */
export const importFoliumParams = (raw: unknown) => useFoliumParamStore.getState().replaceAll(normalizeFoliumParamsPayload(raw));

/** Export window: take the injected values without writing them to disk. */
export const hydrateFoliumParamsForExport = (raw: unknown) => {
    persistenceEnabled = false;
    useFoliumParamStore.setState({ byScope: normalizeFoliumParamsPayload(raw) });
};

/*
 * A FoliumParamAccess bound to one scope and schema. Reads merge defaults and
 * re-validate; writes are filtered through the schema. The merged object is
 * cached per stored-values identity, so `get()` is stable between changes and
 * safe to call every frame.
 */
export const createFoliumParamAccess = (scope: string, schema: readonly FoliumParam[]): FoliumParamAccess => {
    let cachedSource: ScopeValues | undefined;
    let cachedMerged: FoliumParamValues = Object.freeze(mergeFoliumParamValues(schema, undefined));
    const read = (): FoliumParamValues => {
        const stored = useFoliumParamStore.getState().byScope[scope];
        if (stored !== cachedSource) {
            cachedSource = stored;
            cachedMerged = Object.freeze(mergeFoliumParamValues(schema, stored));
        }
        return cachedMerged;
    };
    return {
        schema,
        get: read,
        set: (patch) => {
            const filtered = filterFoliumParamPatch(schema, patch ?? {});
            if (Object.keys(filtered).length > 0) {
                useFoliumParamStore.getState().setValues(scope, filtered);
            }
        },
        reset: () => useFoliumParamStore.getState().resetScope(scope),
        subscribe: (listener) => useFoliumParamStore.subscribe((state, previous) => {
            if (state.byScope[scope] !== previous.byScope[scope]) listener();
        }),
    };
};
