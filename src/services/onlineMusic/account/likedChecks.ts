import type { MediaId, OnlineProviderId } from '../../../types/onlineMusic';
import { errorMessage } from '../../../utils/errorText';

// src/services/onlineMusic/account/likedChecks.ts
// The hearts of the songs being played and queued, asked of the platform for those songs alone,
// where the account's liked list was not read to the end (`getLikedSongIds` answered not whole:
// its read stops at a limit of its own, say). Past that point Folia holds only what it held
// before, and a song liked or unliked there in the platform's own app shows the heart it had.
//
// - A read of the liked ids is the adapter's `getLikedSongIds` or the read of the account's own
//   liked list from its first page (omni's `endLikedListRead`): either one may stop short of the
//   end, and either one read whole leaves nothing to ask.
// - Asked only where the newest read of the platform's liked ids that was applied was not whole,
//   for the account it was read for, and only of an adapter with `library.areSongsLiked`.
// - Each song is asked once after each such read, and not again until the next: a read of the
//   liked ids follows the moments at which the list may have been changed elsewhere
//   (readMoments.ts), the sync button and sign-in. A heart pressed in Folia needs no asking.
// - One request at a time for a platform, LIKED_CHECK_SLICE songs to a request. Each request
//   takes the songs in play not asked yet, in the order they are in play when it is sent (the one
//   playing first); a song that left play before its turn is not asked. Each answer is settled by
//   the one rule (keptAfterRead.ts) as it comes.
// - An answer that comes after a read of the liked ids was applied is dropped, whichever of the
//   two was begun first: that read may show a song as liked that the answer, asked before, says
//   is not, and taking the answer would put out the heart. After a read that was not whole the
//   songs are asked again; after a whole one nothing needs asking. As the requests go one after
//   another, the answers about one song come in the order they were asked.
// - A request that fails ends the checks until the next read of the liked ids: a request that
//   failed is likely to fail again, and asking at each change of the songs in play would send it
//   again and again. A song the platform says nothing of is not asked again either.

/** A song being played or queued, by its platform and its id there. */
export interface SongInPlay {
    providerId: OnlineProviderId;
    mediaId: MediaId;
}

// How many songs one request asks of. How many a platform takes at once was not measured.
export const LIKED_CHECK_SLICE = 50;

/** What omni hands in: the one rule for the liked ids is its own. */
export interface LikedChecksDeps<R> {
    /** Who is signed in to the platform; null where nobody is. */
    signedIn(providerId: OnlineProviderId): MediaId | null;
    /** The adapter's `library.areSongsLiked`; null where it has none. */
    asker(providerId: OnlineProviderId): ((ids: MediaId[]) => Promise<Record<string, boolean>>) | null;
    /** Notes the start of a read of an account's liked ids. */
    beginLikedRead(providerId: OnlineProviderId, userId: MediaId): R;
    /** Settles what was asked by the one rule and writes the account store. */
    applyLikedCheck(read: R, liked: MediaId[], notLiked: MediaId[]): void;
}

/** A platform's checks since its last read of the liked ids, which was not whole. */
interface PlatformChecks {
    userId: MediaId;
    /** The songs asked of, or being asked of, since that read. */
    asked: Set<string>;
    /** A request failed: nothing more is asked until the next read. */
    stopped: boolean;
}

// Makes what omni tells of the songs in play and of each read of the liked ids.
export const createLikedChecks = <R>(deps: LikedChecksDeps<R>) => {
    // The platforms whose last applied read of the liked ids was not whole: a new entry each such read.
    const partial = new Map<OnlineProviderId, PlatformChecks>();
    // The platforms whose requests are being sent (`drain`): one loop for each.
    const draining = new Set<OnlineProviderId>();
    let inPlay: readonly SongInPlay[] = [];

    // The platform's songs in play not asked since its last read, in their order, at most `limit`.
    const notAsked = (providerId: OnlineProviderId, platform: PlatformChecks, limit = Infinity): MediaId[] => {
        const ids: MediaId[] = [];
        const keys = new Set<string>();
        for (const song of inPlay) {
            if (ids.length >= limit) break;
            const key = String(song.mediaId);
            if (song.providerId !== providerId || platform.asked.has(key) || keys.has(key)) continue;
            keys.add(key);
            ids.push(song.mediaId);
        }
        return ids;
    };

    // Where the platform's songs in play are to be asked now, its checks and its asker; else null.
    const asking = (providerId: OnlineProviderId) => {
        const platform = partial.get(providerId);
        const userId = deps.signedIn(providerId);
        if (!platform || platform.stopped || userId === null || String(userId) !== String(platform.userId)) return null;
        const asker = deps.asker(providerId);
        return asker ? { platform, asker } : null;
    };

    // Sends the platform's requests one after another until no song in play is left to ask.
    const drain = async (providerId: OnlineProviderId): Promise<void> => {
        draining.add(providerId);
        try {
            for (let now = asking(providerId); now; now = asking(providerId)) {
                const { platform, asker } = now;
                const slice = notAsked(providerId, platform, LIKED_CHECK_SLICE);
                if (slice.length === 0) return;
                slice.forEach(id => platform.asked.add(String(id)));
                const read = deps.beginLikedRead(providerId, platform.userId);
                let states: Record<string, boolean>;
                try {
                    states = await asker(slice);
                } catch (error) {
                    platform.stopped = true;
                    const left = slice.length + notAsked(providerId, platform).length;
                    console.warn(`[Like] ${providerId}: the hearts of ${left} songs in play could not be checked, they stay as they were until the next read of the liked songs: ${errorMessage(error)}`);
                    continue;
                }
                // A read of the liked ids was applied while the request was out.
                if (partial.get(providerId) !== platform) continue;
                deps.applyLikedCheck(
                    read,
                    slice.filter(id => states[String(id)] === true),
                    slice.filter(id => states[String(id)] === false),
                );
            }
        } finally {
            draining.delete(providerId);
        }
    };

    // Starts the platform's requests where none are being sent; the loop under way takes new songs itself.
    const check = (providerId: OnlineProviderId): void => {
        if (!draining.has(providerId)) void drain(providerId);
    };

    return {
        /** The songs being played and queued now, the one playing first. */
        songsInPlay(songs: readonly SongInPlay[]): void {
            inPlay = songs;
            for (const providerId of partial.keys()) check(providerId);
        },
        /** A read of the platform's liked ids was applied for `userId`. */
        likedRead(providerId: OnlineProviderId, userId: MediaId, whole: boolean): void {
            if (whole) {
                partial.delete(providerId);
                return;
            }
            partial.set(providerId, { userId, asked: new Set(), stopped: false });
            check(providerId);
        },
    };
};
