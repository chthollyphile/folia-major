// src/services/onlineMusic/exploreReads.ts
// What the explore adapters share for reading their page from its start again and again (see
// EXPLORE_ADAPTER.md). Nothing here knows a platform.
//  1. What the reads before used, so that the next read uses other things first: the entries a
//     shelf handed out, the songs the shelves an adapter makes were asked with. One rule for all
//     of it: of the candidates at hand, the ones never used come first, then the ones used
//     longest ago. So a list is gone through to its end before its first entries come again, and
//     no adapter starts a round over by itself.
//  2. The number of a read in its cursors, by which a cursor of a read before is told.

// A scope remembers this many keys. Past that it forgets the ones used longest ago, which count
// as never used from then on.
export const MAX_KEPT = 5000;

/**
 * A memory of what was used, kept for as long as the adapter that made it holds it (nothing is
 * stored). It is kept by scope: a key the adapter chooses for the things that take turns with
 * each other, the same key in every read (a shelf's id for its entries, a word for the songs
 * asked with). The memory keeps the order of use itself: what is noted later was used later,
 * within one read too, so that a list of any length is gone through evenly.
 */
export const createHandedOut = () => {
    /** By scope, each key with its place in the order of use; a scope's keys stand in that order, the one used longest ago first. */
    const scopes = new Map<string, Map<string, number>>();
    let uses = 0;
    return {
        /** Whether `key` was used in `scope`, as far as the scope remembers. */
        has: (scope: string, key: string): boolean => scopes.get(scope)?.has(key) ?? false,
        /**
         * `candidates` in the order to use them in: the ones never used in `scope` first, in the
         * order they came in, then the others, the one used longest ago first.
         */
        inTurn<T>(scope: string, candidates: T[], keyOf: (candidate: T) => string): T[] {
            const usedAt = scopes.get(scope);
            const placeOf = (candidate: T) => usedAt?.get(keyOf(candidate)) ?? -Infinity;
            return [...candidates].sort((left, right) => (placeOf(left) === placeOf(right) ? 0 : placeOf(left) - placeOf(right)));
        },
        /** Notes that `keys` were used in `scope`, now and in this order. */
        note(scope: string, keys: string[]): void {
            const usedAt = scopes.get(scope) ?? new Map<string, number>();
            scopes.set(scope, usedAt);
            for (const key of keys) {
                // (Taken out first, so that the key goes to the end of the scope's order.)
                usedAt.delete(key);
                usedAt.set(key, uses += 1);
            }
            for (const key of usedAt.keys()) {
                if (usedAt.size <= MAX_KEPT) break;
                usedAt.delete(key);
            }
        },
    };
};

/** A cursor of the read numbered `read`: the number, then what the adapter says in it. */
export const stampCursor = (read: number, words: string): string => `${read}:${words}`;
/** What a cursor says, where it is of the read numbered `read`; null for a cursor of another read. */
export const cursorWords = (cursor: string, read: number): string | null => {
    const at = cursor.indexOf(':');
    return at > 0 && Number(cursor.slice(0, at)) === read ? cursor.slice(at + 1) : null;
};
