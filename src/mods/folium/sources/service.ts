import type { ModRuntimeInfo } from '../../types';
import type { FoliumContextKind } from '../contract';
import type { FoliumSourceDef, FoliumSourceHandle, FoliumSourcePageStore, FoliumSourcesService } from './contract';
import { supportsFoliumCapability } from './capabilities';
import { createFoliumSourceError } from './errors';

// src/mods/folium/sources/service.ts
// `folium.sources` for one mod (plan §4.1, §4.6). `supports` and `error` work everywhere and for every
// `folium: 2` mod; `register` and `pageStore` are a source mod's, in the main window. Registering goes to the
// registry and adapter (registries/sources.ts), the page store to registries/sourcePageStore.ts; the client loader
// loads them only in the main window and hands them in, so this file stays free of the host's provider graph.

export interface FoliumSourcesServiceOptions {
    context: FoliumContextKind;
    /** The registry's register, bound to this activation; absent outside the main window. */
    register?: (def: FoliumSourceDef) => FoliumSourceHandle;
    /** The page store of a source by the id the host knows it by; absent outside the main window. */
    pageStore?: (hostId: string) => FoliumSourcePageStore;
}

/** `folium.sources` for `mod`. */
export const createFoliumSourcesService = (mod: ModRuntimeInfo, options: FoliumSourcesServiceOptions): FoliumSourcesService => {
    const isSourceMod = mod.kind === 'source';
    const refuse = (what: string): never => {
        if (!isSourceMod) throw new Error(`not-a-source-mod: ${what} is for a mod that declares "sources" in mod.json`);
        throw new Error(`sources-unavailable-in-${options.context}-context`);
    };
    // The page stores by the id a mod may name them with: the manifest's id, or the one the host knows the source by.
    const stores = new Map<string, FoliumSourcePageStore>();
    const hostIdOf = (sourceId: unknown): string | null => {
        const source = (mod.sources ?? []).find((candidate) => candidate.localId === sourceId || candidate.id === sourceId);
        return source ? source.id : null;
    };
    return Object.freeze({
        register: (def: FoliumSourceDef) => (isSourceMod && options.register ? options.register(def) : refuse('sources.register')),
        supports: (id: string, version: number) => supportsFoliumCapability(id, version),
        error: createFoliumSourceError,
        pageStore: (sourceId: string) => {
            const make = options.pageStore;
            if (!isSourceMod || !make) return refuse('sources.pageStore');
            const hostId = hostIdOf(sourceId);
            if (!hostId) throw new Error(`sources.pageStore: "${sourceId}" is not a source of this mod's mod.json`);
            let store = stores.get(hostId);
            if (!store) {
                store = make(hostId);
                stores.set(hostId, store);
            }
            return store;
        },
    });
};
