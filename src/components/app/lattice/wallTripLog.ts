import { useLayoutEffect } from 'react';
import { collectionFlight } from '../../collectionFlight';
import { useAppViewStore } from '../../../stores/useAppViewStore';

// src/components/app/lattice/wallTripLog.ts
// One log line for every trip between the wall and a collection's page: how long after the press
// the navigation was committed, the first frame after it was on the screen, and the cover's
// flight began and landed. The stutter of this transition was reported by eye; these lines are
// the numbers the next report comes with.
//
// A trip begins at the press: the wall's Open button, or the page's Back (the moment the morph
// armed the flight back). Its line is written when the flight has landed, or some seconds after
// the press where no cover flew. The flight's two times are read off the morph's state
// (`carrier`, components/collectionFlight); the other two are marked from inside the wall (WallTripLog).

/** One trip's times, in ms from where it began. Null: it has not come. */
export interface WallTrip {
    way: 'open' | 'return';
    /** Whether it began at a press. A return through the mouse's back key or the browser's back
     * has no press that is known here: its times are from the navigation. */
    fromPress: boolean;
    committed: number | null;
    frame: number | null;
    takeoff: number | null;
    landing: number | null;
}

// A trip with no landing by then is written as it is: longer than a card may wait for its
// landing place (1.2 s) and fly (0.46 s).
const TRIP_DEADLINE_MS = 3000;

const at = (time: number | null, missing: string) => (time === null ? missing : `at ${time} ms`);

/** The trip's line. */
export const wallTripLine = (trip: WallTrip): string => {
    const flight = trip.takeoff === null
        ? 'no flight'
        : trip.landing === null ? `flight from ${trip.takeoff} ms, not landed` : `flight from ${trip.takeoff} to ${trip.landing} ms`;
    return `[Lattice] ${trip.way === 'open' ? 'Open from the wall' : 'Return to the wall'}: `
        + `committed ${at(trip.committed, 'never')}, first frame ${at(trip.frame, 'not seen')}, ${flight} `
        + `(${trip.fromPress ? 'from the press' : 'from the navigation: no press was seen'})`;
};

// The trip that has begun and is not written yet.
let underWay: { trip: WallTrip; since: () => number; close: () => void } | null = null;

/**
 * Begins a trip at `pressedAt` (a `performance.now()` time; null where no press is known, and
 * the trip begins now). One that has not been written yet is dropped: it was cut short, and its
 * line would be of no whole trip.
 */
export const beginWallTrip = (way: WallTrip['way'], pressedAt: number | null = performance.now()): void => {
    underWay?.close();
    const startedAt = pressedAt ?? performance.now();
    const trip: WallTrip = { way, fromPress: pressedAt !== null, committed: null, frame: null, takeoff: null, landing: null };
    const since = () => Math.round(performance.now() - startedAt);
    const close = () => {
        unsubscribe();
        clearTimeout(deadline);
        if (underWay?.trip === trip) underWay = null;
    };
    const write = () => {
        close();
        console.log(wallTripLine(trip));
    };
    // The carrier in the air is the flight; whatever it does next (it lands, or is cut off) is its end.
    const unsubscribe = collectionFlight().store.subscribe((state, before) => {
        if (state.carrier === before.carrier) return;
        if (state.carrier === 'flies') {
            trip.takeoff ??= since();
        } else if (before.carrier === 'flies') {
            trip.landing = since();
            write();
        }
    });
    const deadline = setTimeout(write, TRIP_DEADLINE_MS);
    underWay = { trip, since, close };
};

/** The navigation of the trip under way has been committed (called in that commit). */
const markWallTripCommitted = (): void => {
    const current = underWay;
    if (!current || current.trip.committed !== null) return;
    current.trip.committed = current.since();
    // Two frames on: the first paints the commit, and the second begins when that paint is done.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        current.trip.frame = current.since();
    }));
};

/**
 * Marks the navigations of a round trip from inside the wall, which is mounted in both; it draws
 * nothing. A component of its own: it renders when the view changes, and the wall is not to
 * render with it. `isReturn`: the wall is put up as the way back from a collection's page.
 */
export const WallTripLog = ({ isReturn }: { isReturn: boolean }): null => {
    // The way back begins here, in the commit that puts the wall up, and is dated back to the
    // press where the morph armed a flight back at one.
    useLayoutEffect(() => {
        if (!isReturn) return;
        const armedAt = collectionFlight().store.getState().exit?.armedAt;
        beginWallTrip('return', armedAt === undefined ? null : performance.now() - (Date.now() - armedAt));
        markWallTripCommitted();
    }, [isReturn]);

    // The way out (begun at the Open button): the commit that puts the page up. The wall is
    // still mounted in it, leaving. Home, which holds the page, comes a commit after the view
    // where it was fully hidden.
    const isPageUp = useAppViewStore(state => state.view === 'home' && !state.isHomeFullyHidden);
    useLayoutEffect(() => {
        if (isPageUp) markWallTripCommitted();
    }, [isPageUp]);

    return null;
};
