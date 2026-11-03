import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/macWallpaperHitPanels.test.ts
// The geometry of the macOS wallpaper click catchers (issue #698): renderer rects to screen
// points, clipped to the wallpaper window, and the flip to Cocoa frames. The NSPanel FFI needs a
// real macOS host and is left to manual verification.

const require = createRequire(import.meta.url);
const {
    MAX_HIT_PANELS,
    toScreenHitRects,
    toCocoaFrame,
    coversWholeWallpaper,
} = require('../../../electron/wallpaper/macWallpaperHitPanels.cjs');

const WINDOW = { x: 0, y: 0, width: 1512, height: 982 };

describe('toScreenHitRects', () => {
    it('offsets by the window origin and rounds outward', () => {
        expect(toScreenHitRects([{ left: 10.4, top: 20.6, width: 100.2, height: 40 }], { ...WINDOW, x: 1512 }))
            .toEqual([{ x: 1522, y: 20, width: 101, height: 41 }]);
    });

    it('scales by the page zoom', () => {
        expect(toScreenHitRects([{ left: 10, top: 10, width: 50, height: 20 }], WINDOW, 2))
            .toEqual([{ x: 20, y: 20, width: 100, height: 40 }]);
    });

    it('clips to the window and drops what is left too small', () => {
        // The panel toggle sits half off the right edge.
        expect(toScreenHitRects([{ left: 1480, top: 900, width: 80, height: 48 }], WINDOW))
            .toEqual([{ x: 1480, y: 900, width: 32, height: 48 }]);
        expect(toScreenHitRects([{ left: 1510, top: 900, width: 80, height: 48 }], WINDOW)).toEqual([]);
    });

    it('ignores malformed input and caps the count', () => {
        expect(toScreenHitRects(null, WINDOW)).toEqual([]);
        expect(toScreenHitRects([{ left: Number.NaN, top: 0, width: 10, height: 10 }, null], WINDOW)).toEqual([]);
        const many = Array.from({ length: 20 }, (_, i) => ({ left: i * 10, top: 0, width: 8, height: 8 }));
        expect(toScreenHitRects(many, WINDOW)).toHaveLength(MAX_HIT_PANELS);
    });
});

describe('toCocoaFrame', () => {
    it('flips y about the primary display height', () => {
        expect(toCocoaFrame({ x: 100, y: 800, width: 400, height: 60 }, 982))
            .toEqual({ x: 100, y: 122, w: 400, h: 60 });
    });

    it('keeps displays above the primary at positive Cocoa y', () => {
        expect(toCocoaFrame({ x: 0, y: -1080, width: 100, height: 100 }, 982))
            .toEqual({ x: 0, y: 1962, w: 100, h: 100 });
    });
});

describe('coversWholeWallpaper', () => {
    it('only while Stage Manager is on and hides the desktop items', () => {
        expect(coversWholeWallpaper({ enabled: true, hidesDesktopItems: true })).toBe(true);
        expect(coversWholeWallpaper({ enabled: true, hidesDesktopItems: false })).toBe(false);
        expect(coversWholeWallpaper({ enabled: false, hidesDesktopItems: true })).toBe(false);
        expect(coversWholeWallpaper(null)).toBe(false);
    });
});
