import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/qqApiStartup.test.ts

const { startQqApi } = require('../../../electron/qqApiStartup.cjs') as {
    startQqApi: (options: Record<string, unknown>) => Promise<{
        port: number;
        stateFilePath: string | null;
        server: FakeServer;
        close: () => Promise<void>;
    }>;
};

const existingBundle = __filename;

// Stands in for the http.Server the bundle exports: listening flips only once the caller lets the
// 'listening' event fire, which is what the startup helper is supposed to wait for.
class FakeServer extends EventEmitter {
    listening = false;

    closeCalls = 0;

    bind() {
        this.listening = true;
        this.emit('listening');
    }

    failToBind(error: Error) {
        this.emit('error', error);
    }

    close(callback: () => void) {
        this.closeCalls += 1;
        this.listening = false;
        callback();
    }
}

/** Mimics the bundle: requiring it starts the listen, which settles on a later tick. */
function bundleThatBinds(server: FakeServer) {
    return () => {
        setImmediate(() => server.bind());
        return { server };
    };
}

describe('QQ API startup', () => {
    it('hands the port, state path and explorer opt-out to the bundle', async () => {
        const env: Record<string, string | undefined> = {};
        const server = new FakeServer();
        const loadBundle = vi.fn(() => {
            expect(env.PORT).toBe('45123');
            expect(env.QQ_AUTH_STATE_PATH).toBe('/tmp/qq/qq-device.json');
            expect(env.AUTO_OPEN_EXPLORER).toBe('false');
            // Packaged desktop builds must never spawn npm to check for a newer version.
            expect(env.QQ_DISABLE_UPDATE_CHECK).toBe('true');
            setImmediate(() => server.bind());
            return { server };
        });

        const result = await startQqApi({
            port: 45123,
            stateFilePath: '/tmp/qq/qq-device.json',
            bundlePath: existingBundle,
            loadBundle,
            env,
        });

        expect(loadBundle).toHaveBeenCalledWith(existingBundle);
        expect(result.port).toBe(45123);
        expect(result.stateFilePath).toBe('/tmp/qq/qq-device.json');
        expect(result.server).toBe(server);
    });

    it('resolves only once the socket is actually bound', async () => {
        const server = new FakeServer();
        let settled = false;

        const pending = startQqApi({
            port: 45123,
            bundlePath: existingBundle,
            loadBundle: () => ({ server }),
            env: {},
        }).then((value) => {
            settled = true;
            return value;
        });

        // The bundle has already been required at this point; without an explicit wait the caller
        // would have reported "running" here, before the port was bound.
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(server.listening).toBe(false);

        server.bind();
        await expect(pending).resolves.toMatchObject({ port: 45123 });
        expect(settled).toBe(true);
    });

    it('accepts a bundle that is already listening by the time it returns', async () => {
        const server = new FakeServer();
        server.listening = true;

        await expect(startQqApi({
            port: 45123,
            bundlePath: existingBundle,
            loadBundle: () => ({ server }),
            env: {},
        })).resolves.toMatchObject({ port: 45123 });
    });

    it('rejects when the port turns out to be taken after the bundle loads', async () => {
        const server = new FakeServer();

        const pending = startQqApi({
            port: 45123,
            bundlePath: existingBundle,
            loadBundle: () => ({ server }),
            env: {},
        });

        server.failToBind(new Error('listen EADDRINUSE: address already in use :::45123'));

        await expect(pending).rejects.toThrow('EADDRINUSE');
    });

    it('keeps post-bind socket errors from becoming unhandled', async () => {
        const server = new FakeServer();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        await startQqApi({
            port: 45123,
            bundlePath: existingBundle,
            loadBundle: bundleThatBinds(server),
            env: {},
        });

        // An EventEmitter with no 'error' listener rethrows; this must not take the main process down.
        expect(() => server.emit('error', new Error('socket hang up'))).not.toThrow();
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('closes the server through the returned handle', async () => {
        const server = new FakeServer();

        const handle = await startQqApi({
            port: 45123,
            bundlePath: existingBundle,
            loadBundle: bundleThatBinds(server),
            env: {},
        });

        await handle.close();
        expect(server.closeCalls).toBe(1);
        expect(server.listening).toBe(false);

        // Closing twice is a no-op rather than an error: quit paths may run more than once.
        await handle.close();
        expect(server.closeCalls).toBe(1);
    });

    it('rejects when the bundle exposes no server handle', async () => {
        await expect(startQqApi({
            port: 45123,
            bundlePath: existingBundle,
            loadBundle: () => ({}),
            env: {},
        })).rejects.toThrow(/did not expose an HTTP server/);
    });

    it('restores the main process environment afterwards', async () => {
        const env: Record<string, string | undefined> = { PORT: '3000', NODE_ENV: 'production' };
        const server = new FakeServer();

        await startQqApi({
            port: 45123,
            stateFilePath: '/tmp/qq/qq-device.json',
            bundlePath: existingBundle,
            loadBundle: bundleThatBinds(server),
            env,
        });

        expect(env.PORT).toBe('3000');
        expect(env.NODE_ENV).toBe('production');
        expect(env.QQ_AUTH_STATE_PATH).toBeUndefined();
        expect(env.QQ_DISABLE_UPDATE_CHECK).toBeUndefined();
    });

    it('restores the environment even when the bundle throws', async () => {
        const env: Record<string, string | undefined> = { PORT: '3000' };

        await expect(startQqApi({
            port: 45123,
            bundlePath: existingBundle,
            loadBundle: () => { throw new Error('listen EADDRINUSE'); },
            env,
        })).rejects.toThrow('listen EADDRINUSE');

        expect(env.PORT).toBe('3000');
        expect(env.AUTO_OPEN_EXPLORER).toBeUndefined();
    });

    it('fails with an actionable message when the bundle was never built', async () => {
        const loadBundle = vi.fn();

        await expect(startQqApi({
            port: 45123,
            bundlePath: '/nonexistent/qqMusicApi.cjs',
            loadBundle,
            env: {},
        })).rejects.toThrow(/npm run build:qq-api/);

        expect(loadBundle).not.toHaveBeenCalled();
    });

    it('refuses to start without a port', async () => {
        await expect(startQqApi({ bundlePath: existingBundle, loadBundle: vi.fn(), env: {} }))
            .rejects.toThrow(/port is required/);
    });
});
