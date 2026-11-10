// src/components/app/playback/start/queueStarts.ts
// How many plays started something other than a step through the queue there is: a queue of their own
// (a playlist, a search result's, a new Personal FM stream from a mode switch or a home card), or Personal
// FM turned on or off. playSong counts one as it is called, before any wait of its own, so a play that has
// not shown its song yet counts already. A step through the queue (next, previous, the FM top-up, a click in
// the queue panel, a retry) counts nothing.
//
// The Personal FM requests that wait for a batch and then play it (the mode switch, the home scene card)
// compare the count from before their wait with the count after it: a change means the listener started
// something else meanwhile, and the late batch is dropped instead of cutting it off. The writes in place
// (an add, a removal, a library refresh, a recovery's new address) are not starts, so they do not drop it.
// A whole-queue write (wholeQueueWrites.ts) is counted there, not here.

let starts = 0;

/** Counts one play that starts a queue of its own, or turns Personal FM on or off. */
export const noteQueueStart = () => {
    starts += 1;
};

/** The starts so far. It only grows: compare two readings rather than resetting it. */
export const queueStartsSoFar = () => starts;
