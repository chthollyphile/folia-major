import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// Sign-out must invalidate old answers before clearing only the companion session.
const require = createRequire(import.meta.url);
const { createSessionActions } = require('../../../electron/appleMusic/companionSession.cjs');

describe('Apple Music companion session', () => {
    it('stops the page before clearing its session and reloads afterward', async () => {
        const steps: string[] = [];
        const window = { isDestroyed: () => false, loadURL: vi.fn(async (url: string) => { steps.push(url); }) };
        const session = { clearStorageData: vi.fn(async () => { steps.push('clear'); }) };
        const actions = createSessionActions({ getWindow: () => window, getSession: () => session,
            invalidate: () => { steps.push('invalidate'); }, startUrl: 'https://music.apple.com/' });
        expect(await actions.logout()).toEqual({ ok: true, data: {} });
        expect(steps).toEqual(['invalidate', 'about:blank', 'clear', 'https://music.apple.com/']);
        expect(actions.isBusy()).toBe(false);
    });

    it('does not accept a second sign-out while clearing is in progress', async () => {
        let finish!: () => void;
        const wait = new Promise<void>(resolve => { finish = resolve; });
        const window = { isDestroyed: () => false, loadURL: vi.fn(async () => {}) };
        const actions = createSessionActions({ getWindow: () => window, getSession: () => ({ clearStorageData: () => wait }),
            invalidate: () => {}, startUrl: 'https://music.apple.com/' });
        const first = actions.logout();
        expect(await actions.logout()).toEqual({ ok: false, error: 'busy' });
        finish();
        expect(await first).toEqual({ ok: true, data: {} });
    });
    it('keeps logout from interrupting recovery, then allows it to clear the session', async () => {
        let finish!: (value: boolean) => void;
        const recovery = new Promise<boolean>(resolve => { finish = resolve; });
        const window = { isDestroyed: () => false, loadURL: vi.fn(async () => {}) };
        const clearStorageData = vi.fn(async () => {});
        const actions = createSessionActions({ getWindow: () => window, getSession: () => ({ clearStorageData }),
            invalidate: vi.fn(), startUrl: 'https://music.apple.com/', recoverDocument: () => recovery });
        const pending = actions.recover({});
        expect(actions.isBusy()).toBe(true);
        expect(await actions.logout()).toMatchObject({ error: 'busy' });
        expect(window.loadURL).not.toHaveBeenCalled();
        finish(true);
        expect(await pending).toBe(true);
        expect(await actions.logout()).toMatchObject({ ok: true });
        expect(clearStorageData).toHaveBeenCalledOnce();
    });

    it('does not start recovery while logout owns the document', async () => {
        let finish!: () => void;
        const clearing = new Promise<void>(resolve => { finish = resolve; });
        const recoverDocument = vi.fn();
        const window = { isDestroyed: () => false, loadURL: vi.fn(async () => {}) };
        const actions = createSessionActions({ getWindow: () => window, getSession: () => ({ clearStorageData: () => clearing }),
            invalidate: vi.fn(), startUrl: 'https://music.apple.com/', recoverDocument });
        const logout = actions.logout();
        expect(await actions.recover({})).toBe(false);
        expect(recoverDocument).not.toHaveBeenCalled();
        finish();
        expect(await logout).toMatchObject({ ok: true });
    });

});
