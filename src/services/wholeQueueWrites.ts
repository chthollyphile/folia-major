import type { SongResult } from '../types';

// src/services/wholeQueueWrites.ts
// How many times the whole play queue was replaced at once (Folium's `folium.playback.replaceQueue`, and
// the user's undo of it). The host's paths that read the queue, wait, and then write it back compare the
// count from before their wait with the count after it: a change means the queue they read is gone, and
// they leave the new one standing (the queue and library controllers, the session restore, the window
// handoff). With no writer the count never moves and those paths behave as they always did.
//
// Kept out of hostExtensionHooks.ts on purpose: several tests replace that module whole with a factory,
// and a new export missing from it would break every controller that calls it.
//
// A restore that gives way this way also says what it left unwritten (reportYieldedQueue): the queue it
// brought back is the listener's own, and the undo of the replacement that stood over it puts that back.

let writes = 0;

/** What a restore that gave way to a whole-queue write would have put in itself (see reportYieldedQueue). */
export interface YieldedQueue {
    /** The queue it brought back and left unwritten. */
    queue: SongResult[];
    /** The Personal FM it would have set; absent when it leaves FM as it is. */
    isFmMode?: boolean;
    /** The song it makes current all the same; null when it makes none current. */
    song: SongResult | null;
}

let yieldedQueueListener: ((yielded: YieldedQueue) => void) | null = null;

/** Counts one whole-queue write; called just before the store write itself. */
export const noteWholeQueueWrite = () => {
    writes += 1;
};

/** The whole-queue writes so far. It only grows: compare two readings rather than resetting it. */
export const wholeQueueWritesSoFar = () => writes;

/**
 * Said by a restore (the last session's at launch, a rebuilt window's handoff) that leaves the queue it
 * brought back unwritten because a whole-queue write came first. That queue, not the one the store held
 * when the write came (empty at launch), is the one the listener had.
 */
export const reportYieldedQueue = (yielded: YieldedQueue) => {
    yieldedQueueListener?.(yielded);
};

/** Who hears reportYieldedQueue (the undo of a mod's replacement), or null. One listener. */
export const setYieldedQueueListener = (listener: ((yielded: YieldedQueue) => void) | null) => {
    yieldedQueueListener = listener;
};
