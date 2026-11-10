// src/mods/folium/omni/providerIds.ts
// The Omni provider ids of mods' own sources (`omni.providers`): how one is made from the mod's
// registration id, and how to tell one from a built-in provider's. No imports and no side
// effects, so reading it loads neither the experimental registry nor Omni.

// `folium.<modid>.<name>`: dots, because ':' already carries meaning in other host ids, and a dot
// can never collide with a built-in provider id.
export const foliumProviderId = (id: string) => `folium.${id.replace(':', '.')}`;

// Whether an Omni provider id is a mod's source, not one built into Folia.
export const isFoliumProviderId = (providerId: string): boolean => providerId.startsWith('folium.');
