import type { ProviderAccountSummary } from '../../../types/onlineMusic';

// src/components/app/home/onlineProviderAccountView.ts

export type OnlineProviderAccountView = 'resolving' | 'guest' | 'authenticated';

// Keeps an unresolved account distinct from a confirmed anonymous session during startup hydration.
export const resolveOnlineProviderAccountView = ({
    provider,
    hasUser,
    platformAvailable,
}: {
    provider?: ProviderAccountSummary;
    hasUser: boolean;
    platformAvailable: boolean;
}): OnlineProviderAccountView => {
    if (hasUser) return 'authenticated';
    if (platformAvailable && (provider?.hydration === 'loading' || provider?.status === 'unknown')) return 'resolving';
    return 'guest';
};
