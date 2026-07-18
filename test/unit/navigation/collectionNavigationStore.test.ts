import { beforeEach, describe, expect, it } from 'vitest';
import { useCollectionNavigationStore } from '@/stores/useCollectionNavigationStore';

// Verifies collection details preserve their origin while nesting GridView destinations.

describe('useCollectionNavigationStore', () => {
    beforeEach(() => {
        useCollectionNavigationStore.getState().clear();
    });

    it('opens a search-origin collection and preserves the origin across nested details', () => {
        useCollectionNavigationStore.getState().openRoot({
            source: 'online',
            providerId: 'netease',
            id: 1,
            name: 'Album',
            type: 'album',
        }, 'search');

        useCollectionNavigationStore.getState().push({
            source: 'online',
            providerId: 'netease',
            id: 2,
            name: 'Artist',
            type: 'artist',
        });

        expect(useCollectionNavigationStore.getState().snapshot).toEqual({
            origin: 'search',
            stack: [
                expect.objectContaining({ id: 1, type: 'album' }),
                expect.objectContaining({ id: 2, type: 'artist' }),
            ],
        });
    });

    it('restores and clears a player-origin navigation snapshot', () => {
        useCollectionNavigationStore.getState().restore({
            origin: 'player',
            stack: [{
                source: 'navidrome',
                id: 'album-1',
                name: 'Album',
                type: 'album',
            }],
        });

        expect(useCollectionNavigationStore.getState().snapshot?.origin).toBe('player');
        useCollectionNavigationStore.getState().clear();
        expect(useCollectionNavigationStore.getState().snapshot).toBeNull();
    });
});
