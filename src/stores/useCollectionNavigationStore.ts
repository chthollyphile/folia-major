import { create } from 'zustand';
import type { GridViewCollectionDescriptor } from '../components/app/home/gridViewCollectionAdapters';

// src/stores/useCollectionNavigationStore.ts

export type CollectionNavigationOrigin = 'home' | 'search' | 'player';

export type CollectionNavigationSnapshot = {
    origin: CollectionNavigationOrigin;
    stack: GridViewCollectionDescriptor[];
};

type CollectionNavigationState = {
    snapshot: CollectionNavigationSnapshot | null;
    openRoot: (collection: GridViewCollectionDescriptor, origin: CollectionNavigationOrigin) => CollectionNavigationSnapshot;
    push: (collection: GridViewCollectionDescriptor) => CollectionNavigationSnapshot | null;
    restore: (snapshot: CollectionNavigationSnapshot | null) => void;
    clear: () => void;
};

export const useCollectionNavigationStore = create<CollectionNavigationState>((set, get) => ({
    snapshot: null,
    openRoot: (collection, origin) => {
        const snapshot = { origin, stack: [collection] };
        set({ snapshot });
        return snapshot;
    },
    push: (collection) => {
        const current = get().snapshot;
        if (!current) {
            return null;
        }
        const snapshot = {
            ...current,
            stack: [...current.stack, collection],
        };
        set({ snapshot });
        return snapshot;
    },
    restore: (snapshot) => set({ snapshot }),
    clear: () => set({ snapshot: null }),
}));

export const getActiveGridViewCollection = (
    snapshot: CollectionNavigationSnapshot | null,
): GridViewCollectionDescriptor | null => snapshot?.stack[snapshot.stack.length - 1] || null;
