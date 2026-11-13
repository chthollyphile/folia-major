import type { OnlineProviderId } from '../../types/onlineMusic';

// src/services/onlineMusic/sourceDeclarations.ts
// What a source declares for the features that ask a platform other than the song's own (Folium 2.0 plan §4.7):
// whether its search, its songs and its lyrics need an account, whether its lyrics can go to other songs
// (`lyrics@1.crossSource`) and whether it gives local songs online details (`songs@1.metadataMatch`).
// A Folium 2 source mod's declarations come from its capabilities (the adapter in
// src/mods/folium/registries/sources.ts writes them here); the built-in platforms, still registered by the
// host, declare nothing here and are read from the tables they always were (the lyric source registry,
// `capabilities.auth`). crossSource.ts and sourceStates.ts read this; it imports nothing at run time.

export type SourceDeclaredAccess = 'anonymous' | 'account';

export interface SourceDeclaration {
    /** `search@1` is there, with its access. */
    search?: { access: SourceDeclaredAccess };
    /** `songs@1` is there, with its access; `metadataMatch` when it gives local songs online details. */
    songs?: { access: SourceDeclaredAccess; metadataMatch: boolean };
    /** `lyrics@1` is there, with its access; `crossSource` when its lyrics can go to other songs. */
    lyrics?: { access: SourceDeclaredAccess; crossSource: { linesOnly: boolean } | null };
    /** The source's getAvailability is to be asked before it takes part. */
    checksAvailability: boolean;
}

const declarations = new Map<OnlineProviderId, SourceDeclaration>();
const listeners = new Set<() => void>();

const announce = () => listeners.forEach((listener) => {
    try {
        listener();
    } catch (error) {
        console.warn('[sourceDeclarations] a listener failed', error);
    }
});

/** Declares (or declares anew, in place) what `sourceId` does; returns the function that takes it back. */
export const declareSource = (sourceId: OnlineProviderId, declaration: SourceDeclaration): (() => void) => {
    const frozen = Object.freeze({ ...declaration });
    declarations.set(sourceId, frozen);
    announce();
    return () => {
        if (declarations.get(sourceId) !== frozen) return;
        declarations.delete(sourceId);
        announce();
    };
};

/** What `sourceId` declared; undefined for a source that declared nothing (a built-in platform, one not there). */
export const getSourceDeclaration = (sourceId: OnlineProviderId): SourceDeclaration | undefined => declarations.get(sourceId);

/** The sources that declared, in the order they first did. */
export const listSourceDeclarations = (): Array<[OnlineProviderId, SourceDeclaration]> => Array.from(declarations.entries());

/** Calls `listener` after every change; returns the function that stops it. */
export const subscribeSourceDeclarations = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
