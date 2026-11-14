import { getOnlineMusicProvider } from './providerRegistry';
import { getSourceState } from './sourceStates';

// src/services/onlineMusic/sourceReadiness.ts
// When the built-in online platforms have all had their chance to register. Startup steps that would lose data
// if a platform registered late (the session restore) wait for it first.
//
// Folium 2.0 (S2): the main window's mod runtime hands in what it waits for (src/mods/runtime/mainWindowStart.ts):
// the source mods' clients have started (or the first screen's 3 s for them ran out) and the source states have
// arrived. Until then, and where there is no mod runtime (the web build, tests), it is settled from the start.

let settled: Promise<void> = Promise.resolve();

/** Resolves once the built-in platforms are registered, or have given up (it never rejects). */
export const builtinSourcesSettled = (): Promise<void> => settled;

/** Replaces what `builtinSourcesSettled` waits for. A rejection counts as settled. */
export const setBuiltinSourcesSettled = (promise: Promise<unknown>): void => {
    settled = promise.then(() => undefined, () => undefined);
};

/**
 * Whether the platform `providerId` is enabled now: registered, and switched on (Folium 2.0 plan §5.3). A source
 * used only for matching is registered but counts as not enabled for playback and the interface; a disabled one
 * is not registered once it is a mod, and counts as not enabled either way.
 */
export const isSourceEnabled = (providerId: string): boolean => (
    Boolean(getOnlineMusicProvider(providerId)) && getSourceState(providerId) === 'enabled'
);

/** Whether `providerId` is registered and used only for matching (plan §5.3): anonymous lyric and metadata matching only. */
export const isSourceMatchingOnly = (providerId: string): boolean => (
    Boolean(getOnlineMusicProvider(providerId)) && getSourceState(providerId) === 'matching'
);
