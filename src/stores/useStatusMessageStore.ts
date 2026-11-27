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

/** A toast kept in the stack, with the key AnimatePresence and dismiss use. */
export type StatusToastEntry = {
    key: string;
    message: StatusMessage;
};

/** At most this many toasts are kept on screen. A newer one pushes the oldest off the bottom. */
const MAX_TOASTS = 5;

type StatusMessageState = {
    /** The newest message. Kept as the single channel's view so existing emitters and their tests
     *  still read one message; it is always `entries[entries.length - 1]?.message`. */
    message: StatusMessage | null;
    /** Every toast still on screen, oldest first. */
    entries: StatusToastEntry[];
    /** The pointer or the keyboard focus rests on the shown toast: its display time stands still.
     *  A new message starts unheld. */
    held: boolean;
    /** Accepts the updater form because callers reason about the previous toast (see
     *  usePlaybackQueueController, which clears only a persistent one). */
    setMessage: StatusSetter;
    /** Closes one toast by key instead of whichever is newest. */
    dismissToast: (key: string) => void;
};

let activitySequence = 0;
let toastSequence = 0;

const toastKeyOf = (message: StatusMessage): string => message.activityId !== undefined
    ? `activity:${message.activityId}`
    : `${message.type}:${message.text}:${message.nonce ?? ++toastSequence}`;

const withEntries = (entries: StatusToastEntry[]) => ({
    entries,
    message: entries[entries.length - 1]?.message ?? null,
});

export const useStatusMessageStore = create<StatusMessageState>((set) => ({
    message: null,
    entries: [],
    held: false,
    setMessage: (next) => set(state => {
        // A caller may reset the single channel with setState({ message: null }) (tests do this
        // between cases). `message` is the view the emitters read, so when it says empty the stack
        // must agree: drop any entries left behind.
        const entriesNow = state.message === null && state.entries.length > 0 ? [] : state.entries;
        let message = typeof next === 'function'
            ? (next as (prev: StatusMessage | null) => StatusMessage | null)(state.message)
            : next;
        // An updater that returns the message unchanged (a skip's tick, a still-valid guard) is not a
        // new toast: keep the stack and the hold state exactly as they are.
        if (message === state.message) return { message };
        if (message !== state.message && message) {
            if (message.activity === 'loading' && message.activityId === undefined) {
                message = { ...message, activityId: ++activitySequence };
            } else if (state.message?.activity === 'loading' && state.message.activityId !== undefined
                && !message.activity && (message.type === 'success' || message.type === 'error')) {
                message = { ...message, activity: message.type, activityId: state.message.activityId };
            }
        }
        if (message === null) {
            // Callers use the single-channel clear when their toast's own action/cancel fires: the
            // notice is handled, so the whole stack goes. Per-toast dismissal uses dismissToast.
            return { ...withEntries([]), held: false };
        }
        const key = toastKeyOf(message);
        const last = entriesNow[entriesNow.length - 1];
        // A loader turning into its result (or a countdown updating that result) replaces its own
        // toast rather than stacking a second card.
        const morph = last && last.message.activityId !== undefined && last.message.activityId === message.activityId;
        const entries = morph
            ? [...entriesNow.slice(0, -1), { key, message }]
            : [...entriesNow, { key, message }].slice(-MAX_TOASTS);
        return { ...withEntries(entries), held: false };
    }),
    dismissToast: (key) => set(state => {
        const entries = state.entries.filter(entry => entry.key !== key);
        return entries.length === state.entries.length ? state : withEntries(entries);
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

/** Subscribe to the whole toast stack, oldest first. */
export const useStatusToasts = () => useStatusMessageStore(state => state.entries);

/** Closes one toast by key, leaving the others in the stack. */
export const dismissToast = (key: string) => {
    useStatusMessageStore.getState().dismissToast(key);
};

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
