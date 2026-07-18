import { create } from 'zustand';
import type { MediaId, OnlineProviderId, ProviderCollection, ProviderUser } from '../types/onlineMusic';

// src/stores/useOnlineProviderAccountStore.ts

export interface OnlineProviderAccountState {
    status: 'unknown' | 'authenticated' | 'anonymous' | 'error';
    user: ProviderUser | null;
    collections: ProviderCollection[];
    likedSongIds: MediaId[];
}

type OnlineProviderAccountStore = {
    accounts: Record<string, OnlineProviderAccountState>;
    updateAccount: (providerId: OnlineProviderId, patch: Partial<OnlineProviderAccountState>) => void;
    clearAccount: (providerId: OnlineProviderId) => void;
};

const emptyAccount = (): OnlineProviderAccountState => ({
    status: 'unknown',
    user: null,
    collections: [],
    likedSongIds: [],
});

export const useOnlineProviderAccountStore = create<OnlineProviderAccountStore>(set => ({
    accounts: {},
    updateAccount: (providerId, patch) => set(state => ({
        accounts: {
            ...state.accounts,
            [providerId]: { ...(state.accounts[providerId] || emptyAccount()), ...patch },
        },
    })),
    clearAccount: providerId => set(state => ({
        accounts: { ...state.accounts, [providerId]: { ...emptyAccount(), status: 'anonymous' } },
    })),
}));
