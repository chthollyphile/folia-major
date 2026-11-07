import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/mainWindowNavigation.test.ts
// The main window's own view changes are not new pages: the capture of the machine's sound, and the
// arm behind it, stay with the page while the app moves between its views, and go only when that page
// itself is replaced (a reload, or a jump to another page).
//
// main.cjs cannot be required (that starts the whole app): the handler is taken from the source as it
// is written and run with the names it uses passed in.

const rootDir = path.resolve(__dirname, '../../../');
const mainCjs = readFileSync(path.join(rootDir, 'electron/main.cjs'), 'utf8');

const body = mainCjs.match(/win\.webContents\.on\('did-start-navigation', \([^)]*\) => \{\n([\s\S]*?)\n {2}\}\);/)?.[1] ?? '';

const handlerFor = (deps: { win: unknown; mainWindow: unknown; forgot: () => void }) => {
    const names = ['win', 'mainWindow', 'forgetExternalSpectrumCapture'];
    const factory = new Function(...names, `return (details) => {\n${body}\n};`);
    return factory(deps.win, deps.mainWindow, deps.forgot) as (details: unknown) => void;
};

describe('main.cjs: a new page clears the spectrum capture, a view change does not', () => {
    it('finds the handler in main.cjs', () => {
        expect(body, 'did-start-navigation handler').toContain('forgetExternalSpectrumCapture()');
    });

    it('clears it when the main window reloads or goes to another page', () => {
        const win = {};
        const forgot = vi.fn();
        handlerFor({ win, mainWindow: win, forgot })({ isMainFrame: true, isSameDocument: false });
        expect(forgot).toHaveBeenCalledOnce();
    });

    it('keeps it while the app changes its own view, or a frame inside the page loads', () => {
        const win = {};
        const forgot = vi.fn();
        const handler = handlerFor({ win, mainWindow: win, forgot });
        // pushState and hash views: the address changes, the page that holds the capture stays.
        handler({ isMainFrame: true, isSameDocument: true });
        handler({ isMainFrame: false, isSameDocument: false });
        expect(forgot).not.toHaveBeenCalled();
    });

    it('leaves the page of another window alone', () => {
        const forgot = vi.fn();
        handlerFor({ win: {}, mainWindow: {}, forgot })({ isMainFrame: true, isSameDocument: false });
        expect(forgot).not.toHaveBeenCalled();
    });
});
