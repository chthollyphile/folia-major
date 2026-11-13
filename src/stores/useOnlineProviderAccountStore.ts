import { create } from 'zustand';
import type { MediaId, OnlineProviderId, ProviderCollection, ProviderUser } from '../types/onlineMusic';

// src/stores/useOnlineProviderAccountStore.ts

export interface OnlineProviderAccountState {
    status: 'unknown' | 'authenticated' | 'anonymous' | 'error';
    user: ProviderUser | null;
    collections: ProviderCollection[];
    likedSongIds: MediaId[];
    /**
     * What a press on a heart asked for, by song id, while its request is not settled. It is shown
     * in place of `likedSongIds` for those songs; `likedSongIds` stays what the provider holds.
     * Written by omni alone (see `pressSongLike`).
     */
    wantedLikes: Record<string, boolean>;
    error?: string;
    hydration: 'loading' | 'ready';
    freshness: 'stale' | 'refreshing' | 'fresh' | 'error';
    lastUpdatedAt?: number;
}

type OnlineProviderAccountStore = {
    accounts: Record<string, OnlineProviderAccountState>;
    /**
     * The platform in effect: the listener's choice while it is registered, else the first registered one.
     * Every reader reads this. '' only when no choice was ever made and no platform is registered.
     */
    activeProviderId: OnlineProviderId;
    /**
     * The listener's own choice, as stored ('' for none yet). Written only by `setActiveProviderId`: a platform
     * that is missing for now (not registered yet, turned off) leaves it as it is, so it is in effect again
     * once that platform is back.
     */
    chosenProviderId: OnlineProviderId;
    /** The listener chose `providerId`: stored, and in effect from now. */
    setActiveProviderId: (providerId: OnlineProviderId) => void;
    /**
     * The registered platforms changed (`registeredIds`, in registration order): the one in effect is worked out
     * again from the stored choice, in memory only. Nothing is stored.
     */
    settleActiveProvider: (registeredIds: readonly OnlineProviderId[]) => void;
    updateAccount: (providerId: OnlineProviderId, patch: Partial<OnlineProviderAccountState>) => void;
    clearAccount: (providerId: OnlineProviderId, error?: string) => void;
};

const ACTIVE_PROVIDER_KEY = 'active_online_provider_id';

// There is no default platform: with nothing stored, the first registered one is in effect.
const getInitialProviderId = (): OnlineProviderId => {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return '';
    return localStorage.getItem(ACTIVE_PROVIDER_KEY) || '';
};

/**
 * The platform in effect: the chosen one while it is registered; else the one in effect so far while it is
 * still registered (a platform coming or going elsewhere does not move it); else the first registered one; the
 * chosen one itself when none is registered (no platform at all: every reader finds it missing and shows its
 * empty state).
 */
export const resolveEffectiveProviderId = (
    chosenProviderId: OnlineProviderId,
    registeredIds: readonly OnlineProviderId[],
    currentProviderId: OnlineProviderId = chosenProviderId,
): OnlineProviderId => {
    if (registeredIds.includes(chosenProviderId)) return chosenProviderId;
    if (registeredIds.includes(currentProviderId)) return currentProviderId;
    return registeredIds[0] ?? chosenProviderId;
};

const emptyAccount = (): OnlineProviderAccountState => ({
    status: 'unknown',
    user: null,
    collections: [],
    likedSongIds: [],
    wantedLikes: {},
    hydration: 'loading',
    freshness: 'stale',
});

const collectionKey = (collection: ProviderCollection): string => (
    `${collection.providerId}:${collection.type}:${String(collection.id)}`
);

const areCollectionSnapshotsEqual = (left: ProviderCollection, right: ProviderCollection): boolean => {
    const leftKeys = Object.keys(left) as Array<keyof ProviderCollection>;
    const rightKeys = Object.keys(right) as Array<keyof ProviderCollection>;
    return leftKeys.length === rightKeys.length
        && leftKeys.every(key => {
            const leftValue = left[key];
            const rightValue = right[key];
            if (Object.is(leftValue, rightValue)) return true;
            if (leftValue && rightValue && typeof leftValue === 'object' && typeof rightValue === 'object') {
                return JSON.stringify(leftValue) === JSON.stringify(rightValue);
            }
            return false;
        });
};

// Preserves object and array references for unchanged collection cards during silent refreshes.
export const reconcileProviderCollections = (
    previous: ProviderCollection[],
    incoming: ProviderCollection[],
): ProviderCollection[] => {
    const previousByKey = new Map(previous.map(collection => [collectionKey(collection), collection]));
    const reconciled = incoming.map(collection => {
        const existing = previousByKey.get(collectionKey(collection));
        return existing && areCollectionSnapshotsEqual(existing, collection) ? existing : collection;
    });
    return reconciled.length === previous.length
        && reconciled.every((collection, index) => collection === previous[index])
        ? previous
        : reconciled;
};

// Keeps the cloud collection in the stable second slot across provider refreshes, and the listening
// ranking's entries right after it: a refresh of the playlists alone puts the entries it keeps first.
const placeAccountEntriesSecond = (collections: ProviderCollection[]): ProviderCollection[] => {
    const cloud = collections.find(collection => collection.type === 'cloud');
    const ranks = collections.filter(collection => collection.type === 'listening_rank');
    if (!cloud && ranks.length === 0) return collections;

    const entries = [...(cloud ? [cloud] : []), ...ranks];
    const rest = collections.filter(collection => collection !== cloud && collection.type !== 'listening_rank');
    return rest.length > 0
        ? [rest[0], ...entries, ...rest.slice(1)]
        : entries;
};

const initialProviderId = getInitialProviderId();

export const useOnlineProviderAccountStore = create<OnlineProviderAccountStore>((set, get) => ({
    accounts: {},
    activeProviderId: initialProviderId,
    chosenProviderId: initialProviderId,
    setActiveProviderId: providerId => {
        if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
            localStorage.setItem(ACTIVE_PROVIDER_KEY, providerId);
        }
        set({ activeProviderId: providerId, chosenProviderId: providerId });
    },
    settleActiveProvider: registeredIds => {
        const next = resolveEffectiveProviderId(get().chosenProviderId, registeredIds, get().activeProviderId);
        if (next !== get().activeProviderId) set({ activeProviderId: next });
    },
    updateAccount: (providerId, patch) => set(state => {
        const previous = state.accounts[providerId] || emptyAccount();
        const nextPatch = patch.collections === undefined
            ? patch
            : {
                ...patch,
                collections: reconcileProviderCollections(
                    previous.collections,
                    placeAccountEntriesSecond(patch.collections),
                ),
            };
        return {
            accounts: {
                ...state.accounts,
                [providerId]: { ...previous, ...nextPatch },
            },
        };
    }),
    clearAccount: (providerId, error) => set(state => ({
        accounts: {
            ...state.accounts,
            [providerId]: {
                ...emptyAccount(),
                status: 'anonymous',
                hydration: 'ready',
                freshness: 'fresh',
                error,
            },
        },
    })),
}));
