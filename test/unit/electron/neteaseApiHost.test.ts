import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/neteaseApiHost.test.ts

const require = createRequire(import.meta.url);
const { createNeteaseApiHost } = require('../../../electron/netease/neteaseApiHost.cjs') as {
    createNeteaseApiHost: (options?: Record<string, unknown>) => {
        preload: () => void;
        start: (options: { host: string }) => Promise<{ port: number }>;
        diagnostics: () => Promise<any>;
    };
};

// Stands in for the worker thread: it keeps what the host posted, and the test answers by hand.
class FakeWorker extends EventEmitter {
    posted: any[] = [];

    postMessage(message: any) {
        this.posted.push(message);
    }
}

const createHost = (overrides: Record<string, unknown> = {}) => {
    const workers: FakeWorker[] = [];
    const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const host = createNeteaseApiHost({
        createWorker: () => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
        logger,
        ...overrides,
    });
    return { host, workers, logger };
};

describe('Netease API host', () => {
    it('opens no worker until it is asked to', () => {
        const { workers } = createHost();

        expect(workers).toHaveLength(0);
    });

    it('resolves a start once the worker says the server is listening', async () => {
        const { host, workers } = createHost();
        const started = host.start({ host: '127.0.0.1' });

        expect(workers).toHaveLength(1);
        const [message] = workers[0].posted;
        expect(message).toMatchObject({ type: 'start', host: '127.0.0.1' });
        workers[0].emit('message', { type: 'result', id: message.id, ok: true, value: { port: 4321 } });

        await expect(started).resolves.toEqual({ port: 4321 });
    });

    it('rejects a start with the value the worker failed with', async () => {
        const { host, workers } = createHost();
        const started = host.start({ host: '127.0.0.1' });
        const failure = new Error('xeapi public key response missing sk');
        workers[0].emit('message', { type: 'result', id: workers[0].posted[0].id, ok: false, error: failure });

        await expect(started).rejects.toBe(failure);
    });

    // Only the error's name and sentence cross the thread: whether the network was the cause comes beside it.
    it('rejects a start the network failed with an error marked offline', async () => {
        const { host, workers } = createHost();
        const started = host.start({ host: '127.0.0.1' });
        const failure = new Error('getaddrinfo ENOTFOUND interface.music.163.com');
        workers[0].emit('message', { type: 'result', id: workers[0].posted[0].id, ok: false, error: failure, offline: true });

        await expect(started).rejects.toMatchObject({ message: failure.message, offline: true });
    });

    it('keeps one worker for the preload, a failed start and the start after it', async () => {
        const { host, workers } = createHost();
        host.preload();
        const first = host.start({ host: '127.0.0.1' });
        workers[0].emit('message', { type: 'result', id: workers[0].posted[0].id, ok: false, error: new Error('no route') });
        await expect(first).rejects.toThrow('no route');

        const second = host.start({ host: '127.0.0.1' });
        expect(workers).toHaveLength(1);
        workers[0].emit('message', { type: 'result', id: workers[0].posted[1].id, ok: true, value: { port: 2 } });
        await expect(second).resolves.toEqual({ port: 2 });
    });

    it('gives each answer to the request it belongs to when they arrive out of order', async () => {
        const { host, workers } = createHost();
        const started = host.start({ host: '127.0.0.1' });
        const asked = host.diagnostics();
        const [startMessage, diagnosticsMessage] = workers[0].posted;
        expect(startMessage).toMatchObject({ type: 'start' });
        expect(diagnosticsMessage).toMatchObject({ type: 'diagnostics' });
        let startSettled = false;
        started.then(() => { startSettled = true; }, () => { startSettled = true; });

        // The request made second is answered first: it gets its own answer, and the start still waits.
        const snapshot = { capturedAt: 5, startup: {}, network: { interfaces: [], globalIpv6Count: 0 }, requests: [] };
        workers[0].emit('message', { type: 'result', id: diagnosticsMessage.id, ok: true, value: snapshot });
        await expect(asked).resolves.toBe(snapshot);
        expect(startSettled).toBe(false);

        const failure = new Error('listen EADDRINUSE: address already in use 127.0.0.1:4321');
        workers[0].emit('message', { type: 'result', id: startMessage.id, ok: false, error: failure });
        await expect(started).rejects.toBe(failure);
    });

    it("writes the worker's log lines through the main thread's logger", () => {
        const { host, workers, logger } = createHost();
        host.preload();
        workers[0].emit('message', { type: 'log', level: 'warn', args: ['[Netease API] retrying', { attempt: 1 }] });
        workers[0].emit('message', { type: 'log', level: 'debug', args: ['no such level on this logger'] });

        expect(logger.warn).toHaveBeenCalledWith('[Netease API] retrying', { attempt: 1 });
        expect(logger.log).toHaveBeenCalledWith('no such level on this logger');
    });

    it('hands an unhandled rejection of the worker to the main thread', () => {
        const onUnhandledRejection = vi.fn();
        const { host, workers } = createHost({ onUnhandledRejection });
        host.preload();
        const reason = new Error('nobody awaited this');
        workers[0].emit('message', { type: 'unhandled-rejection', reason });

        expect(onUnhandledRejection).toHaveBeenCalledWith(reason);
    });

    it('fails what was waiting when the worker ends, tells the caller, and opens a new one for the next start', async () => {
        const onExit = vi.fn();
        const { host, workers, logger } = createHost({ onExit });
        const started = host.start({ host: '127.0.0.1' });
        workers[0].emit('exit', 1);
        await expect(started).rejects.toThrow('exited with code 1');
        expect(logger.error).toHaveBeenCalledWith('[Netease API] worker thread exited with code 1');
        // The caller gets the exit code, and the error the waiting request was rejected with.
        expect(onExit).toHaveBeenCalledTimes(1);
        expect(onExit.mock.calls[0][0]).toBe(1);
        await expect(started).rejects.toBe(onExit.mock.calls[0][1]);

        void host.start({ host: '127.0.0.1' });
        expect(workers).toHaveLength(2);
        expect(workers[1].posted[0]).toMatchObject({ type: 'start', host: '127.0.0.1' });
    });

    it("passes an uncaught exception of the worker to the caller's handler", () => {
        const onWorkerError = vi.fn();
        const { host, workers } = createHost({ onWorkerError });
        host.preload();
        const error = new Error('thrown inside the worker');
        workers[0].emit('error', error);

        expect(onWorkerError).toHaveBeenCalledWith(error);
    });

    it('answers the diagnostics from the worker, and with an empty record before any worker exists', async () => {
        const { host, workers } = createHost();

        const empty = await host.diagnostics();
        expect(empty).toEqual({ startup: [], login: null, identity: null, connections: [] });
        expect(workers).toHaveLength(0);

        host.preload();
        const asked = host.diagnostics();
        const [message] = workers[0].posted;
        expect(message).toMatchObject({ type: 'diagnostics' });
        const snapshot = { startup: [], login: { capturedAt: 5, startup: {}, requests: [] }, identity: null, connections: [] };
        workers[0].emit('message', { type: 'result', id: message.id, ok: true, value: snapshot });

        await expect(asked).resolves.toBe(snapshot);
    });
});
