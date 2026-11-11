import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/nativeTrafficLights.test.ts
// The macOS traffic lights close the window on their own, and wallpaper mode needs a window
// without them. These rules only run on macOS, so they are pinned here.
const require = createRequire(import.meta.url);
const {
    shouldHideToTrayOnClose,
    shouldRebuildBeforeMacWallpaper,
    shouldRebuildAfterMacWallpaper,
} = require('../../../electron/nativeTrafficLights.cjs');

describe('native traffic lights: close to tray', () => {
    const hiding = { nativeTrafficLights: true, isAppQuitting: false, wallpaperMode: false, closeToTray: true, hasTray: true };

    it('hides the window instead of closing it when close-to-tray is on', () => {
        expect(shouldHideToTrayOnClose(hiding)).toBe(true);
    });

    it.each([
        ['the app is quitting', { isAppQuitting: true }],
        ['close-to-tray is off', { closeToTray: false }],
        ['there is no tray to come back from', { hasTray: false }],
        ['the window is a wallpaper', { wallpaperMode: true }],
        ['the window draws its own close button', { nativeTrafficLights: false }],
    ])('lets the close through when %s', (_label, change) => {
        expect(shouldHideToTrayOnClose({ ...hiding, ...change })).toBe(false);
    });
});

describe('native traffic lights: wallpaper mode', () => {
    it('rebuilds a window with traffic lights before it becomes a wallpaper', () => {
        expect(shouldRebuildBeforeMacWallpaper({ nativeTrafficLights: true, canEnterWallpaper: true, fullscreen: false })).toBe(true);
    });

    it.each([
        ['the entry will be refused', { canEnterWallpaper: false }],
        ['the window is in native full screen', { fullscreen: true }],
        ['the window has no traffic lights', { nativeTrafficLights: false }],
    ])('leaves the window alone when %s', (_label, change) => {
        expect(shouldRebuildBeforeMacWallpaper({ nativeTrafficLights: true, canEnterWallpaper: true, fullscreen: false, ...change })).toBe(false);
    });

    it('rebuilds on the way out only when the setting is on and the window lacks the lights', () => {
        expect(shouldRebuildAfterMacWallpaper({ settingEnabled: true, nativeTrafficLights: false })).toBe(true);
        expect(shouldRebuildAfterMacWallpaper({ settingEnabled: true, nativeTrafficLights: true })).toBe(false);
        expect(shouldRebuildAfterMacWallpaper({ settingEnabled: false, nativeTrafficLights: false })).toBe(false);
    });
});
