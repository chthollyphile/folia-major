import { useSyncExternalStore } from 'react';
import { getExternalPlaybackCapabilities, subscribeExternalPlayback } from '@/services/externalPlaybackSession';

// src/hooks/useExternalPlaybackCapabilities.ts
export const useExternalPlaybackCapabilities = () =>
    useSyncExternalStore(subscribeExternalPlayback, getExternalPlaybackCapabilities, () => null);
