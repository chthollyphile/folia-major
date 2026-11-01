import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    REMOTE_CONTROL_WINDOW_WIDTH,
    REMOTE_CONTROL_WINDOW_HEIGHT,
    getInitialRemoteControlWindowPosition,
    isPointOverRemoteControlStrip,
    clampRemoteControlWindowX,
    resolveRemoteControlWindowPosition,
} = require('../../../electron/remoteControlWindowGeometry.cjs') as typeof import('../../../electron/remoteControlWindowGeometry.cjs');

const windowAt = (x: number, y: number) => ({ x, y, width: REMOTE_CONTROL_WINDOW_WIDTH, height: REMOTE_CONTROL_WINDOW_HEIGHT });

describe('remote window geometry', () => {
    it('opens with the card in use where the old 428-wide centred window had it', () => {
        const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
        const oldWindowX = Math.floor((1920 - 428) / 2);
        const position = getInitialRemoteControlWindowPosition(workArea);
        // The card in use starts 4 px into the old window, and 4 + 174 px into the new one.
        expect(position.x + 178).toBe(oldWindowX + 4);
        expect(position.y).toBe(Math.floor((1040 - 184) / 2));
    });

    it('opens on a second screen\'s work area the same way', () => {
        const position = getInitialRemoteControlWindowPosition({ x: 1920, y: 40, width: 1280, height: 984 });
        expect(position).toEqual({ x: 1920 + 426 - 174, y: 40 + 400 });
    });

    it('lets clicks through only left of the card in use', () => {
        const bounds = windowAt(500, 300);
        expect(isPointOverRemoteControlStrip(bounds, { x: 500, y: 300 })).toBe(true);
        expect(isPointOverRemoteControlStrip(bounds, { x: 677, y: 483 })).toBe(true);
        expect(isPointOverRemoteControlStrip(bounds, { x: 678, y: 380 })).toBe(false);
        expect(isPointOverRemoteControlStrip(bounds, { x: 600, y: 299 })).toBe(false);
        expect(isPointOverRemoteControlStrip(bounds, { x: 600, y: 484 })).toBe(false);
        expect(isPointOverRemoteControlStrip(bounds, { x: 499, y: 380 })).toBe(false);
    });

    it('keeps the strip on the card\'s left when a window manager widens the window', () => {
        const bounds = { x: 0, y: 0, width: 702, height: 184 };
        expect(isPointOverRemoteControlStrip(bounds, { x: 227, y: 90 })).toBe(true);
        expect(isPointOverRemoteControlStrip(bounds, { x: 228, y: 90 })).toBe(false);
    });

    it('stops the window at the outer left edge of the screens', () => {
        const screens = [{ x: 0, y: 0, width: 1920, height: 1080 }];
        expect(clampRemoteControlWindowX(windowAt(-120, 400), screens)).toBe(0);
        expect(clampRemoteControlWindowX(windowAt(0, 400), screens)).toBe(0);
        expect(clampRemoteControlWindowX(windowAt(30, 400), screens)).toBe(30);
    });

    it('lets the window cross onto a screen on the left', () => {
        const screens = [
            { x: -1920, y: 0, width: 1920, height: 1080 },
            { x: 0, y: 0, width: 1920, height: 1080 },
        ];
        expect(clampRemoteControlWindowX(windowAt(-120, 400), screens)).toBe(-120);
        expect(clampRemoteControlWindowX(windowAt(-2000, 400), screens)).toBe(-1920);
    });

    it('stops at the edge of the screen that holds the window when the left one sits lower', () => {
        const screens = [
            { x: -1920, y: 600, width: 1920, height: 1080 },
            { x: 0, y: 0, width: 1920, height: 1080 },
        ];
        expect(clampRemoteControlWindowX(windowAt(-100, 100), screens)).toBe(0);
    });

    it('leaves a window that is on no screen at all alone', () => {
        expect(clampRemoteControlWindowX(windowAt(-5000, 100), [{ x: 0, y: 0, width: 1920, height: 1080 }])).toBe(-5000);
    });

    it('restores a remembered position that is still on a screen', () => {
        const workAreas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
        expect(resolveRemoteControlWindowPosition({ x: 400, y: 300 }, workAreas)).toEqual({ x: 400, y: 300 });
    });

    it('returns null when the remembered spot is on no screen any more', () => {
        const workAreas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
        expect(resolveRemoteControlWindowPosition({ x: 2500, y: 300 }, workAreas)).toBeNull();
    });

    it('returns null when the window would hang off the right edge', () => {
        const workAreas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
        // 1800 + 602 runs 482 px past the edge, taking the card in use with it.
        expect(resolveRemoteControlWindowPosition({ x: 1800, y: 300 }, workAreas)).toBeNull();
    });

    it('returns null when the remembered y no longer sits on a screen', () => {
        const workAreas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
        // 1040 tall work area, window 184 tall: y = 1000 leaves 144 px of the window off the bottom.
        expect(resolveRemoteControlWindowPosition({ x: 400, y: 1000 }, workAreas)).toBeNull();
    });

    it('lets the empty strip sit off screen only while the cover is collapsed', () => {
        const workAreas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
        // The card in use starts 4 + 174 px in, so at x = -174 it is 4 px from the edge.
        expect(resolveRemoteControlWindowPosition({ x: -174, y: 300 }, workAreas, false)).toEqual({ x: -174, y: 300 });
        expect(resolveRemoteControlWindowPosition({ x: -174, y: 300 }, workAreas, true)).toBeNull();
        expect(resolveRemoteControlWindowPosition({ x: -174, y: 300 }, workAreas)).toBeNull();
    });

    it('restores a position on a second screen while that screen is there', () => {
        const workAreas = [
            { x: 0, y: 0, width: 1920, height: 1040 },
            { x: 1920, y: 0, width: 2560, height: 1400 },
        ];
        expect(resolveRemoteControlWindowPosition({ x: 2500, y: 300 }, workAreas)).toEqual({ x: 2500, y: 300 });
    });

    it('returns null for an absent or malformed position', () => {
        const workAreas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
        expect(resolveRemoteControlWindowPosition(null, workAreas)).toBeNull();
        expect(resolveRemoteControlWindowPosition({ x: 'a', y: 100 }, workAreas)).toBeNull();
        expect(resolveRemoteControlWindowPosition({ x: 400 }, workAreas)).toBeNull();
        expect(resolveRemoteControlWindowPosition({ x: Number.NaN, y: 100 }, workAreas)).toBeNull();
        expect(resolveRemoteControlWindowPosition(undefined, workAreas)).toBeNull();
    });

    it('lets the card in use reach the left edge when the cover is collapsed', () => {
        const screens = [{ x: 0, y: 0, width: 1920, height: 1080 }];
        // The empty strip left of the card may go off screen; the card itself (4 + 174 px in) stops at the edge.
        expect(clampRemoteControlWindowX(windowAt(-120, 400), screens, false)).toBe(-120);
        expect(clampRemoteControlWindowX(windowAt(-178, 400), screens, false)).toBe(-178);
        expect(clampRemoteControlWindowX(windowAt(-300, 400), screens, false)).toBe(-178);
        expect(clampRemoteControlWindowX(windowAt(-300, 400), screens, true)).toBe(0);
    });

    it('stops the collapsed card at the edge of the screen that holds it', () => {
        const screens = [
            { x: -1920, y: 600, width: 1920, height: 1080 },
            { x: 0, y: 0, width: 1920, height: 1080 },
        ];
        expect(clampRemoteControlWindowX(windowAt(-260, 100), screens, false)).toBe(-178);
        expect(clampRemoteControlWindowX({ x: -278, y: 100, width: 702, height: 184 }, screens, false)).toBe(-228);
    });
});

describe('remote window queue expansion', () => {
    const {
        getRemoteControlQueueExpansion,
        getRemoteControlWindowBounds,
        getRemoteControlCardPosition,
    } = require('../../../electron/remoteControlWindowGeometry.cjs') as typeof import('../../../electron/remoteControlWindowGeometry.cjs');
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

    it('grows down when there is room below', () => {
        expect(getRemoteControlQueueExpansion(windowAt(600, 300), workArea, 340)).toEqual({ direction: 'down', height: 340 });
    });

    it('grows up when only above has room', () => {
        // 1040 - (800 + 184) = 56 below, 800 above.
        expect(getRemoteControlQueueExpansion(windowAt(600, 800), workArea, 340)).toEqual({ direction: 'up', height: 340 });
    });

    it('cuts the queue to the larger room when neither side fits', () => {
        const short = { x: 0, y: 0, width: 1920, height: 500 };
        // 200 above, 500 - 384 = 116 below.
        expect(getRemoteControlQueueExpansion(windowAt(600, 200), short, 340)).toEqual({ direction: 'up', height: 200 });
    });

    it('keeps the search field and three rows on a very short screen', () => {
        const tiny = { x: 0, y: 0, width: 1920, height: 300 };
        expect(getRemoteControlQueueExpansion(windowAt(600, 40), tiny, 340)).toEqual({ direction: 'down', height: 160 });
        // A queue that wants less than that minimum is not grown past what it wants.
        expect(getRemoteControlQueueExpansion(windowAt(600, 40), tiny, 124)).toEqual({ direction: 'down', height: 124 });
    });

    it('keeps the side a shown queue grew to, only changing its height', () => {
        expect(getRemoteControlQueueExpansion(windowAt(600, 300), workArea, 200, 'up')).toEqual({ direction: 'up', height: 200 });
        expect(getRemoteControlQueueExpansion(windowAt(600, 250), workArea, 340, 'up')).toEqual({ direction: 'up', height: 250 });
    });

    it('leaves the anchored side when it no longer holds the search field and three rows', () => {
        // 100 below, 756 above: a short queue went down, then the queue got long.
        expect(getRemoteControlQueueExpansion(windowAt(600, 756), workArea, 88)).toEqual({ direction: 'down', height: 88 });
        expect(getRemoteControlQueueExpansion(windowAt(600, 756), workArea, 340, 'down')).toEqual({ direction: 'up', height: 340 });
    });

    it('grows down, uncut, without a work area (Wayland)', () => {
        expect(getRemoteControlQueueExpansion(windowAt(0, 0), null, 340)).toEqual({ direction: 'down', height: 340 });
    });

    it('moves the window up by the queue only when it grows up, and finds the card back', () => {
        const card = { x: 600, y: 800 };
        const up = { direction: 'up' as const, height: 340 };
        const down = { direction: 'down' as const, height: 340 };
        expect(getRemoteControlWindowBounds(card, up)).toEqual({ x: 600, y: 460, width: 602, height: 524 });
        expect(getRemoteControlWindowBounds(card, down)).toEqual({ x: 600, y: 800, width: 602, height: 524 });
        expect(getRemoteControlWindowBounds(card, null)).toEqual(windowAt(600, 800));
        expect(getRemoteControlCardPosition({ x: 600, y: 460 }, up)).toEqual(card);
        expect(getRemoteControlCardPosition({ x: 600, y: 800 }, down)).toEqual(card);
        expect(getRemoteControlCardPosition({ x: 600, y: 800 }, null)).toEqual(card);
    });
});
