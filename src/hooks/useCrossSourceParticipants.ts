import { useMemo, useSyncExternalStore } from 'react';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import { omni } from '../services/onlineMusic/omni';
import { participants, type CrossSourceFeature, type CrossSourceParticipants } from '../services/onlineMusic/crossSource';

// src/hooks/useCrossSourceParticipants.ts
// The sources taking part in a cross-source feature now (crossSource.ts), for the screens that list them:
// worked out again when a platform comes or goes, when someone signs in or out, and when a platform's
// configuration changes.

const subscribeProviders = (listener: () => void) => omni.subscribeProviders(listener);
const getProviderRegistryVersion = () => omni.getProviderRegistryVersion();

export const useCrossSourceParticipants = (feature: CrossSourceFeature): CrossSourceParticipants => {
    // Only who is signed in where: a heart pressed does not change this string.
    const signIns = useOnlineProviderAccountStore(state => Object.entries(state.accounts)
        .map(([providerId, account]) => `${providerId}:${account.status}:${account.user ? 1 : 0}`)
        .join('|'));
    const registryVersion = useSyncExternalStore(subscribeProviders, getProviderRegistryVersion);
    // Read on every render: a platform's configuration (getAvailability) changes with nothing telling a memo.
    const configured = omni.getProviderSummaries().filter(provider => provider.availability.configured).map(provider => provider.providerId).join();
    return useMemo(() => participants(feature),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the strings stand for what participants() reads
        [feature, signIns, configured, registryVersion]);
};
