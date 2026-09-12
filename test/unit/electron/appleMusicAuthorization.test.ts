import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/appleMusicAuthorization.test.ts

const require = createRequire(import.meta.url);
const { createAuthorization } = require('../../../electron/appleMusic/authorization.cjs');

function setup() {
    const parent = { isDestroyed: () => false };
    let rejectLogin: (error: Error) => void = () => {};
    let resolveLogin: (value: boolean) => void = () => {};
    const invoke = vi.fn((action: string) => action === 'status'
        ? Promise.resolve({ authorized: false })
        : new Promise<boolean>((resolve, reject) => { resolveLogin = resolve; rejectLogin = reject; }));
    const contents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
    const auth = createAuthorization({ getParentWindow: () => parent, invoke, timeoutMs: 10000 });
    auth.attach(contents);
    const popup = Object.assign(new EventEmitter(), {
        isDestroyed: () => false, destroy: vi.fn(), focus: vi.fn(), setMenu: vi.fn(),
        webContents: Object.assign(new EventEmitter(), {
            setWindowOpenHandler: vi.fn(), getURL: vi.fn(() => 'https://idmsa.apple.com/signin'),
            executeJavaScript: vi.fn().mockResolvedValue(true),
        }),
    });
    return { auth, parent, invoke, contents, popup, resolveLogin: () => resolveLogin(true), rejectLogin: () => rejectLogin(new Error('authorization-failed')),
        open: (url = 'https://idmsa.apple.com/signin') => contents.setWindowOpenHandler.mock.calls[0][0]({ url }) };
}

afterEach(() => vi.useRealTimers());

describe('Apple authorization window lifecycle', () => {
    it('opens one parented Apple dialog from a user gesture, reuses concurrent login, and cleans up on success', async () => {
        const s = setup();
        expect(s.open().action).toBe('deny');
        const first = s.auth.authorize();
        await Promise.resolve();
        expect(s.invoke).toHaveBeenCalledWith('authorize', {}, true);
        expect(s.open()).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: { parent: s.parent, modal: true, webPreferences: { sandbox: true, nodeIntegration: false } } });
        s.contents.emit('did-create-window', s.popup);
        expect(s.auth.authorize()).toBe(first);
        expect(s.open().action).toBe('deny');
        expect(s.popup.focus).toHaveBeenCalled();
        expect(s.open('https://apple.com.evil.example/login').action).toBe('deny');
        expect(s.open('http://apple.com/login').action).toBe('deny');
        s.resolveLogin();
        await first;
        expect(s.popup.destroy).toHaveBeenCalledOnce();
        expect(s.open().action).toBe('deny');
    });
    it('waits for the SDK when Apple closes its window before authorization finishes', async () => {
        vi.useFakeTimers();
        const s = setup();
        const completed = vi.fn();
        const first = s.auth.authorize().then(completed);
        await Promise.resolve();
        s.contents.emit('did-create-window', s.popup);
        s.popup.emit('closed');
        await vi.advanceTimersByTimeAsync(2000);
        expect(completed).not.toHaveBeenCalled();
        s.resolveLogin();
        await first;
        expect(completed).toHaveBeenCalledOnce();
    });
    it('preserves SDK failures instead of relabelling every closed window as cancelled, and allows retry', async () => {
        const s = setup();
        const first = s.auth.authorize();
        const rejected = expect(first).rejects.toThrow('authorization-failed');
        await Promise.resolve();
        s.contents.emit('did-create-window', s.popup);
        s.popup.emit('closed');
        s.rejectLogin();
        await rejected;
        const retry = s.auth.authorize();
        await Promise.resolve();
        s.resolveLogin();
        await retry;
    });
    it('closes an abandoned Apple popup on timeout', async () => {
        vi.useFakeTimers();
        const s = setup();
        const first = s.auth.authorize();
        const rejected = expect(first).rejects.toThrow('login-timeout');
        await Promise.resolve();
        s.contents.emit('did-create-window', s.popup);
        await vi.advanceTimersByTimeAsync(10000);
        await rejected;
        expect(s.popup.destroy).toHaveBeenCalledOnce();
    });
    it('completes only the exact Apple callback error page and still preserves SDK failure', async () => {
        const s = setup();
        const first = s.auth.authorize();
        const rejected = expect(first).rejects.toThrow('authorization-failed');
        await Promise.resolve();
        s.contents.emit('did-create-window', s.popup);
        for (const url of ['https://idmsa.apple.com/error', 'https://authorize.music.apple.com.evil.example/error', 'https://authorize.music.apple.com/woa']) {
            s.popup.webContents.getURL.mockReturnValue(url);
            s.popup.webContents.emit('did-finish-load');
        }
        expect(s.popup.webContents.executeJavaScript).not.toHaveBeenCalled();
        s.popup.webContents.getURL.mockReturnValue('https://authorize.music.apple.com/error');
        s.popup.webContents.emit('did-finish-load');
        s.popup.webContents.emit('did-navigate-in-page');
        await Promise.resolve();
        expect(s.popup.webContents.executeJavaScript).toHaveBeenCalledOnce();
        s.rejectLogin();
        await rejected;
    });
});
