import { OnlineProviderError } from '../../../types/onlineMusic';
import type {
    MediaId,
    OnlineMusicProvider,
    OnlineProviderId,
    ProviderCollection,
    ProviderLikedSongIds,
    ProviderUser,
} from '../../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { getOnlineMusicProvider } from '../providerRegistry';
import {
    clearProviderAccountSnapshot,
    loadProviderAccountSnapshot,
    saveProviderAccountSnapshot,
} from '../providerAccountCache';
import type { ProviderAccountSnapshot } from '../providerAccountCache';
import { answeredWithin } from './answeredWithin';
import { errorMessage } from '../../../utils/errorText';

// src/services/onlineMusic/account/accountRead.ts
// The one function that reads a signed-in account from its platform: who is signed in, their
// playlists, their cloud entry and their liked song ids, each through the platform's adapter,
// settled in the account store and kept on disk (the snapshot). It knows no platform by name: what
// one platform does differently is a member of its adapter (`OnlineAuthProvider`,
// `OnlineLibraryProvider`).
//
// When it runs (omni is told by src/hooks/useAccountReads.ts and useOnlineProviderPlatform.ts):
// app start, a completed sign-in, a platform switch, the sync button. The playlists alone are read
// again after a change made to one in Folia and when the home screen is entered.
//
// One guard for a platform:
// - A read asked for while one is under way joins it; no second one is made. A completed sign-in
//   is the exception: the read under way may have asked before the sign-in was there, so it is
//   given up and a new one begins.
// - A sign-out, or a sign-in that ran out, ends what is under way: an answer that comes after it
//   writes nothing, into the store or onto the disk.
// - The playlists read alone are written only while the account shown is still the user they
//   were read for.
// - At the home screen the playlists are read at most once in HOME_WAIT_MS, and not while a read
//   is under way.
// - The snapshot is saved one save after another, and a sign-out waits for the last one before it
//   removes the snapshot.
//
// What a part that fails leaves:
// - Who is signed in could not be asked, or was not answered within WHO_WAIT_MS: the account stays
//   as shown, marked as failed. Where that leaves nobody shown, the account is read again when the
//   home screen is next entered (`readAtHome`), at most once in a wait that doubles from
//   HOME_WAIT_MS with each time it could not be asked in a row, up to WHO_RETRY_MAX_MS.
// - The playlists could not be read: the same, and the liked songs are not read.
// - The cloud entry could not be read: the one held stays.
// - The liked songs could not be read: the hearts stay as they were; the rest is kept.
// Nobody is signed out by a failure. The account leaves when the platform says nobody is signed
// in, or refuses the sign-in (`auth-required`); where it is the playlists that were refused, the
// platform is asked who is signed in once more before anybody is signed out.
//
// What was kept on disk is shown only once the platform has named the same user: the sign-in may
// be held outside this page, and the page cannot tell whose the kept account is. An adapter whose
// sign-in goes with what the page keeps says so (`showsKeptAccountAtStart`): its kept account is
// shown at once at app start, while the platform is asked.

/** Why an account is read. */
export type AccountReadReason = 'start' | 'sign-in' | 'switch' | 'sync';

/**
 * How a read of an account ended.
 * - 'read': who is signed in and their playlists were read (their liked songs too, unless that part failed).
 * - 'not read': somebody is signed in and their playlists could not be read.
 * - 'unknown': who is signed in could not be asked, or the read was given up.
 * - 'nobody': nobody is signed in.
 * - 'ran out': the sign-in Folia showed is no longer valid, and the account left.
 * - 'not asked': the home screen was entered and nothing was read (see `readAtHome`).
 */
export type AccountReadOutcome = 'read' | 'not read' | 'unknown' | 'nobody' | 'ran out' | 'not asked';

/** What omni hands in: the one rule for the liked ids is its own (`applyLikedRead`). */
export interface AccountReadsDeps<R> {
    /** Notes the start of a read of an account's liked ids. */
    beginLikedRead(providerId: OnlineProviderId, userId: MediaId): R;
    /**
     * Settles what was read by the one rule (keptAfterRead.ts) and writes the account store.
     * `alike`: the account then holds what the answer held.
     */
    applyLikedRead(read: R, answer: ProviderLikedSongIds): { changed: boolean; alike: boolean };
    /**
     * Forgets the hearts pressed on the platform so far: the account they were pressed for has
     * left the screen, and they say nothing of the liked songs of whoever is read next.
     */
    forgetLikePresses(providerId: OnlineProviderId): void;
    /** A clock for spans of time (ms). */
    now(): number;
}

interface WholeRead {
    outcome: Promise<AccountReadOutcome>;
    /** Whether the liked songs have begun to be read. */
    likedBegun: boolean;
    /** How the liked part ended (`alike` of `applyLikedRead`); rejects where the liked songs were not read. */
    liked: Promise<boolean>;
}

interface PlatformReads {
    /** Raised by a sign-out, a completed sign-in and an account that left: a read begun before it writes nothing more. */
    generation: number;
    /** The read of the whole account under way. */
    whole: WholeRead | null;
    /** How many reads of the playlists alone are under way. */
    playlistsAlone: number;
    /** When the playlists were last begun to be read, whole or alone; null where the last read of them alone failed. */
    playlistsBeganAt: number | null;
    /** The saves of the snapshot, one after another. */
    saving: Promise<unknown>;
    /** When who is signed in last could not be asked; null once anything has answered since. */
    whoUnknownAt: number | null;
    /** How many times in a row who is signed in could not be asked; 0 once anything has answered since. */
    whoUnknownTimes: number;
}

// Long enough that going between the home screen, the player and a collection does not read the
// playlists each time, short enough to feel live.
export const HOME_WAIT_MS = 5_000;

// How long a platform is given to say who is signed in. A request that never ends would hold every
// later read of the platform, which joins the one under way. Longer than the longest wait an
// adapter makes of its own before it asks: NetEase on the desktop waits up to 45 s for its local
// API to start (netease.ts).
const WHO_WAIT_MS = 60_000;

// The longest the home screen waits before it reads an account again whose user could not be asked.
// A platform that cannot answer for the whole run (a sign-in stored that this run cannot unseal)
// is then asked about once a minute, not at every entry; one that can be reached again comes back
// within a minute of the next entry.
const WHO_RETRY_MAX_MS = 60_000;

const PLAYLIST_PAGE_SIZE = 50;
// A list that never ends is given up here.
const PLAYLIST_OFFSET_LIMIT = 1000;

const isAuthRequired = (error: unknown): boolean => error instanceof OnlineProviderError && error.code === 'auth-required';
const messageOf = (error: unknown): string => errorMessage(error);

// Every page of the account's playlists, as the adapter gives them. `goOn` is asked before each
// request: a read that was given up asks for no further page.
const playlistsOf = async (provider: OnlineMusicProvider, userId: MediaId, goOn: () => boolean): Promise<ProviderCollection[]> => {
    const collections: ProviderCollection[] = [];
    if (!provider.library?.getUserPlaylists) return collections;
    let offset = 0;
    let hasMore = true;
    while (hasMore && offset < PLAYLIST_OFFSET_LIMIT && goOn()) {
        const page = await provider.library.getUserPlaylists(userId, PLAYLIST_PAGE_SIZE, offset);
        collections.push(...page.items);
        hasMore = page.hasMore && page.nextOffset > offset;
        offset = page.nextOffset;
    }
    return collections;
};

// Makes the functions that read an account, sign it out, and tell of a read under way. They keep,
// for each platform, what is under way (see the top of this file).
export const createAccountReads = <R>(deps: AccountReadsDeps<R>) => {
    const platforms = new Map<OnlineProviderId, PlatformReads>();
    const readsOf = (providerId: OnlineProviderId): PlatformReads => {
        let reads = platforms.get(providerId);
        if (!reads) {
            reads = { generation: 0, whole: null, playlistsAlone: 0, playlistsBeganAt: null, saving: Promise.resolve(), whoUnknownAt: null, whoUnknownTimes: 0 };
            platforms.set(providerId, reads);
        }
        return reads;
    };
    const store = () => useOnlineProviderAccountStore.getState();
    const shownUser = (providerId: OnlineProviderId): ProviderUser | null => store().accounts[providerId]?.user ?? null;

    // What was kept of a platform's account at the last save, as its adapter reads it now (an
    // adapter with `normalizeUser` / `normalizeCollection` takes what an older build kept). Where
    // no snapshot is found, what the adapter's build from before the snapshot kept is made one;
    // once it is saved the adapter forgets it, and where the save fails it is kept for the next start.
    const keptAccount = async (provider: OnlineMusicProvider): Promise<ProviderAccountSnapshot | null> => {
        let kept = await loadProviderAccountSnapshot(provider.id).catch(() => null);
        const auth = provider.auth;
        if (!kept && auth?.oldKeptAccount) {
            kept = await auth.oldKeptAccount()
                .then(async old => {
                    if (!old) return null;
                    const saved = await saveProviderAccountSnapshot(provider.id, old);
                    await auth.forgetOldKeptAccount?.();
                    return saved;
                })
                .catch(() => null);
        }
        if (!kept) return null;
        const user = provider.normalizeUser ? provider.normalizeUser(kept.user) : kept.user;
        if (!user) return null;
        const collections = provider.normalizeCollection
            ? kept.collections.map(collection => provider.normalizeCollection!(collection, collection.type)).filter(Boolean)
            : kept.collections;
        return { ...kept, user, collections };
    };

    // Saves the account as the store holds it now, with `collections` as they were just read,
    // after the save before it. Null where the account left meanwhile.
    const save = (providerId: OnlineProviderId, reads: PlatformReads, generation: number, collections: ProviderCollection[]) => {
        const saved = reads.saving.catch(() => {}).then(() => {
            const account = store().accounts[providerId];
            if (reads.generation !== generation || !account?.user) return null;
            return saveProviderAccountSnapshot(providerId, {
                user: account.user,
                collections,
                // As the store has them now: what a read left, with any like made since.
                likedSongIds: account.likedSongIds,
            });
        });
        reads.saving = saved;
        return saved;
    };

    // The account stays as it is shown, marked as failed.
    const markFailed = (providerId: OnlineProviderId, error: unknown): void => {
        store().updateAccount(providerId, {
            status: shownUser(providerId) ? 'authenticated' : 'error',
            error: messageOf(error),
            hydration: 'ready',
            freshness: 'error',
        });
    };

    // An account leaves the screen and the disk. `tell` tells the adapter, and runs up to its
    // first wait before the store drops the account: what shows the account asks the adapter
    // again when the store changes. Then the last save is waited for and what was kept goes.
    const drop = async (providerId: OnlineProviderId, reads: PlatformReads, error: string | undefined, tell: () => unknown): Promise<void> => {
        reads.generation += 1;
        reads.whoUnknownAt = null;
        reads.whoUnknownTimes = 0;
        let told: Promise<unknown>;
        try {
            told = Promise.resolve(tell()).then(() => null, messageOf);
        } catch (failure) {
            told = Promise.resolve(messageOf(failure));
        }
        store().clearAccount(providerId, error);
        deps.forgetLikePresses(providerId);
        await reads.saving.catch(() => {});
        const [adapterFailure, removalFailure] = await Promise.all([told, clearProviderAccountSnapshot(providerId).then(() => null, messageOf)]);
        if (adapterFailure !== null) console.warn(`[Account] ${providerId}: its adapter could not be told that the account left: ${adapterFailure}`);
        if (removalFailure !== null) console.warn(`[Account] ${providerId}: the kept account could not be removed: ${removalFailure}`);
    };

    // Asks the platform who is signed in. Answers with the user, or with how the read ends: nobody
    // is signed in (the account, if one was shown, has left), or the platform could not be asked
    // or did not answer within WHO_WAIT_MS (the account stays as shown, marked as failed).
    const askWho = async (provider: OnlineMusicProvider, reads: PlatformReads, generation: number, said: string): Promise<ProviderUser | AccountReadOutcome> => {
        const had = shownUser(provider.id);
        let user: ProviderUser | null;
        try {
            user = await answeredWithin(provider.auth!.getLoginStatus(), WHO_WAIT_MS);
        } catch (error) {
            if (reads.generation !== generation) return 'unknown';
            if (!isAuthRequired(error)) {
                reads.whoUnknownAt = deps.now();
                reads.whoUnknownTimes += 1;
                markFailed(provider.id, error);
                console.warn(`[Account] ${said}: who is signed in could not be asked, the account stays as it is shown: ${messageOf(error)}`);
                return 'unknown';
            }
            user = null;
        }
        if (reads.generation !== generation) return 'unknown';
        reads.whoUnknownAt = null;
        reads.whoUnknownTimes = 0;
        if (user) return user;
        // The platform names nobody, or refuses the sign-in: the account leaves.
        await drop(provider.id, reads, had ? 'auth-required' : undefined, () => provider.auth?.signInRanOut?.());
        console.log(`[Account] ${said}: ${had ? 'the sign-in is no longer valid, the account left' : 'nobody is signed in'}`);
        return had ? 'ran out' : 'nobody';
    };

    // A part of the account could not be read. Refused for the sign-in: the platform is asked who
    // is signed in, and the account leaves where it names nobody. Otherwise, and where it still
    // names a user, the account stays as shown, marked as failed.
    const failed = async (provider: OnlineMusicProvider, reads: PlatformReads, generation: number, said: string, error: unknown): Promise<AccountReadOutcome> => {
        if (reads.generation !== generation) return 'unknown';
        if (isAuthRequired(error)) {
            const who = await askWho(provider, reads, generation, said);
            if (typeof who === 'string') return who;
        }
        markFailed(provider.id, error);
        console.warn(`[Account] ${said}: the account could not be read, it stays as it is shown: ${messageOf(error)}`);
        return 'not read';
    };

    const readWhole = async (
        provider: OnlineMusicProvider,
        reason: AccountReadReason,
        reads: PlatformReads,
        whole: WholeRead,
        likedEnded: (alike: boolean) => void,
    ): Promise<AccountReadOutcome> => {
        const providerId = provider.id;
        const said = `${providerId}: ${reason}`;
        const availability = provider.getAvailability?.() ?? { configured: true };
        if (!availability.configured || !provider.auth) {
            // No way to ask this platform here (the web build has no desktop side): nobody is shown.
            store().clearAccount(providerId, availability.reason);
            return 'nobody';
        }
        const generation = reads.generation;
        const current = () => reads.generation === generation;
        const showsKept = provider.auth.showsKeptAccountAtStart === true;
        if (reason === 'start') {
            if (showsKept) {
                const kept = await keptAccount(provider);
                if (!current()) return 'unknown';
                if (kept) {
                    store().updateAccount(providerId, {
                        status: 'authenticated',
                        user: kept.user,
                        collections: kept.collections,
                        likedSongIds: kept.likedSongIds,
                        hydration: 'ready',
                        freshness: 'stale',
                        lastUpdatedAt: kept.savedAt,
                    });
                }
            } else {
                // Nothing is shown of the account until the platform has named its user.
                store().clearAccount(providerId);
            }
        }
        // While nobody is shown and the platform is asked, such an adapter's account shows as
        // being found out; the others' shows nobody.
        store().updateAccount(providerId, {
            ...(showsKept && !shownUser(providerId) ? { status: 'unknown' as const, hydration: 'loading' as const } : {}),
            freshness: 'refreshing',
            error: undefined,
        });

        const who = await askWho(provider, reads, generation, said);
        if (typeof who === 'string') return who;
        const user = who;
        try {
            const shown = shownUser(providerId);
            if (shown && String(shown.id) === String(user.id)) {
                store().updateAccount(providerId, { status: 'authenticated', user, hydration: 'ready', error: undefined });
            } else {
                // What Folia shows is another user's, or nobody's. Another user's goes at once,
                // with the hearts pressed for it; what was kept of this user is shown while the
                // platform is read.
                if (shown) {
                    store().clearAccount(providerId);
                    deps.forgetLikePresses(providerId);
                }
                const kept = await keptAccount(provider);
                if (!current()) return 'unknown';
                const matching = kept && String(kept.user.id) === String(user.id) ? kept : null;
                store().updateAccount(providerId, {
                    status: 'authenticated',
                    user,
                    collections: matching?.collections ?? [],
                    likedSongIds: matching?.likedSongIds ?? [],
                    hydration: 'ready',
                    freshness: 'refreshing',
                    lastUpdatedAt: matching?.savedAt,
                    error: undefined,
                });
            }

            reads.playlistsBeganAt = deps.now();
            const collections = await playlistsOf(provider, user.id, current);
            if (!current()) return 'unknown';
            if (provider.library?.getCloudCollection) {
                let cloud = store().accounts[providerId]?.collections.find(collection => collection.type === 'cloud') ?? null;
                try {
                    cloud = await provider.library.getCloudCollection(user);
                } catch (error) {
                    console.warn(`[Account] ${said}: the cloud entry could not be read, the one held stays: ${messageOf(error)}`);
                }
                if (!current()) return 'unknown';
                if (cloud) collections.push(cloud);
            }
            // The playlists show before the liked songs are read: that list may take many requests.
            store().updateAccount(providerId, { status: 'authenticated', user, collections, hydration: 'ready', error: undefined });

            let likedSaid = 'its liked songs are not read on this platform';
            if (provider.library?.getLikedSongIds) {
                whole.likedBegun = true;
                try {
                    const likedRead = deps.beginLikedRead(providerId, user.id);
                    const answer = await provider.library.getLikedSongIds(user.id);
                    if (!current()) return 'unknown';
                    // What was read meets the hearts pressed meanwhile by the one rule.
                    likedEnded(deps.applyLikedRead(likedRead, answer).alike);
                    likedSaid = `${answer.ids.length} liked songs read${answer.whole ? '' : ', not to the end'}`;
                } catch (error) {
                    if (!current()) return 'unknown';
                    console.warn(`[Account] ${said}: the liked songs could not be read, the hearts stay as they were: ${messageOf(error)}`);
                    likedSaid = 'the liked songs were not read';
                }
            }

            const saved = await save(providerId, reads, generation, collections);
            if (!current() || !saved) return 'unknown';
            store().updateAccount(providerId, { freshness: 'fresh', lastUpdatedAt: saved.savedAt });
            console.log(`[Account] ${said}: read: ${collections.length} playlists, ${collections.filter(collection => collection.isOwned).length} of them the account's own; ${likedSaid}`);
            return 'read';
        } catch (error) {
            return failed(provider, reads, generation, said, error);
        }
    };

    // Reads the playlists of the account shown again, and nothing else of it: after a change made
    // to one in Folia, and when the home screen is entered. Answers with the playlists read;
    // rejects where they could not be read, with the account marked as failed.
    const readPlaylists = async (providerId: OnlineProviderId): Promise<ProviderCollection[]> => {
        const provider = getOnlineMusicProvider(providerId);
        const account = store().accounts[providerId];
        const userId = account?.user?.id;
        if (!provider || userId === undefined || userId === null) return [];
        const reads = readsOf(providerId);
        const generation = reads.generation;
        // The account shown is still the one read for: the platform may name another user meanwhile
        // (a read of the whole account), and this user's playlists are not that one's.
        const current = () => {
            const shown = shownUser(providerId);
            return reads.generation === generation && !!shown && String(shown.id) === String(userId);
        };
        store().updateAccount(providerId, { freshness: 'refreshing', error: undefined });
        reads.playlistsAlone += 1;
        reads.playlistsBeganAt = deps.now();
        try {
            const playlists = (await playlistsOf(provider, userId, current)).filter(collection => collection.type === 'playlist');
            if (!current()) return playlists;
            const collections = [
                ...(account.collections || []).filter(collection => collection.type !== 'playlist'),
                ...playlists,
            ];
            const saved = await save(providerId, reads, generation, collections);
            if (!current() || !saved) return playlists;
            store().updateAccount(providerId, { collections, freshness: 'fresh', lastUpdatedAt: saved.savedAt });
            return playlists;
        } catch (error) {
            if (current()) {
                store().updateAccount(providerId, {
                    freshness: 'error',
                    error: error instanceof Error ? error.message : 'provider_playlist_refresh_failed',
                });
            }
            throw error;
        } finally {
            reads.playlistsAlone -= 1;
        }
    };

    const accountReads = {
        readPlaylists,

        // Reads the account of a platform whole (see the top of this file). Never rejects.
        read(providerId: OnlineProviderId, reason: AccountReadReason): Promise<AccountReadOutcome> {
            const provider = getOnlineMusicProvider(providerId);
            if (!provider) return Promise.resolve('nobody');
            const reads = readsOf(providerId);
            if (reads.whole && reason !== 'sign-in') return reads.whole.outcome;
            if (reason === 'sign-in') reads.generation += 1;

            let likedEnded!: (alike: boolean) => void;
            let likedNotRead!: (error: Error) => void;
            const liked = new Promise<boolean>((resolve, reject) => { likedEnded = resolve; likedNotRead = reject; });
            // Nobody may be waiting for it.
            liked.catch(() => {});
            const whole: WholeRead = { outcome: Promise.resolve('unknown'), likedBegun: false, liked };
            reads.whole = whole;
            whole.outcome = readWhole(provider, reason, reads, whole, likedEnded)
                .catch((error): AccountReadOutcome => {
                    console.warn(`[Account] ${providerId}: ${reason}: the read ended on a fault: ${messageOf(error)}`);
                    return 'unknown';
                })
                .finally(() => {
                    likedNotRead(new Error('the liked songs were not read'));
                    if (reads.whole === whole) reads.whole = null;
                });
            return whole.outcome;
        },

        // The home screen is entered: the playlists of the account shown are read again. Not
        // while a read of the platform is under way, and not within HOME_WAIT_MS of the last time
        // they were begun to be read; after a failure the next entry reads at once. A read that
        // is refused for the sign-in is checked as in the read of the whole account, so the
        // account may leave ('ran out'). Where nobody is shown because who is signed in could not
        // be asked, the account is read whole instead, once for the entry (joining a read under
        // way), so that it comes back once the platform can be reached; not within HOME_WAIT_MS
        // of the last time it could not be asked, a wait that doubles with each time in a row, up
        // to WHO_RETRY_MAX_MS. Never rejects.
        async readAtHome(providerId: OnlineProviderId): Promise<AccountReadOutcome> {
            const provider = getOnlineMusicProvider(providerId);
            const reads = readsOf(providerId);
            if (provider?.auth && !shownUser(providerId) && reads.whoUnknownAt !== null) {
                const wait = Math.min(HOME_WAIT_MS * 2 ** Math.max(0, reads.whoUnknownTimes - 1), WHO_RETRY_MAX_MS);
                if (!reads.whole && deps.now() - reads.whoUnknownAt <= wait) return 'not asked';
                return accountReads.read(providerId, 'sync');
            }
            if (!provider?.auth || !shownUser(providerId) || reads.whole || reads.playlistsAlone > 0) return 'not asked';
            if (reads.playlistsBeganAt !== null && deps.now() - reads.playlistsBeganAt <= HOME_WAIT_MS) return 'not asked';
            const generation = reads.generation;
            try {
                await readPlaylists(providerId);
                return 'read';
            } catch (error) {
                reads.playlistsBeganAt = null;
                if (reads.generation !== generation) return 'unknown';
                if (isAuthRequired(error)) {
                    const who = await askWho(provider, reads, generation, `${providerId}: home`);
                    if (typeof who === 'string') return who;
                }
                console.warn(`[Account] ${providerId}: home: the playlists could not be read, they stay as they are shown: ${messageOf(error)}`);
                return 'not read';
            }
        },

        // The listener signs out: the adapter's `logout` is told (see `drop`), and the account
        // leaves the screen at once, whatever becomes of the request. Never rejects.
        async signOut(providerId: OnlineProviderId): Promise<void> {
            await drop(providerId, readsOf(providerId), undefined, () => getOnlineMusicProvider(providerId)?.auth?.logout());
            console.log(`[Account] ${providerId}: signed out`);
        },

        // The liked part of the read under way for a platform, for a moment that would read the
        // liked songs itself (readMoments.ts): it joins that read and reads no second time. Null
        // where no read is under way. The promise answers whether the account then holds what the
        // platform's list held at that moment: not where the liked songs had begun to be read
        // before the moment came, since a change made elsewhere in between may not be in them.
        likedOfReadUnderWay(providerId: OnlineProviderId): Promise<boolean> | null {
            const whole = platforms.get(providerId)?.whole;
            if (!whole) return null;
            const begunBefore = whole.likedBegun;
            return whole.liked.then(alike => alike && !begunBefore);
        },
    };
    return accountReads;
};
