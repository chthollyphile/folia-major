import { usePersonalFmModeStore } from '@/stores/usePersonalFmModeStore';

// src/components/app/playback/personalFmEndings.ts
// How often Personal FM was ended from outside a play: a switch to another platform (its radio stops
// there) or a sign-out that took the radio's songs away. Neither replaces the queue nor drops the plays
// of other platforms, so a play that started before keeps its FM call: compared before and after its
// waits, a change here tells it that FM is over, and it does not turn FM back on (a failure that puts
// the FM state back, the skip after a failure, a retry, another version).
// Like wholeQueueWrites.ts it only grows: compare two readings rather than resetting it.

let endings = 0;

/** Counts one ending; called with the store write that ends FM, or where FM ends though it shows off for now. */
export const notePersonalFmEnded = (): void => {
    endings += 1;
    usePersonalFmModeStore.getState().resetStationSelections();
};

/** The endings so far. */
export const personalFmEndingsSoFar = (): number => endings;
