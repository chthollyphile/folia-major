import { create } from 'zustand';
import type React from 'react';
import type { StatusMessage } from '../types';

// src/stores/useStatusMessageStore.ts
// The app's single toast/status channel.
//
// This used to be a round trip: App.tsx owned `statusMsg` as React state, handed `setStatusMsg`
// down to ~20 hooks, and separately registered it into useSettingsUiStore as `statusSetter` so
// that store's 61 `notify()` calls could reach it. Every emitter therefore had to be given the
// setter as a parameter. Owning it here lets any emitter — React or not — import one stable
// function instead, so the setter stops travelling through props and dependency arrays.

export type StatusSetter = React.Dispatch<React.SetStateAction<StatusMessage | null>>;

type StatusMessageState = {
    message: StatusMessage | null;
    /** The pointer or the keyboard focus rests on the shown toast: its display time stands still.
     *  A new message starts unheld. */
    held: boolean;
    /** Accepts the updater form because callers reason about the previous toast (see
     *  usePlaybackQueueController, which clears only a persistent one). */
    setMessage: StatusSetter;
};

export const useStatusMessageStore = create<StatusMessageState>((set) => ({
    message: null,
    held: false,
    setMessage: (next) => set(state => {
        const message = typeof next === 'function'
            ? (next as (prev: StatusMessage | null) => StatusMessage | null)(state.message)
            : next;
        return message === state.message ? { message } : { message, held: false };
    }),
}));

/**
 * Module-level emitter for everything that is not a React component: stores, services, and the
 * hooks that used to receive `setStatusMsg` as a parameter. Its identity is stable, so it never
 * needs to appear in a dependency array.
 */
export const setStatusMessage: StatusSetter = (next) => {
    useStatusMessageStore.getState().setMessage(next);
};

/** Subscribe to the current toast. Only the component that renders it should call this. */
export const useStatusMessage = () => useStatusMessageStore(state => state.message);

/** The toast says whether the pointer or the focus rests on it. */
export const holdStatusMessage = (held: boolean) => {
    if (useStatusMessageStore.getState().held !== held) useStatusMessageStore.setState({ held });
};

/**
 * Runs a shown message's display time: `onEnd` once `ms` have gone by while it was not held.
 * Returns the function that stops it.
 */
export const runStatusMessageTime = (ms: number, onEnd: () => void): (() => void) => {
    let left = ms;
    let startedAt = 0;
    let timer: number | null = null;
    const stand = () => {
        if (timer === null) return;
        window.clearTimeout(timer);
        timer = null;
        left -= Date.now() - startedAt;
    };
    const follow = (held: boolean) => {
        if (held) return stand();
        if (timer !== null) return;
        startedAt = Date.now();
        timer = window.setTimeout(onEnd, left);
    };
    follow(useStatusMessageStore.getState().held);
    const stopWatching = useStatusMessageStore.subscribe(state => follow(state.held));
    return () => {
        stopWatching();
        stand();
    };
};
