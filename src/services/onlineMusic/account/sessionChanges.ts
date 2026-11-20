import type { OnlineProviderId } from '../../../types/onlineMusic';

// Provider transports report a session change; omni re-reads the account through its adapter.
// This is a hint, never permission to clear a possibly newer sign-in directly.
const listeners = new Set<(providerId: OnlineProviderId) => void>();

export const onProviderSessionChanged = (listener: (providerId: OnlineProviderId) => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const notifyProviderSessionChanged = (providerId: OnlineProviderId): void => {
    for (const listener of listeners) listener(providerId);
};
