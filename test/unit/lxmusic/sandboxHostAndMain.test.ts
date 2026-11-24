import { describe, expect, it, vi } from 'vitest';
import type { FoliumSourceMainApi } from '@/mods/folium/mainContract';
import activate from '../../../sources/lxmusic/main/index';
import { createEgress } from '../../../sources/lxmusic/main/egress';
import { answerLxRequest, createLxSandbox, SANDBOX_PARTITION } from '../../../sources/lxmusic/main/sandboxHost';

// test/unit/lxmusic/sandboxHostAndMain.test.ts
// 洛雪音源的沙箱窗口宿主和 main 入口，Electron 换成假的：分区怎么配（本地应答、拒权限、死代理、CSP）、
// 页面发来的请求哪些接、哪些 403，被拦的去处不回内容，窗口什么时候销毁；以及没导入脚本时 main 入口不开窗口、不联网。

type Serve = (request: Request) => Response | Promise<Response>;

const fakeSession = () => {
    const calls: string[] = [];
    const handlers = new Map<string, Serve>();
    return {
        calls,
        handlers,
        session: {
            partition: SANDBOX_PARTITION,
            intercept: (scheme: 'http' | 'https', handler: Serve) => { calls.push(`intercept:${scheme}`); handlers.set(scheme, handler); return () => undefined; },
            refusePermissions: () => { calls.push('refusePermissions'); return () => undefined; },
            setProxy: async (config: Record<string, unknown>) => { calls.push(`setProxy:${String(config.proxyRules)}`); },
        } as never,
    };
};

/** A hidden window whose page answers each executeJavaScript with what `answer` returns for the code. */
const fakeWindows = (answer: (code: string) => unknown) => {
    const downloads: Array<(event: { preventDefault(): void }) => void> = [];
    const windows: Array<{ destroyed: boolean; options: Record<string, unknown>; loaded: string[]; events: string[]; evaluated: string[] }> = [];
    const hidden = (options: Record<string, unknown>) => {
        const state = { destroyed: false, options, loaded: [] as string[], events: [] as string[], evaluated: [] as string[] };
        windows.push(state);
        return {
            isDestroyed: () => state.destroyed,
            destroy: () => { state.destroyed = true; },
            loadURL: async (url: string) => { state.loaded.push(url); },
            webContents: {
                setWindowOpenHandler: (handler: () => { action: string }) => { state.events.push(`open:${handler().action}`); },
                on: (event: string) => { state.events.push(event); },
                setWebRTCIPHandlingPolicy: (policy: string) => { state.events.push(`webrtc:${policy}`); },
                executeJavaScript: async (code: string) => { state.evaluated.push(code); return answer(code); },
                setAudioMuted: (muted: boolean) => { state.events.push(`muted:${String(muted)}`); },
                session: { on: (event: string, listener: (event: { preventDefault(): void }) => void) => { state.events.push(`session:${event}`); downloads.push(listener); } },
            },
        };
    };
    return { windows, hidden, downloads };
};

const SCRIPT = { id: 's1', code: 'the script', info: { name: 'S' } };
const PAYLOAD = { source: 'kw', action: 'musicUrl', info: { type: '128k', musicInfo: {} } };

const sandboxWith = (answer: (code: string) => unknown, allowed = () => true) => {
    const { session, calls, handlers } = fakeSession();
    const { windows, hidden, downloads } = fakeWindows(answer);
    const sandbox = createLxSandbox({
        session, hidden, egress: createEgress(), runtimeCode: () => 'RUNTIME_CODE', isAllowed: allowed, log: () => undefined,
    });
    return { sandbox, calls, handlers, windows, downloads };
};
const pageAnswers = (code: string) => (code.includes('__lxHost.load(') ? { sources: { kw: {} } } : code.includes('__lxHost.call(') ? 'http://example.com/a.mp3' : undefined);

describe('the hidden sandbox window', () => {
    it('answers the partition locally, refuses permissions and sends everything else to a dead proxy', async () => {
        const { sandbox, calls, windows, downloads } = sandboxWith(pageAnswers);
        expect(await sandbox.load(SCRIPT)).toEqual({ kw: {} });
        expect(calls).toEqual(['intercept:https', 'intercept:http', 'refusePermissions', 'setProxy:socks5://127.0.0.1:1']);
        expect(windows).toHaveLength(1);
        expect(windows[0].options).toEqual({ session: SANDBOX_PARTITION, backgroundThrottling: false });
        expect(windows[0].loaded).toEqual(['https://lx-sandbox.invalid/']);
        expect(windows[0].events).toEqual([
            'open:deny', 'will-navigate', 'will-redirect', 'will-attach-webview', 'webrtc:disable_non_proxied_udp', 'muted:true', 'session:will-download',
        ]);
        // Every download of the partition is refused (a blob link with a download attribute is not the CSP's to stop).
        let prevented = 0;
        downloads[0]({ preventDefault: () => { prevented += 1; } });
        expect(prevented).toBe(1);
        // The partition is one: a second window registers no second listener.
        await sandbox.load({ ...SCRIPT, id: 's2' });
        expect(downloads).toHaveLength(1);
        expect(windows[0].evaluated[0]).toContain('RUNTIME_CODE');
        // The script goes in as a JSON string: it can never close the call it is handed in.
        expect(windows[0].evaluated[1]).toBe('globalThis.__lxHost.load("the script", {"name":"S"}, 15000)');
    });

    it('serves a blank page with a CSP that allows no network but its own origin, and 403 for anything else', async () => {
        const { sandbox, handlers } = sandboxWith(pageAnswers);
        await sandbox.load(SCRIPT);
        const serve = handlers.get('https')!;
        const page = await serve(new Request('https://lx-sandbox.invalid/'));
        expect(page.status).toBe(200);
        const csp = page.headers.get('content-security-policy')!;
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain('connect-src https://lx-sandbox.invalid');
        expect(csp).not.toContain('*');
        // No modal box in the app's name, no download, no popup, no form: only scripts, and its own origin for the fetch.
        expect(csp).toContain('sandbox allow-scripts allow-same-origin');
        expect(csp).not.toMatch(/allow-(modals|downloads|popups|forms|top-navigation)/);
        expect(await page.text()).not.toMatch(/<script|src=/);
        for (const url of ['https://example.com/', 'https://lx-sandbox.invalid/other', 'https://lx-sandbox.invalid.evil.example/', 'http://127.0.0.1/']) {
            expect((await serve(new Request(url))).status, url).toBe(403);
        }
        expect((await serve(new Request('https://lx-sandbox.invalid/__lx/request'))).status).toBe(403);
        expect((await handlers.get('http')!(new Request('http://lx-sandbox.invalid/'))).status).toBe(403);
    });

    it('hands a request of the page to the egress, and answers a blocked one with a reason and no content', async () => {
        const { sandbox, handlers } = sandboxWith(pageAnswers);
        await sandbox.load(SCRIPT);
        const post = (body: unknown) => handlers.get('https')!(new Request('https://lx-sandbox.invalid/__lx/request', { method: 'POST', body: JSON.stringify(body) }));
        for (const url of ['http://127.0.0.1:8080/', 'http://[::ffff:10.0.0.1]/', 'http://169.254.169.254/', 'file:///etc/passwd', 'http://localhost/']) {
            const answer = await (await post({ url, method: 'GET', headers: {}, body: null, timeoutMs: 1000 })).json();
            expect(answer.ok, url).toBe(false);
            // A reason and nothing else: not the host, not the address a name resolved to.
            expect(answer.error, url).toMatch(/^egress blocked [(][a-z-]+[)]$/);
            expect(answer.body).toBeUndefined();
        }
        expect((await post({ url: 42 })).status).toBe(400);
        expect((await handlers.get('https')!(new Request('https://lx-sandbox.invalid/__lx/request', { method: 'POST', body: 'not json' }))).status).toBe(400);
        expect((await answerLxRequest(createEgress(), { url: 'http://example.com/', body: Buffer.alloc(3 * 1024 * 1024).toString('base64') })).status).toBe(413);
        // A POST larger than the envelope is not read into the main process: refused by its declared length, or while it streams in.
        const huge = 'x'.repeat(5 * 1024 * 1024);
        expect((await handlers.get('https')!(new Request('https://lx-sandbox.invalid/__lx/request', { method: 'POST', body: huge, headers: { 'content-length': String(huge.length) } }))).status).toBe(413);
        const streamed = new Request('https://lx-sandbox.invalid/__lx/request', {
            method: 'POST', duplex: 'half',
            body: new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); } }),
        } as RequestInit);
        expect((await handlers.get('https')!(streamed)).status).toBe(413);
    });

    it('runs one script a window: another script, or a destroy, replaces the window', async () => {
        const { sandbox, windows } = sandboxWith(pageAnswers);
        expect(await sandbox.call(SCRIPT, PAYLOAD)).toBe('http://example.com/a.mp3');
        expect(await sandbox.call(SCRIPT, PAYLOAD)).toBe('http://example.com/a.mp3');
        expect(windows).toHaveLength(1);
        expect(windows[0].evaluated.at(-1)).toBe(`globalThis.__lxHost.call(${JSON.stringify(PAYLOAD)}, 20000)`);
        await sandbox.call({ ...SCRIPT, id: 's2' }, PAYLOAD);
        expect(windows).toHaveLength(2);
        expect(windows[0].destroyed).toBe(true);
        sandbox.destroy();
        await Promise.resolve();
        expect(windows[1].destroyed).toBe(true);
        await sandbox.call({ ...SCRIPT, id: 's2' }, PAYLOAD);
        expect(windows).toHaveLength(3);
    });

    it('destroys the window of a script that failed to load, and opens none while the main window is gone', async () => {
        const failing = sandboxWith((code) => { if (code.includes('__lxHost.load(')) throw new Error('the script did not send "inited"'); return undefined; });
        await expect(failing.sandbox.load(SCRIPT)).rejects.toThrow(/inited/);
        expect(failing.windows[0].destroyed).toBe(true);
        const closed = sandboxWith(pageAnswers, () => false);
        await expect(closed.sandbox.load(SCRIPT)).rejects.toThrow(/closed/);
        await expect(closed.sandbox.call(SCRIPT, PAYLOAD)).rejects.toThrow(/closed/);
        expect(closed.windows).toHaveLength(0);
    });

    it('replaces the window of a page that stops answering, and keeps it when the script only reports a failure', async () => {
        vi.useFakeTimers();
        try {
            let hang = false;
            const { sandbox, windows } = sandboxWith(code => (hang && code.includes('__lxHost.call(') ? new Promise(() => undefined) : pageAnswers(code)));
            await sandbox.call(SCRIPT, PAYLOAD);
            hang = true;
            const pending = sandbox.call(SCRIPT, PAYLOAD).catch((error: Error) => error.message);
            await vi.advanceTimersByTimeAsync(26_000);
            expect(await pending).toBe('the script sandbox did not answer');
            expect(windows[0].destroyed).toBe(true);
        } finally {
            vi.useRealTimers();
        }
        const refusing = sandboxWith((code) => { if (code.includes('__lxHost.call(')) throw new Error('no url for this song'); return pageAnswers(code); });
        await expect(refusing.sandbox.call(SCRIPT, PAYLOAD)).rejects.toThrow('no url for this song');
        expect(refusing.windows[0].destroyed).toBe(false);
    });
});

const fakeApi = () => {
    const rpc = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const media = new Map<string, (read: unknown) => unknown>();
    const storage = new Map<string, unknown>();
    const fetched: string[] = [];
    const { session, calls } = fakeSession();
    const { windows, hidden } = fakeWindows(() => undefined);
    const picked = { file: null as string | null };
    const api = {
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
        storage: {
            get: async (key: string) => storage.get(key),
            set: async (key: string, value: unknown) => { storage.set(key, value); },
            delete: async (key: string) => { storage.delete(key); },
        },
        net: {
            session: (name: string) => { calls.push(`session:${name}`); return session; },
            fetch: async (url: string) => { fetched.push(url); return new Response('{}'); },
        },
        windows: { hidden, mainWindowPresent: () => true, onMainWindowChanged: () => () => undefined },
        dialog: { pickFile: async () => picked.file },
        media: {
            serve: (name: string, handler: (read: unknown) => unknown) => { media.set(name, handler); return () => undefined; },
            url: (name: string, rest = '') => `folia-mod://lxmusic/_media/${name}/${rest}`,
        },
        rpc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => { rpc.set(name, handler); } },
        onBeforeUnload: () => () => undefined,
    };
    activate(api as unknown as FoliumSourceMainApi);
    return { rpc, media, storage, fetched, calls, windows, picked };
};

describe('the main entry with no script imported', () => {
    it('opens no window, asks no platform and starts no request when it starts', () => {
        const { calls, windows, fetched, storage } = fakeApi();
        // The sandbox's partition is named, nothing more: it is configured when a window first opens.
        expect(calls).toEqual([`session:${SANDBOX_PARTITION}`]);
        expect(windows).toHaveLength(0);
        expect(fetched).toEqual([]);
        expect(storage.size).toBe(0);
    });

    it('answers its state as empty, and refuses the catalog and audio without a request', async () => {
        const { rpc, fetched, windows } = fakeApi();
        expect(await rpc.get('state')!()).toEqual({ ok: true, data: { scripts: [], activeId: null, platform: null, platforms: [] } });
        // The songs a history or a playlist still holds are not asked about either: tracks, song and lyric too.
        for (const operation of ['searchSongs', 'searchPlaylists', 'searchAlbums', 'charts', 'tracks', 'song']) {
            expect(await rpc.get('catalog')!(operation, { query: 'x', id: 'kw:p:1', limit: 30, offset: 0 }), operation).toMatchObject({ ok: false, code: 'unavailable' });
        }
        expect(await rpc.get('lyric')!({ id: 'kw:1', title: 't', artists: [] })).toEqual({ ok: true, data: null });
        expect(await rpc.get('audio')!({ id: 'kw:1', title: 't', artists: [] }, 'high')).toMatchObject({ ok: false, code: 'unavailable' });
        expect(await rpc.get('audio')!({ id: 'netease:1', title: 't', artists: [] }, 'high')).toMatchObject({ ok: false, code: 'unsupported' });
        expect(fetched).toEqual([]);
        expect(windows).toHaveLength(0);
    });

    it('answers nothing for a stream address it did not issue', async () => {
        const { media } = fakeApi();
        const read = (query: Record<string, string>) => media.get('stream')!({ url: '', path: 'kw/128k/1', query, headers: {}, range: null });
        expect(await read({})).toMatchObject({ status: 410, body: '' });
        expect(await read({ once: 'made-up' })).toMatchObject({ status: 410, body: '' });
        expect(await read({ once: '__proto__' })).toMatchObject({ status: 410, body: '' });
    });

    it('imports nothing when no file is picked', async () => {
        const { rpc, windows, storage } = fakeApi();
        expect(await rpc.get('importScript')!()).toEqual({ ok: true, data: null });
        expect(windows).toHaveLength(0);
        expect(storage.size).toBe(0);
    });
});
