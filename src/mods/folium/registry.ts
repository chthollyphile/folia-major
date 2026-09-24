import { useSyncExternalStore } from 'react';
import type { FoliumId, FoliumRegistryHandle } from './contract';

// src/mods/folium/registry.ts
// The single registry implementation behind every `folium.registries.*`.
// It owns id namespacing (`modid:name`), ownership, duplicate rejection,
// per-mod teardown and change notification; each concrete registry only adds
// validation and the adapter that wires entries into a host surface.

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface FoliumRegistryEntry<Def> {
    /** `modid:name`. */
    id: FoliumId;
    modId: string;
    name: string;
    def: Def;
}

export interface FoliumRegistryOptions<Def, Stored> {
    /**
     * Validates and normalizes a mod-supplied definition; throw to reject it.
     * The returned value is what the registry stores and adapters see.
     */
    validate?: (def: Def, context: { modId: string; id: FoliumId }) => Stored;
    /** Wires an accepted entry into its host surface; throwing rolls the registration back. */
    onAdd?: (entry: FoliumRegistryEntry<Stored>) => void;
    /** Undoes onAdd. Called on unregister and when the owning mod is torn down. */
    onRemove?: (entry: FoliumRegistryEntry<Stored>) => void;
}

export interface FoliumHostRegistry<Def, Stored = Def> {
    readonly name: string;
    register(modId: string, def: Def): FoliumRegistryHandle;
    unregister(id: FoliumId): void;
    unregisterAll(modId: string): void;
    get(id: FoliumId): FoliumRegistryEntry<Stored> | null;
    /** Stable array reference between changes (safe for useSyncExternalStore). */
    list(): readonly FoliumRegistryEntry<Stored>[];
    subscribe(listener: () => void): () => void;
}

export const foliumId = (modId: string, name: string): FoliumId => `${modId}:${name}`;

export const createFoliumRegistry = <Def extends { id: string }, Stored = Def>(
    name: string,
    options: FoliumRegistryOptions<Def, Stored> = {},
): FoliumHostRegistry<Def, Stored> => {
    const entries = new Map<FoliumId, FoliumRegistryEntry<Stored>>();
    const listeners = new Set<() => void>();
    let snapshot: readonly FoliumRegistryEntry<Stored>[] = Object.freeze([]);

    const notify = () => {
        snapshot = Object.freeze(Array.from(entries.values()));
        listeners.forEach((listener) => {
            try {
                listener();
            } catch (error) {
                console.warn(`[Folium] ${name} listener failed`, error);
            }
        });
    };

    const remove = (id: FoliumId) => {
        const entry = entries.get(id);
        if (!entry) return;
        entries.delete(id);
        try {
            options.onRemove?.(entry);
        } catch (error) {
            console.warn(`[Folium] ${name}: removing ${id} failed`, error);
        }
        notify();
    };

    const register = (modId: string, def: Def): FoliumRegistryHandle => {
        if (!def || typeof def !== 'object' || typeof def.id !== 'string' || !NAME_PATTERN.test(def.id)) {
            throw new Error(`[Folium] ${name}.register: id must match /^[a-z0-9][a-z0-9-]*$/`);
        }
        const id = foliumId(modId, def.id);
        if (entries.has(id)) {
            throw new Error(`[Folium] ${name}.register: duplicate id "${id}"`);
        }
        const stored = options.validate ? options.validate(def, { modId, id }) : def as unknown as Stored;
        const entry: FoliumRegistryEntry<Stored> = { id, modId, name: def.id, def: stored };
        entries.set(id, entry);
        try {
            options.onAdd?.(entry);
        } catch (error) {
            entries.delete(id);
            throw error;
        }
        notify();
        return Object.freeze({
            id,
            // Removes this registration only: after a teardown the same id may
            // belong to a newer registration (a re-enabled mod), which a stale
            // handle must not take down.
            unregister: () => {
                if (entries.get(id) === entry) remove(id);
            },
        });
    };

    return {
        name,
        register,
        unregister: remove,
        unregisterAll: (modId) => {
            Array.from(entries.values())
                .filter((entry) => entry.modId === modId)
                .forEach((entry) => remove(entry.id));
        },
        get: (id) => entries.get(id) ?? null,
        list: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
};

/** React view of a registry's entries; re-renders on every register/unregister. */
export const useFoliumRegistryEntries = <Stored>(
    registry: Pick<FoliumHostRegistry<never, Stored>, 'list' | 'subscribe'>,
): readonly FoliumRegistryEntry<Stored>[] => useSyncExternalStore(registry.subscribe, registry.list, registry.list);
