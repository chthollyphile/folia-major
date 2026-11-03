import type { OmniCollection } from '../../../../types/onlineMusic';

// src/library/core/collection/mutations/collectionSaves.service.ts
// The star of an album or a playlist (the collection's "subscribe"): it shows what was asked for
// at once; the request to the platform runs behind it and is not waited for. A request that fails
// puts the star back to what the platform last confirmed, and the one who pressed it says so.
// A request outlives the collection's session that started it (the page is closed, another
// collection is opened, its mutation controller is let go), so what is under way is kept here, by
// collection, and not in the controller. The platform is reached through the `send` each request
// is given (the controller's injected omni): this file calls no service.

/** Sends one change to the platform: save the collection (`true`) or take it out. */
export type CollectionSaveSend = (wanted: boolean) => Promise<void>;

interface Asked {
    // What the star shows; the request under way works towards it.
    wanted: boolean;
    send: CollectionSaveSend;
    // Told each change the platform has made.
    onChanged: (saved: boolean) => void;
}
type Watcher = (key: string, saved: boolean) => void;

/** How a request ended for the press that started it. `failed`: the platform did not take a change, and the star is put back to `saved`. */
export type CollectionSaveOutcome = { failed: false } | { failed: true; saved: boolean };

const underWay = new Map<string, Asked>();
// How many times each collection's requests have ended.
const ended = new Map<string, number>();
const watchers = new Set<Watcher>();

export const collectionSaveKey = (collection: Pick<OmniCollection, 'providerId' | 'type' | 'id'>): string => (
    `${collection.providerId}:${collection.type}:${collection.id}`
);

/** What the star of this collection shows while its request is under way; undefined when none is. */
export const collectionSaveUnderWay = (key: string): boolean | undefined => underWay.get(key)?.wanted;

/** A mark of this moment among a collection's requests, for `collectionSaveReadIsCurrent`. */
export const collectionSaveMark = (key: string): number => ended.get(key) ?? 0;

/**
 * Whether what the platform answered to "is it saved", asked at `mark`, can be shown. Not while a
 * request is under way, and not when one has ended since: the answer may be of before the change.
 */
export const collectionSaveReadIsCurrent = (key: string, mark: number): boolean => !underWay.has(key) && collectionSaveMark(key) === mark;

/** Calls `watcher` when a collection's requests have ended, with the state the platform is left in. */
export const watchCollectionSaves = (watcher: Watcher): (() => void) => {
    watchers.add(watcher);
    return () => { watchers.delete(watcher); };
};

// Sends changes until the platform's state is the wanted one: a star pressed again while a
// request is under way changes what is wanted, and the next request follows from it.
const settle = async (key: string, asked: Asked, before: boolean): Promise<CollectionSaveOutcome> => {
    let made = before;
    try {
        while (asked.wanted !== made) {
            const next = asked.wanted;
            try {
                await asked.send(next);
            } catch (error) {
                console.warn(`[CollectionSave] ${made ? 'Not taken out' : 'Not saved'}; the star is put back`, error);
                // Nothing to say when the star was meanwhile pressed back to what the platform holds.
                return asked.wanted !== made ? { failed: true, saved: made } : { failed: false };
            }
            made = next;
            asked.onChanged(next);
        }
        return { failed: false };
    } finally {
        underWay.delete(key);
        ended.set(key, collectionSaveMark(key) + 1);
        for (const watcher of watchers) watcher(key, made);
    }
};

/**
 * Has the platform save the collection of `key` (`wanted`) or take it out, behind a star that
 * already shows it. A press while a request is under way joins it (and answers at once that
 * nothing failed); the press that started it is answered when the platform is left in the wanted
 * state, or has refused.
 */
export const askCollectionSaved = (
    key: string,
    wanted: boolean,
    how: { send: CollectionSaveSend; onChanged: (saved: boolean) => void },
): Promise<CollectionSaveOutcome> => {
    const asked = underWay.get(key);
    if (asked) {
        asked.wanted = wanted;
        asked.send = how.send;
        asked.onChanged = how.onChanged;
        return Promise.resolve({ failed: false });
    }
    const started: Asked = { wanted, send: how.send, onChanged: how.onChanged };
    underWay.set(key, started);
    return settle(key, started, !wanted);
};
