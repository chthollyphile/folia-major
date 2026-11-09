import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    REMOTE_CONTROL_HIDE_TITLEBAR_SETTING_KEY,
    REMOTE_CONTROL_CLICK_THROUGH_SETTING_KEY,
    REMOTE_CONTROL_EXPAND_COVER_SETTING_KEY,
    REMOTE_CONTROL_TEXT_SHADE_SETTING_KEY,
    readRemoteControlWindowSettings,
    shouldShowRemoteUnlockTrayItem,
    applyRemoteControlMouseIgnore,
} = require('../../../electron/remoteControlWindowSettings.cjs') as typeof import('../../../electron/remoteControlWindowSettings.cjs');

describe('remote window settings', () => {
    it('defaults hide titlebar, click-through and text shade to off, expand cover to on', () => {
        expect(readRemoteControlWindowSettings((_key: string, fallback: boolean) => fallback)).toEqual({
            hideTitlebar: false,
            clickThrough: false,
            expandCover: true,
            textShade: false,
        });
    });

    it('reads the stored keys', () => {
        const stored: Record<string, boolean> = {
            [REMOTE_CONTROL_HIDE_TITLEBAR_SETTING_KEY]: true,
            [REMOTE_CONTROL_CLICK_THROUGH_SETTING_KEY]: true,
            [REMOTE_CONTROL_EXPAND_COVER_SETTING_KEY]: false,
            [REMOTE_CONTROL_TEXT_SHADE_SETTING_KEY]: true,
        };
        expect(readRemoteControlWindowSettings((key: string, fallback: boolean) => stored[key] ?? fallback)).toEqual({
            hideTitlebar: true,
            clickThrough: true,
            expandCover: false,
            textShade: true,
        });
    });

    it('shows the tray unlock item only for an open click-through window', () => {
        expect(shouldShowRemoteUnlockTrayItem({ remoteOpen: true, clickThrough: true })).toBe(true);
        expect(shouldShowRemoteUnlockTrayItem({ remoteOpen: false, clickThrough: true })).toBe(false);
        expect(shouldShowRemoteUnlockTrayItem({ remoteOpen: true, clickThrough: false })).toBe(false);
    });

    it('applies mouse ignore without forwarding and skips destroyed windows', () => {
        const win = { isDestroyed: () => false, setIgnoreMouseEvents: vi.fn() };
        expect(applyRemoteControlMouseIgnore(win, true)).toBe(true);
        expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
        const dead = { isDestroyed: () => true, setIgnoreMouseEvents: vi.fn() };
        expect(applyRemoteControlMouseIgnore(dead, true)).toBe(false);
        expect(dead.setIgnoreMouseEvents).not.toHaveBeenCalled();
    });
});
