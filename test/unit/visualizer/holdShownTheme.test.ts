import { describe, expect, it } from 'vitest';
import { holdShownTheme, type ShownTheme } from '@/components/visualizer/useShownTheme';

// test/unit/visualizer/holdShownTheme.test.ts
// The theme the visualizer draws the song on screen with. A blend moves the live theme to the incoming
// song while the picture still shows the outgoing one; a cancel puts the outgoing song back without
// bringing its theme back.

const themeA = { name: 'A' };
const themeB = { name: 'B' };
const shownA: ShownTheme<{ name: string }> = { songId: 'a', theme: themeA, passed: null };

/** Each step: the live theme, whether a blend shows the outgoing song, and the song on screen. */
const run = (steps: [{ name: string }, boolean, string][]) => steps.reduce(
    (held, [live, showingTail, songId]) => holdShownTheme(held, live, showingTail, songId),
    shownA,
);

describe('holdShownTheme', () => {
    it('follows the live theme without a blend', () => {
        expect(holdShownTheme(shownA, themeA, false, 'a')).toBe(shownA);
        expect(run([[themeB, false, 'a']]).theme).toBe(themeB);
        expect(run([[themeB, false, 'b']]).theme).toBe(themeB);
    });

    it('keeps the song on screen\'s theme through a blend, once the incoming song\'s has come', () => {
        expect(run([[themeA, true, 'a'], [themeB, true, 'a']]).theme).toBe(themeA);
    });

    it('takes the incoming song\'s theme at the settle', () => {
        expect(run([[themeA, true, 'a'], [themeB, true, 'a'], [themeB, false, 'b']]).theme).toBe(themeB);
    });

    it('keeps it after a cancel, until the live theme changes again', () => {
        const cancelled = run([[themeA, true, 'a'], [themeB, true, 'a'], [themeB, false, 'a']]);
        expect(cancelled.theme).toBe(themeA);
        const restored = { name: 'A again' };
        expect(holdShownTheme(cancelled, restored, false, 'a').theme).toBe(restored);
    });
});
