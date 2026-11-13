import type { OnlineMusicProvider } from '@/types/onlineMusic';
import {
    getOnlineMusicProvider,
    registerOnlineMusicProvider,
    unregisterOnlineMusicProvider,
} from '@/services/onlineMusic/providerRegistry';

// src/mods/folium/registries/heldProviders.ts
// The host provider ids mods hold (Folium 2.0): one id, one mod, whether its provider came through folium.sources
// (sources.ts) or the experimental omni.providers (omniProviders.ts), and the custom capabilities of each, for
// folium.omni.capability. A file of its own so the experimental surfaces do not load the source adapter.

/** Where a host provider id held by a mod came from. */
export type FoliumProviderOrigin = 'sources' | 'omni.providers';

interface HeldProvider {
    modId: string;
    origin: FoliumProviderOrigin;
    provider: OnlineMusicProvider;
    /** The source's custom capabilities, by id (`x.<mod id>.<name>@<version>`). */
    custom: ReadonlyMap<string, unknown>;
}

const held = new Map<string, HeldProvider>();

/**
 * Registers `provider` as held by `modId` (Folium 2 sources and the experimental `omni.providers`), or in place of
 * the one it held under that id. Throws when another provider already has its id, built-in or a mod's.
 */
export const holdFoliumProvider = (
    modId: string,
    origin: FoliumProviderOrigin,
    provider: OnlineMusicProvider,
    custom: ReadonlyMap<string, unknown> = new Map(),
): void => {
    const current = held.get(provider.id);
    if (current ? current.modId !== modId || current.origin !== origin : getOnlineMusicProvider(provider.id)) {
        throw new Error(`provider "${provider.id}" already exists`);
    }
    held.set(provider.id, { modId, origin, provider, custom });
    registerOnlineMusicProvider(provider);
};

/** Undoes holdFoliumProvider, when `provider` is still the one held under its id. */
export const releaseFoliumProvider = (provider: OnlineMusicProvider): void => {
    if (held.get(provider.id)?.provider !== provider) return;
    held.delete(provider.id);
    if (getOnlineMusicProvider(provider.id) === provider) unregisterOnlineMusicProvider(provider.id);
};

/** Which mod holds a provider id, and through what; null for a built-in provider or none. */
export const getFoliumProviderHolder = (providerId: string): { modId: string; origin: FoliumProviderOrigin } | null => {
    const entry = held.get(providerId);
    return entry ? { modId: entry.modId, origin: entry.origin } : null;
};

/** `folium.omni.capability`: a source's custom capability by id, the mod's own object; null without one. */
export const getFoliumSourceCapability = (sourceId: string, id: string): unknown => {
    if (typeof sourceId !== 'string' || typeof id !== 'string') return null;
    return held.get(sourceId)?.custom.get(id) ?? null;
};

