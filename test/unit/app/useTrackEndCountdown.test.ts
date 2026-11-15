// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTrackEndCountdown } from '@/components/app/overlays/now-playing-toast/useTrackEndCountdown';
import { currentTime } from '@/stores/motionSignals';

// test/unit/app/useTrackEndCountdown.test.ts
// The track-end countdown reads the playback clock, which moves every frame, from a hook App calls.
// These pin the answer, and that a clock tick which does not change it does not run the caller again.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let renders: number;
let shown: boolean;

const Probe = ({ enabled, duration }: { enabled: boolean; duration: number }) => {
    renders += 1;
    shown = useTrackEndCountdown({ enabled, duration });
    return null;
};
const render = (enabled: boolean, duration: number) => {
    act(() => root.render(createElement(Probe, { enabled, duration })));
};
const tick = (time: number) => act(() => { currentTime.set(time); });

beforeEach(() => {
    renders = 0;
    shown = false;
    currentTime.set(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    currentTime.set(0);
});

describe('useTrackEndCountdown', () => {
    it('is on for the last five seconds of the track, and off at its end', () => {
        render(true, 100);
        tick(94.9);
        expect(shown).toBe(false);
        tick(95);
        expect(shown).toBe(true);
        tick(99.9);
        expect(shown).toBe(true);
        tick(100);
        expect(shown).toBe(false);
    });

    it('stays off when nothing can show it, or the length is not known', () => {
        render(false, 100);
        tick(97);
        expect(shown).toBe(false);

        render(true, 0);
        tick(98);
        expect(shown).toBe(false);

        render(true, Number.NaN);
        tick(99);
        expect(shown).toBe(false);
    });

    it('does not run its caller again on a tick that leaves the answer as it was', () => {
        render(true, 100);
        tick(50);
        tick(96);
        expect(shown).toBe(true);
        const rendersOnceOn = renders;

        // Right after the commit that turned it on: the tick where a same-value setState is not skipped.
        tick(96.1);
        tick(96.2);
        tick(96.3);
        expect(renders).toBe(rendersOnceOn);

        tick(10);
        expect(shown).toBe(false);
        const rendersOnceOff = renders;
        tick(10.1);
        tick(10.2);
        expect(renders).toBe(rendersOnceOff);
    });
});
