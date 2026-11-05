import React from 'react';
import type { OnlineProviderId } from '../../types/onlineMusic';

// Platform-owned setup sections are discovered beside the login UI, without provider rules in LoginScreen.
const entries = import.meta.glob<{ default: React.ComponentType<{ signedIn: boolean }> }>('./*/PlaybackSettings.tsx', { eager: true });
export const ProviderPlaybackSettings = ({ providerId, signedIn }: { providerId: OnlineProviderId | null; signedIn: boolean }) => {
    const Settings = entries[`./${providerId}/PlaybackSettings.tsx`]?.default;
    return Settings ? <Settings signedIn={signedIn} /> : null;
};
