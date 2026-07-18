import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { listOnlineMusicProviders } from '../services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import type { OnlineProviderId, ProviderAccountSummary } from '../types/onlineMusic';

// src/hooks/useOnlineProviderPlatform.ts

export type OnlineProviderPlatformState = {
    providers: ProviderAccountSummary[];
    activeProviderId: OnlineProviderId;
    activeProvider: ProviderAccountSummary | undefined;
    setActiveProviderId: (providerId: OnlineProviderId) => void;
    refreshProvider: (providerId: OnlineProviderId) => Promise<void>;
};

export const useOnlineProviderPlatform = (
    refreshers: Partial<Record<OnlineProviderId, () => Promise<unknown>>>,
): OnlineProviderPlatformState => {
    const { accounts, activeProviderId, setActiveProviderId } = useOnlineProviderAccountStore(useShallow(state => ({
        accounts: state.accounts,
        activeProviderId: state.activeProviderId,
        setActiveProviderId: state.setActiveProviderId,
    })));

    const providers = useMemo<ProviderAccountSummary[]>(() => listOnlineMusicProviders().map(provider => {
        const account = accounts[provider.id];
        return {
            providerId: provider.id,
            displayName: provider.displayName,
            shortName: provider.shortName || provider.displayName,
            availability: provider.getAvailability?.() ?? { configured: true },
            status: account?.status || 'unknown',
            user: account?.user || null,
            collections: account?.collections || [],
            error: account?.error,
        };
    }), [accounts]);

    const refreshProvider = useCallback(async (providerId: OnlineProviderId) => {
        await refreshers[providerId]?.();
    }, [refreshers]);

    const activeProvider = providers.find(provider => provider.providerId === activeProviderId) || providers[0];
    return { providers, activeProviderId, activeProvider, setActiveProviderId, refreshProvider };
};
