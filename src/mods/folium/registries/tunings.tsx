import React, { useSyncExternalStore } from 'react';
import { getVisualizerRegistryEntry, hasVisualizerMode } from '@/components/visualizer/registry';
import type { Theme } from '@/types';
import type { FoliumParam, FoliumParamAccess, FoliumTuningDef } from '../contract';
import { sanitizeFoliumParams } from '../params';
import { createFoliumParamAccess, useFoliumParamStore } from '../paramStore';
import { createFoliumRegistry, useFoliumRegistryEntries, type FoliumRegistryEntry } from '../registry';
import { reportFoliumIssue } from '../status';
import { FoliumSettingsCard } from '../FoliumSettingsCard';

// src/mods/folium/registries/tunings.tsx
// `folium.registries.tunings`: mods tuning builtin visualizer modes. A target
// mode declares its tunable keys (VisualizerRegistryEntry.foliumTunables); a
// tuning may only use those keys, as numbers, inside the declared range. One
// key of one target belongs to one mod: a later registration asking for a key
// that is already taken loses that key and the conflict is reported.
//
// Values persist in the Folium param store (`tuning:<id>`); the target reads
// the merged multipliers of every tuning through useFoliumTunings(mode).

export interface StoredFoliumTuning {
    def: FoliumTuningDef;
    target: string;
    params: FoliumParam[];
    access: FoliumParamAccess;
}

// target -> key -> owning tuning id
const keyOwners = new Map<string, Map<string, string>>();

const claimKeys = (target: string, id: string, keys: string[]) => {
    let owners = keyOwners.get(target);
    if (!owners) {
        owners = new Map();
        keyOwners.set(target, owners);
    }
    keys.forEach((key) => owners!.set(key, id));
};

const releaseKeys = (target: string, id: string) => {
    const owners = keyOwners.get(target);
    if (!owners) return;
    Array.from(owners.entries()).forEach(([key, owner]) => {
        if (owner === id) owners.delete(key);
    });
};

export const tuningsRegistry = createFoliumRegistry<FoliumTuningDef, StoredFoliumTuning>('tunings', {
    validate: (def, { id, modId }) => {
        const target = typeof def.target === 'string' ? def.target : '';
        const tunables = hasVisualizerMode(target) ? getVisualizerRegistryEntry(target).foliumTunables : undefined;
        if (!tunables) {
            throw new Error(`tunings.register: "${target}" is not a mode with Folium tunables`);
        }
        const owners = keyOwners.get(target);
        const params: FoliumParam[] = [];
        sanitizeFoliumParams(def.params).forEach((param) => {
            const tunable = tunables[param.key];
            if (param.type !== 'number' || !tunable) {
                reportFoliumIssue(modId, `tuning ${id}`, `"${param.key}" is not a numeric tunable of ${target}`);
                return;
            }
            const owner = owners?.get(param.key);
            if (owner && owner !== id) {
                reportFoliumIssue(modId, `tuning ${id}`, `"${target}.${param.key}" is already tuned by ${owner}`);
                return;
            }
            // Range is the intersection of what the mod asks for and what the mode allows.
            const min = Math.max(tunable.min, param.min ?? tunable.min);
            const max = Math.min(tunable.max, param.max ?? tunable.max);
            if (min > max) {
                reportFoliumIssue(modId, `tuning ${id}`, `"${param.key}" range does not overlap ${target}'s [${tunable.min}, ${tunable.max}]`);
                return;
            }
            const requested = typeof param.defaultValue === 'number' ? param.defaultValue : tunable.identity;
            params.push({ ...param, min, max, defaultValue: Math.min(max, Math.max(min, requested)) });
        });
        if (params.length === 0) {
            throw new Error(`tunings.register: no usable tunable keys for "${target}"`);
        }
        return { def, target, params, access: createFoliumParamAccess(`tuning:${id}`, params) };
    },
    onAdd: (entry) => claimKeys(entry.def.target, entry.id, entry.def.params.map((param) => param.key)),
    onRemove: (entry) => releaseKeys(entry.def.target, entry.id),
});

/*
 * Merged multipliers for one target, recomputed only when the registry or the
 * param store changes. Keys no tuning claims are absent, so the target's own
 * fallback (identity) applies.
 */
const EMPTY_TUNINGS: Readonly<Record<string, number>> = Object.freeze({});
const tuningCache = new Map<string, {
    list: readonly FoliumRegistryEntry<StoredFoliumTuning>[];
    byScope: unknown;
    value: Readonly<Record<string, number>>;
}>();

export const readFoliumTunings = (target: string): Readonly<Record<string, number>> => {
    const list = tuningsRegistry.list();
    const byScope = useFoliumParamStore.getState().byScope;
    const cached = tuningCache.get(target);
    if (cached && cached.list === list && cached.byScope === byScope) {
        return cached.value;
    }
    const merged: Record<string, number> = {};
    list.forEach((entry) => {
        if (entry.def.target !== target) return;
        const values = entry.def.access.get();
        entry.def.params.forEach((param) => {
            const value = values[param.key];
            if (typeof value === 'number') merged[param.key] = value;
        });
    });
    const value = Object.keys(merged).length > 0 ? Object.freeze(merged) : EMPTY_TUNINGS;
    tuningCache.set(target, { list, byScope, value });
    return value;
};

const subscribeTunings = (listener: () => void) => {
    const offRegistry = tuningsRegistry.subscribe(listener);
    const offStore = useFoliumParamStore.subscribe(listener);
    return () => {
        offRegistry();
        offStore();
    };
};

/** What a builtin mode reads every render: `{ [tunableKey]: value }` from every tuning targeting it. */
export const useFoliumTunings = (target: string): Readonly<Record<string, number>> => useSyncExternalStore(
    subscribeTunings,
    () => readFoliumTunings(target),
    () => readFoliumTunings(target),
);

/** The tuning cards of every mod targeting `mode`, for the mode's settings page. */
export const FoliumTuningCards: React.FC<{
    mode: string;
    theme: Theme;
    isDaylight: boolean;
    controlCardBg: string;
    rangeInputClass: string;
    description: string;
}> = ({ mode, theme, isDaylight, controlCardBg, rangeInputClass, description }) => {
    const entries = useFoliumRegistryEntries(tuningsRegistry);
    const relevant = entries.filter((entry) => entry.def.target === mode);
    if (relevant.length === 0) return null;
    return (
        <>
            {relevant.map((entry) => (
                <FoliumSettingsCard
                    key={entry.id}
                    modId={entry.modId}
                    where={`tuning ${entry.id}`}
                    title={entry.def.def.label}
                    fallbackTitle={entry.id}
                    access={entry.def.access}
                    theme={theme}
                    isDaylight={isDaylight}
                    controlCardBg={controlCardBg}
                    rangeInputClass={rangeInputClass}
                    description={description}
                />
            ))}
        </>
    );
};
