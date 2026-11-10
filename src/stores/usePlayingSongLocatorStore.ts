import { create } from 'zustand';
import type { GridViewCollectionDescriptor } from '../components/app/home/gridViewCollectionAdapters';

// src/stores/usePlayingSongLocatorStore.ts
// What "locate the playing song" (components/app/playing-song-locator/playingSongLocator.ts) keeps between its steps:
//  - `source`: the collection whose page the queue was started from, with the songs that queue
//    was made of; null for a queue started anywhere else. It outlives a restart, as the queue does.
//    The service writes it once the player has taken a queue (`noteQueueStarted` there).
//  - `request`: the question waiting for a collection page to answer it. The page answers,
//    because only it knows its cards: a collection is read page by page, and the song may be in
//    a part that is still to arrive.
//  - `navigator`: the app's own navigation, which App hands over.
// The store reads no other store; the deciding is done in the service.

/** The collection whose page a song was played from, and the songs that queue was made of. */
export interface PlaybackSource {
    collection: GridViewCollectionDescriptor;
    songKeys: ReadonlySet<string>;
}

/** A question put to the page of one collection: show the card of this song. */
export interface LocateRequest {
    nonce: number;
    /** `collectionKey` of the collection whose page is asked; for the wall, its own key (lattice/wallLocate.ts). */
    collectionKey: string;
    songKey: string;
    /**
     * Whether the page waits for tracks that are still to come before it says no. A page opened
     * for the question does; a page asked by its own button answers from the cards it has.
     */
    waits: boolean;
}

/** How the locator moves between screens. */
export interface LocatorNavigator {
    navigateToHome: () => void;
    navigateToCollection: (collection: GridViewCollectionDescriptor, origin: 'home' | 'player') => void;
    pushCollection: (collection: GridViewCollectionDescriptor) => void;
}

const STORAGE_KEY = 'folia_playback_source';

const storage = (): Storage | null => (typeof localStorage === 'undefined' ? null : localStorage);

// What is stored may be of another version of the app, or not written by it at all.
const isDescriptor = (value: unknown): value is GridViewCollectionDescriptor => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const { source, type, id } = value as Record<string, unknown>;
    return typeof source === 'string' && typeof type === 'string' && (typeof id === 'string' || typeof id === 'number');
};

const recall = (): PlaybackSource | null => {
    try {
        const kept = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null') as { collection?: unknown; songKeys?: unknown } | null;
        if (!kept || !isDescriptor(kept.collection) || !Array.isArray(kept.songKeys)) return null;
        return { collection: kept.collection, songKeys: new Set(kept.songKeys.filter((key): key is string => typeof key === 'string')) };
    } catch {
        return null;
    }
};

const keep = (source: PlaybackSource | null): void => {
    try {
        if (source) storage()?.setItem(STORAGE_KEY, JSON.stringify({ collection: source.collection, songKeys: [...source.songKeys] }));
        else storage()?.removeItem(STORAGE_KEY);
    } catch {
        // Kept for the session. What storage still holds is of an earlier queue: none is better than that one.
        try { storage()?.removeItem(STORAGE_KEY); } catch { /* storage is out of reach */ }
    }
};

interface PlayingSongLocatorState {
    source: PlaybackSource | null;
    request: LocateRequest | null;
    navigator: LocatorNavigator | null;
    setNavigator: (navigator: LocatorNavigator | null) => void;
    /** The queue that plays was started with these songs on this page; null: on no collection's page. */
    setSource: (source: PlaybackSource | null) => void;
    setRequest: (request: LocateRequest | null) => void;
}

export const usePlayingSongLocatorStore = create<PlayingSongLocatorState>(set => ({
    source: recall(),
    request: null,
    navigator: null,
    setNavigator: navigator => set({ navigator }),
    setSource: source => {
        set({ source });
        keep(source);
    },
    setRequest: request => set({ request }),
}));
