import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planPageFromWallTile, useCollectionMorphStore } from '../../../src/library/suites/grid/transitions/collectionMorphStore';
import type { CollectionMorphCapture } from '../../../src/library/suites/grid/transitions/morphProbes';
import type { CollectionMorphPending } from '../../../src/library/suites/grid/transitions/morphGeometry';
import { useCollectionNavigationStore } from '../../../src/stores/useCollectionNavigationStore';

// test/unit/lattice/wallFlight.test.ts
// What the wall leaves in the morph store at the press that opens a collection's page (the grid's
// planPageFromWallTile, which the wall reaches through components/collectionFlight): the page
// reads its plan from there at its first render, and the morph overlay starts the cover's flight
// from the capture. Nothing of it shows when it is wrong but a page that comes up the old way.

const tile = (): CollectionMorphCapture => ({
    rect: { x: 300, y: 200, width: 536, height: 400 },
    radius: 0,
    url: 'tile-cover.jpg',
    proportions: 1,
    frame: null,
    title: null,
    sourceKey: 'lattice:album-7',
});

/** A card of the home screen that an earlier open of some collection flew from. */
const homeCard = { ...tile(), sourceKey: 'grid3d:2', navAtGestureStart: { wasOpen: false, depth: 0 }, capturedAt: 1 } as CollectionMorphPending;

const planAt = (depth: number) => {
    const { plan, planDepth } = useCollectionMorphStore.getState();
    return planDepth === depth ? plan : null;
};

describe('the wall opens a collection\'s page', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useCollectionMorphStore.getState().clear();
        useCollectionNavigationStore.setState({ snapshot: null });
    });

    afterEach(() => {
        useCollectionMorphStore.getState().clear();
        vi.useRealTimers();
    });

    it('makes its tile the clicked card, and the page\'s plan the morph with the tile\'s cover', () => {
        planPageFromWallTile(tile(), true);

        const { pending } = useCollectionMorphStore.getState();
        expect(pending).toMatchObject({ sourceKey: 'lattice:album-7', url: 'tile-cover.jpg', navAtGestureStart: { wasOpen: false, depth: 0 } });
        // The page that opens from the wall is the first of its navigation.
        expect(planAt(1)).toEqual({ kind: 'morph', coverUrl: 'tile-cover.jpg', title: null });
    });

    it('plans the cascade alone where the tile has no cover to fly, and remembers no card to fly back to', () => {
        useCollectionMorphStore.setState({ lastHome: homeCard, lastHomeRoot: 'some-collection' });

        planPageFromWallTile(null, true);

        expect(useCollectionMorphStore.getState().pending).toBeNull();
        expect(planAt(1)).toEqual({ kind: 'cascade' });
        expect(useCollectionMorphStore.getState()).toMatchObject({ lastHome: null, lastHomeRoot: '' });
    });

    it('makes no plan with motion reduced, and remembers no card to fly back to', () => {
        useCollectionMorphStore.setState({ lastHome: homeCard, lastHomeRoot: 'some-collection' });

        planPageFromWallTile(null, false);

        expect(useCollectionMorphStore.getState()).toMatchObject({ pending: null, plan: null, lastHome: null });
    });
});
