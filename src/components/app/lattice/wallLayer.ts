import { create } from 'zustand';
import type { Variants } from 'framer-motion';
import { useAppViewStore } from '../../../stores/useAppViewStore';
import { readReducedMotion } from '../../../stores/useMotionSettingsStore';
import { isFlightBackArmed } from './wallFlight';

// src/components/app/lattice/wallLayer.ts
// The layer App puts the wall up in: how it leaves the screen, and when the visualizer, which is
// away while the wall covers it, is taken down and put back. App needs this from its first
// render; the wall's own code is loaded when the wall is first opened, and this file takes
// nothing from it.

/**
 * Whether the wall is being left for a collection's page (the Open button of its grown tile),
 * and not for the player or the home screen. Known from the press on: the wall says so in the
 * store before the navigation. It is so until that page has made its entrance
 * (wallExitCompleted), and the store ends it where the app leaves the page's view first.
 */
export const wallIsLeftForPage = (): boolean => useAppViewStore.getState().isLatticeLeftForPage;

// Left for the player or the home screen, the wall fades for as long as its posters take to
// leave in their wave (PosterWall). Left for a collection's page it is out of the way in a
// moment: the page comes up under it, and a cover is in flight from its tile to that page.
const WALL_FADE_SECONDS = 0.62;
const WALL_FADE_FOR_PAGE_SECONDS = 0.18;

/**
 * The layer's exit, as a dynamic variant: framer resolves it when the exit runs, and what the
 * wall is left for is known in no render before that one. Its `custom` is the wall's
 * reduced-motion setting.
 */
export const WALL_LAYER: Variants = {
    gone: (reducedMotion: boolean) => ({
        opacity: 0,
        transition: wallIsLeftForPage()
            ? { duration: reducedMotion ? 0 : WALL_FADE_FOR_PAGE_SECONDS, ease: 'easeOut' }
            : { duration: reducedMotion ? 0 : WALL_FADE_SECONDS, ease: 'easeIn' },
    }),
};

// How long after the wall has left for a collection's page the visualizer is put back. By then
// the cover has landed and handed over (0.46 s and 0.14 s, morphFlight.ts) and the cards of a
// page whose tracks were at hand have come in (up to 0.32 s late, 0.5 s each).
const VISUALIZER_AFTER_PAGE_ENTRANCE_MS = 900;

// How long a wall that fades in over a collection's page has the visualizer under it. The fade
// lasts 200 ms (Lattice.css, `lattice-return`) and starts with the wall's first frame, which
// comes after the wall's first render: that render is given 300 ms. Under a wall that covers
// it, the visualizer may go at any time.
const WALL_COVERS_PAGE_MS = 500;

/**
 * Whether a wall that is being put up fades in over the page under it, as the wall decides it
 * for itself when it mounts (Lattice.tsx, `fadesIn`): it is come back to from a collection's
 * page, that page's cover is to fly back to it, and its motion is not reduced. Any other wall
 * covers what is under it from its first frame.
 */
const wallFadesInOverPage = (): boolean => (
    useAppViewStore.getState().latticeReturnTileId !== null
    && isFlightBackArmed()
    && !readReducedMotion('lattice')
);

export type VisualizerAroundWall = {
    /** Whether the visualizer is mounted. */
    isUp: boolean;
    /** Whether it has come up in a fade (index.css, `visualizer-comes-up`), and not in one frame. */
    fadesIn: boolean;
    /** Whether the wall is off the screen: none is up, and the exit of the last one is over. */
    hasWallLeft: boolean;
};

/**
 * When the visualizer is mounted, around a wall. A wall covers it, and it is taken down for as
 * long. It is never to come or go in one frame where that shows:
 * - A wall is put up: the visualizer goes in that frame, the wall's first, which covers it.
 *   Under a wall that fades in over a page (wallFadesInOverPage) it stays until that wall
 *   covers it.
 * - The wall is left for the player or the home screen: the visualizer is put back in the frame
 *   the wall begins to leave in, and the wall fades from over it.
 * - The wall is left for a collection's page: the wall has left in a moment, while that page's
 *   entrance has only begun. The visualizer is put back after the entrance and not into it, and
 *   comes up under the page in a fade (none with the wall's motion reduced). It waits for as
 *   long as the wall counts as being left for a page (wallIsLeftForPage): wallExitCompleted
 *   ends that when the entrance is over, and the store ends it sooner where the app goes on to
 *   the player, which has the visualizer back then, in a fade as well.
 * A store, and not state of App: what it holds changes with the view, in the same render.
 */
export const useVisualizerAroundWall = create<VisualizerAroundWall>(() => {
    const isWallUp = useAppViewStore.getState().view === 'lattice';
    return { isUp: !isWallUp, fadesIn: false, hasWallLeft: !isWallUp };
});

let coverTimer: ReturnType<typeof setTimeout> | undefined;
let entranceTimer: ReturnType<typeof setTimeout> | undefined;

/** One log line each time the visualizer is taken down, kept or put back: which rule did it. */
const report = (what: string) => console.log(`[Lattice] Visualizer ${what}`);

// The rule itself: what a change of the view, or the end of a page's entrance, does to the
// visualizer. Told by the store the view is in, so that both change in one render.
useAppViewStore.subscribe((app, before) => {
    const { isUp } = useVisualizerAroundWall.getState();
    if (app.view === 'lattice') {
        if (before.view === 'lattice') return;
        // A wall is put up. No page's entrance is waited for any more.
        clearTimeout(entranceTimer);
        if (isUp && wallFadesInOverPage()) {
            useVisualizerAroundWall.setState({ hasWallLeft: false });
            report(`kept for ${WALL_COVERS_PAGE_MS} ms under a wall that fades in over a page`);
            coverTimer = setTimeout(() => {
                useVisualizerAroundWall.setState({ isUp: false, fadesIn: false });
                report('taken down: the wall that faded in over a page covers it');
            }, WALL_COVERS_PAGE_MS);
        } else {
            useVisualizerAroundWall.setState({ isUp: false, fadesIn: false, hasWallLeft: false });
            if (isUp) report('taken down: a wall is put up and covers it from its first frame');
        }
        return;
    }
    // The wall is left: a visualizer it had not covered yet stays.
    if (before.view === 'lattice') clearTimeout(coverTimer);
    if (isUp || app.isLatticeLeftForPage) return;
    // In a view that has not changed, what puts it back is the end of a page's entrance.
    const isAfterEntrance = app.view === before.view;
    // Put back as the wall begins to leave, it has the whole wall over it and needs no fade of
    // its own. Anywhere else nothing covers it for sure (a page's entrance is over, or the app
    // has gone on from that page to the player): it comes up in a fade.
    const fadesIn = before.view !== 'lattice' && !readReducedMotion('lattice');
    useVisualizerAroundWall.setState({ isUp: true, fadesIn });
    const why = isAfterEntrance
        ? 'the entrance of the page the wall was left for is over'
        : before.view === 'lattice'
            ? `the wall begins to leave for the ${app.view} view, and fades from over it`
            : `the app has gone on to the ${app.view} view`;
    report(`put back ${fadesIn ? 'in a fade' : 'in one frame'}: ${why}`);
});

/**
 * What the wall's layer calls when its exit is over: the wall is off the screen, unless one has
 * been put up again meanwhile. Where it was left for a collection's page, that page's entrance
 * is given its time from here on, and the wall then no longer counts as being left for a page.
 */
export const wallExitCompleted = (): void => {
    clearTimeout(entranceTimer);
    useVisualizerAroundWall.setState({ hasWallLeft: useAppViewStore.getState().view !== 'lattice' });
    if (wallIsLeftForPage()) {
        if (!useVisualizerAroundWall.getState().isUp) {
            report(`stays down for ${VISUALIZER_AFTER_PAGE_ENTRANCE_MS} ms more: the wall was left for a page, which makes its entrance`);
        }
        entranceTimer = setTimeout(
            () => useAppViewStore.getState().setIsLatticeLeftForPage(false),
            VISUALIZER_AFTER_PAGE_ENTRANCE_MS,
        );
    }
};
