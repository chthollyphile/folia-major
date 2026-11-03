// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundLyricHold } from '@/components/app/backgroundThrottling/useBackgroundLyricHold';
import { isBackgroundLyricHeld } from '@/components/app/backgroundThrottling/backgroundLyricHoldStore';

// test/unit/app/backgroundLyricHold.test.ts
// When 后台节流 holds the lyric animation: only while the main process says the switch is in force,
// and only while the window is minimised / hidden (or the page is hidden); losing the focus alone
// never holds it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type State = { active: boolean; hidden: boolean };

let container: HTMLDivElement;
let root: Root;
let visibility: DocumentVisibilityState;
let push: ((state: State) => void) | null;
let initial: State;
const unsubscribe = vi.fn();

const Probe = () => {
    useBackgroundLyricHold();
    return null;
};

const mount = async () => {
    await act(async () => root.render(createElement(Probe)));
};
const send = (state: State) => {
    act(() => push?.(state));
};

beforeEach(() => {
    visibility = 'visible';
    push = null;
    initial = { active: false, hidden: false };
    unsubscribe.mockClear();
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    window.electron = {
        getBackgroundThrottlingState: () => Promise.resolve(initial),
        onBackgroundThrottlingChanged: (callback: (state: State) => void) => {
            push = callback;
            return unsubscribe;
        },
    } as unknown as typeof window.electron;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as { electron?: unknown }).electron;
    vi.restoreAllMocks();
});

describe('useBackgroundLyricHold', () => {
    it('holds while the switch is in force and the window is out of sight, and lets go when it is back', async () => {
        initial = { active: true, hidden: false };
        await mount();
        expect(isBackgroundLyricHeld()).toBe(false);

        send({ active: true, hidden: true });
        expect(isBackgroundLyricHeld()).toBe(true);

        send({ active: true, hidden: false });
        expect(isBackgroundLyricHeld()).toBe(false);
    });

    it('starts held when the window is already out of sight', async () => {
        initial = { active: true, hidden: true };
        await mount();
        expect(isBackgroundLyricHeld()).toBe(true);
    });

    it('never holds while the switch is not in force, whatever the window does', async () => {
        await mount();
        send({ active: false, hidden: true });
        visibility = 'hidden';
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(isBackgroundLyricHeld()).toBe(false);
    });

    it('takes a page Chromium reports hidden as out of sight too', async () => {
        initial = { active: true, hidden: false };
        await mount();
        visibility = 'hidden';
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(isBackgroundLyricHeld()).toBe(true);

        visibility = 'visible';
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(isBackgroundLyricHeld()).toBe(false);
    });

    it('does not hold a window that only lost the focus', async () => {
        initial = { active: true, hidden: false };
        await mount();
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        act(() => { window.dispatchEvent(new Event('blur')); });
        expect(isBackgroundLyricHeld()).toBe(false);
    });

    it('lets go and unsubscribes on unmount', async () => {
        initial = { active: true, hidden: true };
        await mount();
        expect(isBackgroundLyricHeld()).toBe(true);

        act(() => root.unmount());
        root = createRoot(container);
        expect(isBackgroundLyricHeld()).toBe(false);
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('does nothing outside the desktop app', async () => {
        delete (window as { electron?: unknown }).electron;
        await mount();
        visibility = 'hidden';
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(isBackgroundLyricHeld()).toBe(false);
    });
});
