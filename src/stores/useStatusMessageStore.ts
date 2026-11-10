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

let activitySequence = 0;

export const useStatusMessageStore = create<StatusMessageState>((set) => ({
    message: null,
    held: false,
    setMessage: (next) => set(state => {
        let message = typeof next === 'function'
            ? (next as (prev: StatusMessage | null) => StatusMessage | null)(state.message)
            : next;
        if (message !== state.message && message) {
            if (message.activity === 'loading' && message.activityId === undefined) {
                message = { ...message, activityId: ++activitySequence };
            } else if (state.message?.activity === 'loading' && state.message.activityId !== undefined
                && !message.activity && (message.type === 'success' || message.type === 'error')) {
                message = { ...message, activity: message.type, activityId: state.message.activityId };
            }
        }
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

/**
 * How long an operation's loader waits before it shows. A load that ends sooner shows nothing at all,
 * neither the loader nor its result: a toast that flashes up and away for a quick answer only distracts.
 */
export const STATUS_LOADING_DELAY_MS = 300;

/** Loaders begun but not shown yet: activity id → the timer that shows it and the toast shown when it began. */
const pendingLoaders = new Map<number, { timer: ReturnType<typeof setTimeout>; before: StatusMessage | null }>();

/** Shows a loader unless an error, or a toast set after the loader began, holds the place. */
const showLoader = (message: StatusMessage, before: StatusMessage | null) => {
    setStatusMessage(previous => previous?.type === 'error' || (previous !== null && previous !== before) ? previous : message);
};

/** Takes a loader out of waiting; says whether it was still waiting (so it never showed). */
const settlePending = (loading: StatusMessage): boolean => {
    const id = loading.activityId;
    const pending = id === undefined ? undefined : pendingLoaders.get(id);
    if (id === undefined || !pending) return false;
    clearTimeout(pending.timer);
    pendingLoaders.delete(id);
    return true;
};

/** Forgets every loader still waiting to show. For tests: a play one case left in flight must not show its loader in the next. */
export const dropWaitingStatusLoaders = (): void => {
    pendingLoaders.forEach(pending => clearTimeout(pending.timer));
    pendingLoaders.clear();
};

/**
 * Starts one owned loading toast, shown after `STATUS_LOADING_DELAY_MS`; a current error keeps its place.
 * `isCurrent` says whether the operation is still wanted when the delay ends: one overtaken meanwhile
 * (a newer play) shows nothing, even if it has not yet found out and cancelled its loader.
 */
export const beginStatusLoading = (text: string, isCurrent?: () => boolean): StatusMessage => {
    const id = ++activitySequence;
    const message: StatusMessage = { type: 'info', activity: 'loading', activityId: id, text, persistent: true };
    const before = useStatusMessageStore.getState().message;
    const timer = setTimeout(() => {
        pendingLoaders.delete(id);
        if (!isCurrent || isCurrent()) showLoader(message, before);
    }, STATUS_LOADING_DELAY_MS);
    pendingLoaders.set(id, { timer, before });
    return message;
};

/** Only this operation's still-visible loader becomes its result; one that never showed ends silently. */
export const completeStatusLoading = (loading: StatusMessage | null, text: string): void => {
    if (!loading || settlePending(loading)) return;
    setStatusMessage(previous => previous?.activity === 'loading' && previous.activityId === loading.activityId
        ? { type: 'success', activity: 'success', activityId: loading.activityId, text, durationMs: 850 }
        : previous);
};

/** A failed operation turns its own shown loader into the failure; one that never showed ends silently. */
export const failStatusLoading = (loading: StatusMessage | null, text: string): void => {
    if (!loading || settlePending(loading)) return;
    setStatusMessage(previous => previous?.activity === 'loading' && previous.activityId === loading.activityId
        ? { type: 'error', activity: 'error', activityId: loading.activityId, text }
        : previous);
};

/** Drops only the cancelled operation's own loader, shown or still waiting. */
export const cancelStatusLoading = (loading: StatusMessage | null): void => {
    if (!loading || settlePending(loading)) return;
    setStatusMessage(previous => previous?.activity === 'loading' && previous.activityId === loading.activityId ? null : previous);
};

/** Changes what this operation's loader says (a retry); one still waiting shows at once with the new words. */
export const reviseStatusLoading = (loading: StatusMessage | null, patch: Partial<StatusMessage>): void => {
    if (!loading) return;
    if (settlePending(loading)) {
        setStatusMessage(previous => previous?.type === 'error' ? previous : { ...loading, ...patch });
        return;
    }
    setStatusMessage(previous => previous?.activity === 'loading' && previous.activityId === loading.activityId
        ? { ...previous, ...patch }
        : previous);
};

/** Decorate before callers retain a toast by identity (for example a skip countdown). */
export const withStatusLoadingResult = (message: StatusMessage): StatusMessage => {
    const previous = useStatusMessageStore.getState().message;
    return previous?.activity === 'loading' && previous.activityId !== undefined
        && (message.type === 'success' || message.type === 'error')
        ? { ...message, activity: message.type, activityId: previous.activityId }
        : message;
};
