import { OnlineProviderError } from '../../types/onlineMusic';
import type { OnlineMusicProvider, OnlineProviderId, ProviderCapabilities } from '../../types/onlineMusic';
import type { SongResult } from '../../types';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { startsWithoutSources } from '../../dev/devLaunchFlags';
import { announceCacheLimit } from '../audioCache';

// src/services/onlineMusic/providerRegistry.ts

const providers = new Map<OnlineProviderId, OnlineMusicProvider>();

/*
 * The order every list of sources follows (Folium 2.0 plan §10, the remaining stages, step 2): the nine built-in
 * platforms in the order the host registered them statically before any moved to a source mod, then every other
 * source in the order it registered. A built-in platform keeps its place whether the host registers it at load
 * or its source mod registers it once the mod's client starts, so the switcher, the sign-in window and the search
 * commands do not reorder each time one more platform moves to a mod or the mods start in another order.
 */
const BUILT_IN_SOURCE_ORDER: readonly OnlineProviderId[] = ['netease', 'kugou', 'qq', 'bodian', 'ytm', 'spotify', 'qishui', 'appleMusic', 'fnmusic', 'lxmusic'];

// When each id registered (a later registration of the same id counts anew), for the sources after the nine.
const registeredAt = new Map<OnlineProviderId, number>();
let registrationCount = 0;
// The ordered list, rebuilt after a change only when someone reads it.
let orderedProviders: OnlineMusicProvider[] | null = null;

const rankOf = (providerId: OnlineProviderId): number => {
    const builtInIndex = BUILT_IN_SOURCE_ORDER.indexOf(providerId);
    return builtInIndex >= 0 ? builtInIndex : BUILT_IN_SOURCE_ORDER.length + (registeredAt.get(providerId) ?? 0);
};

// Folium mods register and remove providers at runtime, after the UI first read the list. The version
// lets that UI (through omni, see useOnlineProviderPlatform) notice instead of keeping a stale list.
let registryVersion = 0;
const registryListeners = new Set<() => void>();

const announceRegistryChange = () => {
    orderedProviders = null;
    registryVersion += 1;
    registryListeners.forEach(listener => listener());
};

export const registerOnlineMusicProvider = (provider: OnlineMusicProvider): void => {
    // `?noSources` (dev only): none of the nine built-in platforms is registered (their source mods, and the web build's
    // registerWebSources), to see the app with no platform at all.
    if (startsWithoutSources && BUILT_IN_SOURCE_ORDER.includes(provider.id)) return;
    if (!providers.has(provider.id)) {
        registrationCount += 1;
        registeredAt.set(provider.id, registrationCount);
    }
    providers.set(provider.id, provider);
    announceRegistryChange();
};

export const unregisterOnlineMusicProvider = (providerId: OnlineProviderId): void => {
    if (!providers.delete(providerId)) return;
    registeredAt.delete(providerId);
    announceRegistryChange();
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

/** The registered sources in the order the lists show them (BUILT_IN_SOURCE_ORDER above); a fresh array each call. */
export const listOnlineMusicProviders = (): OnlineMusicProvider[] => {
    orderedProviders ??= Array.from(providers.values()).sort((a, b) => rankOf(a.id) - rankOf(b.id));
    return orderedProviders.slice();
};

/**
 * `ids` in the order of listOnlineMusicProviders: the nine built-in platforms in their place, then the other
 * registered sources by registration, then the ids not registered now (a source mod switched off), as given.
 */
export const sortOnlineMusicSourceIds = (ids: readonly OnlineProviderId[]): OnlineProviderId[] => {
    const rank = (id: OnlineProviderId) => (BUILT_IN_SOURCE_ORDER.includes(id) || providers.has(id) ? rankOf(id) : Number.POSITIVE_INFINITY);
    return [...ids].sort((a, b) => {
        const left = rank(a);
        const right = rank(b);
        return left === right ? 0 : left < right ? -1 : 1;
    });
};

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

/**
 * Puts the file `url` plays into the provider's own cache; resolves to whether it is there. That cache
 * is in the media cache budget: the main process hears the listener's limit first, to prune to it.
 */
export const keepProviderSongAudio = async (song: SongResult, url: string): Promise<boolean> => {
    await announceCacheLimit();
    return askProviderCache(song, 'keepAudio', url);
};

export const canPlayOnlineMusicSong = (song: SongResult): boolean => {
    const provider = getOnlineMusicProviderForSong(song);
    return (providerSupports(provider, 'playback') && Boolean(provider?.playback))
        || (providerSupports(provider, 'externalPlayback') && Boolean(provider?.externalPlayback) && provider?.externalPlayback?.canPlay?.(song) !== false);
};

/**
 * The provider sounds this song in a player of its own outside this app (or behind the player page, `surface`):
 * it has one, and the song's route (`routeOf`, where it has more than one way) is not its address.
 */
export const canPlaySongExternally = (song: SongResult): boolean => {
    const provider = getOnlineMusicProviderForSong(song);
    return providerSupports(provider, 'externalPlayback') && Boolean(provider?.externalPlayback)
        && provider?.routeOf?.(song) !== 'audio';
};

/** The song plays in its provider's player and shows that player's picture on the player page (`surface`, plan §4.2). */
export const playsSongOnSurface = (song: SongResult): boolean => {
    const provider = getOnlineMusicProviderForSong(song);
    return canPlaySongExternally(song) && typeof provider?.externalPlayback?.mount === 'function'
        && provider.routeOf?.(song) === 'surface';
};

export const requireOnlineMusicProviderForSong = (song: SongResult): OnlineMusicProvider => {
    const sourceRef = getPlaybackSourceRef(song);
    if (sourceRef.kind !== 'online') {
        throw new OnlineProviderError('unsupported', `Song is not from an online provider: ${sourceRef.kind}`);
    }
    return requireOnlineMusicProvider(sourceRef.providerId);
};
