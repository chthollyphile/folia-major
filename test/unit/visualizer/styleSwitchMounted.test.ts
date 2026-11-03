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
import VisualizerBackdrop from '@/components/visualizer/VisualizerBackdrop';
import VisualizerShell from '@/components/visualizer/VisualizerShell';
import VisualizerStyleTransition, { FIRST_FRAME_LIMIT_MS, useStyleSwitch } from '@/components/visualizer/styleTransition/VisualizerStyleTransition';
import { LEAVE_FALLBACK_MARGIN_MS, type LayerTransition } from '@/components/visualizer/styleTransition/layerTransition';
import { useFirstFrameDrawn } from '@/components/visualizer/styleTransition/firstFrame';
import { whenFree } from '@/components/visualizer/preview/pictureTurns';
import type { VisualizerRegistryEntry, VisualizerSharedProps } from '@/components/visualizer/definition';
import type { VisualizerMode } from '@/types';

// test/unit/visualizer/styleSwitchMounted.test.ts
// While a style switch plays, the leaving style and the new one are both mounted, and each one's
// VisualizerShell reads the pointer on the backdrop's box. Only the style on screen may. When both
// did, a move into the bottom-right hotspot showed the player panel guide in both shells; the leaving
// one let go of it when it unmounted, under a pointer still in the hotspot, and the new one, which
// held it already, did not show it again until the pointer left the hotspot.
// The leaving style goes when its animation finishes, and a little later when no finish event comes
// (a hidden window, an animation cancelled from outside): it may hold a WebGL context.
// A switch to a style with a slow start waits for its first frame, or for the limit, and no small
// picture starts while a switch waits or plays.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every value the shells sent the player panel guide, in order. */
const guide: boolean[] = [];
const props = {
    theme: { fontStyle: 'sans' },
    audioPower: motionValue(0),
    audioBands: {},
    isPreviewMode: true,
    staticMode: false,
    onPlayerPanelGuideHotspotChange: (isActive: boolean) => { guide.push(isActive); },
} as unknown as VisualizerSharedProps;
// No background, so nothing but the style mounts in the backdrop.
const entry = { background: false } as unknown as VisualizerRegistryEntry;
const transition: LayerTransition = {
    leave: { to: { opacity: 0 }, duration: 300, easing: 'linear' },
    enter: { from: { opacity: 0 }, duration: 420, easing: 'linear' },
};

// jsdom has no Web Animations: each animate() hands back one that the test ends by hand.
type Played = {
    fill: string;
    playState: string;
    onfinish: (() => void) | null;
    finished: Promise<void>;
    end: () => void;
    cancel: () => void;
    pause: () => void;
    play: () => void;
    commitStyles: () => void;
};
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
        const animation: Played = {
            fill: String(options?.fill),
            playState: 'running',
            onfinish: null,
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

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    guide.length = 0;
    played.length = 0;
    document.body.replaceChildren();
});

/** What the style named 'slow' calls once it has drawn its first frame. */
let drawFirstFrame: (() => void) | null = null;
const SlowStart: React.FC = () => {
    drawFirstFrame = useFirstFrameDrawn();
    return null;
};
const renderStyle = (mode: VisualizerMode) => React.createElement(VisualizerShell, {
    theme: props.theme,
    audioPower: props.audioPower,
    audioBands: props.audioBands,
    sharedProps: props,
    children: React.createElement('div', { 'data-style': mode }, mode === 'slow' ? React.createElement(SlowStart) : null),
});
/** VisualizerRenderer's part: the styles are kept above the backdrop. */
const Renderer: React.FC<{ mode: VisualizerMode }> = ({ mode }) => {
    const styleSwitch = useStyleSwitch(mode, transition);
    return React.createElement(VisualizerBackdrop, {
        entry,
        props,
        waits: styleSwitch.waits,
        children: React.createElement(VisualizerStyleTransition, { styleSwitch, transition, renderStyle }),
    });
};
const show = (mode: string) => act(() => root!.render(React.createElement(Renderer, { mode: mode as VisualizerMode })));

const mount = (mode: string) => {
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    show(mode);
    // The backdrop's box, where the shells listen.
    return host.firstElementChild as HTMLElement;
};
const moveIntoHotspot = (box: HTMLElement) => act(() => {
    box.dispatchEvent(new MouseEvent('mousemove', { clientX: window.innerWidth - 10, clientY: window.innerHeight - 10, bubbles: true }));
});
const leaveTheBox = (box: HTMLElement) => act(() => {
    box.dispatchEvent(new MouseEvent('mouseleave'));
});
const leaves = () => played.filter(animation => animation.fill === 'forwards');
const enters = () => played.filter(animation => animation.fill === 'backwards');
/** Ends the leave animation of the style going out, which unmounts it. */
const finishLeaving = () => act(() => {
    expect(leaves()).toHaveLength(1);
    leaves()[0].end();
});
const stylesMounted = () => [...document.querySelectorAll('[data-style]')].map(node => node.getAttribute('data-style'));

describe('the pointer during a style switch', () => {
    it('keeps the guide shown when the leaving style goes, under a pointer still in the hotspot', () => {
        const box = mount('a');
        moveIntoHotspot(box);
        show('b');
        expect(stylesMounted()).toEqual(['a', 'b']);
        moveIntoHotspot(box);
        finishLeaving();
        expect(stylesMounted()).toEqual(['b']);
        expect(guide.at(-1)).toBe(true);
    });

    it('hides a guide shown before the switch once the pointer leaves, though the new style never showed it', () => {
        const box = mount('a');
        moveIntoHotspot(box);
        expect(guide).toEqual([true]);
        show('b');
        leaveTheBox(box);
        finishLeaving();
        expect(guide.at(-1)).toBe(false);
    });
});

describe('a leave whose animation never finishes', () => {
    it('keeps the style while it should still be fading, and removes it after the margin', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            mount('a');
            show('b');
            act(() => { vi.advanceTimersByTime(transition.leave.duration); });
            expect(stylesMounted()).toEqual(['a', 'b']);
            act(() => { vi.advanceTimersByTime(LEAVE_FALLBACK_MARGIN_MS); });
            expect(stylesMounted()).toEqual(['b']);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('a switch to a style with a slow start', () => {
    it('leaves the style on screen as it is and the new one unseen until the new one has drawn', () => {
        mount('a');
        show('slow');
        expect(stylesMounted()).toEqual(['a', 'slow']);
        expect(leaves()).toHaveLength(0);
        expect(enters().map(animation => animation.playState)).toEqual(['paused']);
        act(() => drawFirstFrame!());
        expect(enters().map(animation => animation.playState)).toEqual(['running']);
        finishLeaving();
        expect(stylesMounted()).toEqual(['slow']);
    });

    it('starts anyway once the limit is over, for a style that never says', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            mount('a');
            show('slow');
            act(() => { vi.advanceTimersByTime(FIRST_FRAME_LIMIT_MS - 1); });
            expect(leaves()).toHaveLength(0);
            act(() => { vi.advanceTimersByTime(1); });
            expect(leaves()).toHaveLength(1);
            expect(enters().map(animation => animation.playState)).toEqual(['running']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('starts no small picture while it waits or plays', async () => {
        mount('a');
        show('slow');
        const started: string[] = [];
        whenFree(() => started.push('picture'));
        act(() => drawFirstFrame!());
        finishLeaving();
        expect(started).toEqual([]);
        await act(async () => { enters()[0].end(); });
        expect(started).toEqual(['picture']);
    });
});
