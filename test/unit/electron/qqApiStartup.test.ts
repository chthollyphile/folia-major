import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/qqApiStartup.test.ts

const { QQ_API_MODULE, isModuleNotFound, startQqApi } = require('../../../electron/qqApiStartup.cjs') as {
    QQ_API_MODULE: string;
    isModuleNotFound: (error: unknown) => boolean;
    startQqApi: (options: Record<string, unknown>) => Promise<{
        port: number;
        stateFilePath: string | null;
        server: FakeServer;
        close: () => Promise<void>;
    }>;
};

/** The shape node throws when a package is absent; the startup helper classifies on `code`. */
function moduleNotFoundError(specifier: string) {
    const error = new Error(`Cannot find module '${specifier}'`) as Error & { code: string };
    error.code = 'MODULE_NOT_FOUND';
    return error;
}

// Stands in for the http.Server the package exports: listening flips only once the caller lets the
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

/** Mimics the package: requiring it starts the listen, which settles on a later tick. */
function moduleThatBinds(server: FakeServer) {
    return () => {
        setImmediate(() => server.bind());
        return { server };
    };
}

describe('QQ API startup', () => {
    it('hands the port, state path and explorer opt-out to the package', async () => {
        const env: Record<string, string | undefined> = {};
        const server = new FakeServer();
        const loadModule = vi.fn(() => {
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
            loadModule,
            env,
        });

        // Loaded by package specifier, not by a path into a build output directory.
        expect(loadModule).toHaveBeenCalledWith('@yakult-green-tea/qq-music-api');
        expect(QQ_API_MODULE).toBe('@yakult-green-tea/qq-music-api');
        expect(result.port).toBe(45123);
        expect(result.stateFilePath).toBe('/tmp/qq/qq-device.json');
        expect(result.server).toBe(server);
    });

    it('resolves only once the socket is actually bound', async () => {
        const server = new FakeServer();
        let settled = false;

        const pending = startQqApi({
            port: 45123,
            loadModule: () => ({ server }),
            env: {},
        }).then((value) => {
            settled = true;
            return value;
        });

        // The package has already been required at this point; without an explicit wait the caller
        // would have reported "running" here, before the port was bound.
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(server.listening).toBe(false);

        server.bind();
        await expect(pending).resolves.toMatchObject({ port: 45123 });
        expect(settled).toBe(true);
    });

    it('accepts a package that is already listening by the time it returns', async () => {
        const server = new FakeServer();
        server.listening = true;

        await expect(startQqApi({
            port: 45123,
            loadModule: () => ({ server }),
            env: {},
        })).resolves.toMatchObject({ port: 45123 });
    });

    it('rejects when the port turns out to be taken after the package loads', async () => {
        const server = new FakeServer();

        const pending = startQqApi({
            port: 45123,
            loadModule: () => ({ server }),
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
            loadModule: moduleThatBinds(server),
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
            loadModule: moduleThatBinds(server),
            env: {},
        });

        await handle.close();
        expect(server.closeCalls).toBe(1);
        expect(server.listening).toBe(false);

        // Closing twice is a no-op rather than an error: quit paths may run more than once.
        await handle.close();
        expect(server.closeCalls).toBe(1);
    });

    it('rejects when the package exposes no server handle', async () => {
        await expect(startQqApi({
            port: 45123,
            loadModule: () => ({}),
            env: {},
        })).rejects.toThrow(/did not expose an HTTP server/);
    });

    it('restores the main process environment afterwards', async () => {
        const env: Record<string, string | undefined> = { PORT: '3000', NODE_ENV: 'production' };
        const server = new FakeServer();

        await startQqApi({
            port: 45123,
            stateFilePath: '/tmp/qq/qq-device.json',
            loadModule: moduleThatBinds(server),
            env,
        });

        expect(env.PORT).toBe('3000');
        expect(env.NODE_ENV).toBe('production');
        expect(env.QQ_AUTH_STATE_PATH).toBeUndefined();
        expect(env.QQ_DISABLE_UPDATE_CHECK).toBeUndefined();
    });

    it('restores the environment even when the package throws', async () => {
        const env: Record<string, string | undefined> = { PORT: '3000' };

        await expect(startQqApi({
            port: 45123,
            loadModule: () => { throw new Error('listen EADDRINUSE'); },
            env,
        })).rejects.toThrow('listen EADDRINUSE');

        expect(env.PORT).toBe('3000');
        expect(env.AUTO_OPEN_EXPLORER).toBeUndefined();
    });

    // A build shipped without the dependency can never recover, so the caller reports it as
    // 'unavailable'; a runtime failure must not be flattened into that same message.
    it('marks a missing package as MODULE_NOT_FOUND with an actionable message', async () => {
        const env: Record<string, string | undefined> = { PORT: '3000' };

        const rejection = startQqApi({
            port: 45123,
            loadModule: () => { throw moduleNotFoundError('@yakult-green-tea/qq-music-api'); },
            env,
        });

        await expect(rejection).rejects.toThrow(/is not installed/);
        await expect(rejection).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' });
        // The environment is still restored on this path.
        expect(env.PORT).toBe('3000');
        expect(env.QQ_DISABLE_UPDATE_CHECK).toBeUndefined();
    });

    it('leaves other load failures unclassified so they surface as errors', async () => {
        const boom = new Error('Unexpected token in module');

        const rejection = startQqApi({
            port: 45123,
            loadModule: () => { throw boom; },
            env: {},
        });

        await expect(rejection).rejects.toBe(boom);
        expect(isModuleNotFound(boom)).toBe(false);
    });

    it('classifies errors the way the caller branches on them', () => {
        expect(isModuleNotFound(moduleNotFoundError('@yakult-green-tea/qq-music-api'))).toBe(true);
        expect(isModuleNotFound(new Error('listen EADDRINUSE'))).toBe(false);
        expect(isModuleNotFound(undefined)).toBe(false);
        expect(isModuleNotFound(null)).toBe(false);
    });

    it('refuses to start without a port', async () => {
        await expect(startQqApi({ loadModule: vi.fn(), env: {} }))
            .rejects.toThrow(/port is required/);
    });
});
