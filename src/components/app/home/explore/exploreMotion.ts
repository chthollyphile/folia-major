import { useEffect, useRef } from 'react';
import type { Transition, Variants } from 'framer-motion';

// src/components/app/home/explore/exploreMotion.ts
// How the explore tab moves. One rule runs through it: a section's place and its heading stay
// where they are, and what the section holds comes and goes in its own place.
//  - A page seen for the first time: each section's heading is drawn (its title comes up from
//    under its line, its rule runs out to the row's buttons), and its pictures are uncovered from
//    the left one after another, each settling from a little larger and from grey while what is
//    written under it comes up. (The lines of a list, whose pictures are small, come up whole.)
//  - "Refresh": the entries shown wait, dimmed; once the next ones are read the old ones turn
//    away where they stand and the new ones turn in, as cards turned over, section after
//    section down the page, so that the page is never empty as a whole.
//  - "More": room for further entries opens at once, holding placeholders, and the entries
//    take those places when they are read.
// A picture is uncovered in 0.7 s and has its colours 0.3 s later, counted from its own turn
// (longer than the half second everything kept to before: it is the one thing here that is
// meant to be watched); an entry turns away quickly.
// With reduced motion (the app's own setting, `calm`) everything fades in place.

/** What a moving thing is told through `custom`. */
export interface Arrival {
    /** Its place among those arriving with it. */
    order: number;
    /** Seconds before the first of them starts. */
    base: number;
    /** Reduced motion: fade in place. */
    calm: boolean;
    /** A section joining a page that is already there: it opens its room before it shows. */
    late?: boolean;
    /** Such a section, joining after the page's last one: nothing stands under it, and its room is there at once. */
    last?: boolean;
    /** Part of a page come back to: it is where it rests from the start, and arrives from nowhere. */
    there?: boolean;
    /** Of a read that takes another one's place: it turns in where the entry before it turned away. */
    turns?: boolean;
}

// From one arriving entry to the next, and how many entries that goes on for.
const STEP = 0.034;
const MAX_STEPS = 9;
// An entry turning away: how long it takes, and how long after the one before it it starts.
const TURN_AWAY = 0.16;
const TURN_AWAY_STEP = 0.016;
/** How far an entry is turned when it cannot be seen, in degrees. */
const EDGE_ON = 90;
// From how far a card is looked at while it turns, in pixels. Far enough that the side of a wide
// card that comes forward grows by no more than the 8px of room its row leaves above it.
const DEPTH = 1800;
/** Seconds a picture takes to be uncovered. */
const UNCOVER = 0.7;
const EASE_IN = [0.4, 0, 1, 1] as const;
/** Quick to start and long to come to rest. */
const EASE_OUT = [0.2, 0.7, 0.2, 1] as const;
/** At rest after about 0.3 s, with the faintest overshoot. */
export const SETTLE: Transition = { type: 'spring', stiffness: 320, damping: 31, mass: 1 };
/** Slower: for what is large, and for room that opens or closes. */
export const SOFT: Transition = { type: 'spring', stiffness: 210, damping: 27, mass: 1 };
const FADE: Transition = { duration: 0.14, ease: 'linear' };

const wait = ({ order, base }: Arrival) => base + Math.min(order, MAX_STEPS) * STEP;
const arriving = (arrival: Arrival, spring: Transition = SETTLE): Transition => (arrival.calm
    ? { ...FADE, delay: arrival.base }
    : { ...spring, delay: wait(arrival), opacity: { duration: 0.18, ease: 'easeOut', delay: wait(arrival) } });
/** Whether something of an entry is where it rests from the start: nothing of it is drawn in. */
const rests = ({ calm, there, turns }: Arrival) => Boolean(calm || there || turns);

// What holds a section's entries. It is told how long they wait before they leave (`custom`, in
// seconds: `sectionLeave`), and has them leave one after another from then on, in the order they
// stand in. The wait is handed to each entry as its delay: an entry that named a delay of its own
// in `gone` would leave by that one instead, and every section would empty at the same moment.
export const BODY: Variants = {
    gone: (delay: number) => ({ transition: { delayChildren: (place: number) => delay + Math.min(place, MAX_STEPS) * TURN_AWAY_STEP } }),
};

type Axis = 'x' | 'y';
const about = (axis: Axis, degrees: number) => (axis === 'x' ? { rotateX: degrees } : { rotateY: degrees });

// An entry as a whole. It is there in its place (from a little lower, with `rise`) while its
// picture is uncovered; where a read takes another one's place it turns about `axis`, away and in.
// When it leaves is its body's to say (`BODY`), which is why `gone` names no delay; with reduced
// motion it names one, of nothing: the entries then fade together.
const entry = (axis: Axis, spring: Transition, rise = 0): Variants => ({
    away: ({ calm, there, turns }: Arrival) => (there ? { opacity: 1, y: 0, ...about(axis, 0) }
        : calm ? { opacity: 0 }
            : turns ? { opacity: 0, ...about(axis, -EDGE_ON) }
                : { opacity: 0, y: rise }),
    here: (arrival: Arrival) => ({ opacity: 1, y: 0, ...about(axis, 0), transition: arriving(arrival, spring) }),
    gone: ({ calm }: Arrival) => (calm
        ? { opacity: 0, transition: { ...FADE, delay: 0 } }
        : { opacity: 0, ...about(axis, EDGE_ON), transition: { duration: TURN_AWAY, ease: EASE_IN } }),
});

/**
 * How a card is looked at while it turns about its upright axis: from `DEPTH` away, straight at
 * its own middle, so that turned a quarter it is seen edge-on. The `transformTemplate` of the
 * entries that turn so. Only while the entry is moved at all: at rest it has no transform.
 * (What turns about its level axis, a line or a band, is looked at from no distance: the side of
 * it that came forward would be wider than the room its list leaves beside it.)
 */
export const fromAfar = (_: unknown, moved: string): string => (moved && moved !== 'none' ? `perspective(${DEPTH}px) ${moved}` : 'none');

/** A picture of a row: it turns as a card does, about its upright axis. */
export const TILE = entry('y', SETTLE);
/** A line of a list: up into place, and turned as a flap is, about its level axis. */
export const LINE = entry('x', SETTLE, 14);
/** The large entry that opens the page. */
export const LARGE = entry('y', SOFT);
/** A section's single entry, as a band. */
export const BAND = entry('x', SOFT);

/** An entry's picture: uncovered from the left, settling from a little larger and from grey. */
export const PICTURE: Variants = {
    away: (arrival: Arrival) => (rests(arrival) ? {} : { clipPath: 'inset(0% 100% 0% 0%)', scale: 1.25, filter: 'grayscale(1)' }),
    here: (arrival: Arrival) => (rests(arrival) ? {} : {
        clipPath: 'inset(0% 0% 0% 0%)',
        scale: 1,
        filter: 'grayscale(0)',
        transition: { duration: UNCOVER, ease: EASE_OUT, delay: wait(arrival), filter: { duration: UNCOVER + 0.3, ease: 'easeOut', delay: wait(arrival) } },
        // (Left as they were found: a picture at rest is neither clipped nor filtered.)
        transitionEnd: { clipPath: 'none', filter: 'none' },
    }),
};

/** What is written under a picture: it comes up while the picture is uncovered. */
export const CAPTION: Variants = {
    away: (arrival: Arrival) => (rests(arrival) ? {} : { opacity: 0, y: 8 }),
    here: (arrival: Arrival) => (rests(arrival) ? {} : { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT, delay: wait(arrival) + 0.18 } }),
};

/** A section's title: it comes up from under its own line (the heading cuts it off there). */
export const TITLE: Variants = {
    away: ({ calm }: Arrival) => (calm ? {} : { y: '110%' }),
    here: (arrival: Arrival) => (arrival.calm ? {} : { y: '0%', transition: { duration: 0.6, ease: EASE_OUT, delay: wait(arrival) } }),
};

/** The rule after a section's title: it runs out from the title to the row's buttons. */
export const RULE: Variants = {
    away: ({ calm }: Arrival) => (calm ? {} : { scaleX: 0 }),
    here: (arrival: Arrival) => (arrival.calm ? {} : { scaleX: 1, transition: { duration: 0.8, ease: EASE_OUT, delay: wait(arrival) + 0.1 } }),
};

/** Whether a section opens its room: it joins a page already there, among its sections. */
const opens = ({ late, last }: Arrival) => Boolean(late && !last);

// A section. It shows with its page, in its place; joining a page already there, or leaving one,
// it opens or closes its room. (One that joins after the last section opens none: the list would
// first lose the height of what stood at its end, the mark that more is being read, and the
// listener standing there would be moved up and back.)
export const SECTION: Variants = {
    away: (arrival: Arrival) => (opens(arrival) ? { opacity: 0, height: 0, overflow: 'clip' } : { opacity: 0 }),
    here: (arrival: Arrival) => (opens(arrival)
        ? { opacity: 1, height: 'auto', transition: arrival.calm ? { duration: 0 } : { ...SOFT, opacity: { duration: 0.3, delay: 0.12 } }, transitionEnd: { overflow: 'visible' } }
        : { opacity: 1, transition: arrival.calm ? { ...FADE, delay: arrival.base } : { duration: 0.3, ease: 'easeOut', delay: wait(arrival) } }),
    gone: ({ calm }: Arrival) => ({ opacity: 0, height: 0, overflow: 'clip', transition: calm ? { duration: 0 } : { ...SOFT, opacity: { duration: TURN_AWAY } } }),
};

/** Seconds a section waits for those before it: its entries start with it. */
export const sectionBase = (order: number, calm: boolean): number => (calm ? 0 : Math.min(order, 6) * 0.06);

/** Seconds a section's entries wait before they leave for the ones of the next read: the sections empty one after another down the page, each filling again as soon as it is empty. */
export const sectionLeave = (order: number, calm: boolean): number => (calm ? 0 : Math.min(order, 6) * 0.05);

/** Arriving alone and at once. */
export const atOnce = (calm: boolean): Arrival => ({ order: 0, base: 0, calm });

// What each of `keys` is told when it arrives: its place among the keys that came with it. The
// ones of the first render count from the first of them and wait `base`; the ones a later
// render brings count from the first of those and wait `laterBase`. A key keeps what it was
// told for as long as it stays, wherever it is moved; one that left and comes back arrives anew.
// With `there`, the ones of the first render are of a page come back to and arrive from nowhere;
// with `turns`, they take the place of another read's and turn in.
export const useArrivals = (keys: string[], base: number, calm: boolean, laterBase = 0, there = false, turns = false): ((key: string) => Arrival) => {
    const told = useRef<Map<string, Arrival> | null>(null);
    const before = told.current;
    const now = new Map<string, Arrival>();
    let arrivals = 0;
    for (const key of keys) {
        now.set(key, before?.get(key) ?? (before ? { order: arrivals++, base: calm ? 0 : laterBase, calm } : { order: arrivals++, base, calm, there, turns }));
    }
    told.current = now;
    return key => now.get(key) ?? atOnce(calm);
};

// Calls `reveal` when a body is asked to grow at its end: when the places held for further
// entries appear, or, where nothing had to be read first, when entries are added after the
// ones there were. It is given how many entries the body held before: the first new place is
// the one after them. Entries that take the places held for them move nothing, and neither
// does an entry that joins at the front (a song just played): the listener did not ask for it.
// Neither does a body first shown while its further entries are being read: they were asked
// for before it was there (the home screen was taken down meanwhile), and it is shown where it was left.
// With `heldOnly`, only the places held count: for a body that entries also join at its end unasked.
export const useRevealGrowth = (keys: string[], isLoadingMore: boolean, reveal: (before: number) => void, heldOnly = false): void => {
    const seen = useRef({ keys, wasLoading: isLoadingMore });
    useEffect(() => {
        const { keys: before, wasLoading } = seen.current;
        seen.current = { keys, wasLoading: isLoadingMore };
        const grewAtItsEnd = !heldOnly && keys.length > before.length && keys[before.length - 1] === before[before.length - 1];
        if (!wasLoading && (isLoadingMore || grewAtItsEnd)) reveal(before.length);
    });
};
