import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// Verify native cursor geometry and renderer requests independently of an Electron window.
const require = createRequire(import.meta.url);
const { isCursorInsideUnlockHotspot, createUnlockHoverRequests } = require('../../../electron/mainWindowClickThrough.cjs');

describe('main window click-through unlock', () => {
    it('reflects the inset hotspot for left controls in scaled and moved viewports', () => {
        const options = { bounds: { x: 100, y: 50, width: 1200 }, hotspot: { width: 172, height: 40, rightInset: 176, topInset: 4 }, viewportWidth: 930, side: 'left' };
        expect(isCursorInsideUnlockHotspot({ ...options, cursor: { x: 340, y: 70 } })).toBe(true);
        expect(isCursorInsideUnlockHotspot({ ...options, cursor: { x: 1200, y: 70 } })).toBe(false);
        expect(isCursorInsideUnlockHotspot({ ...options, scale: 1.5, viewportOrigin: 370, viewportWidth: 600, cursor: { x: 730, y: 80 } })).toBe(true);
        const requests = createUnlockHoverRequests({ platform: 'darwin', pollCursor: () => true, setHover: vi.fn() });
        expect(requests.getSide()).toBe('right');
        requests.handle(false, 930, undefined, options.bounds, 1, 'left');
        expect(requests.getSide()).toBe('left');
    });

    it('uses the page width when DevTools narrows the window', () => {
        const options = {
            bounds: { x: 100, y: 50, width: 1200 },
            hotspot: { width: 172, height: 40, rightInset: 176, topInset: 4 },
            viewportWidth: 930,
            scale: 1,
        };
        expect(isCursorInsideUnlockHotspot({ ...options, cursor: { x: 810, y: 70 } })).toBe(true);
        expect(isCursorInsideUnlockHotspot({ ...options, cursor: { x: 1080, y: 70 } })).toBe(false);
        expect(isCursorInsideUnlockHotspot({ ...options, viewportWidth: 1200, cursor: { x: 1080, y: 70 } })).toBe(true);
        expect(isCursorInsideUnlockHotspot({ ...options, viewportWidth: 600, scale: 1.5, cursor: { x: 670, y: 80 } })).toBe(true);
        // A left-docked inspector shifts the page origin while its right edge stays fixed.
        expect(isCursorInsideUnlockHotspot({ ...options, viewportOrigin: 370, cursor: { x: 1080, y: 70 } })).toBe(true);
    });

    it('does not let a delayed renderer mouseleave override the macOS cursor', () => {
        const pollCursor = vi.fn(() => true);
        const setHover = vi.fn();
        const requests = createUnlockHoverRequests({ platform: 'darwin', pollCursor, setHover });
        expect(requests.handle(false, 930)).toBe(true);
        expect(requests.handle(false, NaN)).toBe(true);
        expect(requests.getViewportWidth()).toBe(930);
        requests.handle(false, 930, { screenX: 850, clientX: 480 }, { x: 100, width: 1200 });
        expect(requests.getViewportOrigin({ x: 100 })).toBe(370);
        expect(requests.getViewportOrigin({ x: 200 })).toBe(470);
        expect(setHover).not.toHaveBeenCalled();
        expect(pollCursor).toHaveBeenCalledTimes(3);
    });

    it('keeps renderer hover control on other platforms', () => {
        const setHover = vi.fn(() => false);
        const pollCursor = vi.fn();
        const requests = createUnlockHoverRequests({ platform: 'linux', pollCursor, setHover });
        requests.handle(false, 930);
        expect(setHover).toHaveBeenCalledWith(false);
        expect(pollCursor).not.toHaveBeenCalled();
    });
});
