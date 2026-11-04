import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// Test the parent-owned channel without starting Electron or loading an Apple account.
const require = createRequire(import.meta.url);
const { createCompanionClient: createClient } = require('../../../electron/appleMusic/companionClient.cjs');

// Isolate client request routing from the separately tested native pipe adapter.
const createCompanionClient = (options: Record<string, unknown>) => createClient({
    ...options, createNativeChannel: ({ spawnProcess }: { spawnProcess: unknown }) => spawnProcess,
});

class Child extends EventEmitter {
    connected = true;
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    send = vi.fn((_message: unknown, callback: (error?: Error) => void) => callback());
    disconnect = vi.fn(() => { this.connected = false; this.emit('disconnect'); });
}

describe('Apple Music companion client', () => {
    it('does not dispatch another attempt after busy exhausts the deadline', async () => {
        vi.useFakeTimers();
        try {
            const child = new Child();
            child.send = vi.fn((message: unknown, callback: (error?: Error) => void) => {
                callback();
                child.emit('message', { id: (message as { id: string }).id, ok: false, error: 'busy' });
            });
            const client = createCompanionClient({ nativeExecutablePath: '/runtime', profilePath: '/profile', spawnProcess: () => child, timeoutMs: 100 });
            const pending = client.request('pause');
            await vi.advanceTimersByTimeAsync(500);
            expect(await pending).toMatchObject({ ok: false, error: 'busy' });
            expect(child.send).toHaveBeenCalledTimes(1);
            client.close();
        } finally { vi.useRealTimers(); }
    });

    it('routes replies to their own requests over one private child', async () => {
        const child = new Child();
        const spawnProcess = vi.fn((_binary: string, _args: string[], _options: unknown) => child);
        const client = createCompanionClient({ nativeExecutablePath: '/runtime', profilePath: '/profile', spawnProcess });
        const first = client.request('accountStatus');
        const second = client.request('search', { query: 'example' });
        expect(spawnProcess).toHaveBeenCalledTimes(1);
        expect(spawnProcess.mock.calls[0][1]).toEqual(['--user-data-dir=/profile']);
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

    it('rejects invalid requests before starting a child', async () => {
        const spawnProcess = vi.fn();
        const client = createCompanionClient({ nativeExecutablePath: '/runtime', profilePath: '/profile', spawnProcess });
        expect(await client.request('evaluate', { code: 'anything' })).toMatchObject({ ok: false, error: 'invalid-request' });
        expect(spawnProcess).not.toHaveBeenCalled();
    });

    it('resolves outstanding requests if the child exits or the parent closes', async () => {
        const child = new Child();
        const client = createCompanionClient({ nativeExecutablePath: '/runtime', profilePath: '/profile', spawnProcess: () => child });
        const request = client.request('accountStatus');
        child.emit('exit', 1);
        expect(await request).toMatchObject({ ok: false, error: 'disconnected' });
        const child2 = new Child();
        const client2 = createCompanionClient({ nativeExecutablePath: '/runtime', profilePath: '/profile', spawnProcess: () => child2 });
        const pending = client2.request('accountStatus');
        client2.close();
        expect(await pending).toMatchObject({ ok: false, error: 'disconnected' });
        expect(child2.disconnect).toHaveBeenCalledOnce();
    });

    it('does not start without absolute runtime and profile paths', async () => {
        const client = createCompanionClient({ nativeExecutablePath: '', profilePath: '/profile', spawnProcess: vi.fn() });
        expect(await client.request('accountStatus')).toMatchObject({ ok: false, error: 'runtime-unavailable' });
    });

    it.each(['not-ready', 'busy'])('asks again when the companion returns %s before execution', async (rejection) => {
        vi.useFakeTimers();
        try {
            const child = new Child();
            child.send = vi.fn((message: unknown, callback: (error?: Error) => void) => {
                callback();
                const id = (message as { id: string }).id;
                child.emit('message', id.endsWith('_1')
                    ? { id, ok: false, error: rejection }
                    : { id, ok: true, data: { ready: true } });
            });
            const client = createCompanionClient({ nativeExecutablePath: '/runtime', profilePath: '/profile', spawnProcess: () => child, timeoutMs: 5000 });
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
            const client = createCompanionClient({ nativeExecutablePath: '/runtime', profilePath: '/profile', spawnProcess: () => child, timeoutMs: 25 });
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
        const client = createCompanionClient({ nativeExecutablePath: '/runtime', profilePath: '/profile', spawnProcess });
        expect(await client.request('hideWindow')).toMatchObject({ ok: true });
        expect(spawnProcess).not.toHaveBeenCalled();
        const show = client.request('showWindow');
        expect(spawnProcess.mock.calls[0][1]).toEqual(['--user-data-dir=/profile']);
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
