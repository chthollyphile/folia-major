import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/backgroundThrottling.test.ts
// The 后台节流 switch in the main process: the main window is throttled only while the switch is on
// and nothing needs the window live, and the renderer hears of every change of that, and of the
// window going out of sight while it holds, exactly once.
const require = createRequire(import.meta.url);
type State = { active: boolean; hidden: boolean };
const { createBackgroundThrottling } = require('../../../electron/backgroundThrottling.cjs') as {
    createBackgroundThrottling: (deps: {
        isEnabled: () => boolean;
        getStandDownReason: () => string | null;
    }) => { attach: (win: unknown) => void; refresh: () => void; getState: () => State };
};

const createWindow = () => {
    const listeners = new Map<string, () => void>();
    const win = {
        destroyed: false,
        minimised: false,
        visible: true,
        isDestroyed: () => win.destroyed,
        isMinimized: () => win.minimised,
        isVisible: () => win.visible,
        on: (event: string, listener: () => void) => { listeners.set(event, listener); },
        emit: (event: string) => listeners.get(event)?.(),
        webContents: {
            setBackgroundThrottling: vi.fn(),
            send: vi.fn(),
        },
    };
    return win;
};

describe('backgroundThrottling', () => {
    let enabled: boolean;
    let reason: string | null;
    const create = () => createBackgroundThrottling({ isEnabled: () => enabled, getStandDownReason: () => reason });

    beforeEach(() => {
        enabled = false;
        reason = null;
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('leaves the window alone while the switch is off, minimised or not', () => {
        const throttling = create();
        const win = createWindow();
        throttling.attach(win);
        win.minimised = true;
        win.emit('minimize');

        expect(throttling.getState()).toEqual({ active: false, hidden: false });
        expect(win.webContents.setBackgroundThrottling).not.toHaveBeenCalled();
        expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('throttles the window and tells the renderer when switched on, and undoes both when switched off', () => {
        const throttling = create();
        const win = createWindow();
        throttling.attach(win);

        enabled = true;
        throttling.refresh();
        throttling.refresh();
        expect(throttling.getState()).toEqual({ active: true, hidden: false });
        expect(win.webContents.setBackgroundThrottling).toHaveBeenCalledTimes(1);
        expect(win.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
        expect(win.webContents.send).toHaveBeenCalledTimes(1);
        expect(win.webContents.send).toHaveBeenLastCalledWith('background-throttling-changed', { active: true, hidden: false });

        enabled = false;
        throttling.refresh();
        expect(throttling.getState()).toEqual({ active: false, hidden: false });
        expect(win.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(false);
        expect(win.webContents.send).toHaveBeenLastCalledWith('background-throttling-changed', { active: false, hidden: false });
    });

    it('follows the window going out of sight and back while the switch is on', () => {
        enabled = true;
        const throttling = create();
        const win = createWindow();
        throttling.attach(win);

        win.minimised = true;
        win.emit('minimize');
        expect(win.webContents.send).toHaveBeenLastCalledWith('background-throttling-changed', { active: true, hidden: true });
        win.minimised = false;
        win.emit('restore');
        expect(win.webContents.send).toHaveBeenLastCalledWith('background-throttling-changed', { active: true, hidden: false });

        win.visible = false;
        win.emit('hide');
        expect(throttling.getState()).toEqual({ active: true, hidden: true });
        win.visible = true;
        win.emit('show');
        expect(throttling.getState()).toEqual({ active: true, hidden: false });
        expect(win.webContents.setBackgroundThrottling).toHaveBeenCalledTimes(1);
    });

    it('stands down while something needs the window live, and comes back after', () => {
        enabled = true;
        const throttling = create();
        const win = createWindow();
        throttling.attach(win);
        win.minimised = true;
        win.emit('minimize');

        reason = 'video export';
        throttling.refresh();
        expect(throttling.getState()).toEqual({ active: false, hidden: false });
        expect(win.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(false);
        expect(win.webContents.send).toHaveBeenLastCalledWith('background-throttling-changed', { active: false, hidden: false });

        // Another reason in place of the first changes nothing the window or the renderer can see.
        const sends = win.webContents.send.mock.calls.length;
        reason = 'OBS browser source';
        throttling.refresh();
        expect(win.webContents.setBackgroundThrottling).toHaveBeenCalledTimes(2);
        expect(win.webContents.send).toHaveBeenCalledTimes(sends);

        reason = null;
        throttling.refresh();
        expect(throttling.getState()).toEqual({ active: true, hidden: true });
        expect(win.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    });

    it('starts a rebuilt window from scratch and ignores a destroyed one', () => {
        enabled = true;
        const throttling = create();
        const first = createWindow();
        throttling.attach(first);

        // A window built in wallpaper mode starts standing down and is never throttled.
        reason = 'wallpaper mode';
        const second = createWindow();
        throttling.attach(second);
        expect(throttling.getState()).toEqual({ active: false, hidden: false });
        expect(second.webContents.setBackgroundThrottling).not.toHaveBeenCalled();
        expect(second.webContents.send).not.toHaveBeenCalled();

        second.destroyed = true;
        reason = null;
        throttling.refresh();
        expect(second.webContents.setBackgroundThrottling).not.toHaveBeenCalled();
        expect(first.webContents.setBackgroundThrottling).toHaveBeenCalledTimes(1);
    });
});
