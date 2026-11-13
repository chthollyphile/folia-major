import { getOnlineMusicProvider } from './providerRegistry';

// src/services/onlineMusic/sourceReadiness.ts
// When the built-in online platforms have all had their chance to register. Startup steps that would lose data
// if a platform registered late (the session restore) wait for it first.
//
// Folium 2.0 seam (S1): the nine platforms are still registered statically when providerRegistry.ts loads, so
// this is settled from the start. S2 hands it the mod loader's promise (clientLoader's `builtinSourcesSettled`,
// with its own time limit) through `setBuiltinSourcesSettled`; callers do not change.

let settled: Promise<void> = Promise.resolve();

/** Resolves once the built-in platforms are registered, or have given up (it never rejects). */
export const builtinSourcesSettled = (): Promise<void> => settled;

/** Replaces what `builtinSourcesSettled` waits for. A rejection counts as settled. */
export const setBuiltinSourcesSettled = (promise: Promise<unknown>): void => {
    settled = promise.then(() => undefined, () => undefined);
};

/**
 * Whether the platform `providerId` is enabled now. Folium 2.0 seam (S1): registered means enabled; S2 adds
 * the per-source switch (a source turned off is not registered at all, and one that failed to start neither).
 */
export const isSourceEnabled = (providerId: string): boolean => Boolean(getOnlineMusicProvider(providerId));
