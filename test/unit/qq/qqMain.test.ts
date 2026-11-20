import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { purgeModuleCache } from '../../../electron/modSystem/nodeEntry.cjs';

// test/unit/qq/qqMain.test.ts
// QQ 音乐音源模组的 main 入口（sources/qq/main/index.ts）：迁之前 main.cjs 里的 createQqBackend、get-qq-port 通道与状态推送、
// CORS 名单和歌词中转的 QQ 主机，现在接在宿主给的 api.* 上。这里用替身 api 驱动它，后端（qqBackend.cjs）换成假的
// （vi.doMock），不加载 qq-music-api、不监听端口、不问 QQ。后端本身在 test/unit/electron/qqBackend.test.ts 与 qqApiStartup.test.ts。

interface FakeBackend {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    options: { broadcast: (channel: string, status: unknown) => void };
}

const SESSION_KEYS = new Set(['QQ_API_AUTH_SESSION_V1']);

/* Each launch loads the entry anew (vi.resetModules), the way the host's purge of the mod's module cache makes a
   re-enabled mod load it anew: every launch has a backend of its own. */
const launch = async (respond: (url: string, init?: Record<string, unknown>) => Response | Promise<Response> = () => new Response('{}')) => {
    vi.resetModules();
    const backends: FakeBackend[] = [];
    vi.doMock('../../../sources/qq/main/qqBackend.cjs', () => ({
        createQqBackend: (options: FakeBackend['options']) => {
            let running = false;
            const backend: FakeBackend = {
                options,
                start: vi.fn(async () => { running = true; }),
                stop: vi.fn(async () => { running = false; }),
                getStatus: vi.fn(() => ({ status: running ? 'running' : 'stopped', port: running ? 41057 : null })),
            };
            backends.push(backend);
            return backend;
        },
    }));
    const { default: activate } = await import('../../../sources/qq/main/index');
    const values = new Map<string, unknown>();
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const sent: Array<[string, unknown]> = [];
    const fetches: Array<{ url: string; init?: Record<string, unknown> }> = [];
    const allowed: unknown[] = [];
    const registered: Array<[string, unknown]> = [];
    const unload: Array<() => Promise<void> | void> = [];
    const quit: Array<() => Promise<void> | void> = [];
    const claimed = (key: string) => {
        if (!SESSION_KEYS.has(key)) throw new Error(`legacy-key-not-claimed:${key}`);
    };
    const api = {
        legacy: { store: {
            get: (key: string) => { claimed(key); return values.get(key); },
            set: (key: string, value: unknown) => { claimed(key); values.set(key, value); },
            has: (key: string) => { claimed(key); return values.has(key); },
            delete: (key: string) => { claimed(key); values.delete(key); },
        } },
        seal: {
            available: () => true,
            seal: (text: string) => Buffer.from(text, 'utf8').toString('base64'),
            open: (sealed: string) => Buffer.from(sealed, 'base64').toString('utf8'),
        },
        paths: { legacy: (name: string) => path.join(os.tmpdir(), 'folia-qq-main-test', name) },
        net: { fetch: async (url: string, init?: Record<string, unknown>) => { fetches.push({ url, init }); return respond(url, init); } },
        media: { allow: (rule: unknown) => { allowed.push(rule); return () => { }; } },
        rpc: {
            handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => { handlers.set(name, handler); },
            send: (name: string, payload: unknown) => { sent.push([name, payload]); },
        },
        diagnostics: {
            register: (id: string, backend: unknown) => { registered.push([id, backend]); },
            snapshot: vi.fn(async (id: string) => ({ snapshotOf: id })),
            selfCheck: vi.fn(async (id: string) => ({ selfCheckOf: id })),
        },
        onBeforeUnload: (handler: () => Promise<void> | void) => { unload.push(handler); },
        onBeforeQuit: (handler: () => Promise<void> | void) => { quit.push(handler); },
    };
    activate(api as never);
    return { api, handlers, sent, fetches, allowed, registered, unload, quit, backend: backends[0] };
};

afterEach(() => {
    vi.doUnmock('../../../sources/qq/main/qqBackend.cjs');
    vi.useRealTimers();
});

describe('QQ Music main entry (source mod)', () => {
    it('lets QQ\'s own hosts\' media through, answers four calls and registers its backend\'s diagnostics', async () => {
        const { handlers, allowed, registered, backend } = await launch();
        expect(allowed).toEqual([{ hosts: ['qq.com', '*.qq.com', 'y.gtimg.cn'] }]);
        expect([...handlers.keys()].sort()).toEqual(['diagnostics', 'musicu', 'selfCheck', 'status']);
        expect(registered).toEqual([['qq', backend]]);
    });

    it('starts the backend only when the client first asks for its status, and once for asks that come together', async () => {
        const { handlers, backend } = await launch();
        expect(backend.start).not.toHaveBeenCalled();
        const [first, second] = await Promise.all([handlers.get('status')!(), handlers.get('status')!()]);
        expect(first).toEqual({ status: 'running', port: 41057 });
        expect(second).toEqual(first);
        await handlers.get('status')!();
        expect(backend.start).toHaveBeenCalledTimes(1);
        // musicu (lyrics, anonymous search) does not start it.
        const fresh = await launch(() => new Response('{"code":0}'));
        await fresh.handlers.get('musicu')!({ req: {} });
        expect(fresh.backend.start).not.toHaveBeenCalled();
    });

    it('tells the client every change of the backend\'s status', async () => {
        const { backend, sent } = await launch();
        backend.options.broadcast('qq-api-status-changed', { status: 'error', port: null });
        expect(sent).toEqual([['status', { status: 'error', port: null }]]);
    });

    it('sends musicu only to QQ\'s fixed address, without the default session\'s cookies, and hands back status and body', async () => {
        const { handlers, fetches } = await launch(() => new Response('{"code":0}', { status: 200, headers: { 'Retry-After': '3' } }));
        const payload = { comm: { ct: 24 }, req: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: {} } };
        expect(await handlers.get('musicu')!(payload)).toEqual({ status: 200, text: '{"code":0}', retryAfter: '3' });
        expect(fetches).toHaveLength(1);
        expect(fetches[0].url).toBe('https://u.y.qq.com/cgi-bin/musicu.fcg');
        expect(fetches[0].init).toMatchObject({ method: 'POST', credentials: 'omit', body: JSON.stringify(payload) });
        expect(fetches[0].init?.headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('refuses a musicu body that is not an object, or too large, before asking anything', async () => {
        const { handlers, fetches } = await launch();
        const musicu = handlers.get('musicu')!;
        await expect(musicu(null)).rejects.toThrow(TypeError);
        await expect(musicu('https://elsewhere.test/')).rejects.toThrow(TypeError);
        await expect(musicu([{ req: {} }])).rejects.toThrow(TypeError);
        await expect(musicu({ req: { param: { text: 'x'.repeat(300 * 1024) } } })).rejects.toThrow(/too large/);
        expect(fetches).toEqual([]);
    });

    it('says QQ could not be asked when the fetch fails, and hands a non-2xx status through with no body', async () => {
        let { handlers } = await launch(() => { throw new Error('getaddrinfo ENOTFOUND u.y.qq.com'); });
        expect(await handlers.get('musicu')!({ req: {} })).toEqual({ unreachable: true, message: 'getaddrinfo ENOTFOUND u.y.qq.com' });
        ({ handlers } = await launch(() => new Response('busy', { status: 429, headers: { 'Retry-After': '10' } })));
        expect(await handlers.get('musicu')!({ req: {} })).toEqual({ status: 429, text: '', retryAfter: '10' });
    });

    it('gives up on a musicu request after 30 s and says so', async () => {
        vi.useFakeTimers();
        const { handlers } = await launch((_url, init) => new Promise((_resolve, reject) => {
            (init?.signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted')));
        }));
        const pending = handlers.get('musicu')!({ req: {} });
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(pending).resolves.toEqual({ unreachable: true, message: 'not answered in 30 s' });
    });

    it('keeps to the limit the client gives for musicu, never past 30 s', async () => {
        vi.useFakeTimers();
        const { handlers } = await launch((_url, init) => new Promise((_resolve, reject) => {
            (init?.signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted')));
        }));
        const pending = handlers.get('musicu')!({ req: {} }, 20_000);
        await vi.advanceTimersByTimeAsync(20_000);
        await expect(pending).resolves.toEqual({ unreachable: true, message: 'not answered in 20 s' });
        const longer = handlers.get('musicu')!({ req: {} }, 90_000);
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(longer).resolves.toEqual({ unreachable: true, message: 'not answered in 30 s' });
    });

    it('answers diagnostics and the self-check from the host\'s diagnostics of its backend', async () => {
        const { api, handlers } = await launch();
        expect(await handlers.get('diagnostics')!()).toEqual({ snapshotOf: 'qq' });
        expect(await handlers.get('selfCheck')!()).toEqual({ selfCheckOf: 'qq' });
        expect(api.diagnostics.snapshot).toHaveBeenCalledWith('qq');
        expect(api.diagnostics.selfCheck).toHaveBeenCalledWith('qq');
    });

    it('stops the server when the mod stops or the app quits, and starts nothing after', async () => {
        const { handlers, backend, unload, quit } = await launch();
        expect(unload).toHaveLength(1);
        expect(quit).toHaveLength(1);
        await handlers.get('status')!();
        await unload[0]();
        expect(backend.stop).toHaveBeenCalledTimes(1);
        await quit[0]();
        expect(backend.stop).toHaveBeenCalledTimes(2);
        // A status asked while it goes is answered without starting a second time.
        await handlers.get('status')!();
        expect(backend.start).toHaveBeenCalledTimes(1);

        // Stopped before anything asked: nothing to wait for, the stop still runs.
        const idle = await launch();
        await idle.unload[0]();
        expect(idle.backend.start).not.toHaveBeenCalled();
        expect(idle.backend.stop).toHaveBeenCalledTimes(1);
        await idle.handlers.get('status')!();
        expect(idle.backend.start).not.toHaveBeenCalled();
    });

    it('enabled again after a stop, has a backend of its own that the next status starts', async () => {
        const first = await launch();
        await first.handlers.get('status')!();
        await first.unload[0]();
        const again = await launch();
        expect(again.backend).not.toBe(first.backend);
        expect(again.backend.start).not.toHaveBeenCalled();
        expect(await again.handlers.get('status')!()).toEqual({ status: 'running', port: 41057 });
        expect(again.backend.start).toHaveBeenCalledTimes(1);
    });
});

// What makes the line above hold in the app: the host's loader drops every module under the mod's folder from
// require.cache before it requires the main entry again (nodeEntry.cjs startMain), the dependency archive
// (deps.<hash>.asar, inside the mod's folder) among them. qq-music-api listens on its port when it is loaded, so a
// package kept in the cache would come back already loaded, its old server closed, and the new start would not
// listen again: the re-enabled source would have no backend.
describe('re-enabling a source mod loads its packages anew', () => {
    it('drops a package under the mod\'s folder from the module cache, so the next require runs it again', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-qq-purge-'));
        try {
            const modDir = path.join(root, 'qq');
            const packageDir = path.join(modDir, 'deps', 'node_modules', 'listens-on-load');
            fs.mkdirSync(packageDir, { recursive: true });
            fs.writeFileSync(path.join(packageDir, 'index.js'), 'globalThis.__foliaQqLoads = (globalThis.__foliaQqLoads ?? 0) + 1; module.exports = { load: globalThis.__foliaQqLoads };');
            const outside = path.join(root, 'other.js');
            fs.writeFileSync(outside, 'module.exports = { at: Math.random() };');
            const load = createRequire(path.join(modDir, 'index.js'));
            const g = globalThis as { __foliaQqLoads?: number };
            delete g.__foliaQqLoads;

            expect(load(packageDir).load).toBe(1);
            expect(load(packageDir).load).toBe(1);
            const kept = load(outside);
            purgeModuleCache(modDir);
            expect(load(packageDir).load).toBe(2);
            // Only the mod's own folder goes.
            expect(load(outside)).toBe(kept);
            delete g.__foliaQqLoads;
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('QQ main entry: the package\'s exports', () => {
    it('takes the exports that carry the server, not the Koa app the compiled package puts on `default`', async () => {
        const { qqApiExportsOf } = await import('../../../sources/qq/main/qqApiExports');
        const server = { once: () => undefined };
        const app = { use: () => undefined };
        // What `import()` gives for the compiled CommonJS package: the exports object itself, its default the app.
        const compiled = { server, configureAuthSessionRepository: () => undefined, default: app };
        expect(qqApiExportsOf(compiled)).toBe(compiled);
        // An ESM wrapper whose default is the exports object.
        const exportsObject = { server, configureAuthSessionRepository: () => undefined };
        expect(qqApiExportsOf({ default: exportsObject })).toBe(exportsObject);
    });

    it('finds the package folder above the stub package.json the package ships in dist/, by the loaded server', async () => {
        const { packageRootOf } = await import('../../../sources/qq/main/qqApiExports');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-qq-root-'));
        try {
            const packageDir = path.join(root, 'node_modules', '@yakult-green-tea', 'qq-music-api');
            fs.mkdirSync(path.join(packageDir, 'dist', 'src'), { recursive: true });
            fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: '@yakult-green-tea/qq-music-api', main: 'dist/src/app.js' }));
            // What 3.3.6 ships in dist/: the same name, no entry.
            fs.writeFileSync(path.join(packageDir, 'dist', 'package.json'), JSON.stringify({ name: '@yakult-green-tea/qq-music-api', version: '3.3.6' }));
            const server = { once: () => undefined };
            const cached = { filename: path.join(packageDir, 'dist', 'src', 'app.js'), exports: { server, default: {} } };
            // The import may hand back another object around the same exports: the server is what is matched.
            expect(packageRootOf({ server }, { [cached.filename]: cached } as never)).toBe(packageDir);
            expect(() => packageRootOf({ server: {} }, { [cached.filename]: cached } as never)).toThrow(/folder was not found/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
