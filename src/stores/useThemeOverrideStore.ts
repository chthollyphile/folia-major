import { create } from 'zustand';
import type { DualTheme } from '../types';
import { getStoredBoolean } from './storagePrimitives';

// src/stores/useThemeOverrideStore.ts
// A theme laid over the song's theme by someone other than the user: today only a mod, through
// `folium.theme.apply` (Folium 1.10). The theme controller (hooks/useThemeController.ts) shows it in
// place of whichever theme source is active, and ends it whenever the user picks a theme themselves; the
// mods runtime (mods/runtime/theme/hostTheme.ts) writes it and takes it off when its mod goes away.
//
// Nothing here is saved: the layer lasts for this run only, and a mod that wants it back after a restart
// applies it again when it starts. It never touches the user's own themes, the song theme cache or sync.

/** Who changed the override last: the user (any theme choice of theirs), the host (a mod went away), or a mod. */
export type ThemeOverrideChangeOrigin =
    | { readonly kind: 'user' | 'host' }
    | { readonly kind: 'mod'; readonly modId: string };

/** The theme a mod laid over the song's theme. */
export interface ModThemeOverride {
    readonly modId: string;
    readonly modName: string;
    /** Sanitized already, with no regard to the stored animation intensity (the controller lays that over). */
    readonly theme: DualTheme;
}

type ThemeOverrideState = {
    override: ModThemeOverride | null;
    origin: ThemeOverrideChangeOrigin;
    /**
     * The user prefers their custom theme: no override is taken meanwhile. Mirrored from the theme
     * controller, which owns the preference.
     */
    customPreferred: boolean;
    setModOverride: (override: ModThemeOverride) => void;
    /** Takes the override off; false when there was none. */
    clearOverride: (origin: ThemeOverrideChangeOrigin) => boolean;
    setCustomPreferred: (preferred: boolean) => void;
};

/*
 * The custom theme preference as the theme controller saved it (hooks/useThemeController.ts writes this key,
 * true only while a custom theme exists). Read once here because mods activate before the App mounts: until
 * the controller mirrors the flag, this is what refuses their `apply`.
 */
const readSavedCustomPreferred = (): boolean => getStoredBoolean('custom_theme_preferred', false);

export const useThemeOverrideStore = create<ThemeOverrideState>((set, get) => ({
    override: null,
    origin: { kind: 'host' },
    customPreferred: readSavedCustomPreferred(),
    setModOverride: (override) => set({ override, origin: { kind: 'mod', modId: override.modId } }),
    clearOverride: (origin) => {
        if (!get().override) return false;
        set({ override: null, origin });
        return true;
    },
    setCustomPreferred: (customPreferred) => {
        if (get().customPreferred !== customPreferred) set({ customPreferred });
    },
}));

const USER_ORIGIN: ThemeOverrideChangeOrigin = Object.freeze({ kind: 'user' });

/** The user chose a theme themselves: any override ends. */
export const endThemeOverrideForUserChoice = () => {
    useThemeOverrideStore.getState().clearOverride(USER_ORIGIN);
};
