import { useRef } from 'react';
import { useIsPresent } from 'framer-motion';
import { useCollectionNavigationStore } from '../../../stores/useCollectionNavigationStore';
import { collectionKey } from '../home/gridViewCollectionAdapters';

// src/components/app/playing-song-locator/useNavigationPageKey.ts
// The page key a collection page is asked under (playingSongLocator.ts), for every suite that
// shows collection pages (the grid's GridCollectionSurface, the Bravais collection layer).

/**
 * The key the app's navigation knows the page on show by (the top of the navigation stack), which
 * "locate the playing song" asks pages by: the host's `collection` may be a refreshed copy with
 * another key (a local album takes the id of the entity it was merged into). A page that leaves
 * keeps the key it had.
 */
export const useNavigationPageKey = (): string | undefined => {
    const isPresent = useIsPresent();
    const key = useCollectionNavigationStore(state => {
        const top = state.snapshot?.stack[state.snapshot.stack.length - 1];
        return top ? collectionKey(top) : undefined;
    });
    const keptRef = useRef(key);
    if (isPresent) keptRef.current = key;
    return keptRef.current;
};
