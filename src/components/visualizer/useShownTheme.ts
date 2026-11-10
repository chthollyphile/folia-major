import { useState } from 'react';
import type { MediaId } from '../../types/onlineMusic';

// src/components/visualizer/useShownTheme.ts
// The theme the visualizer draws the song on screen with (useVisualizerRendererModel). A blend moves the
// live state to the incoming song at the arm, and the live theme follows once that song's theme comes,
// while the picture still shows the outgoing song: that one keeps its own theme until the blend settles.
// The incoming song's theme goes with the hand-off (VisualizerSongHandoff) to the style that draws one.

/** The theme kept for the song on screen, and the live theme while a blend held it back. */
export interface ShownTheme<T> {
    songId: MediaId | null | undefined;
    theme: T;
    /** The live theme while a blend showed this one: the incoming song's once it came, else this one. */
    passed: T | null;
}

/**
 * The theme for the song on screen (`songId`): the live one, except through a blend (`showingTail`),
 * where the song on screen keeps the theme it had. A blend cancelled back onto that song keeps it until
 * the live theme changes again: until then the live theme is still the one the incoming song brought.
 */
export const holdShownTheme = <T>(
    held: ShownTheme<T>,
    live: T,
    showingTail: boolean,
    songId: MediaId | null | undefined,
): ShownTheme<T> => {
    if (showingTail) return held.passed === live ? held : { ...held, passed: live };
    if (held.songId === songId && (held.passed === null ? held.theme === live : held.passed === live)) return held;
    return { songId, theme: live, passed: null };
};

/** The theme for the song on screen, given the live theme and whether a blend shows the outgoing song. */
export const useShownTheme = <T>(live: T, showingTail: boolean, songId: MediaId | null | undefined): T => {
    const [held, setHeld] = useState<ShownTheme<T>>(() => ({ songId, theme: live, passed: null }));
    const next = holdShownTheme(held, live, showingTail, songId);
    if (next !== held) setHeld(next);
    return next.theme;
};
