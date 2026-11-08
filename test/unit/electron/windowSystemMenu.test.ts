import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/windowSystemMenu.test.ts
// Windows' window menu is refused only for a window whose key-capture field is recording, and a
// recording that never said it ended stops counting once its page reloads, crashes or closes.
const require = createRequire(import.meta.url);
const { createWindowSystemMenuGuard } = require('../../../electron/windowSystemMenu.cjs') as {
    createWindowSystemMenuGuard: () => {
        attach: (window: unknown) => void;
        setCapturing: (webContentsId: number, active: boolean) => void;
        isCapturing: (webContentsId: number) => boolean;
    };
};

const makeWindow = (id: number) => {
    const window = new EventEmitter() as EventEmitter & { webContents: EventEmitter & { id: number } };
    window.webContents = Object.assign(new EventEmitter(), { id });
    return window;
};

/** Opens the window menu on `window` and says whether it was refused. */
const openMenu = (window: EventEmitter): boolean => {
    let refused = false;
    window.emit('system-context-menu', { preventDefault: () => { refused = true; } }, { x: 0, y: 0 });
    return refused;
};

describe('windowSystemMenu', () => {
    it('leaves the menu alone until the window records, and only for that window', () => {
        const guard = createWindowSystemMenuGuard();
        const main = makeWindow(1);
        const remote = makeWindow(2);
        guard.attach(main);
        guard.attach(remote);

        expect(openMenu(main)).toBe(false);
        guard.setCapturing(1, true);
        expect(openMenu(main)).toBe(true);
        expect(openMenu(remote)).toBe(false);
        guard.setCapturing(1, false);
        expect(openMenu(main)).toBe(false);
    });

    it('takes only a literal true as recording', () => {
        const guard = createWindowSystemMenuGuard();
        guard.setCapturing(1, 'yes' as unknown as boolean);
        expect(guard.isCapturing(1)).toBe(false);
    });

    it('forgets a recording when the page navigates, crashes or the window closes', () => {
        for (const [target, event, payload] of [
            ['webContents', 'did-start-navigation', { isMainFrame: true, isSameDocument: false }],
            ['webContents', 'render-process-gone', undefined],
            ['window', 'closed', undefined],
        ] as const) {
            const guard = createWindowSystemMenuGuard();
            const window = makeWindow(3);
            guard.attach(window);
            guard.setCapturing(3, true);
            (target === 'window' ? window : window.webContents).emit(event, payload);
            expect(guard.isCapturing(3), event).toBe(false);
        }
    });

    it('keeps a recording while an iframe loads or the page changes its own address', () => {
        const guard = createWindowSystemMenuGuard();
        const window = makeWindow(4);
        guard.attach(window);
        guard.setCapturing(4, true);
        window.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
        window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
        expect(guard.isCapturing(4)).toBe(true);
    });
});
