import type { MediaId, OnlineProviderId } from '../../../types/onlineMusic';
import { answeredWithin } from './answeredWithin';
import { errorMessage } from '../../../utils/errorText';

// src/services/onlineMusic/account/readMoments.ts
// The one place that decides whether the liked songs of a signed-in account are read again from
// its platform at a moment when they may have been changed in the platform's own app, so that
// such a change shows in Folia without a restart.
//
// The moments (src/hooks/useAccountReads.ts hears of them and tells omni): Folia's window is
// returned to, and the home screen is entered. At each, the platform is asked how many songs its
// liked list holds (one request, the adapter's `getLikedSongCount`), and the liked ids are read
// whole only when that count is not the one held. A like and an unlike made together elsewhere
// leave the count as it was and are not seen here. A platform whose adapter has no such count is
// asked nothing and read nothing at these moments. There is no timer.
//
// Not decided here: the read of the whole account (app start, sign-in, platform switch, the sync
// button; accountRead.ts) and the opening of the account's own liked list, which read the liked
// ids whole every time. A moment that falls into a read of the whole account joins its liked part
// and reads no second time (omni hands that in as `readLikedWhole`).
//
// The count held is the number of liked ids Folia holds plus `ahead`: by how much the platform's
// count differed from that number after the last read made here that left Folia holding what the
// platform's list held. The two can differ for good (a platform may count songs its list no longer
// shows), and compared this way that costs one read a session and not one a check. A like made in
// Folia moves both alike, so it starts no read. A read that did not leave the two alike (the one
// rule refused it, or a song pressed meanwhile kept what Folia held) writes no `ahead`: the count
// asked before it says nothing of what is held after it, and a wrong `ahead` would hide the next
// change made elsewhere. The next moment then reads again. A count of 0 goes with the read: the
// rule takes an empty list only where the platform counted it as empty too (keptAfterRead.ts).
// `ahead` is kept in memory only.

/** A moment at which an account's liked songs may have been changed outside Folia. */
export type AccountMoment = 'window-returned' | 'home-entered';

export type LikedReadDecision = 'read whole' | 'ask for the count' | 'do nothing';

// Checks of one platform begin at least this far apart. Returning to the window fires a focus and
// a visibility event together, and flicking between windows fires more: they make one check.
// Nobody gets to another app, changes a like there and is back in this time, so no change is
// missed for it. It is the wait the home screen's playlist refresh uses.
export const CHECK_INTERVAL_MS = 5_000;

// How long the platform has to answer the count, and then the read. A request that never answers
// would otherwise hold the platform's checks off until restart. It is the limit of a like press
// (src/utils/likePresses.ts).
export const ANSWER_LIMIT_MS = 20_000;

/** What is known of a platform's account when a moment comes. */
export interface LikedReadKnown {
    /** Whether the one the moment is for is signed in to the platform. */
    signedIn: boolean;
    /** Whether a check of the platform, or the read it started, is under way. */
    underWay: boolean;
    /** How long ago the platform's last check began (ms); null where there was none. */
    sinceLastCheck: number | null;
    /**
     * The liked list's song count: the one held, and the one the platform just gave (null where
     * it gave none). Left out while the platform has not been asked at this moment.
     */
    count?: { held: number; read: number | null };
}

// What to do at a moment. Before the platform was asked for its count: whether to ask. With its
// answer: whether to read the liked ids whole.
export const decideLikedRead = (known: LikedReadKnown): LikedReadDecision => {
    if (!known.signedIn) return 'do nothing';
    if (!known.count) {
        if (known.underWay) return 'do nothing';
        if (known.sinceLastCheck !== null && known.sinceLastCheck < CHECK_INTERVAL_MS) return 'do nothing';
        return 'ask for the count';
    }
    if (known.count.read === null) return 'do nothing';
    return known.count.read === known.count.held ? 'do nothing' : 'read whole';
};

export interface AccountMomentsDeps {
    /** Who is signed in to the platform and how many liked ids Folia holds for them; null where nobody is. */
    account(providerId: OnlineProviderId): { userId: MediaId; likedHeld: number } | null;
    /**
     * The platform's count of the account's liked list (`getLikedSongCount` of its adapter):
     * undefined at once where the adapter has no such count.
     */
    likedCount(providerId: OnlineProviderId, userId: MediaId): Promise<number | null> | undefined;
    /**
     * Reads the account's liked ids whole and settles them by the one rule; rejects where the read
     * failed. True where Folia then holds what the platform's list held: the answer was applied and
     * no song kept what Folia held because it was pressed meanwhile. `countedEmpty`: the count
     * just given was 0.
     */
    readLikedWhole(providerId: OnlineProviderId, userId: MediaId, countedEmpty: boolean): Promise<boolean>;
    now(): number;
}

interface PlatformChecks {
    underWay: boolean;
    lastCheckAt: number | null;
    /** See the top of the file; for the account of `userId` alone. */
    ahead: { userId: string; by: number } | null;
}

// Makes the function that is told of the moments: it asks, decides (`decideLikedRead`) and starts
// the read, one check at a time for a platform, and writes one line into the log for each check.
export const createAccountMoments = (deps: AccountMomentsDeps) => {
    const checks = new Map<OnlineProviderId, PlatformChecks>();

    return async (moment: AccountMoment, providerId: OnlineProviderId): Promise<void> => {
        let platform = checks.get(providerId);
        if (!platform) {
            platform = { underWay: false, lastCheckAt: null, ahead: null };
            checks.set(providerId, platform);
        }
        const account = deps.account(providerId);
        const known: LikedReadKnown = {
            signedIn: account !== null,
            underWay: platform.underWay,
            sinceLastCheck: platform.lastCheckAt === null ? null : deps.now() - platform.lastCheckAt,
        };
        if (!account || decideLikedRead(known) !== 'ask for the count') return;

        const userKey = String(account.userId);
        const line = `[Like] ${providerId}: ${moment}`;
        platform.underWay = true;
        platform.lastCheckAt = deps.now();
        let failed = 'the count of the liked list could not be asked for';
        try {
            const asked = deps.likedCount(providerId, account.userId);
            const read = asked === undefined ? null : await answeredWithin(asked, ANSWER_LIMIT_MS);
            // The account as it is now: it may have left, or been pressed in, while the count was asked for.
            const now = deps.account(providerId);
            const signedIn = now !== null && String(now.userId) === userKey;
            const ahead = platform.ahead?.userId === userKey ? platform.ahead.by : 0;
            const held = (now?.likedHeld ?? 0) + ahead;
            // What the log says of the two sides: the ids Folia holds, and `ahead` where it is not 0.
            const heldSaid = `${now?.likedHeld ?? 0} held${ahead === 0 ? '' : ` and ${ahead} ahead at the last read`}`;
            const decision = decideLikedRead({ ...known, signedIn, count: { held, read } });
            if (decision !== 'read whole' || read === null) {
                const why = !signedIn ? 'its account left while the count was asked for'
                    : asked === undefined ? 'its adapter has no count of the liked list short of reading it'
                    : read === null ? 'the platform gave no count of the liked list'
                    : `the liked list counts ${read}, ${heldSaid}`;
                console.log(`${line}: ${why}: the liked songs are not read`);
                return;
            }
            console.log(`${line}: the liked list counts ${read}, ${heldSaid}: the liked songs are read whole`);
            failed = 'the liked songs could not be read';
            const alike = await answeredWithin(deps.readLikedWhole(providerId, account.userId, read === 0), ANSWER_LIMIT_MS);
            const after = deps.account(providerId);
            if (after !== null && String(after.userId) === userKey && alike) {
                platform.ahead = { userId: userKey, by: read - after.likedHeld };
            }
        } catch (error) {
            console.warn(`${line}: ${failed}, they stay as they were: ${errorMessage(error)}`);
        } finally {
            platform.underWay = false;
        }
    };
};
