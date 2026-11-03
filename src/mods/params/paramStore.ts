import { create } from 'zustand';
import type { FoliumSetting, FoliumSettingAccess, FoliumSettingValues } from '../folium/contract';
import { filterFoliumParamPatch, isFoliumSecretParam, mergeFoliumParamValues } from './params';

// src/mods/params/paramStore.ts
// Persisted values for every schema-backed Folium surface, keyed by scope:
//   `visualizer:<id>`  visualizer settings
//   `background:<id>`  background type settings
//   `tuning:<id>`      tunings of builtin modes
//   `settings:<id>`    settings sections
// Only raw user-set values are stored; defaults come from the schema at read
// time (mergeFoliumParamValues), so a mod changing a default reaches users who
// never touched that field.
//
// The whole map rides along in visual config import/export and in the export
// window's render config, so exports render with the user's values.
//
// Folium 1.7 `secret` fields never have a value here (the main process keeps
// them, folium/secrets.ts). Once a schema with one is bound to a scope, the
// store holds that key out of the scope for the rest of the session: a value
// already saved under it (the field used to be `text`) is dropped, and an
// import, the export window's copy or a write cannot bring it back. So every
// reader of `byScope` (the snapshot for export, the host bridge) gets a map
// without it.

const STORAGE_KEY = 'folia_folium_params_v1';

type ScopeValues = Record<string, unknown>;
type ParamsByScope = Record<string, ScopeValues>;

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

// Keys of `secret` fields by scope, for this session. Only ever grows: a key once known to be a
// secret stays out of the store even after its mod stops.
const secretKeysByScope = new Map<string, Set<string>>();

/* `values` without the scope's secret keys; the same object when it holds none. */
const withoutSecretValues = (scope: string, values: ScopeValues): ScopeValues => {
    const secretKeys = secretKeysByScope.get(scope);
    if (!secretKeys || !Object.keys(values).some((key) => secretKeys.has(key))) return values;
    return Object.fromEntries(Object.entries(values).filter(([key]) => !secretKeys.has(key)));
};

/* Every scope without its secret keys; the same object when nothing had to go. */
const withoutSecrets = (byScope: ParamsByScope): ParamsByScope => {
    if (secretKeysByScope.size === 0) return byScope;
    let changed = false;
    const out: ParamsByScope = {};
    Object.entries(byScope).forEach(([scope, values]) => {
        const kept = withoutSecretValues(scope, values);
        if (kept !== values) changed = true;
        out[scope] = kept;
    });
    return changed ? out : byScope;
};

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
    /** Folium 1.7: holds these `secret` keys out of `scope`, dropping a value already saved under one. */
    excludeSecretKeys: (scope: string, keys: readonly string[]) => void;
}

export const useFoliumParamStore = create<FoliumParamStoreState>((set) => ({
    byScope: load(),
    setValues: (scope, patch) => set((state) => {
        const byScope = { ...state.byScope, [scope]: { ...(state.byScope[scope] ?? {}), ...withoutSecretValues(scope, patch) } };
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
        const next = withoutSecrets(normalizeFoliumParamsPayload(byScope));
        save(next);
        set({ byScope: next });
    },
    excludeSecretKeys: (scope, keys) => {
        if (keys.length === 0) return;
        const secretKeys = secretKeysByScope.get(scope) ?? new Set<string>();
        keys.forEach((key) => secretKeys.add(key));
        secretKeysByScope.set(scope, secretKeys);
        set((state) => {
            const stored = state.byScope[scope];
            if (!stored) return state;
            const kept = withoutSecretValues(scope, stored);
            if (kept === stored) return state;
            const byScope = { ...state.byScope, [scope]: kept };
            save(byScope);
            return { byScope };
        });
    },
}));

/** Raw stored values of every scope; used by config export and the export window. */
export const snapshotFoliumParams = (): ParamsByScope => useFoliumParamStore.getState().byScope;

/** Visual config import: replaces every stored value. */
export const importFoliumParams = (raw: unknown) => useFoliumParamStore.getState().replaceAll(normalizeFoliumParamsPayload(raw));

/** Export window: take the injected values without writing them to disk. */
export const hydrateFoliumParamsForExport = (raw: unknown) => {
    persistenceEnabled = false;
    useFoliumParamStore.setState({ byScope: withoutSecrets(normalizeFoliumParamsPayload(raw)) });
};

/*
 * A FoliumSettingAccess bound to one scope and schema. Reads merge defaults and
 * re-validate; writes are filtered through the schema. The merged object is
 * cached per stored-values identity, so `get()` is stable between changes and
 * safe to call every frame. The schema's `secret` fields are in `schema` but
 * never in the values, and the store holds their keys out of the scope.
 */
export const createFoliumParamAccess = (scope: string, schema: readonly FoliumSetting[]): FoliumSettingAccess => {
    useFoliumParamStore.getState().excludeSecretKeys(scope, schema.filter(isFoliumSecretParam).map((param) => param.key));
    let cachedSource: ScopeValues | undefined;
    let cachedMerged: FoliumSettingValues = Object.freeze(mergeFoliumParamValues(schema, undefined));
    const read = (): FoliumSettingValues => {
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
        onChange: (listener) => useFoliumParamStore.subscribe((state, previous) => {
            if (state.byScope[scope] !== previous.byScope[scope]) listener();
        }),
    };
};
