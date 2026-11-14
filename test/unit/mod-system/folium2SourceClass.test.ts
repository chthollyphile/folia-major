import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import {
    IPC, cleanHarness, clearModRecords, confirmMod, electronCalls, hostStore, invoke, launch, modRecord, resetHarness,
    harness, persisted, sourceManifest, stateOf, writeMod,
} from './loaderHarness';

// test/unit/mod-system/folium2SourceClass.test.ts
// Source mods are a class of their own (dev/folium/folium-2-plan.md §5.2), with their own limits and the api
// members of §5.5. Gate 3 of S2: an ordinary mod keeps every limit it had — 5 MB answers, the 1 MB data
// file, 8 KB secrets, the permission gates, the 1.5 s of the first screen — and none of the source members;
// only a `folium: 2` mod that declares sources gets the exemptions, and an empty declaration buys nothing.

const require = createRequire(import.meta.url);
const { validateManifest, isSourceManifest } = require('../../../electron/modSystem/manifest.cjs');
const { createLoginDiagnosticsRegistry } = require('../../../electron/loginBackendIpc.cjs');
const { ownPartitionOf } = require('../../../electron/modSystem/sourceApi.cjs');
const shared = require('../../../electron/modSystem/foliumShared.json');

beforeEach(() => {
    resetHarness();
    clearModRecords();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    cleanHarness();
    clearModRecords();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/* An enabled ordinary mod (folium 1) and an enabled third-party source mod (folium 2), both with a main entry. */
const writeBoth = (permissions: string[] = []) => {
    const plain = writeMod('user', { id: 'plain', permissions }, { main: true });
    confirmMod(plain, 'plain');
    const source = writeMod('user', sourceManifest('radio', ['station'], { secrets: ['token'] }), { main: true });
    confirmMod(source, 'radio');
};

type Api = Record<string, any>;
const apiOf = (modId: string) => modRecord(modId)!.api as Api;

describe('which mods are source mods', () => {
    it('is only a folium 2 manifest with at least one source', () => {
        const base = { id: 'x', name: 'x', version: '1.0.0', client: 'client.mjs' };
        expect(isSourceManifest(validateManifest({ ...base, folium: 2, sources: [{ id: 'a', name: 'A' }] }).value)).toBe(true);
        expect(isSourceManifest(validateManifest({ ...base, folium: 2 }).value)).toBe(false);
        expect(validateManifest({ ...base, folium: 2, sources: [] }).ok).toBe(false);
        expect(validateManifest({ ...base, folium: 1, sources: [{ id: 'a', name: 'A' }] }).errors).toEqual(['"sources" needs "folium": 2']);
    });
});

describe('gate 3: an ordinary mod keeps its limits', () => {
    it('needs net.fetch, gets Node fetch with the 5 MB cap and the 60 s ceiling; a source mod needs nothing and goes through Electron net', async () => {
        writeBoth();
        launch();
        expect(await invoke(IPC.netFetch, 'plain', 'https://example.com/a', {})).toEqual({ ok: false, error: 'permission-denied:net.fetch' });
        const answer = await invoke(IPC.netFetch, 'radio', 'https://example.com/a', { responseType: 'base64', timeoutMs: 600000 }) as { ok: boolean; result: { bodyBase64: string } };
        expect(answer).toMatchObject({ ok: true, result: { status: 200 } });
        expect(Buffer.from(answer.result.bodyBase64, 'base64')).toEqual(Buffer.from([0, 1, 2, 255]));
        expect(electronCalls.filter(([name]) => name === 'net.fetch')).toHaveLength(1);
        // In a partition of its own.
        const inPartition = await invoke(IPC.netFetch, 'radio', 'https://example.com/b', { session: 'cache' }) as { result: { body: string } };
        expect(inPartition.result.body).toBe('from persist:folium.radio.cache');
        expect(await invoke(IPC.netFetch, 'radio', 'https://example.com/b', { session: 'Bad Name' })).toEqual({ ok: false, error: 'net-invalid-session' });
    });

    it('still cuts an ordinary mod\'s answer at 5 MB', async () => {
        writeBoth(['net.fetch']);
        launch();
        const big = new Uint8Array(shared.limits.standard.netFetch.maxBodyBytes + 1);
        vi.stubGlobal('fetch', async () => new Response(big));
        expect(await invoke(IPC.netFetch, 'plain', 'https://example.com/a', {})).toEqual({ ok: false, error: 'net-body-too-large' });
    });

    it('keeps the 1 MB data file and the filesystem.data gate; a source mod has 16 MB without the permission', async () => {
        writeBoth();
        launch();
        const mb = 'x'.repeat(1024 * 1024);
        await expect(apiOf('plain').storage.set('k', 'v')).rejects.toThrow('permission-denied:filesystem.data');
        expect(await invoke(IPC.storage, 'plain', 'get', 'k')).toEqual({ ok: false, error: 'permission-denied:filesystem.data' });
        await apiOf('radio').storage.set('big', mb + mb);
        expect(await invoke(IPC.storage, 'radio', 'get', 'big')).toEqual({ ok: true, result: mb + mb });
        await expect(apiOf('radio').storage.set('huge', 'x'.repeat(shared.limits.source.storage.maxBytes))).rejects.toThrow('storage-quota-exceeded');
        expect(() => apiOf('radio').storage.paths.data).not.toThrow();
        expect(() => apiOf('plain').storage.paths.data).toThrow('permission-denied:filesystem.data');
    });

    it('keeps the 1 MB cap for an ordinary mod that declares filesystem.data', async () => {
        writeBoth(['filesystem.data']);
        launch();
        await expect(apiOf('plain').storage.set('big', 'x'.repeat(1024 * 1024))).rejects.toThrow('storage-quota-exceeded:1048576');
    });

    it('keeps secrets at 8 KB and undeclared until a settings section declares them; a source mod\'s manifest slots hold 64 KB at once', async () => {
        writeBoth();
        launch();
        const nineKb = 'k'.repeat(9 * 1024);
        await expect(apiOf('plain').secrets.set('token', 'x')).rejects.toThrow('secret-undeclared:token');
        await invoke(IPC.secrets, 'plain', 'declare', ['token']);
        expect(await invoke(IPC.secrets, 'plain', 'set', 'token', nineKb)).toEqual({ ok: false, error: 'secret-too-large:8192' });
        await apiOf('radio').secrets.set('token', nineKb);
        expect(await apiOf('radio').secrets.get('token')).toBe(nineKb);
        await expect(apiOf('radio').secrets.set('token', 'k'.repeat(65 * 1024))).rejects.toThrow('secret-too-large:65536');
        await expect(apiOf('radio').secrets.set('other', 'x')).rejects.toThrow('secret-undeclared:other');
    });

    it('keeps the other permission gates of a source mod (playback.read, render.export)', () => {
        writeBoth();
        launch();
        expect(() => apiOf('radio').runtime.getPlaybackSnapshot()).toThrow('permission-denied:playback.read');
    });

    it('gives an ordinary mod none of the source members', () => {
        writeBoth();
        launch();
        const plain = apiOf('plain');
        for (const member of ['legacy', 'seal', 'cache', 'net', 'media', 'windows', 'shell', 'dialog', 'onBeforeUnload', 'onBeforeQuit', 'onPlayersOrphaned', 'diagnostics', 'native', 'reportError']) {
            expect(plain[member], member).toBeUndefined();
            expect(apiOf('radio')[member], member).toBeDefined();
        }
        expect(plain.paths.legacy).toBeUndefined();
        expect('locale' in plain.host).toBe(false);
    });

    it('keeps the first screen\'s 1.5 s for ordinary mods and gives the source group its own 3 s', () => {
        expect(shared.limits.standard.start.firstScreenMs).toBe(1500);
        expect(shared.limits.source.start.firstScreenMs).toBe(3000);
        const bootstrap = fs.readFileSync(path.join(__dirname, '../../../src/bootstrap.tsx'), 'utf8');
        expect(/const FIRST_SCREEN_MOD_WAIT_MS = (\d+);/.exec(bootstrap)?.[1]).toBe(String(shared.limits.standard.start.firstScreenMs));
    });
});

describe('the source members of api (plan §5.5)', () => {
    // Mod ids and partition names may both hold a hyphen, so `persist:folium-<mod>-<name>` named one partition two
    // ways (foo + bar-login, foo-bar + login): the same cookies, and one mod's "clear data" cleared the other's.
    it('keeps the partitions of two mods apart however their ids and names split', () => {
        expect(ownPartitionOf('foo', 'bar-login')).not.toBe(ownPartitionOf('foo-bar', 'login'));
        expect(ownPartitionOf('radio', 'login')).toBe('persist:folium.radio.login');
    });

    const launchSource = (extra: Record<string, unknown> = {}) => {
        writeMod('builtin', sourceManifest('spotify', ['spotify'], { native: ['librespot'] }), { main: true });
        const diagnostics = createLoginDiagnosticsRegistry();
        const reported: unknown[] = [];
        const pruned: unknown[] = [];
        const system = launch({
            extra: {
                diagnostics,
                reportError: (where: string, error: unknown) => reported.push([where, error]),
                requestCachePrune: (limit: unknown) => pruned.push(limit),
                nativePath: (name: string) => (name === 'librespot' ? path.join(harness().root, 'native', 'librespot.cjs') : null),
                ...extra,
            },
        });
        return { system, diagnostics, reported, pruned, api: apiOf('spotify') };
    };

    it('legacy.store reaches only the claimed keys; paths.legacy only the claimed folders', () => {
        hostStore.set('SPOTIFY_SESSION_V1', 'sealed');
        const { api } = launchSource();
        expect(api.legacy.store.get('SPOTIFY_SESSION_V1')).toBe('sealed');
        api.legacy.store.set('SPOTIFY_DEVICE_ID', 'device');
        expect(hostStore.get('SPOTIFY_DEVICE_ID')).toBe('device');
        expect(api.legacy.store.has('SPOTIFY_DEVICE_ID')).toBe(true);
        api.legacy.store.delete('SPOTIFY_DEVICE_ID');
        expect(hostStore.has('SPOTIFY_DEVICE_ID')).toBe(false);
        expect(() => api.legacy.store.get('QQ_API_AUTH_SESSION_V1')).toThrow('legacy-key-not-claimed:QQ_API_AUTH_SESSION_V1');
        expect(api.paths.legacy('soloist')).toBe(path.join(harness().userData, 'soloist'));
        expect(() => api.paths.legacy('ytm-sign-in')).toThrow('legacy-folder-not-claimed');
    });

    it('seal seals and opens with safeStorage', () => {
        const { api } = launchSource();
        expect(api.seal.available()).toBe(true);
        const sealed = api.seal.seal('secret');
        expect(sealed).not.toContain('secret');
        expect(api.seal.open(sealed)).toBe('secret');
    });

    it('cache: its folder, a prune of the host\'s budget, and entries the host can list', async () => {
        const { api, pruned, system } = launchSource();
        expect(api.cache.dir()).toBe(path.join(harness().userData, 'mods-cache', 'spotify'));
        expect(fs.statSync(api.cache.dir()).isDirectory()).toBe(true);
        api.cache.requestPrune(1024);
        expect(pruned).toEqual([1024]);
        const off = api.cache.provideEntries({ list: async () => [{ id: 'a', size: 3 }] });
        expect(await system.sourceCaches.list()).toEqual([{ id: 'a', size: 3, modId: 'spotify' }]);
        off();
        expect(await system.sourceCaches.list()).toEqual([]);
    });

    // A source names its partition on every request; the record of it is read from the settings file once a run.
    it('reads the record of its own partitions once, not on every request', () => {
        const { api } = launchSource();
        api.net.session('cache');
        const reads = vi.spyOn(persisted, 'get');
        for (let i = 0; i < 10; i += 1) api.net.session('cache');
        expect(reads.mock.calls.filter(([key]) => key === 'mods.sourcePartitions')).toEqual([]);
        expect(persisted.get('mods.sourcePartitions')).toEqual({ spotify: ['persist:folium.spotify.cache'] });
    });

    it('net: Electron net, a claimed partition or its own, and the proxy', async () => {
        const { api } = launchSource();
        expect(new Uint8Array(await (await api.net.fetch('https://example.com/bin')).arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
        expect(api.net.session('folia-spotify').partition).toBe('folia-spotify');
        expect(api.net.session('cache').partition).toBe('persist:folium.spotify.cache');
        expect(() => api.net.session('Folia Other')).toThrow();
        expect(await (await api.net.fetch('https://example.com/x', { session: 'folia-spotify' })).text()).toBe('from folia-spotify');
        expect(await api.net.resolveProxy('https://example.com')).toBe('DIRECT');
    });

    // Bodian's desktop API signs GETs that carry a JSON body: a web fetch refuses those, Electron's ClientRequest sends them.
    it('net.request: the ClientRequest of Electron, in the default session or a partition the source names, never one it passes itself', () => {
        const { api } = launchSource();
        const request = api.net.request({ url: 'https://example.com/play', method: 'GET', partition: 'persist:other' });
        expect(request).toMatchObject({ kind: 'client-request' });
        expect(api.net.request({ url: 'https://example.com/a', session: 'folia-spotify' })).toMatchObject({ kind: 'client-request' });
        expect(api.net.session('cache').request({ url: 'https://example.com/b' })).toMatchObject({ kind: 'client-request' });
        expect(electronCalls.filter(([name]) => name === 'net.request')).toEqual([
            ['net.request', { url: 'https://example.com/play', method: 'GET' }],
            ['net.request', { url: 'https://example.com/a', partition: 'folia-spotify' }],
            ['net.request', { url: 'https://example.com/b', partition: 'persist:folium.spotify.cache' }],
        ]);
        expect(() => api.net.request({ method: 'GET' })).toThrow('net.request requires');
        expect(() => api.net.request({ url: 'https://example.com', session: 'Bad Name' })).toThrow();
    });

    it('media: rules the host\'s one listener reads, and _media streams with Range', async () => {
        const { api, system } = launchSource();
        const remove = api.media.allow({ hosts: ['*.scdn.co'] });
        expect(system.mediaRules.allows({ url: 'https://audio.scdn.co/a.mp3', resourceType: 'media', method: 'GET' })).toBe(true);
        expect(system.mediaRules.allows({ url: 'https://audio.scdn.co/a.mp3', resourceType: 'media', method: 'POST' })).toBe(false);
        remove();
        expect(system.mediaRules.allows({ url: 'https://audio.scdn.co/a.mp3', resourceType: 'media', method: 'GET' })).toBe(false);
        expect(api.media.url('audio', 'track/1')).toBe('folia-mod://spotify/_media/audio/track/1');
    });

    it('media: the own test of a rule, asked only on its hosts, followed through a redirect for the lifetime of the rule', () => {
        const { api, system } = launchSource();
        const asked: unknown[] = [];
        const read = (url: string, extra: Record<string, unknown> = {}) => ({ url, resourceType: 'media', method: 'GET', ...extra });
        api.media.allow({
            hosts: ['cdn.example.com'],
            ttlMs: 60_000,
            followRedirects: true,
            test: (request: { url: string; responseHeaders: Record<string, string[]> }) => {
                asked.push(request);
                if (request.url.includes('throws')) throw new Error('broken test');
                return request.url.endsWith('.mp3') || /^audio\//.test(String(request.responseHeaders['content-type'] ?? ''));
            },
        });
        expect(system.mediaRules.allows(read('https://cdn.example.com/a.mp3'))).toBe(true);
        expect(system.mediaRules.allows(read('https://cdn.example.com/b', { responseHeaders: { 'content-type': ['audio/flac'] } }))).toBe(true);
        expect(system.mediaRules.allows(read('https://cdn.example.com/page.html'))).toBe(false);
        expect(system.mediaRules.allows(read('https://cdn.example.com/throws.mp3'))).toBe(false);
        expect(system.mediaRules.allows(read('https://cdn.example.com/a.mp3', { method: 'POST' }))).toBe(false);
        expect(asked[0]).toEqual({ url: 'https://cdn.example.com/a.mp3', method: 'GET', resourceType: 'media', responseHeaders: {} });
        expect(Object.isFrozen(asked[0])).toBe(true);
        // Never asked off its hosts: a source sees no other source's addresses or answers.
        const before = asked.length;
        expect(system.mediaRules.allows(read('https://audio.other-source.example/a.mp3?token=secret'))).toBe(false);
        expect(asked.length).toBe(before);
        // The headers it gets are a frozen copy: changing them changes nothing the browser gets.
        const headers = { 'content-type': ['audio/flac'] };
        api.media.allow({ hosts: ['tamper.example.com'], test: (request: { responseHeaders: Record<string, string[]> }) => {
            expect(Object.isFrozen(request.responseHeaders['content-type'])).toBe(true);
            expect(() => request.responseHeaders['content-type'].push('text/html')).toThrow();
            return true;
        } });
        expect(system.mediaRules.allows(read('https://tamper.example.com/a', { responseHeaders: headers }))).toBe(true);
        expect(headers['content-type']).toEqual(['audio/flac']);
        // The CDN hop of an answer the test let through becomes the rule's.
        system.mediaRules.followRedirect({ ...read('https://cdn.example.com/a.mp3'), redirectURL: 'https://edge.example.net/x?sig=1' });
        expect(system.mediaRules.allows(read('https://edge.example.net/x?sig=1'))).toBe(true);
        system.mediaRules.followRedirect({ ...read('https://cdn.example.com/page.html'), redirectURL: 'https://edge.example.net/other' });
        expect(system.mediaRules.allows(read('https://edge.example.net/other'))).toBe(false);
        expect(() => api.media.allow({ hosts: ['cdn.example.com'], test: 'yes' })).toThrow('test must be a function');
        expect(() => api.media.allow({ test: () => true })).toThrow('a test needs the hosts');
    });

    it('windows: a hidden sandboxed window destroyed with the mod, and whether the main window is there', async () => {
        const { api, system } = launchSource();
        const window = api.windows.hidden({ session: 'folia-spotify', width: 10, webPreferences: { preload: '/evil.js' } });
        expect(window.options).toEqual({ width: 10, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'folia-spotify' } });
        expect(api.windows.mainWindowPresent()).toBe(true);
        const heard: boolean[] = [];
        api.windows.onMainWindowChanged((present: boolean) => heard.push(present));
        system.noteMainWindowChanged();
        expect(heard).toEqual([true]);
        await system.setSourceState('spotify', 'disabled');
        expect(window.isDestroyed()).toBe(true);
    });

    it('shell, dialog and the host\'s locale', async () => {
        const { api } = launchSource();
        await api.shell.openExternal('https://accounts.example.com/sign-in');
        expect(() => api.shell.openExternal('file:///etc/passwd')).toThrow('http(s)');
        expect(electronCalls).toContainEqual(['shell.openExternal', 'https://accounts.example.com/sign-in']);
        expect(await api.dialog.pickFile({ filters: [{ name: 'exe', extensions: ['exe'] }] })).toBe('/picked/file.bin');
        expect(api.host.locale).toBe('en');
    });

    it('players orphaned, diagnostics into the sign-in registry, native files, and the crash report', () => {
        const nativeDir = path.join(harness().root, 'native');
        fs.mkdirSync(nativeDir, { recursive: true });
        fs.writeFileSync(path.join(nativeDir, 'librespot.cjs'), 'module.exports = { native: true };');
        const { api, system, diagnostics, reported } = launchSource();
        const orphaned: string[] = [];
        api.onPlayersOrphaned((reason: string) => orphaned.push(reason));
        system.notePlayersOrphaned('rebuild');
        expect(orphaned).toEqual(['rebuild']);
        const backend = { getStatus: () => ({}), getDiagnostics: () => ({ steps: [] }), selfCheckHosts: [] };
        const off = api.diagnostics.register('spotify', backend);
        expect(diagnostics.get('spotify')).toBe(backend);
        expect(() => api.diagnostics.register('qq', backend)).toThrow('not a source of this mod');
        off();
        expect(diagnostics.get('spotify')).toBeNull();
        expect(api.native.path('librespot')).toBe(path.join(nativeDir, 'librespot.cjs'));
        expect(api.native.load('librespot')).toEqual({ native: true });
        expect(() => api.native.path('apple-music-companion')).toThrow('native-not-granted');
        const error = new Error('boom');
        api.reportError(error, 'worker');
        expect(reported).toEqual([['mod:spotify worker', error]]);
    });

    it('takes everything the mod registered away when it stops', async () => {
        const { api, system, diagnostics } = launchSource();
        api.media.allow({ hosts: ['cdn.example.com'] });
        api.diagnostics.register('spotify', { getDiagnostics: () => ({}) });
        api.cache.provideEntries({ list: async () => [{ id: 'a' }] });
        await system.setSourceState('spotify', 'disabled');
        expect(system.mediaRules.allows({ url: 'https://cdn.example.com/a', resourceType: 'media', method: 'GET' })).toBe(false);
        expect(diagnostics.get('spotify')).toBeNull();
        expect(await system.sourceCaches.list()).toEqual([]);
        expect(stateOf(system, 'spotify')!.status).toBe('disabled');
    });

    it('lists the certificate exceptions and lyric relay hosts the running source mods declare', () => {
        writeMod('builtin', sourceManifest('kugou', [{ id: 'kugou', certificateExceptions: ['fs.example.com'], lyricRelayHosts: ['lyrics.example.com'] }]));
        const system = launch();
        expect(system.allowsCertificateException('fs.example.com')).toBe(true);
        expect(system.allowsCertificateException('other.example.com')).toBe(false);
        expect(system.isLyricRelayHost('lyrics.example.com')).toBe(true);
    });
});
