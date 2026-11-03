import { useEffect, useRef, type DependencyList } from 'react';

// src/mods/runtime/listeners.ts
// "Keep a set of listeners and tell them", once. Every context a mod mounts
// with is built with a `subscribe` (stage, background, progress bar, panel tab,
// settings panel), which the mod receives as `onChange`, and so has every
// registry; each used to carry its own copy of the set, of the loop that tells
// the listeners, and of the rule "not on the first run". The copies had drifted: two caught a listener that threw, three did not.
// Here one that throws is logged and the rest are still told, everywhere.
//
// What a mod subscribes reaches these sets wrapped by the gate (guard.ts), so
// its failures are caught and named there; the catch here is for the host's own
// listeners.

export interface FoliumListeners {
    /** Adds a listener; returns the function that removes it. What a context is built with as `subscribe`. */
    subscribe: (listener: () => void) => () => void;
    /** Tells every listener. */
    notify: () => void;
}

/** A set of listeners. `what` names them in the console when one throws, e.g. "stage subscriber". */
export const createFoliumListeners = (what: string): FoliumListeners => {
    const listeners = new Set<() => void>();
    return {
        subscribe: (listener) => {
            listeners.add(listener);
            // What the remover answers (was it still there) reaches a mod through the gate, as it always has.
            return () => listeners.delete(listener);
        },
        notify: () => {
            listeners.forEach((listener) => {
                try {
                    listener();
                } catch (error) {
                    console.warn(`[Folium] ${what} failed`, error);
                }
            });
        },
    };
};

/** One set of listeners for the life of a component: the same object on every render. */
export const useFoliumListeners = (what: string): FoliumListeners => {
    const ref = useRef<FoliumListeners | null>(null);
    ref.current ??= createFoliumListeners(what);
    return ref.current;
};

/**
 * Tells the listeners when one of `deps` has changed. Not on the first run: content that has
 * just mounted reads the current values anyway.
 */
export const useFoliumNotifyOnChange = (listeners: FoliumListeners, deps: DependencyList) => {
    const primedRef = useRef(false);
    useEffect(() => {
        if (!primedRef.current) {
            primedRef.current = true;
            return;
        }
        listeners.notify();
    }, deps);
};
