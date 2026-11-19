import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmMain.test.ts — the source mod's main entry (sources/ytm/main/index.ts): what main.cjs gave the
// bridge before the move (its partition and proxy, the sandbox window, the language, the sign-in folder, the audio
// scheme, the IPC channel, the quit hold) now comes from api.*. The bridge is stood in for, to see what it is handed;
// the sandbox is the real one, on a stand-in partition and window.

const bridge = vi.hoisted(() => ({
    options: null as null | Record<string, (...args: never[]) => unknown>,
    request: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true, data: 'answer' })),
    serveAudio: vi.fn<(...args: unknown[]) => Promise<Response>>(async () => new Response('bytes', { status: 206 })),
    shutdown: vi.fn((): Promise<unknown> | null => null),
}));
vi.mock('../../../sources/ytm/main/ytmApiBridge.cjs', () => ({
    createYtmApiBridge: (options: Record<string, (...args: never[]) => unknown>) => {
        bridge.options = options;
        return { request: bridge.request, serveAudio: bridge.serveAudio, shutdown: bridge.shutdown };
    },
}));

const { default: activate } = await import('../../../sources/ytm/main/index');

type Handler = (...args: unknown[]) => unknown;

const fakeWindow = () => ({
    destroyed: false,
    loadURL: vi.fn<(url: string) => Promise<void>>(async () => {}),
    destroy: vi.fn(function (this: { destroyed: boolean }) { this.destroyed = true; }),
    isDestroyed(this: { destroyed: boolean }) { return this.destroyed; },
    webContents: {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        setWebRTCIPHandlingPolicy: vi.fn(),
        executeJavaScript: vi.fn<(code: string) => Promise<string>>(async () => 'ran'),
    },
});

const launch = () => {
    const sessions = new Map<string, ReturnType<typeof fakeSession>>();
    const fakeSession = (name: string) => ({
        partition: name,
        fetch: vi.fn<(url: string, init?: Record<string, unknown>) => Promise<Response>>(async () => new Response('ok')),
        setProxy: vi.fn<(config: Record<string, unknown>) => Promise<void>>(async () => {}),
        intercept: vi.fn<(scheme: string, handler: (request: Request) => Response) => () => void>(() => () => {}),
        refusePermissions: vi.fn(() => () => {}),
    });
    const windows: Array<ReturnType<typeof fakeWindow>> = [];
    const mainWindowListeners: Array<(present: boolean) => void> = [];
    const media = new Map<string, Handler>();
    const rpc = new Map<string, Handler>();
    const beforeQuit: Handler[] = [];
    const beforeUnload: Handler[] = [];
    const state = { present: true, locale: 'zh-CN' };
    const api = {
        legacy: { store: { get: vi.fn(), set: vi.fn(), has: vi.fn(), delete: vi.fn() } },
        seal: { available: () => true, seal: (text: string) => Buffer.from(`sealed:${text}`).toString('base64'), open: (sealed: string) => Buffer.from(sealed, 'base64').toString().slice(7) },
        net: {
            session: vi.fn((name: string) => {
                if (!sessions.has(name)) sessions.set(name, fakeSession(name));
                return sessions.get(name)!;
            }),
        },
        windows: {
            hidden: vi.fn<(options: Record<string, unknown>) => ReturnType<typeof fakeWindow>>(() => { const window = fakeWindow(); windows.push(window); return window; }),
            mainWindowPresent: () => state.present,
            onMainWindowChanged: (listener: (present: boolean) => void) => { mainWindowListeners.push(listener); return () => {}; },
        },
        host: { get locale() { return state.locale; } },
        paths: { legacy: vi.fn((name: string) => `C:/userData/${name}`) },
        media: {
            url: (name: string, rest = '') => `folia-mod://ytm/_media/${name}/${rest}`,
            serve: (name: string, handler: Handler) => { media.set(name, handler); return () => {}; },
        },
        rpc: { handle: (name: string, handler: Handler) => { rpc.set(name, handler); } },
        onBeforeQuit: (handler: Handler) => {
            beforeQuit.push(handler);
            return () => { const at = beforeQuit.indexOf(handler); if (at >= 0) beforeQuit.splice(at, 1); };
        },
        onBeforeUnload: (handler: Handler) => { beforeUnload.push(handler); return () => {}; },
    };
    activate(api as never);
    const options = bridge.options!;
    return { api, sessions, windows, mainWindowListeners, media, rpc, beforeQuit, beforeUnload, state, options };
};

beforeEach(() => {
    bridge.options = null;
    bridge.request.mockClear();
    bridge.serveAudio.mockClear();
    bridge.shutdown.mockReset().mockReturnValue(null);
});

describe('YouTube Music main entry (source mod)', () => {
    it('runs player code in a hidden, unthrottled window of the claimed sandbox partition, which never reaches the network', async () => {
        const { options, sessions, windows, api } = launch();
        expect(await options.evaluate('1 + 1' as never)).toBe('ran');
        expect(api.windows.hidden).toHaveBeenCalledWith({ session: 'folia-ytm-sandbox', backgroundThrottling: false });
        const sandbox = sessions.get('folia-ytm-sandbox')!;
        expect(sandbox.intercept.mock.calls.map(([scheme]) => scheme).sort()).toEqual(['http', 'https']);
        expect(sandbox.refusePermissions).toHaveBeenCalledTimes(1);
        expect(sandbox.setProxy).toHaveBeenCalledWith({ proxyRules: 'socks5://127.0.0.1:1', proxyBypassRules: '<-loopback>' });
        // Requests of the page are answered here: the blank page at YouTube's origin, nothing anywhere else.
        const serve = sandbox.intercept.mock.calls[0][1];
        const blank = serve(new Request('https://www.youtube.com/'));
        expect(blank.headers.get('content-type')).toBe('text/html');
        expect(serve(new Request('https://www.youtube.com/s/player/base.js')).status).toBe(403);
        expect(windows[0].loadURL).toHaveBeenCalledWith('https://www.youtube.com/');
        // One window for every call while it stands.
        await options.evaluate('2' as never);
        expect(windows).toHaveLength(1);
    });

    it('closes the sandbox window with the main window, and opens none while the main window is gone', async () => {
        const { options, windows, mainWindowListeners, state } = launch();
        await options.evaluate('1' as never);
        state.present = false;
        for (const listener of mainWindowListeners) listener(false);
        await vi.waitFor(() => expect(windows[0].destroy).toHaveBeenCalled());
        await expect(options.evaluate('1' as never)).rejects.toThrow('YouTube Music sandbox is closed');
        expect(windows).toHaveLength(1);
    });

    it('asks Google from the claimed folia-ytm partition on the system proxy, without cookies', async () => {
        const { options, sessions } = launch();
        await options.fetch(new URL('https://music.youtube.com/youtubei/v1/search') as never, { method: 'POST' } as never);
        await options.fetch('https://www.youtube.com/sw.js' as never, undefined as never);
        const network = sessions.get('folia-ytm')!;
        expect(network.setProxy).toHaveBeenCalledTimes(1);
        expect(network.setProxy).toHaveBeenCalledWith({ mode: 'system' });
        expect(network.fetch.mock.calls).toEqual([
            ['https://music.youtube.com/youtubei/v1/search', { method: 'POST', credentials: 'omit' }],
            ['https://www.youtube.com/sw.js', { credentials: 'omit' }],
        ]);
        // youtubei.js hands a Request: its address, method, headers and body go over as an address and an init.
        network.fetch.mockClear();
        await options.fetch(new Request('https://music.youtube.com/youtubei/v1/browse', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"q":1}',
        }) as never, undefined as never);
        await options.fetch(new Request('https://www.youtube.com/') as never, undefined as never);
        const [[url, init], [plainUrl, plainInit]] = network.fetch.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
        expect(url).toBe('https://music.youtube.com/youtubei/v1/browse');
        expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit' });
        expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"q":1}');
        expect(plainUrl).toBe('https://www.youtube.com/');
        expect(plainInit).toEqual({ method: 'GET', headers: {}, credentials: 'omit' });
    });

    it('asks pages in the host’s language as it is at the call, and runs the sign-in browser on the claimed folder', () => {
        const { options, state, api } = launch();
        expect(options.language()).toBe('zh-CN');
        state.locale = 'en';
        expect(options.language()).toBe('en');
        expect(options.signInFolder()).toBe('C:/userData/ytm-sign-in');
        expect(api.paths.legacy).toHaveBeenCalledWith('ytm-sign-in');
    });

    it('serves a track under _media/audio, its one-run key in `once`', async () => {
        const { options, media } = launch();
        expect(options.audioUrl('m9SMT5ipbxk' as never, 'high' as never, 'abc123' as never)).toBe('folia-mod://ytm/_media/audio/m9SMT5ipbxk/high?once=abc123');
        const serve = media.get('audio')!;
        const answer = await serve({ url: '', path: 'm9SMT5ipbxk/high', query: { once: 'abc123' }, headers: {}, range: 'bytes=0-9' }) as Response;
        expect(answer.status).toBe(206);
        expect(bridge.serveAudio).toHaveBeenCalledWith({ videoId: 'm9SMT5ipbxk', level: 'high', key: 'abc123', range: 'bytes=0-9' });
        // An address of no track is a network error, as the old scheme answered it.
        expect((await serve({ url: '', path: 'm9SMT5ipbxk', query: {}, headers: {}, range: null }) as Response).type).toBe('error');
        expect(bridge.serveAudio).toHaveBeenCalledTimes(1);
    });

    it('takes the window’s operations on rpc `request`, and holds a quit or an unload for a sign-in under way', async () => {
        const { rpc, beforeQuit, beforeUnload, options, windows } = launch();
        // No sign-in under way: a quit is not held at all (no handler), as main.cjs did not hold it.
        expect(beforeQuit).toHaveLength(0);
        let signInDone!: () => void;
        options.onSignInWork(new Promise<void>(resolve => { signInDone = resolve; }) as never);
        expect(beforeQuit).toHaveLength(1);
        expect(await rpc.get('request')!('search_songs', { query: 'x' })).toEqual({ ok: true, data: 'answer' });
        expect(bridge.request).toHaveBeenCalledWith('search_songs', { query: 'x' });
        await rpc.get('request')!('login_status', null);
        expect(bridge.request).toHaveBeenLastCalledWith('login_status', {});

        let settle!: () => void;
        bridge.shutdown.mockReturnValue(new Promise<void>(resolve => { settle = resolve; }));
        let quitDone = false;
        const quitting = Promise.resolve(beforeQuit[0]()).then(() => { quitDone = true; });
        await Promise.resolve();
        expect(quitDone).toBe(false);
        settle();
        await quitting;
        expect(quitDone).toBe(true);
        // Once the sign-in's browser has ended and its folder is gone, quits are not held again.
        signInDone();
        await vi.waitFor(() => expect(beforeQuit).toHaveLength(0));

        // Turned off: the sandbox window goes too.
        await options.evaluate('1' as never);
        bridge.shutdown.mockReturnValue(null);
        await beforeUnload[0]();
        await vi.waitFor(() => expect(windows[0].destroy).toHaveBeenCalled());
    });
});
