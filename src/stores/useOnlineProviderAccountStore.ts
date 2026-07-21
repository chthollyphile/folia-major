import { create } from 'zustand';
import type { MediaId, OnlineProviderId, ProviderCollection, ProviderUser } from '../types/onlineMusic';

// src/stores/useOnlineProviderAccountStore.ts

export interface OnlineProviderAccountState {
    status: 'unknown' | 'authenticated' | 'anonymous' | 'error';
    user: ProviderUser | null;
    collections: ProviderCollection[];
    likedSongIds: MediaId[];
    error?: string;
    hydration: 'loading' | 'ready';
    freshness: 'stale' | 'refreshing' | 'fresh' | 'error';
    lastUpdatedAt?: number;
}

type OnlineProviderAccountStore = {
    accounts: Record<string, OnlineProviderAccountState>;
    activeProviderId: OnlineProviderId;
    setActiveProviderId: (providerId: OnlineProviderId) => void;
    updateAccount: (providerId: OnlineProviderId, patch: Partial<OnlineProviderAccountState>) => void;
    clearAccount: (providerId: OnlineProviderId) => void;
};

const ACTIVE_PROVIDER_KEY = 'active_online_provider_id';

const getInitialProviderId = (): OnlineProviderId => {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return 'netease';
    return localStorage.getItem(ACTIVE_PROVIDER_KEY) || 'netease';
};

const emptyAccount = (): OnlineProviderAccountState => ({
    status: 'unknown',
    user: null,
    collections: [],
    likedSongIds: [],
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

// Keeps the cloud collection in the stable second slot across provider refreshes.
const placeCloudCollectionSecond = (collections: ProviderCollection[]): ProviderCollection[] => {
    const cloud = collections.find(collection => collection.type === 'cloud');
    if (!cloud) return collections;

    const withoutCloud = collections.filter(collection => collection !== cloud);
    return withoutCloud.length > 0
        ? [withoutCloud[0], cloud, ...withoutCloud.slice(1)]
        : [cloud];
};

export const useOnlineProviderAccountStore = create<OnlineProviderAccountStore>(set => ({
    accounts: {},
    activeProviderId: getInitialProviderId(),
    setActiveProviderId: providerId => {
        if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
            localStorage.setItem(ACTIVE_PROVIDER_KEY, providerId);
        }
        set({ activeProviderId: providerId });
    },
    updateAccount: (providerId, patch) => set(state => {
        const previous = state.accounts[providerId] || emptyAccount();
        const nextPatch = patch.collections === undefined
            ? patch
            : {
                ...patch,
                collections: reconcileProviderCollections(
                    previous.collections,
                    placeCloudCollectionSecond(patch.collections),
                ),
            };
        return {
            accounts: {
                ...state.accounts,
                [providerId]: { ...previous, ...nextPatch },
            },
        };
    }),
    clearAccount: providerId => set(state => ({
        accounts: {
            ...state.accounts,
            [providerId]: {
                ...emptyAccount(),
                status: 'anonymous',
                hydration: 'ready',
                freshness: 'fresh',
            },
        },
    })),
}));
