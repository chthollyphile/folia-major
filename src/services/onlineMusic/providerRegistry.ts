import { OnlineProviderError } from '../../types/onlineMusic';
import type { OnlineMusicProvider, OnlineProviderId, ProviderCapabilities } from '../../types/onlineMusic';
import type { SongResult } from '../../types';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { neteaseProvider } from './netease/neteaseProvider';
import { kugouProvider } from './kugou/kugouProvider';
import { qqProvider } from './qq/qqProvider';
import { bodianProvider } from './bodian/bodianProvider';
import { ytmProvider } from './ytm/ytmProvider';
import { spotifyProvider } from './spotify/spotifyProvider';
import { sodaProvider } from './soda/sodaProvider';

// src/services/onlineMusic/providerRegistry.ts

const providers = new Map<OnlineProviderId, OnlineMusicProvider>();

// Folium mods register and remove providers at runtime, after the UI first read the list. The version
// lets that UI (through omni, see useOnlineProviderPlatform) notice instead of keeping a stale list.
let registryVersion = 0;
const registryListeners = new Set<() => void>();

const announceRegistryChange = () => {
    registryVersion += 1;
    registryListeners.forEach(listener => listener());
};

export const registerOnlineMusicProvider = (provider: OnlineMusicProvider): void => {
    providers.set(provider.id, provider);
    announceRegistryChange();
};

export const unregisterOnlineMusicProvider = (providerId: OnlineProviderId): void => {
    if (providers.delete(providerId)) announceRegistryChange();
};

/** Bumped by every registration and removal. */
export const getOnlineMusicProviderRegistryVersion = (): number => registryVersion;

/** Calls `listener` after every registration and removal; returns the unsubscribe function. */
export const subscribeOnlineMusicProviderRegistry = (listener: () => void): (() => void) => {
    registryListeners.add(listener);
    return () => {
        registryListeners.delete(listener);
    };
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

// A provider can keep its audio in a cache of its own (`playback.keepAudio`): Spotify's files are
// encrypted where Spotify keeps them, and the desktop side keeps them on disk that way, without
// their key. Nothing writes such a song to the media cache; its audio is asked of the provider's
// cache instead, by the URL the song plays from, and a kept file is read by reading that URL.
export const keepsOwnSongAudio = (song: SongResult): boolean => {
    const playback = getOnlineMusicProviderForSong(song)?.playback;
    return Boolean(playback?.keepAudio && playback.hasKeptAudio);
};

// A provider that cannot be asked, or fails in any way, holds nothing.
const askProviderCache = async (song: SongResult, ask: 'hasKeptAudio' | 'keepAudio', url: string): Promise<boolean> => {
    try {
        return Boolean(await getOnlineMusicProviderForSong(song)?.playback?.[ask]?.(url));
    } catch {
        return false;
    }
};

/** Whether the provider's own cache holds the file `url` plays. */
export const hasProviderKeptSongAudio = (song: SongResult, url: string): Promise<boolean> => askProviderCache(song, 'hasKeptAudio', url);

/** Puts the file `url` plays into the provider's own cache; resolves to whether it is there. */
export const keepProviderSongAudio = (song: SongResult, url: string): Promise<boolean> => askProviderCache(song, 'keepAudio', url);

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
registerOnlineMusicProvider(qqProvider);
registerOnlineMusicProvider(bodianProvider);
registerOnlineMusicProvider(ytmProvider);
registerOnlineMusicProvider(spotifyProvider);
registerOnlineMusicProvider(sodaProvider);
