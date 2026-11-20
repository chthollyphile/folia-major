import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyMain.test.ts — the source mod's main entry (sources/spotify/main/index.ts): what main.cjs
// gave the bridge before the move (its partition and proxy, the language, the store and its sealing, the system
// browser, librespot, the audio scheme, the media cache folder and budget, Soloist's folder and file picker, the
// IPC channel, the quit hold, the pause when no window follows Soloist) now comes from api.*. The bridge is stood in
// for, to see what it is handed.

type Handler = (...args: never[]) => unknown;

const bridge = vi.hoisted(() => ({
    options: null as null | Record<string, Handler> & { soloistPaths: { data: () => string; cache: () => string } },
    request: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true, data: 'answer' })),
    serveAudio: vi.fn<(...args: unknown[]) => Promise<Response>>(async () => new Response('bytes', { status: 206 })),
    pauseSoloist: vi.fn(async () => true),
    shutdown: vi.fn(async () => {}),
    dispose: vi.fn(),
    files: {
        list: vi.fn(async () => [{ name: '4cOdK2wGLETKBW3PvgPWqT-320.bin', size: 1200, usedAt: 5 }]),
        remove: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
    },
}));
vi.mock('../../../sources/spotify/main/spotifyApiBridge.cjs', () => ({
    createSpotifyApiBridge: (options: NonNullable<typeof bridge.options>) => {
        bridge.options = options;
        return {
            request: bridge.request, serveAudio: bridge.serveAudio, pauseSoloist: bridge.pauseSoloist,
            shutdown: bridge.shutdown, dispose: bridge.dispose, audioFiles: bridge.files,
        };
    },
}));

const { default: activate } = await import('../../../sources/spotify/main/index');

type AnyHandler = (...args: unknown[]) => unknown;

const launch = () => {
    const session = {
        fetch: vi.fn<(url: string, init?: Record<string, unknown>) => Promise<Response>>(async () => new Response('ok')),
        setProxy: vi.fn<(config: Record<string, unknown>) => Promise<void>>(async () => {}),
    };
    const media = new Map<string, AnyHandler>();
    const rpc = new Map<string, AnyHandler>();
    const beforeQuit: AnyHandler[] = [];
    const beforeUnload: AnyHandler[] = [];
    const orphaned: AnyHandler[] = [];
    const provided: Array<{ list: AnyHandler; remove: AnyHandler; clear: AnyHandler }> = [];
    const state = { locale: 'zh-CN' };
    const librespot = { createSession: vi.fn() };
    const api = {
        legacy: { store: { get: vi.fn(), set: vi.fn(), has: vi.fn(), delete: vi.fn() } },
        seal: { available: () => true, seal: (text: string) => Buffer.from(`sealed:${text}`).toString('base64'), open: (sealed: string) => Buffer.from(sealed, 'base64').toString().slice(7) },
        net: { session: vi.fn(() => session) },
        host: { get locale() { return state.locale; } },
        shell: { openExternal: vi.fn(async () => {}) },
        native: { load: vi.fn(() => librespot) },
        paths: { legacy: vi.fn((name: string) => `C:/userData/${name}`) },
        dialog: { pickFile: vi.fn(async () => 'C:/Downloads/soloist/soloist.exe') },
        cache: {
            legacyDir: vi.fn((name: string) => `D:/media-cache/${name}`),
            requestPrune: vi.fn(),
            provideEntries: vi.fn((provider: (typeof provided)[number]) => { provided.push(provider); return () => {}; }),
        },
        media: {
            url: (name: string, rest = '') => `folia-mod://spotify/_media/${name}/${rest}`,
            serve: (name: string, handler: AnyHandler) => { media.set(name, handler); return () => {}; },
        },
        rpc: { handle: (name: string, handler: AnyHandler) => { rpc.set(name, handler); } },
        onPlayersOrphaned: (handler: AnyHandler) => { orphaned.push(handler); return () => {}; },
        onBeforeQuit: (handler: AnyHandler) => {
            beforeQuit.push(handler);
            return () => { const at = beforeQuit.indexOf(handler); if (at >= 0) beforeQuit.splice(at, 1); };
        },
        onBeforeUnload: (handler: AnyHandler) => { beforeUnload.push(handler); return () => {}; },
    };
    activate(api as never);
    const options = bridge.options!;
    return { api, session, media, rpc, beforeQuit, beforeUnload, orphaned, provided, state, librespot, options };
};

beforeEach(() => {
    bridge.options = null;
    bridge.request.mockClear();
    bridge.serveAudio.mockClear();
    bridge.pauseSoloist.mockClear();
    bridge.shutdown.mockClear();
    bridge.dispose.mockClear();
});

describe('Spotify main entry (source mod)', () => {
    it('asks Spotify from the claimed partition, through the system proxy, without cookies, in the app\'s language', async () => {
        const { api, session, options, state } = launch();
        expect(api.net.session).toHaveBeenCalledWith('folia-spotify');
        expect(session.setProxy).not.toHaveBeenCalled();
        await (options.fetch as (input: string, init?: Record<string, unknown>) => Promise<Response>)('https://api-partner.spotify.com/x', { method: 'POST' });
        await (options.fetch as (input: URL) => Promise<Response>)(new URL('https://spclient.wg.spotify.com/y'));
        expect(session.setProxy).toHaveBeenCalledTimes(1);
        expect(session.setProxy).toHaveBeenCalledWith({ mode: 'system' });
        expect(session.fetch.mock.calls).toEqual([
            ['https://api-partner.spotify.com/x', { method: 'POST', credentials: 'omit' }],
            ['https://spclient.wg.spotify.com/y', { credentials: 'omit' }],
        ]);
        expect((options.language as () => string)()).toBe('zh-CN');
        state.locale = 'en';
        expect((options.language as () => string)()).toBe('en');
    });

    it('opens the sign-in page in the system browser, seals the session with api.seal, and keeps the claimed store', async () => {
        const { api, options } = launch();
        await (options.openExternal as (url: string) => Promise<void>)('https://accounts.spotify.com/authorize?x=1');
        expect(api.shell.openExternal).toHaveBeenCalledWith('https://accounts.spotify.com/authorize?x=1');
        expect(options.store).toBe(api.legacy.store);
        const safe = options.safeStorage as unknown as { isEncryptionAvailable(): boolean; encryptString(text: string): Buffer; decryptString(data: Buffer): string };
        expect(safe.isEncryptionAvailable()).toBe(true);
        expect(safe.decryptString(safe.encryptString('token-private'))).toBe('token-private');
    });

    it('has the host load librespot, and hands out _media addresses with a one-time key', () => {
        const { api, options, librespot } = launch();
        expect(api.native.load).not.toHaveBeenCalled();
        expect((options.loadLibrespot as () => unknown)()).toBe(librespot);
        expect(api.native.load).toHaveBeenCalledWith('librespot');
        expect((options.audioUrl as (id: string, key: string) => string)('4cOdK2wGLETKBW3PvgPWqT', 'a b')).toBe('folia-mod://spotify/_media/audio/4cOdK2wGLETKBW3PvgPWqT?once=a%20b');
    });

    it('answers the _media route for a track id only, with the read taken apart', async () => {
        const { media } = launch();
        const serve = media.get('audio')!;
        const answer = await serve({ path: '4cOdK2wGLETKBW3PvgPWqT', query: { once: 'k1' }, range: 'bytes=0-9' }) as Response;
        expect(answer.status).toBe(206);
        expect(bridge.serveAudio).toHaveBeenCalledWith({ trackId: '4cOdK2wGLETKBW3PvgPWqT', key: 'k1', range: 'bytes=0-9' });
        expect((await serve({ path: '4cOdK2wGLETKBW3PvgPWqT', query: {}, range: null }) as Response).status).toBe(206);
        expect(bridge.serveAudio).toHaveBeenLastCalledWith({ trackId: '4cOdK2wGLETKBW3PvgPWqT', key: '', range: null });
        expect((await serve({ path: '../../etc', query: { once: 'k1' }, range: null }) as Response).type).toBe('error');
        expect(bridge.serveAudio).toHaveBeenCalledTimes(2);
    });

    it('keeps the encrypted files in the claimed media cache folder, inside the host\'s budget', async () => {
        const { api, options, provided } = launch();
        expect((options.audioDirectory as () => string)()).toBe('D:/media-cache/spotify');
        expect(api.cache.legacyDir).toHaveBeenCalledWith('spotify');
        expect(provided).toHaveLength(1);
        expect(await provided[0].list()).toEqual([{ id: '4cOdK2wGLETKBW3PvgPWqT-320.bin', size: 1200, usedAt: 5 }]);
        await provided[0].remove('4cOdK2wGLETKBW3PvgPWqT-320.bin');
        expect(bridge.files.remove).toHaveBeenCalledWith('4cOdK2wGLETKBW3PvgPWqT-320.bin');
        await provided[0].clear();
        expect(bridge.files.clear).toHaveBeenCalled();
        // A file kept: the host trims the media cache to its own limit.
        (options.onAudioKept as (limit?: number) => void)(4096);
        expect(api.cache.requestPrune).toHaveBeenCalledWith();
    });

    it('gives Soloist the claimed userData folder, and picks its program from the downloads folder', async () => {
        const { api, options } = launch();
        expect(options.soloistPaths.data()).toBe(path.join('C:/userData/soloist', 'data'));
        expect(options.soloistPaths.cache()).toBe(path.join('C:/userData/soloist', 'cache'));
        expect(api.paths.legacy).toHaveBeenCalledWith('soloist');
        expect(await (options.chooseSoloistFile as () => Promise<string | null>)()).toBe('C:/Downloads/soloist/soloist.exe');
        expect(api.dialog.pickFile).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: expect.stringMatching(/Downloads$/) }));
    });

    it('lets the main window\'s requests through to the bridge', async () => {
        const { rpc } = launch();
        expect(await rpc.get('request')!('login_status', { a: 1 })).toEqual({ ok: true, data: 'answer' });
        expect(bridge.request).toHaveBeenLastCalledWith('login_status', { a: 1 });
        await rpc.get('request')!('logout', null);
        expect(bridge.request).toHaveBeenLastCalledWith('logout', {});
    });

    it('pauses Soloist when no window takes the playback over', async () => {
        const { orphaned } = launch();
        orphaned[0]();
        expect(bridge.pauseSoloist).toHaveBeenCalledTimes(1);
    });

    it('holds a quit only while Soloist is about or a token renewal is not stored yet', async () => {
        const { beforeQuit, options } = launch();
        expect(beforeQuit).toHaveLength(0);
        (options.onSoloistActive as (active: boolean) => void)(true);
        expect(beforeQuit).toHaveLength(1);
        await beforeQuit[0]();
        expect(bridge.shutdown).toHaveBeenCalledTimes(1);
        (options.onSoloistActive as (active: boolean) => void)(false);
        expect(beforeQuit).toHaveLength(0);

        let stored!: () => void;
        const renewal = new Promise<void>((resolve) => { stored = resolve; });
        (options.onRenewing as (done: Promise<void>) => void)(renewal);
        expect(beforeQuit).toHaveLength(1);
        stored();
        await vi.waitFor(() => expect(beforeQuit).toHaveLength(0));
    });

    it('stops Soloist, closes the sign-in port and librespot, and leaves no process listener when turned off', async () => {
        const before = process.listeners('exit');
        const { beforeUnload, options } = launch();
        const added = process.listeners('exit').filter(listener => !before.includes(listener));
        expect(added).toHaveLength(1);
        const stop = vi.fn();
        (options.onProcessExit as (stop: () => void) => void)(stop);
        // Only this entry's listener is called: the process does not end here.
        (added[0] as () => void)();
        expect(stop).toHaveBeenCalledTimes(1);
        await beforeUnload[0]();
        expect(bridge.shutdown).toHaveBeenCalledTimes(1);
        expect(bridge.dispose).toHaveBeenCalledTimes(1);
        expect(process.listeners('exit')).toEqual(before);
    });
});
