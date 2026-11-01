import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// Test the parent-owned channel without starting Electron or loading an Apple account.
const require = createRequire(import.meta.url);
const { createCompanionClient } = require('../../../electron/appleMusic/companionClient.cjs');

class Child extends EventEmitter {
    connected = true;
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    send = vi.fn((_message: unknown, callback: (error?: Error) => void) => callback());
    disconnect = vi.fn(() => { this.connected = false; this.emit('disconnect'); });
}

describe('Apple Music companion client', () => {
    it('routes replies to their own requests over one private child', async () => {
        const child = new Child();
        const spawnProcess = vi.fn((_binary: string, _args: string[], _options: unknown) => child);
        const client = createCompanionClient({ runtimePath: '/runtime', profilePath: '/profile', spawnProcess });
        const first = client.request('accountStatus');
        const second = client.request('search', { query: 'example' });
        expect(spawnProcess).toHaveBeenCalledTimes(1);
        expect(spawnProcess.mock.calls[0][1]).toContain('--folia-companion-hidden');
        expect(spawnProcess.mock.calls[0][2]).toMatchObject({ shell: false, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        const idOf = (operation: string) => {
            const call = child.send.mock.calls.find(([message]) => (message as { operation?: string }).operation === operation);
            return (call?.[0] as { id: string } | undefined)?.id;
        };
        child.emit('message', { id: idOf('search'), ok: true, data: { items: [] } });
        child.emit('message', { id: idOf('accountStatus'), ok: true, data: { authorized: true } });
        expect(await first).toMatchObject({ ok: true, data: { authorized: true } });
        expect(await second).toMatchObject({ ok: true, data: { items: [] } });
        client.close();
    });

    it('forwards the companion\'s own log lines and leaves the rest out', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const child = new Child();
            const client = createCompanionClient({ runtimePath: '/runtime', profilePath: '/profile', spawnProcess: () => child });
            const request = client.request('accountStatus');
            child.stdout.emit('data', '[AppleMusic] Companion window opened\nnoise that is not ours\n');
            child.stderr.emit('data', '[AppleMusic] Widevine components did not become ready\n');
            const sent = child.send.mock.calls[0]?.[0] as { id?: string } | undefined;
            child.emit('message', { id: sent?.id, ok: true, data: { id: 'a'.repeat(64) } });
            await request;
            expect(info).toHaveBeenCalledWith('[AppleMusic] Companion window opened');
            expect(warn).toHaveBeenCalledWith('[AppleMusic] Widevine components did not become ready');
            expect(info.mock.calls.flat()).not.toContain('noise that is not ours');
            client.close();
        } finally {
            info.mockRestore();
            warn.mockRestore();
        }
    });

    it('rejects invalid requests before starting a child', async () => {
        const spawnProcess = vi.fn();
        const client = createCompanionClient({ runtimePath: '/runtime', profilePath: '/profile', spawnProcess });
        expect(await client.request('evaluate', { code: 'anything' })).toMatchObject({ ok: false, error: 'invalid-request' });
        expect(spawnProcess).not.toHaveBeenCalled();
    });

    it('resolves outstanding requests if the child exits or the parent closes', async () => {
        const child = new Child();
        const client = createCompanionClient({ runtimePath: '/runtime', profilePath: '/profile', spawnProcess: () => child });
        const request = client.request('accountStatus');
        child.emit('exit', 1);
        expect(await request).toMatchObject({ ok: false, error: 'disconnected' });
        const child2 = new Child();
        const client2 = createCompanionClient({ runtimePath: '/runtime', profilePath: '/profile', spawnProcess: () => child2 });
        const pending = client2.request('accountStatus');
        client2.close();
        expect(await pending).toMatchObject({ ok: false, error: 'disconnected' });
        expect(child2.disconnect).toHaveBeenCalledOnce();
    });

    it('does not start without absolute runtime and profile paths', async () => {
        const client = createCompanionClient({ runtimePath: '', profilePath: '/profile', spawnProcess: vi.fn() });
        expect(await client.request('accountStatus')).toMatchObject({ ok: false, error: 'runtime-unavailable' });
    });

    it('asks again while the companion is still starting', async () => {
        vi.useFakeTimers();
        try {
            const child = new Child();
            child.send = vi.fn((message: unknown, callback: (error?: Error) => void) => {
                callback();
                const id = (message as { id: string }).id;
                child.emit('message', id.endsWith('_1')
                    ? { id, ok: false, error: 'not-ready' }
                    : { id, ok: true, data: { ready: true } });
            });
            const client = createCompanionClient({ runtimePath: '/runtime', profilePath: '/profile', spawnProcess: () => child, timeoutMs: 5000 });
            const pending = client.request('accountStatus');
            await vi.advanceTimersByTimeAsync(300);
            expect(await pending).toMatchObject({ ok: true, data: { ready: true } });
            expect(child.send).toHaveBeenCalledTimes(2);
            client.close();
        } finally {
            vi.useRealTimers();
        }
    });

    it('times out a stalled child and ignores its late reply', async () => {
        vi.useFakeTimers();
        try {
            const child = new Child();
            const client = createCompanionClient({ runtimePath: '/runtime', profilePath: '/profile', spawnProcess: () => child, timeoutMs: 25 });
            const pending = client.request('accountStatus');
            await vi.advanceTimersByTimeAsync(25);
            expect(await pending).toMatchObject({ ok: false, error: 'timeout' });
            child.emit('message', { id: 'request_1', ok: true, data: { authorized: true } });
            client.close();
        } finally {
            vi.useRealTimers();
        }
    });

    it('starts hidden even for login and forwards later show/hide requests', async () => {
        const child = new Child();
        const spawnProcess = vi.fn((_binary: string, _args: string[], _options: unknown) => child);
        const client = createCompanionClient({ runtimePath: '/runtime', profilePath: '/profile', spawnProcess });
        expect(await client.request('hideWindow')).toMatchObject({ ok: true });
        expect(spawnProcess).not.toHaveBeenCalled();
        const show = client.request('showWindow');
        expect(spawnProcess.mock.calls[0][1]).toContain('--folia-companion-hidden');
        const shown = child.send.mock.calls[0][0] as { id: string; operation: string };
        expect(shown.operation).toBe('showWindow');
        child.emit('message', { id: shown.id, ok: true, data: {} });
        await show;
        const hide = client.request('hideWindow');
        const hidden = child.send.mock.calls[1][0] as { id: string; operation: string };
        expect(hidden.operation).toBe('hideWindow');
        child.emit('message', { id: hidden.id, ok: true, data: {} });
        await hide;
        client.close();
    });

});
