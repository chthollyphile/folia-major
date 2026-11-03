// src/components/app/playing-song-locator/resolveLocateStep.ts
// How a page asked "where is the song that is playing" (playingSongLocator.ts) answers, from what
// it has: one rule for every page that answers (the grid's collection page, the Bravais wall).
// What the page does with the answer is its own: it centres the card, clears its filter.

export type LocateStep =
    /** Answer now: true once the page has shown the card; false: not here; 'unread': cannot tell. */
    | { kind: 'answer'; answer: boolean | 'unread' }
    /** A filter may be what hides the song: clear it, and look again among all the cards. */
    | { kind: 'unfilter' }
    /** Cards are still to come, and the request waits for them. */
    | { kind: 'wait' };

export const resolveLocateStep = ({
    isHere,
    isFiltered,
    waits,
    cardsStillArriving,
    hasReadFailed,
}: {
    /** The song is among the cards the page shows. */
    isHere: boolean;
    /** A filter hides cards. */
    isFiltered: boolean;
    /** The request's `waits`: the page was opened for it. */
    waits: boolean;
    /** The list is still being read, or filled in in the background. */
    cardsStillArriving: boolean;
    /** A read failed: the list is short of what it did not reach. */
    hasReadFailed: boolean;
}): LocateStep => {
    if (isHere) return { kind: 'answer', answer: true };
    if (isFiltered) return { kind: 'unfilter' };
    if (waits && cardsStillArriving) return { kind: 'wait' };
    // The song is not here where the list is whole; where it is not, the page cannot tell.
    return { kind: 'answer', answer: !cardsStillArriving && !hasReadFailed ? false : 'unread' };
};
