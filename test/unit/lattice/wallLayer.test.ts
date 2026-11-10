import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisualizerAroundWall, wallExitCompleted, wallIsLeftForPage } from '../../../src/components/app/lattice/wallLayer';
import { useCollectionMorphStore } from '../../../src/library/suites/grid/transitions/collectionMorphStore';
import type { CollectionMorphExit } from '../../../src/library/suites/grid/transitions/morphGeometry';
import { useAppViewStore } from '../../../src/stores/useAppViewStore';
import { MOTION_SURFACE_IDS, useMotionSettingsStore } from '../../../src/stores/useMotionSettingsStore';

// test/unit/lattice/wallLayer.test.ts
// For how long the wall counts as being left for a collection's page. It is asked again long
// after the press: by a home put up for whatever page, by a wall that leaves for the player. An
// answer that outlasts its moment shows as nothing but a home grid missing under a page, or a
// wall that leaves without its wave.
// And when the visualizer is mounted, around a wall: the wall covers it and it is taken down
// meanwhile. A wrong moment shows as the theme's background there, or gone, in one frame.

/** The wall's Open button: what the wall writes in the store before it navigates. */
const pressOpen = () => {
    useAppViewStore.getState().setLatticeReturnTileId('album-7');
    useAppViewStore.getState().setIsLatticeLeftForPage(true);
};

const goTo = (view: 'home' | 'player' | 'lattice') => useAppViewStore.getState().setView(view);

const FLIGHT_BACK: CollectionMorphExit = {
    from: { rect: { x: 300, y: 200, width: 536, height: 400 }, radius: 0, url: 'page-cover.jpg', proportions: 1, frame: null, title: null },
    sourceKey: 'lattice:album-7',
    nested: false,
    armedDepth: 1,
    armedAt: 1,
};

/** The page's Back button: the flight of its cover back to the wall is armed, then the wall is put up. */
const pressBack = () => {
    useCollectionMorphStore.setState({ exit: FLIGHT_BACK });
    goTo('lattice');
};

const setWallMotionReduced = (isReduced: boolean) => useMotionSettingsStore.setState({
    reducedMotionSurfaces: {
        ...Object.fromEntries(MOTION_SURFACE_IDS.map(surface => [surface, false])),
        lattice: isReduced,
    } as Record<(typeof MOTION_SURFACE_IDS)[number], boolean>,
    followSystemReducedMotion: false,
});

const visualizer = () => useVisualizerAroundWall.getState();
const after = (ms: number) => vi.advanceTimersByTime(ms);

/** A wall put up from the home screen, with nothing left over from an earlier one. */
const putUpWall = () => {
    goTo('lattice');
    useAppViewStore.getState().setLatticeReturnTileId(null);
};

/** The wall is left for a collection's page, and its exit (180 ms) is over. */
const openPageFromWall = () => {
    putUpWall();
    pressOpen();
    goTo('home');
    after(180);
    wallExitCompleted();
};

// The home screen, no wall on the screen, the visualizer up; every time in fake milliseconds.
// The rule logs each time it takes the visualizer down or puts it back: not into the test run.
beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    setWallMotionReduced(false);
    useCollectionMorphStore.setState({ exit: null });
    useAppViewStore.setState({ view: 'home', latticeReturnTileId: null, isLatticeLeftForPage: false });
    vi.clearAllTimers();
    useVisualizerAroundWall.setState({ isUp: true, fadesIn: false, hasWallLeft: true });
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    useCollectionMorphStore.setState({ exit: null });
    setWallMotionReduced(false);
});

describe('the wall is left for a collection\'s page', () => {
    beforeEach(() => {
        useAppViewStore.setState({ view: 'lattice', latticeReturnTileId: null, isLatticeLeftForPage: false });
    });

    it('from the press, and on into the view the page is put up in', () => {
        expect(wallIsLeftForPage()).toBe(false);

        pressOpen();
        goTo('home');

        expect(wallIsLeftForPage()).toBe(true);
    });

    it('no longer once the app has gone on to the player, whatever page it comes back to', () => {
        pressOpen();
        goTo('home');

        goTo('player');
        expect(wallIsLeftForPage()).toBe(false);
        goTo('home');
        expect(wallIsLeftForPage()).toBe(false);
        // The tile the wall is to open on again is kept all the while: it does not say it.
        expect(useAppViewStore.getState().latticeReturnTileId).toBe('album-7');
    });

    it('no longer once a wall is up again: the same wall, come back to while it was leaving, still has its tile', () => {
        pressOpen();
        goTo('home');

        goTo('lattice');

        expect(wallIsLeftForPage()).toBe(false);
        expect(useAppViewStore.getState().latticeReturnTileId).toBe('album-7');
    });
});

describe('the visualizer, around a wall', () => {
    it('is up where no wall is, and goes in the frame a wall is put up in', () => {
        expect(visualizer()).toEqual({ isUp: true, fadesIn: false, hasWallLeft: true });

        putUpWall();

        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
        after(60_000);
        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
    });

    it.each(['home', 'player'] as const)('is put back, with no fade, in the frame the wall begins to leave in for the %s view', (view) => {
        putUpWall();

        goTo(view);

        // Under the wall, which is on the screen for the 620 ms of its exit.
        expect(visualizer()).toEqual({ isUp: true, fadesIn: false, hasWallLeft: false });
        after(620);
        expect(visualizer()).toEqual({ isUp: true, fadesIn: false, hasWallLeft: false });
        wallExitCompleted();
        expect(visualizer()).toEqual({ isUp: true, fadesIn: false, hasWallLeft: true });
        after(60_000);
        expect(visualizer()).toEqual({ isUp: true, fadesIn: false, hasWallLeft: true });
    });

    it('stays down through the exit of a wall left for a page and through that page\'s entrance, and comes up in a fade 900 ms after the exit', () => {
        putUpWall();
        pressOpen();
        goTo('home');

        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
        after(180);
        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
        wallExitCompleted();
        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: true });

        after(899);
        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: true });
        expect(wallIsLeftForPage()).toBe(true);

        after(1);
        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: true });
        expect(wallIsLeftForPage()).toBe(false);
    });

    it('comes up after that entrance with no fade where the wall\'s motion is reduced', () => {
        setWallMotionReduced(true);
        openPageFromWall();

        after(899);
        expect(visualizer().isUp).toBe(false);
        after(1);

        expect(visualizer()).toEqual({ isUp: true, fadesIn: false, hasWallLeft: true });
    });

    it('is back at once, in a fade, where the app goes on to the player during the page\'s entrance', () => {
        openPageFromWall();
        after(300);

        goTo('player');

        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: true });
        // The end of the entrance, 600 ms on, has nothing left to do.
        after(60_000);
        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: true });
    });

    it('is back at once, in a fade, under a wall that is still leaving for a page, where the app goes on to the player', () => {
        putUpWall();
        pressOpen();
        goTo('home');
        after(100);

        goTo('player');

        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: false });
        after(80);
        wallExitCompleted();
        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: true });
        after(60_000);
        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: true });
    });

    it('stays for 500 ms under a wall that fades in over the page it is come back to, then goes', () => {
        openPageFromWall();
        after(900);
        expect(visualizer().isUp).toBe(true);

        pressBack();

        // As it came up, the fade's class still on it: taking that off would end a fade under way.
        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: false });
        after(499);
        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: false });
        after(1);
        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
    });

    it('goes at once where the wall come back to does not fade in: no flight back is armed', () => {
        openPageFromWall();
        after(900);

        goTo('lattice');

        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
    });

    it('goes at once where the wall come back to does not fade in: its motion is reduced', () => {
        openPageFromWall();
        after(900);
        setWallMotionReduced(true);

        pressBack();

        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
    });

    it('goes at once where a wall is put up anew, though a flight back is still armed', () => {
        useCollectionMorphStore.setState({ exit: FLIGHT_BACK });

        putUpWall();

        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
    });

    it('stays down where the wall is come back to during the page\'s entrance, and the entrance\'s end no longer puts it back', () => {
        openPageFromWall();
        after(300);

        pressBack();

        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
        expect(wallIsLeftForPage()).toBe(false);
        after(60_000);
        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
    });

    it('stays up where the wall is left again before it has covered it', () => {
        openPageFromWall();
        after(900);
        pressBack();
        after(200);

        goTo('home');

        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: false });
        // The 500 ms of the wall that was to cover it run out with nothing to do.
        after(300);
        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: false });
        after(320);
        wallExitCompleted();
        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: true });
    });

    it('stays up, and the page\'s entrance is still given its time, where a wall that had not covered it is left for a page', () => {
        openPageFromWall();
        after(900);
        pressBack();
        after(200);

        pressOpen();
        goTo('home');
        after(180);
        wallExitCompleted();

        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: true });
        expect(wallIsLeftForPage()).toBe(true);
        after(900);
        expect(visualizer()).toEqual({ isUp: true, fadesIn: true, hasWallLeft: true });
        expect(wallIsLeftForPage()).toBe(false);
    });

    it('does not count a wall as gone whose exit is over while a wall is up again', () => {
        putUpWall();
        goTo('home');
        after(100);

        goTo('lattice');
        wallExitCompleted();

        expect(visualizer()).toEqual({ isUp: false, fadesIn: false, hasWallLeft: false });
    });
});
