// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Theme } from '@/types';

// test/unit/visualizer/monetBackgroundLayer.test.ts
// When the Monet background asks for its picture. A picture of an image not shown yet (a new copy, a
// new song) is asked for at once, so it is made while the copy waits out the settle time; the
// picture shown is still the one asked for when that time is over. A new theme or setting for the
// image on screen waits the settle time, so a slider does not start a picture per step. A picture
// asked for is released once the inputs change, so one not begun by then is not made.

const released = vi.hoisted((): string[] => []);
const wantMonetBackgroundUrl = vi.hoisted(() => vi.fn((options: { coverUrl?: string | null; theme: { accentColor: string } }) => ({
    url: Promise.resolve(`picture-${options.theme.accentColor}`),
    release: () => {
        released.push(options.theme.accentColor);
    },
})));
vi.mock('@/components/visualizer/monet/monetBackgroundPipeline', () => ({
    wantMonetBackgroundUrl,
    getMonetBackgroundCacheKey: (options: unknown) => JSON.stringify(options),
    checkCanvasFilterSupport: () => true,
}));
vi.mock('@/hooks/useReducedMotionFor', () => ({ useReducedMotionFor: () => false }));

const { default: MonetBackgroundLayer } = await import('@/components/visualizer/backgrounds/monet/MonetBackgroundLayer');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const themeWith = (accentColor: string) => ({ backgroundColor: '#000000', primaryColor: '#ffffff', secondaryColor: '#888888', accentColor } as Theme);
const asked = () => wantMonetBackgroundUrl.mock.calls.map(([options]) => options.theme.accentColor);

let root: Root;
let host: HTMLDivElement;
const show = (accentColor: string, coverUrl = 'cover-a') => act(() => {
    root.render(React.createElement(MonetBackgroundLayer, { coverUrl, theme: themeWith(accentColor) }));
});
const wait = (ms: number) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
});

beforeEach(() => {
    vi.useFakeTimers();
    wantMonetBackgroundUrl.mockClear();
    released.length = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
});

describe('when the Monet background asks for its picture', () => {
    it('without a picture: at once, and again for the one it shows once the settle time is over', async () => {
        show('#ff0000');
        expect(asked()).toEqual(['#ff0000']);
        await wait(100);
        // A theme that arrives within the settle time is asked for at once as well, and is the one shown.
        show('#00ff00');
        expect(asked()).toEqual(['#ff0000', '#00ff00']);
        // The first one is no longer wanted.
        expect(released).toEqual(['#ff0000']);
        await wait(179);
        expect(asked()).toEqual(['#ff0000', '#00ff00']);
        await wait(1);
        expect(asked()).toEqual(['#ff0000', '#00ff00', '#00ff00']);
        expect(host.innerHTML).toContain('picture-#00ff00');
    });

    it('with a picture: a new theme only once the settle time is over', async () => {
        show('#ff0000');
        await wait(180);
        wantMonetBackgroundUrl.mockClear();
        show('#0000ff');
        await wait(179);
        expect(asked()).toEqual([]);
        await wait(1);
        expect(asked()).toEqual(['#0000ff']);
    });

    it('with a picture: a new image at once', async () => {
        show('#ff0000');
        await wait(180);
        wantMonetBackgroundUrl.mockClear();
        show('#ff0000', 'cover-b');
        expect(asked()).toEqual(['#ff0000']);
        await wait(180);
        expect(asked()).toEqual(['#ff0000', '#ff0000']);
        expect(wantMonetBackgroundUrl.mock.calls.map(([options]) => options.coverUrl)).toEqual(['cover-b', 'cover-b']);
    });
});
