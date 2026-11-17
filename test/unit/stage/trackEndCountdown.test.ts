// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrackEndCountdownHost } from '../../../src/components/app/overlays/now-playing-toast/TrackEndCountdownHost';
import {
    isInTrackEndCountdown,
    useTrackEndCountdownStore,
    withTrackEndCountdown,
} from '../../../src/components/app/overlays/now-playing-toast/trackEndCountdownStore';
import { currentTime } from '../../../src/stores/motionSignals';

// test/unit/stage/trackEndCountdown.test.ts
// The track-end countdown reads the playback clock, which moves every frame. These pin the answer,
// that the store's readers hear of it only when it changes, and how the card's props take it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('isInTrackEndCountdown', () => {
    it('is on for the last five seconds of the track, and off at its end', () => {
        const at = (time: number) => isInTrackEndCountdown({ enabled: true, duration: 100, time });
        expect(at(94.9)).toBe(false);
        expect(at(95)).toBe(true);
        expect(at(99.9)).toBe(true);
        expect(at(100)).toBe(false);
        expect(at(101)).toBe(false);
    });

    it('stays off when nothing can show it, or the length is not known', () => {
        expect(isInTrackEndCountdown({ enabled: false, duration: 100, time: 97 })).toBe(false);
        expect(isInTrackEndCountdown({ enabled: true, duration: 0, time: 0 })).toBe(false);
        expect(isInTrackEndCountdown({ enabled: true, duration: Number.NaN, time: 99 })).toBe(false);
        expect(isInTrackEndCountdown({ enabled: true, duration: Number.POSITIVE_INFINITY, time: 99 })).toBe(false);
    });
});

describe('TrackEndCountdownHost', () => {
    let container: HTMLDivElement;
    let root: Root;
    let notifications: number;
    let unsubscribe: () => void;

    const render = (enabled: boolean, duration: number) => {
        act(() => root.render(createElement(TrackEndCountdownHost, { enabled, duration })));
    };
    const tick = (time: number) => act(() => { currentTime.set(time); });
    const isActive = () => useTrackEndCountdownStore.getState().active;

    beforeEach(() => {
        currentTime.set(0);
        useTrackEndCountdownStore.setState({ active: false });
        notifications = 0;
        unsubscribe = useTrackEndCountdownStore.subscribe(() => { notifications += 1; });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        unsubscribe();
        container.remove();
        currentTime.set(0);
        useTrackEndCountdownStore.setState({ active: false });
    });

    it('turns the store on for the last five seconds and off at the end', () => {
        render(true, 100);
        tick(50);
        expect(isActive()).toBe(false);
        tick(96);
        expect(isActive()).toBe(true);
        tick(100);
        expect(isActive()).toBe(false);
    });

    it('follows the props it was last given', () => {
        render(false, 100);
        tick(97);
        expect(isActive()).toBe(false);

        render(true, 100);
        tick(97.1);
        expect(isActive()).toBe(true);

        // The next song is longer: the same clock reading is no longer near its end.
        render(true, 300);
        tick(97.2);
        expect(isActive()).toBe(false);
    });

    it('tells the store\'s readers only when the answer changes', () => {
        render(true, 100);
        tick(10);
        tick(20);
        tick(30);
        expect(notifications).toBe(0);

        tick(96);
        tick(96.1);
        tick(96.2);
        tick(97);
        expect(notifications).toBe(1);

        tick(5);
        tick(5.1);
        expect(notifications).toBe(2);
    });

    it('leaves the store off when it goes away mid-countdown', () => {
        render(true, 100);
        tick(98);
        expect(isActive()).toBe(true);

        act(() => root.unmount());
        expect(isActive()).toBe(false);
        // afterEach unmounts again; a root unmounted twice is fine.
        root = createRoot(container);
    });
});

describe('withTrackEndCountdown', () => {
    const nextUp = { title: 'Next' };

    it('marks the card as previewing while the countdown runs and there is a track to preview', () => {
        const card = { trackKey: 'a', nextUp, isNextUp: false };
        expect(withTrackEndCountdown(card, true)).toEqual({ trackKey: 'a', nextUp, isNextUp: true });
        // The props it was given are not written to.
        expect(card.isNextUp).toBe(false);
    });

    it('hands back the very props it was given when there is nothing to add', () => {
        const idle = { nextUp, isNextUp: false };
        expect(withTrackEndCountdown(idle, false)).toBe(idle);

        const nothingToPreview = { nextUp: null, isNextUp: false };
        expect(withTrackEndCountdown(nothingToPreview, true)).toBe(nothingToPreview);

        // A blend already previews it.
        const blending = { nextUp, isNextUp: true };
        expect(withTrackEndCountdown(blending, true)).toBe(blending);

        expect(withTrackEndCountdown(null, true)).toBeNull();
        expect(withTrackEndCountdown(undefined, true)).toBeUndefined();
    });
});
