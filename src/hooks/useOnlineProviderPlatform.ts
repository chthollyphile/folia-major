import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { omni } from '../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import type { OnlineProviderId, ProviderAccountSummary } from '../types/onlineMusic';

// src/hooks/useOnlineProviderPlatform.ts

export type OnlineProviderPlatformState = {
    providers: ProviderAccountSummary[];
    activeProviderId: OnlineProviderId;
    activeProvider: ProviderAccountSummary | undefined;
    switchProvider: (providerId: OnlineProviderId) => Promise<boolean>;
    refreshProvider: (providerId: OnlineProviderId) => Promise<unknown>;
};

type ProviderSwitchTransaction = {
    currentProviderId: OnlineProviderId;
    nextProviderId: OnlineProviderId;
    prepare?: (currentProviderId: OnlineProviderId, nextProviderId: OnlineProviderId) => Promise<boolean>;
    commit: (providerId: OnlineProviderId) => void;
    refresh?: () => Promise<unknown>;
};

// Commits a provider change only after cleanup is confirmed, then refreshes the new account namespace.
export const switchOnlineProviderTransaction = async ({
    currentProviderId,
    nextProviderId,
    prepare,
    commit,
    refresh,
}: ProviderSwitchTransaction): Promise<boolean> => {
    if (nextProviderId === currentProviderId) return true;
    if (prepare && !await prepare(currentProviderId, nextProviderId)) return false;
    omni.invalidateActiveRequests();
    commit(nextProviderId);
    await refresh?.();
    return true;
};

export const useOnlineProviderPlatform = (
    refreshers: Partial<Record<OnlineProviderId, () => Promise<unknown>>>,
    prepareSwitch?: (currentProviderId: OnlineProviderId, nextProviderId: OnlineProviderId) => Promise<boolean>,
): OnlineProviderPlatformState => {
    const { accounts, activeProviderId, setActiveProviderId } = useOnlineProviderAccountStore(useShallow(state => ({
        accounts: state.accounts,
        activeProviderId: state.activeProviderId,
        setActiveProviderId: state.setActiveProviderId,
    })));

    const providers = useMemo<ProviderAccountSummary[]>(() => omni.getProviderSummaries(), [accounts]);
    const refreshProvider = useCallback(async (providerId: OnlineProviderId) => {
        return await refreshers[providerId]?.();
    }, [refreshers]);
    const switchProvider = useCallback((providerId: OnlineProviderId) => switchOnlineProviderTransaction({
        currentProviderId: activeProviderId,
        nextProviderId: providerId,
        prepare: prepareSwitch,
        commit: setActiveProviderId,
        refresh: refreshers[providerId],
    }), [activeProviderId, prepareSwitch, refreshers, setActiveProviderId]);

    const activeProvider = providers.find(provider => provider.providerId === activeProviderId) || providers[0];
    return { providers, activeProviderId, activeProvider, switchProvider, refreshProvider };
};
