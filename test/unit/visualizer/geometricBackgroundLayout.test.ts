// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue } from 'framer-motion';
import GeometricBackground from '@/components/visualizer/backgrounds/common/GeometricBackground';
import type { AudioBands, Theme } from '@/types';
import { loadLucideIcons } from '@/services/lucideIconResolver';

// test/unit/visualizer/geometricBackgroundLayout.test.ts
// The geometric background lays its shapes out from the seed alone. The theme of a song often comes
// after the song, each time with a new icon list (also an empty one): it recolours the shapes and
// fills their icon slots in place, and a pause holds them, but neither lays them out again. A new
// seed does. The shapes' loops are CSS animations: the elements stay the same, or the loops restart.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const audioPower = motionValue(0);
const audioBands = {
    bass: motionValue(0), lowMid: motionValue(0), mid: motionValue(0), vocal: motionValue(0), treble: motionValue(0),
} as unknown as AudioBands;
const themeWith = (patch: Partial<Theme>) => ({
    backgroundColor: '#000000', primaryColor: '#ffffff', secondaryColor: '#888888', accentColor: '#ff0000', lyricsIcons: [], ...patch,
} as unknown as Theme);

let root: Root | null = null;
beforeEach(() => {
    // The layout is random; a fixed sequence gives it icon slots every run.
    let seed = 7;
    vi.spyOn(Math, 'random').mockImplementation(() => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    });
});
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

const show = (seed: string, theme: Theme, paused = false) => act(() => root!.render(React.createElement(GeometricBackground, {
    theme, audioPower, audioBands, seed, paused,
})));
/** Each shape's place, in order. */
const places = () => [...document.querySelectorAll<HTMLElement>('.geometric-drift')].map(shape => `${shape.style.left} ${shape.style.top}`);
const nodes = (selector: string) => [...document.querySelectorAll(selector)];
const same = (now: Element[], before: Element[]) => now.length === before.length && now.every((node, index) => node === before[index]);

describe('the geometric background layout', () => {
    it('stays where it is when a theme comes after the song, and when the player pauses', async () => {
        // Icons load on demand: these are there before the theme that names them arrives.
        await loadLucideIcons(['Star', 'Moon']);
        root = createRoot(document.body.appendChild(document.createElement('div')));
        show('song-a', themeWith({}));
        const first = places();
        expect(first).toHaveLength(15);

        show('song-a', themeWith({ secondaryColor: '#123456', lyricsIcons: [] }));
        expect(places()).toEqual(first);
        show('song-a', themeWith({ secondaryColor: '#654321', lyricsIcons: ['Star', 'Moon'] }), true);
        expect(places()).toEqual(first);
        expect(document.querySelector('.geometric-paused')).not.toBeNull();

        // The loops run on: the same shape and icon-slot elements throughout, icons or not.
        const drifts = nodes('.geometric-drift');
        const pulses = nodes('.geometric-pulse');
        expect(pulses.length).toBeGreaterThan(0);
        expect(document.querySelectorAll('.geometric-pulse svg')).toHaveLength(pulses.length);
        show('song-a', themeWith({ lyricsIcons: [] }));
        expect(same(nodes('.geometric-drift'), drifts)).toBe(true);
        expect(same(nodes('.geometric-pulse'), pulses)).toBe(true);
        expect(document.querySelectorAll('.geometric-pulse svg')).toHaveLength(0);

        // The layer of the old seed may still be fading out in front of the new one's.
        show('song-b', themeWith({ lyricsIcons: ['Star', 'Moon'] }));
        expect(places().slice(-15)).not.toEqual(first);
    });
});
