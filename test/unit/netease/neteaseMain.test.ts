import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NETEASE_API_PACKAGE, neteasePackageRoot } from '../../../sources/netease/main/packageRoot';

// test/unit/netease/neteaseMain.test.ts
// 网易云音乐音源模组的 main 入口（sources/netease/main/index.ts）：迁之前 main.cjs 里的 createNeteaseBackend、
// get-netease-port / get-netease-api-status / restart-netease-api 三个通道与状态推送，现在接在宿主给的 api.* 上。
// 这里用替身 api 驱动它，后端（neteaseBackend.cjs）换成假的（vi.doMock），不开线程、不加载 API 包、不监听端口。
// 后端本身在 test/unit/electron/neteaseBackend.test.ts、neteaseApiHost.test.ts 与 neteaseApiStartup.test.ts。

interface FakeBackend {
    preload: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    options: {
        broadcast: (channel: string, status: unknown) => void;
        onUnhandledRejection: (reason: unknown) => void;
        workerPath: string;
        workerData: { packageRoot: string };
    };
}

const PACKAGE_ROOT = path.join('deps', 'node_modules', NETEASE_API_PACKAGE);

/* Each launch loads the entry anew (vi.resetModules), the way the host's purge of the mod's module cache makes a
   re-enabled mod load it anew: every launch has a backend of its own. */
const launch = async () => {
    vi.resetModules();
    const backends: FakeBackend[] = [];
    const resolved: string[] = [];
    vi.doMock('@folia/source-deps', () => ({
        depsRequire: Object.assign(() => { throw new Error('the entry loads nothing from the archive itself'); }, {
            resolve: (request: string) => {
                resolved.push(request);
                return path.join(PACKAGE_ROOT, path.relative(NETEASE_API_PACKAGE, request));
            },
        }),
    }));
    vi.doMock('../../../sources/netease/main/neteaseBackend.cjs', () => ({
        createNeteaseBackend: (options: FakeBackend['options']) => {
            let status = { status: 'idle', port: null as number | null };
            const backend: FakeBackend = {
                options,
                preload: vi.fn(),
                start: vi.fn(async () => {
                    status = { status: 'running', port: 35001 };
                    return status;
                }),
                stop: vi.fn(async () => { status = { status: 'idle', port: null }; }),
                getStatus: vi.fn(() => status),
            };
            backends.push(backend);
            return backend;
        },
    }));
    const { default: activate } = await import('../../../sources/netease/main/index');
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const sent: Array<[string, unknown]> = [];
    const registered: Array<[string, unknown]> = [];
    const reported: Array<[unknown, string]> = [];
    const unload: Array<() => Promise<void> | void> = [];
    const quit: Array<() => Promise<void> | void> = [];
    const api = {
        rpc: {
            handle: (name: string, handler: (...args: unknown[]) => unknown) => { handlers.set(name, handler); },
            send: (name: string, payload: unknown) => { sent.push([name, payload]); },
        },
        diagnostics: {
            register: (id: string, backend: unknown) => { registered.push([id, backend]); },
            snapshot: vi.fn(async (id: string) => ({ snapshotOf: id })),
            selfCheck: vi.fn(async (id: string) => ({ selfCheckOf: id })),
        },
        reportError: (reason: unknown, where: string) => { reported.push([reason, where]); },
        onBeforeUnload: (handler: () => Promise<void> | void) => { unload.push(handler); },
        onBeforeQuit: (handler: () => Promise<void> | void) => { quit.push(handler); },
    };
    activate(api as never);
    return { api, handlers, sent, registered, reported, unload, quit, resolved, backend: backends[0] };
};

const UNBLOCK = 'ENABLE_GENERAL_UNBLOCK';
const unblockBefore = process.env[UNBLOCK];

afterEach(() => {
    vi.doUnmock('../../../sources/netease/main/neteaseBackend.cjs');
    vi.doUnmock('@folia/source-deps');
    if (unblockBefore === undefined) delete process.env[UNBLOCK];
    else process.env[UNBLOCK] = unblockBefore;
});

describe('NetEase Cloud Music main entry (source mod)', () => {
    it('answers four calls, registers its backend\'s diagnostics, and starts the API as soon as it is loaded', async () => {
        const { handlers, registered, backend } = await launch();
        expect([...handlers.keys()].sort()).toEqual(['diagnostics', 'restart', 'selfCheck', 'status']);
        expect(registered).toEqual([['netease', backend]]);
        // Fully enabled, the host loads the entry when the app starts; matching only, at the client's first rpc (the
        // host's deferred main), so the API starts no earlier than the source is used.
        expect(backend.preload).toHaveBeenCalledTimes(1);
        expect(backend.start).toHaveBeenCalledTimes(1);
        expect(backend.start).toHaveBeenCalledWith();
    });

    it('opens the worker built beside it, and hands it the folder of the API package in the deps archive', async () => {
        const { backend, resolved } = await launch();
        expect(path.basename(backend.options.workerPath)).toBe('worker.cjs');
        expect(resolved).toEqual([`${NETEASE_API_PACKAGE}/package.json`]);
        expect(backend.options.workerData).toEqual({ packageRoot: PACKAGE_ROOT });
    });

    it('answers the status as it is, never waiting for a start', async () => {
        const { handlers, backend } = await launch();
        backend.start.mockClear();
        backend.getStatus.mockReturnValue({ status: 'starting', port: null });
        expect(await handlers.get('status')!()).toEqual({ status: 'starting', port: null });
        expect(backend.start).not.toHaveBeenCalled();
    });

    it('restarts for the reason it is given, and for no other', async () => {
        const { handlers, backend } = await launch();
        backend.start.mockClear();
        await expect(handlers.get('restart')!('needed')).resolves.toEqual({ status: 'running', port: 35001 });
        expect(backend.start).toHaveBeenLastCalledWith('needed');
        await handlers.get('restart')!('something else');
        expect(backend.start).toHaveBeenLastCalledWith(undefined);
        await handlers.get('restart')!();
        expect(backend.start).toHaveBeenLastCalledWith(undefined);
    });

    it('tells the client every change of the backend\'s status, and reports the worker\'s unhandled rejections', async () => {
        const { backend, sent, reported } = await launch();
        backend.options.broadcast('netease-api-status-changed', { status: 'error', port: null, error: 'port in use' });
        expect(sent).toEqual([['status', { status: 'error', port: null, error: 'port in use' }]]);
        const reason = new Error('inside the worker');
        backend.options.onUnhandledRejection(reason);
        expect(reported).toEqual([[reason, 'NetEase API worker']]);
    });

    it('answers diagnostics and the self-check from the host\'s diagnostics of its backend', async () => {
        const { api, handlers } = await launch();
        expect(await handlers.get('diagnostics')!()).toEqual({ snapshotOf: 'netease' });
        expect(await handlers.get('selfCheck')!()).toEqual({ selfCheckOf: 'netease' });
        expect(api.diagnostics.snapshot).toHaveBeenCalledWith('netease');
        expect(api.diagnostics.selfCheck).toHaveBeenCalledWith('netease');
    });

    it('stops the worker when the mod stops or the app quits, once, and restarts nothing after', async () => {
        const { handlers, backend, unload, quit } = await launch();
        expect(unload).toHaveLength(1);
        expect(quit).toHaveLength(1);
        await unload[0]();
        expect(backend.stop).toHaveBeenCalledTimes(1);
        await quit[0]();
        expect(backend.stop).toHaveBeenCalledTimes(1);
        backend.start.mockClear();
        expect(await handlers.get('restart')!('needed')).toEqual({ status: 'idle', port: null });
        expect(backend.start).not.toHaveBeenCalled();
    });

    // The worker sets ENABLE_GENERAL_UNBLOCK=false for the whole process (only the API package reads it): it is put
    // back as it was before the entry loaded, set or not.
    it('puts ENABLE_GENERAL_UNBLOCK back as it was when it stops', async () => {
        delete process.env[UNBLOCK];
        let launched = await launch();
        process.env[UNBLOCK] = 'false';
        await launched.unload[0]();
        expect(process.env[UNBLOCK]).toBeUndefined();

        process.env[UNBLOCK] = 'true';
        launched = await launch();
        process.env[UNBLOCK] = 'false';
        await launched.quit[0]();
        expect(process.env[UNBLOCK]).toBe('true');
    });

    it('enabled again after a stop, has a backend of its own, started anew', async () => {
        const first = await launch();
        await first.unload[0]();
        const again = await launch();
        expect(again.backend).not.toBe(first.backend);
        expect(again.backend.start).toHaveBeenCalledTimes(1);
        await expect(again.handlers.get('restart')!('needed')).resolves.toEqual({ status: 'running', port: 35001 });
    });
});

describe('the folder of the API package', () => {
    it('is the folder of its own package.json, wherever the archive keeps it', () => {
        const at = path.join('archive', 'node_modules', NETEASE_API_PACKAGE);
        expect(neteasePackageRoot((request) => path.join('archive', 'node_modules', request))).toBe(at);
    });

    // Found through its package.json: the package has no exports table that would hide it, and the package.json found
    // is the package's own (not one of a folder inside it).
    it('is found in the pinned package by its package.json', () => {
        const root = neteasePackageRoot((request) => require.resolve(request));
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name: string; exports?: unknown };
        expect(manifest.name).toBe(NETEASE_API_PACKAGE);
        expect(manifest.exports).toBeUndefined();
        expect(fs.existsSync(path.join(root, 'main.js'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'util', 'request.js'))).toBe(true);
    });
});
