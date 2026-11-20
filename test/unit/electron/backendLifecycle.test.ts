import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/backendLifecycle.test.ts
// 内嵌后端的生命周期工具。宿主那份随网易一起搬进了 sources/netease/main/backendLifecycle.cjs（宿主不再有内嵌后端）。

const {
    createBackendStatus,
    createStartupRecorder,
    describeError,
    findFreePort,
    waitUntilListening,
} = require('../../../sources/netease/main/backendLifecycle.cjs') as {
    createBackendStatus: (options: Record<string, unknown>) => { get: () => any; update: (patch: Record<string, unknown>) => any };
    createStartupRecorder: (options: Record<string, unknown>) => {
        begin: () => void;
        step: <T>(id: string, fn: (note: (detail: Record<string, unknown>) => void) => Promise<T> | T) => Promise<T>;
        finish: (outcome: string) => void;
        snapshot: () => any[];
    };
    describeError: (error: unknown) => string;
    findFreePort: () => Promise<number>;
    waitUntilListening: (server: net.Server) => Promise<net.Server>;
};

const quietLogger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('backend lifecycle', () => {
    it('describes an error with its Node code and cause', () => {
        expect(describeError(Object.assign(new Error('xeapi public key refresh timed out'), { code: 'ETIMEDOUT' })))
            .toBe('ETIMEDOUT: xeapi public key refresh timed out');
        // 错误码已经在 message 里时不重复。
        expect(describeError(Object.assign(new Error('listen EADDRINUSE: address already in use'), { code: 'EADDRINUSE' })))
            .toBe('listen EADDRINUSE: address already in use');
        expect(describeError(new Error('outer', { cause: new Error('inner') }))).toBe('outer (cause: inner)');
        expect(describeError('plain text')).toBe('plain text');
        expect(describeError(undefined)).toBe('Unknown error');
    });

    it('broadcasts every status change to all windows', () => {
        let clock = 100;
        const broadcast = vi.fn();
        const status = createBackendStatus({ channel: 'x-status', broadcast, now: () => clock });
        expect(status.get()).toEqual({ status: 'starting', port: null, error: null, updatedAt: 100 });

        clock = 150;
        const next = status.update({ status: 'running', port: 4321 });

        expect(next).toEqual({ status: 'running', port: 4321, error: null, updatedAt: 150 });
        expect(broadcast).toHaveBeenCalledWith('x-status', next);
    });

    it('records each startup step with its duration, details and error', async () => {
        let clock = 0;
        const logger = quietLogger();
        const startup = createStartupRecorder({ name: 'Test API', now: () => (clock += 10), logger });

        startup.begin();
        await startup.step('port', async (note) => {
            note({ port: 1234 });
            return 1234;
        });
        await expect(startup.step('xeapi-key', async () => {
            throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        })).rejects.toThrow('socket hang up');
        startup.finish('failed');

        const [run] = startup.snapshot();
        expect(run.outcome).toBe('failed');
        expect(run.steps).toEqual([
            expect.objectContaining({ id: 'port', outcome: 'ok', detail: { port: 1234 }, error: null, durationMs: 10 }),
            expect.objectContaining({ id: 'xeapi-key', outcome: 'failed', error: 'ECONNRESET: socket hang up' }),
        ]);
        expect(logger.warn).toHaveBeenCalledWith('[Test API] startup step xeapi-key: failed (10ms)', { error: 'ECONNRESET: socket hang up' });
    });

    it('keeps the last three startup runs', async () => {
        const startup = createStartupRecorder({ name: 'Test API', logger: quietLogger() });
        for (let index = 0; index < 4; index += 1) {
            startup.begin();
            await startup.step(`step-${index}`, () => undefined);
            startup.finish('running');
        }
        expect(startup.snapshot().map(run => run.steps[0].id)).toEqual(['step-1', 'step-2', 'step-3']);
    });

    it('turns a lost port race into a rejection instead of an unhandled error event', async () => {
        const holder = net.createServer();
        await new Promise<void>(resolve => holder.listen(0, '127.0.0.1', resolve));
        const { port } = holder.address() as AddressInfo;

        const late = net.createServer();
        late.listen(port, '127.0.0.1');
        await expect(waitUntilListening(late)).rejects.toMatchObject({ code: 'EADDRINUSE' });

        const fresh = net.createServer();
        fresh.listen(await findFreePort(), '127.0.0.1');
        await expect(waitUntilListening(fresh)).resolves.toBe(fresh);

        await Promise.all([holder, fresh].map(server => new Promise(resolve => server.close(resolve))));
    });
});
