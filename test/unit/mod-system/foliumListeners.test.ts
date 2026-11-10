// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createFoliumListeners, useFoliumListeners, useFoliumNotifyOnChange, type FoliumListeners } from '@/mods/runtime/listeners';

// test/unit/mod-system/foliumListeners.test.ts
// The one helper behind every context's `subscribe` and every registry's. The
// rules the app does not show: a listener that throws is logged and the rest
// are still told; the same function added twice is told once and one removal
// takes it out; a component's listeners are told when a watched value changes
// and not on its first render.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('createFoliumListeners', () => {
    it('tells the rest when one throws, and says which set it was in', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const listeners = createFoliumListeners('stage subscriber');
        const told: string[] = [];
        const failure = new Error('boom');
        listeners.subscribe(() => { told.push('first'); });
        listeners.subscribe(() => { throw failure; });
        listeners.subscribe(() => { told.push('third'); });

        expect(() => listeners.notify()).not.toThrow();
        expect(told).toEqual(['first', 'third']);
        expect(warn).toHaveBeenCalledWith('[Folium] stage subscriber failed', failure);
    });

    it('tells a function added twice once, and one removal takes it out', () => {
        const listeners = createFoliumListeners('progress subscriber');
        const listener = vi.fn();
        const remove = listeners.subscribe(listener);
        listeners.subscribe(listener);
        listeners.notify();
        expect(listener).toHaveBeenCalledTimes(1);

        remove();
        listeners.notify();
        expect(listener).toHaveBeenCalledTimes(1);
        // Removing again is harmless.
        expect(() => remove()).not.toThrow();
    });
});

describe('useFoliumNotifyOnChange', () => {
    it('tells the listeners when a watched value changed, and not on the first render', () => {
        const seen: FoliumListeners[] = [];
        const Probe: React.FC<{ value: number; other: number }> = ({ value }) => {
            const listeners = useFoliumListeners('probe subscriber');
            seen.push(listeners);
            useFoliumNotifyOnChange(listeners, [value]);
            return null;
        };
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        const render = (value: number, other: number) => act(() => root!.render(React.createElement(Probe, { value, other })));

        render(1, 1);
        const listener = vi.fn();
        seen[0].subscribe(listener);
        expect(listener).not.toHaveBeenCalled();

        // A render that changes nothing watched tells nobody.
        render(1, 2);
        expect(listener).not.toHaveBeenCalled();
        render(2, 2);
        expect(listener).toHaveBeenCalledTimes(1);
        // The set is the same object on every render: a context built once keeps working.
        expect(new Set(seen).size).toBe(1);
    });
});
