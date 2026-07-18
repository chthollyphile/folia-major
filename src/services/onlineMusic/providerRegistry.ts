import { OnlineProviderError } from '../../types/onlineMusic';
import type { OnlineMusicProvider, OnlineProviderId, ProviderCapabilities } from '../../types/onlineMusic';
import type { SongResult } from '../../types';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { neteaseProvider } from './neteaseProvider';
import { kugouProvider } from './kugouProvider';

// src/services/onlineMusic/providerRegistry.ts

const providers = new Map<OnlineProviderId, OnlineMusicProvider>();

export const registerOnlineMusicProvider = (provider: OnlineMusicProvider): void => {
    providers.set(provider.id, provider);
};

export const unregisterOnlineMusicProvider = (providerId: OnlineProviderId): void => {
    providers.delete(providerId);
};

export const getOnlineMusicProvider = (providerId: OnlineProviderId): OnlineMusicProvider | null => (
    providers.get(providerId) || null
);

export const listOnlineMusicProviders = (): OnlineMusicProvider[] => Array.from(providers.values());

export const requireOnlineMusicProvider = (providerId: OnlineProviderId): OnlineMusicProvider => {
    const provider = getOnlineMusicProvider(providerId);
    if (!provider) {
        throw new OnlineProviderError('unavailable', `Online music provider is not registered: ${providerId}`, providerId);
    }
    return provider;
};

export const providerSupports = (
    provider: OnlineMusicProvider | null | undefined,
    capability: keyof ProviderCapabilities,
): boolean => Boolean(provider?.capabilities[capability]);

export const getOnlineMusicProviderForSong = (song: SongResult): OnlineMusicProvider | null => {
    const sourceRef = getPlaybackSourceRef(song);
    return sourceRef.kind === 'online' ? getOnlineMusicProvider(sourceRef.providerId) : null;
};

export const canPlayOnlineMusicSong = (song: SongResult): boolean => {
    const provider = getOnlineMusicProviderForSong(song);
    return providerSupports(provider, 'playback') && Boolean(provider?.playback);
};

export const requireOnlineMusicProviderForSong = (song: SongResult): OnlineMusicProvider => {
    const sourceRef = getPlaybackSourceRef(song);
    if (sourceRef.kind !== 'online') {
        throw new OnlineProviderError('unsupported', `Song is not from an online provider: ${sourceRef.kind}`);
    }
    return requireOnlineMusicProvider(sourceRef.providerId);
};

registerOnlineMusicProvider(neteaseProvider);
registerOnlineMusicProvider(kugouProvider);
