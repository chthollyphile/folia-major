// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time, and Node's own experimental storage
// shadows jsdom's here, so an in-memory Storage goes in before any import runs.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue } from 'framer-motion';
import VisualizerBackgroundTransition, {
    BACKGROUND_READY_LIMIT_MS,
    shownBackground,
} from '@/components/visualizer/styleTransition/VisualizerBackgroundTransition';
import type { LayerTransition } from '@/components/visualizer/styleTransition/layerTransition';
import { useFirstFrameDrawn } from '@/components/visualizer/styleTransition/firstFrame';
import type { VisualizerBackgroundConfig, VisualizerBackgroundRenderProps } from '@/components/visualizer/backgrounds/definition';
import { DEFAULT_MONET_BACKGROUND_TUNING, type Theme } from '@/types';

// test/unit/visualizer/backgroundSongChange.test.ts
// A new song is a change of background where the background draws the song: its entry's `song` says
// what of it (common: the seed, and the cover where the cover colours are on; monet: the image its
// picture is made from). Then a new copy is mounted for the new song, unseen until it is ready or the
// limit is over, while the copy on screen leaves still drawing the old song. Never more than two
// copies, and without a transition the new song's copy replaces the old one at once. Following new
// inputs costs one render of each copy, not two.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = { backgroundColor: '#000000', primaryColor: '#ffffff', secondaryColor: '#888888', accentColor: '#ff0000' } as Theme;
const inputsFor = (patch: Partial<VisualizerBackgroundRenderProps>): VisualizerBackgroundRenderProps => ({
    config: { mode: 'common' },
    theme,
    isDaylight: false,
    coverUrl: 'cover-a',
    audioPower: motionValue(0),
    audioBands: {} as VisualizerBackgroundRenderProps['audioBands'],
    seed: 'song-a',
    staticMode: false,
    paused: false,
    ...patch,
});
const sameBackground = (a: Partial<VisualizerBackgroundRenderProps>, b: Partial<VisualizerBackgroundRenderProps>, animate = true) => (
    shownBackground(inputsFor(a), true, animate) === shownBackground(inputsFor(b), true, animate)
);

describe('which inputs are a song change', () => {
    const commonWithCover: VisualizerBackgroundConfig = { mode: 'common', common: { useCoverColorBg: true } };

    it('for common: the seed, and the cover only where the cover colours are on; never the theme', () => {
        expect(sameBackground({ seed: 'song-a' }, { seed: 'song-b' })).toBe(false);
        expect(sameBackground({ coverUrl: 'cover-a' }, { coverUrl: 'cover-b' })).toBe(true);
        expect(sameBackground({ config: commonWithCover, coverUrl: 'cover-a' }, { config: commonWithCover, coverUrl: 'cover-b' })).toBe(false);
        expect(sameBackground({}, { theme: { ...theme, accentColor: '#00ff00' } })).toBe(true);
        expect(sameBackground({ staticMode: true, seed: 'song-a' }, { staticMode: true, seed: 'song-b' })).toBe(true);
    });

    it('for monet: the image its picture is made from', () => {
        const monet: VisualizerBackgroundConfig = { mode: 'monet' };
        expect(sameBackground({ config: monet, coverUrl: 'cover-a' }, { config: monet, coverUrl: 'cover-b' })).toBe(false);
        expect(sameBackground({ config: monet, seed: 'song-a' }, { config: monet, seed: 'song-b' })).toBe(true);
        const uploaded: VisualizerBackgroundConfig = {
            mode: 'monet',
            customImage: { url: 'upload' } as VisualizerBackgroundConfig['customImage'],
            monet: { tuning: { ...DEFAULT_MONET_BACKGROUND_TUNING, backgroundSource: 'uploaded-global' } },
        } as VisualizerBackgroundConfig;
        expect(sameBackground({ config: uploaded, coverUrl: 'cover-a' }, { config: uploaded, coverUrl: 'cover-b' })).toBe(true);
    });

    it('for nomand: the image its shader draws', () => {
        const nomand: VisualizerBackgroundConfig = { mode: 'nomand' };
        expect(sameBackground({ config: nomand, coverUrl: 'cover-a' }, { config: nomand, coverUrl: 'cover-b' })).toBe(false);
        expect(sameBackground({ config: nomand, seed: 'song-a' }, { config: nomand, seed: 'song-b' })).toBe(true);
    });

    it('for latent and sora: nothing, they blend new colours in place', () => {
        for (const mode of ['latent', 'sora'] as const) {
            const config: VisualizerBackgroundConfig = { mode };
            expect(sameBackground(
                { config, seed: 'song-a', coverUrl: 'cover-a' },
                { config, seed: 'song-b', coverUrl: 'cover-b', theme: { ...theme, primaryColor: '#123456' } },
            )).toBe(true);
        }
    });

    it('nothing where the host does not animate: the copy on screen changes in place', () => {
        const nomand: VisualizerBackgroundConfig = { mode: 'nomand' };
        expect(sameBackground({ seed: 'song-a' }, { seed: 'song-b' }, false)).toBe(true);
        expect(sameBackground({ config: nomand, coverUrl: 'cover-a' }, { config: nomand, coverUrl: 'cover-b' }, false)).toBe(true);
        expect(sameBackground({ config: nomand }, {}, false)).toBe(false);
    });

    it('for the embedded page: nothing', () => {
        const url: VisualizerBackgroundConfig = { mode: 'url' };
        expect(sameBackground({ config: url, seed: 'song-a', coverUrl: 'cover-a' }, { config: url, seed: 'song-b', coverUrl: 'cover-b' })).toBe(true);
    });
});

// jsdom has no Web Animations: each animate() hands back one that the test ends by hand.
type Played = { fill: string; playState: string; onfinish: (() => void) | null; finished: Promise<void>; end: () => void };
const played: Played[] = [];
beforeAll(() => {
    HTMLElement.prototype.animate = function animate(_keyframes: unknown, options?: KeyframeAnimationOptions) {
        let resolve = () => {};
        let reject = (_error: unknown) => {};
        const finished = new Promise<void>((done, fail) => {
            resolve = done;
            reject = fail;
        });
        finished.catch(() => {});
        const animation = {
            fill: String(options?.fill),
            playState: 'running',
            onfinish: null as (() => void) | null,
            finished,
            end() { this.playState = 'finished'; resolve(); this.onfinish?.(); },
            cancel() { this.playState = 'idle'; reject(new DOMException('cancelled', 'AbortError')); },
            pause() { this.playState = 'paused'; },
            play() { this.playState = 'running'; },
            commitStyles() {},
        };
        played.push(animation);
        return animation as unknown as Animation;
    };
});
afterAll(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

const transition: LayerTransition = {
    leave: { to: { opacity: 0 }, duration: 300, easing: 'linear' },
    enter: { from: { opacity: 0 }, duration: 420, easing: 'linear' },
};

let root: Root | null = null;
let renders = 0;
/** What the background of the song 'slow' calls once it is ready. */
let ready: (() => void) | null = null;
const SlowCover: React.FC = () => {
    ready = useFirstFrameDrawn();
    return null;
};
const render = (inputs: VisualizerBackgroundRenderProps) => {
    renders += 1;
    return React.createElement('div', { 'data-seed': String(inputs.seed) }, inputs.seed === 'slow' ? React.createElement(SlowCover) : null);
};
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    renders = 0;
    ready = null;
    played.length = 0;
    document.body.replaceChildren();
});

const show = (seed: string, animated = true) => act(() => root!.render(React.createElement(VisualizerBackgroundTransition, {
    inputs: inputsFor({ seed }),
    drawn: true,
    transition: animated ? transition : null,
    waits: false,
    render,
})));
const mount = (seed: string, animated = true) => {
    root = createRoot(document.body.appendChild(document.createElement('div')));
    show(seed, animated);
};
const seedsMounted = () => [...document.querySelectorAll('[data-seed]')].map(node => node.getAttribute('data-seed'));
const leaves = () => played.filter(animation => animation.fill === 'forwards');
const enters = () => played.filter(animation => animation.fill === 'backwards');

describe('a song change of a background that draws the song', () => {
    it('mounts a copy for the new song while the old copy leaves drawing the old song', () => {
        mount('song-a');
        show('song-b');
        expect(seedsMounted()).toEqual(['song-a', 'song-b']);
        expect(leaves()).toHaveLength(1);
        act(() => leaves()[0].end());
        expect(seedsMounted()).toEqual(['song-b']);
    });

    it('keeps the new copy unseen and the old one as it is until the new one is ready', () => {
        mount('song-a');
        show('slow');
        expect(seedsMounted()).toEqual(['song-a', 'slow']);
        expect(leaves()).toHaveLength(0);
        expect(enters().map(animation => animation.playState)).toEqual(['paused']);
        act(() => ready!());
        expect(leaves()).toHaveLength(1);
        expect(enters().map(animation => animation.playState)).toEqual(['running']);
    });

    it('starts anyway once the limit is over, for a copy that never says it is ready', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            mount('song-a');
            show('slow');
            act(() => { vi.advanceTimersByTime(BACKGROUND_READY_LIMIT_MS - 1); });
            expect(leaves()).toHaveLength(0);
            act(() => { vi.advanceTimersByTime(1); });
            expect(leaves()).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('never mounts more than two copies, whatever the number of quick changes', () => {
        mount('song-a');
        show('song-b');
        show('song-c');
        expect(seedsMounted()).toEqual(['song-b', 'song-c']);
        show('song-d');
        expect(seedsMounted()).toEqual(['song-c', 'song-d']);
    });

    it('replaces the copy at once without a transition', () => {
        mount('song-a', false);
        show('song-b', false);
        expect(seedsMounted()).toEqual(['song-b']);
        expect(played).toHaveLength(0);
    });

    it('renders a copy once per render of the backdrop, though its inputs are a new object each time', () => {
        mount('song-a');
        renders = 0;
        show('song-a');
        show('song-a');
        expect(renders).toBe(2);
    });
});
