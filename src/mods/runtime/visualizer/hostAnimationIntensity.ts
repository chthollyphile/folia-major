import { useEffect, useRef } from 'react';
import { readStoredAnimationIntensity } from '@/services/themePreferences';
import type { Theme } from '@/types';
import type { ModRuntimeInfo } from '../../types';
import type { FoliumAnimationIntensity, FoliumVisualizerChangeOrigin } from '../../folium/contract';
import { emitFoliumEvent } from '../../folium/events';

// src/mods/runtime/visualizer/hostAnimationIntensity.ts
// The animation intensity behind `folium.visualizer` (Folium 1.9). Unlike the rest of the lyric display
// settings it is no store value: the theme carries it, the theme is App state (useThemeController), and what
// is saved (services/themePreferences.ts) is laid over every theme that is applied. So the read is the saved
// value, which the theme controller writes in the same call that takes a new theme; the write goes through
// the App's own setTheme, the one the player panel's chip calls; and the event follows the theme the App
// renders. The host's Theme['animationIntensity'] and the contract's FoliumAnimationIntensity are the same
// list: a level either side gains and the other lacks fails to compile here.

/** The App's setTheme for one level, while the App is mounted. */
let applyIntensity: ((value: FoliumAnimationIntensity) => void) | null = null;

// The mod whose write is on its way to the theme: the App renders it a commit later.
let pendingModWrite: { modId: string; value: FoliumAnimationIntensity } | null = null;

const USER_ORIGIN: FoliumVisualizerChangeOrigin = Object.freeze({ kind: 'user', modId: null });

/** The animation intensity now: the saved one, which every applied theme carries. */
export const readFoliumAnimationIntensity = (): FoliumAnimationIntensity => readStoredAnimationIntensity();

/**
 * Sets the intensity as the player panel's chip does, for this mod; whether anything changed. Before the App
 * has mounted there is no theme to set: the call fails as the `folium.ui` calls do then.
 */
export const writeFoliumAnimationIntensity = (mod: ModRuntimeInfo, value: FoliumAnimationIntensity): boolean => {
    if (!applyIntensity) throw new Error('visualizer-unavailable-in-main-context');
    const before = readStoredAnimationIntensity();
    applyIntensity(value);
    const changed = readStoredAnimationIntensity() !== before;
    if (changed) {
        pendingModWrite = { modId: mod.id, value };
        console.info(`[FoliumVisualizer] ${mod.id} set the animation intensity to ${value}`);
    }
    return changed;
};

/**
 * Connects the App's theme to `folium.visualizer`: the write above reaches `setTheme`, and
 * `visualizer.animationIntensityChanged` fires when the theme on screen takes another level, as the mod's
 * whose write brought it there, as the user's otherwise. The App calls it once.
 */
export const useFoliumAnimationIntensity = (theme: Theme, setTheme: (theme: Theme) => void) => {
    const latest = useRef({ theme, setTheme });
    latest.current = { theme, setTheme };

    useEffect(() => {
        const apply = (value: FoliumAnimationIntensity) => {
            latest.current.setTheme({ ...latest.current.theme, animationIntensity: value });
        };
        applyIntensity = apply;
        return () => {
            if (applyIntensity === apply) applyIntensity = null;
        };
    }, []);

    const intensity: FoliumAnimationIntensity = theme.animationIntensity;
    const reported = useRef(intensity);
    useEffect(() => {
        if (reported.current === intensity) return;
        reported.current = intensity;
        const write = pendingModWrite;
        pendingModWrite = null;
        const origin = write?.value === intensity ? Object.freeze({ kind: 'mod' as const, modId: write.modId }) : USER_ORIGIN;
        emitFoliumEvent('visualizer.animationIntensityChanged', { intensity, origin });
    }, [intensity]);
};
