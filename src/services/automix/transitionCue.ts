// src/services/automix/transitionCue.ts
// Announces to the screen that a transition is happening, and its shape.
//
// A channel rather than a port on `createAutomixSession`: the audience is a decorative overlay far
// from the decks, and threading a port through would re-render App on every song change just to feed
// a component that draws a circle.
//
// Announced, never stored: a listener subscribing mid-transition misses it, by design - this is the
// report of an event, not a status light.

export interface TransitionCue {
    /** Wall-clock seconds from the announcement until the blend is over. */
    seconds: number;
    /** Where in those seconds the two tracks change places, 0..1. */
    crossover: number;
    /** Wall-clock seconds per beat of the outgoing track, or null when nothing measured a tempo. */
    periodSec: number | null;
}

type TransitionCueListener = (cue: TransitionCue | null) => void;

const listeners = new Set<TransitionCueListener>();

/** A blend is starting, or - with null - has finished, however it finished. */
export const announceTransition = (cue: TransitionCue | null): void => {
    listeners.forEach(listener => listener(cue));
};

export const subscribeToTransitionCue = (listener: TransitionCueListener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
