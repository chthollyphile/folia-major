// src/services/automix/transitionCue.ts
// Announces to the screen that a transition is happening, and its shape.
//
// A channel rather than a port on `createAutomixSession`: the audience is a decorative overlay far
// from the decks, and threading a port through would re-render App on every song change just to feed
// a component that draws a circle.
//
// Announced, and the one in flight is also recorded. The announcement is still the primary thing -
// nobody polls this - but there are now two renderers for one blend (the full-screen ring and the
// now playing card's border), and which of them is on screen can change mid-blend: navigating between
// home and the lyrics page, or flipping the card's own setting, unmounts one and mounts the other. A
// renderer that arrives mid-blend and can only wait for the next announcement draws nothing for the
// rest of the transition, which reads as the animation being broken. So a late arrival can ask what
// is in flight, and how far in - see `getActiveTransitionCue`.

export interface TransitionCue {
    /** Wall-clock seconds from the announcement until the blend is over. */
    seconds: number;
    /** Where in those seconds the two tracks change places, 0..1. */
    crossover: number;
    /** Wall-clock seconds per beat of the outgoing track, or null when nothing measured a tempo. */
    periodSec: number | null;
}

/** A blend already under way, as a renderer mounting mid-transition needs to see it. */
export interface ActiveTransitionCue {
    cue: TransitionCue;
    /** Milliseconds since it was announced. Where to start drawing from. */
    elapsedMs: number;
}

type TransitionCueListener = (cue: TransitionCue | null) => void;

const listeners = new Set<TransitionCueListener>();

/** The blend in flight and when it was announced, or null between transitions. */
let active: { cue: TransitionCue; startedAt: number } | null = null;

/** A blend is starting, or - with null - has finished, however it finished. */
export const announceTransition = (cue: TransitionCue | null): void => {
    active = cue === null ? null : { cue, startedAt: performance.now() };
    listeners.forEach(listener => listener(cue));
};

/**
 * The blend in flight, or null when there is none - including one whose own clock has run out
 * without a settle ever being announced, so a renderer mounting late never picks up a stale cue and
 * draws a finished transition. Pure: callers read it from a render-phase initialiser.
 */
export const getActiveTransitionCue = (): ActiveTransitionCue | null => {
    if (!active) return null;
    const elapsedMs = performance.now() - active.startedAt;
    if (elapsedMs >= active.cue.seconds * 1000) return null;
    return { cue: active.cue, elapsedMs };
};

export const subscribeToTransitionCue = (listener: TransitionCueListener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
