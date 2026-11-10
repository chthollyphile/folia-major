import type { MediaId, ProviderLikedSongIds } from '../../../types/onlineMusic';

// src/services/onlineMusic/account/keptAfterRead.ts
// The one rule by which a read of what an account keeps on its platform (its liked songs) meets
// what the listener pressed in Folia meanwhile. No store and no clock in here: omni hands in what
// is held, what was read and what was pressed, and writes what comes back.
//
// - An item with a press not settled, or whose request the platform took since PRESS_GRACE_MS
//   before the read began, keeps what Folia holds: the read may have been made before or after
//   that request reached the platform. A request that failed or was given up shields nothing:
//   what Folia holds for the item is then no newer than the read.
// - Every other item takes the read's answer.
// - A read that is not whole only adds: an item it does not show may lie past where it stopped.
//   A check of some items (likedChecks.ts) also names the ones that are not kept: those it takes away.
// - An answer is dropped when a whole read of the platform begun after it was applied before it,
//   or when the signed-in user is no longer the one the read was begun for. A read begun later
//   that never ends, fails, or was not whole holds no other read back. (A check whose answer
//   comes after a read of the list was applied never gets here: likedChecks.ts drops it.)
// - A whole answer with nothing in it changes nothing while items are held. On several platforms
//   a page that could not be made out reads as an empty list (YouTube Music's first page, QQ
//   through its backend, a KuGou page without a list), and taking it would put every heart out
//   and save that. It is taken where the platform's own count of the list, asked just before the
//   read (readMoments.ts), said the list is empty too: two answers agree, and the last heart taken
//   back in the platform's own app goes out here. The adapters with a count throw where an answer
//   carries no list, and the local backend one of them reads through throws on any error code
//   upstream: what is left is the platform saying the list is empty.

// How long an item keeps the state its last request left, whatever a read begun after it says: a
// list read right after a request may not show the change yet. How long a platform takes to show
// it was not measured; this is a guess. It is kept short so that a like made here and taken back
// in the platform's own app is not held on to: nobody gets there and back in this time.
const PRESS_GRACE_MS = 5_000;

/** A read of an account under way. */
export interface AccountRead {
    /** Whose account is read. */
    userId: MediaId;
    /** When the read began (ms). */
    beganAt: number;
    /** Its number among the reads begun for the platform: a later read has a higher one. */
    order: number;
    /** The platform's own count of the list, asked just before the read (readMoments.ts), was 0. */
    countedEmpty?: boolean;
}

export type KeptAfterRead =
    | {
        /** What the account holds from now on. */
        ids: MediaId[];
        added: number;
        removed: number;
        /** The keys of the items that kept what Folia holds because they were pressed. */
        pressed: ReadonlySet<string>;
    }
    /** The read changes nothing, and why. */
    | { refused: 'a whole read begun after it was applied before it' | 'its user is no longer the one signed in' | 'it is empty while items are held' };

// Settles what an account holds after a read, by the rules at the top of this file.
export const keptAfterRead = ({ read, answer, notKept = [], held, signedInUserId, newestApplied, touchedSince }: {
    read: AccountRead;
    answer: ProviderLikedSongIds;
    /** With an answer that is not whole: the items the platform said it does not keep. */
    notKept?: MediaId[];
    /** What Folia holds for the account now. */
    held: MediaId[];
    /** Who is signed in to the platform now. */
    signedInUserId: MediaId | null | undefined;
    /** The `order` of the newest whole read of the platform that was applied; 0 where none was. */
    newestApplied: number;
    /** Whether an item has an unsettled press, or a request for it was taken at `time` or later (likePresses.ts). */
    touchedSince: (key: string, time: number) => boolean;
}): KeptAfterRead => {
    if (read.order < newestApplied) return { refused: 'a whole read begun after it was applied before it' };
    if (signedInUserId === undefined || signedInUserId === null || String(signedInUserId) !== String(read.userId)) {
        return { refused: 'its user is no longer the one signed in' };
    }
    if (answer.whole && answer.ids.length === 0 && held.length > 0 && !read.countedEmpty) return { refused: 'it is empty while items are held' };

    const since = read.beganAt - PRESS_GRACE_MS;
    const pressed = new Set<string>();
    const isPressed = (id: MediaId): boolean => {
        const touched = touchedSince(String(id), since);
        if (touched) pressed.add(String(id));
        return touched;
    };
    const ids: MediaId[] = [];
    const keys = new Set<string>();
    const take = (id: MediaId): void => {
        if (keys.has(String(id))) return;
        keys.add(String(id));
        ids.push(id);
    };
    // A read that is not whole takes nothing away but what it names as not kept: all else that is held stays.
    if (!answer.whole) {
        const taken = new Set(notKept.filter(id => !isPressed(id)).map(String));
        held.filter(id => !taken.has(String(id))).forEach(take);
    }
    // From the read, every item but the pressed ones; from what is held, the pressed ones.
    for (const id of answer.ids) {
        if (!isPressed(id)) take(id);
    }
    if (answer.whole) {
        for (const id of held) {
            if (isPressed(id)) take(id);
        }
    }

    const heldKeys = new Set(held.map(String));
    return {
        ids,
        added: [...keys].filter(key => !heldKeys.has(key)).length,
        removed: [...heldKeys].filter(key => !keys.has(key)).length,
        pressed,
    };
};
