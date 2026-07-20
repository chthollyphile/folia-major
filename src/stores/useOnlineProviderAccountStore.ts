import { create } from 'zustand';
import type { MediaId, OnlineProviderId, ProviderCollection, ProviderUser } from '../types/onlineMusic';

// src/stores/useOnlineProviderAccountStore.ts

export interface OnlineProviderAccountState {
    status: 'unknown' | 'authenticated' | 'anonymous' | 'error';
    user: ProviderUser | null;
    collections: ProviderCollection[];
    likedSongIds: MediaId[];
    error?: string;
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
});

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
        const nextPatch = patch.collections === undefined
            ? patch
            : { ...patch, collections: placeCloudCollectionSecond(patch.collections) };
        return {
            accounts: {
                ...state.accounts,
                [providerId]: { ...(state.accounts[providerId] || emptyAccount()), ...nextPatch },
            },
        };
    }),
    clearAccount: providerId => set(state => ({
        accounts: { ...state.accounts, [providerId]: { ...emptyAccount(), status: 'anonymous' } },
    })),
}));
