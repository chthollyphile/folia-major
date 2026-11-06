import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyOfficialClient.test.ts — steering Spotify's own app: the player state
// turned into Folia's status, the repeat names, the media session answering when the DevTools port
// does not, and — the part that is behaviour rather than wiring — what a call may do to Spotify.
// D1: only a play or the launch switch may close and start it again, once in a run; a status read,
// a pause, a seek and a queue write never start it and never close it. M2: a page that throws is
// given one more look with the cached player dropped. M7: the whole DevTools connection is bounded,
// and a socket that closes before it opened is a refused connection. L2: the advertisement mute
// script switches on and off. L5: Windows' own tools run by their absolute path. The last block is
// the system media keys Folia holds while an external player sounds the song (mediaKeys.cjs): the
// three keys are registered and mapped to transport actions, given back on request, and a key the
// system refused is tried again the next time.

const require = createRequire(import.meta.url);
const {
    createSpotifyOfficialClient, isAdvertisementItem, repeatModeOf, statusFromMediaSession, statusFromPlayerState,
} = require('../../../electron/spotify/officialClient.cjs');
const { createSpotifyApiBridge, SPOTIFY_OPERATIONS } = require('../../../electron/spotify/spotifyApiBridge.cjs');
const { spotifyError } = require('../../../electron/spotify/errors.cjs');
const { createMediaKeyTakeover, MEDIA_KEYS } = require('../../../electron/spotify/mediaKeys.cjs');

const TRACK = '4uLU6hMCjMI75M1A2tKUQC';
// A call that cannot reach the page costs three connections: the call itself, the look again with
// the cached player dropped (M2), and the call once more (officialClient.cjs's `evaluateInPage`).
const FAILED_CONNECTIONS = 3;
const NEWLINE = String.fromCharCode(10);

describe('statusFromPlayerState', () => {
    it('adds the time since the timestamp to a playing track and names it', () => {
        const status = statusFromPlayerState({
            item: { uri: 'spotify:track:' + TRACK }, isPaused: false, isBuffering: false,
            positionAsOfTimestamp: 10000, timestamp: 1000, duration: 200000, repeat: 2,
        }, 3500);
        expect(status).toEqual({ id: TRACK, ad: false, isPaused: false, isBuffering: false, positionMs: 12500, durationMs: 200000, repeat: 'one' });
    });

    it('keeps a paused position and never runs past the end', () => {
        expect(statusFromPlayerState({ isPaused: true, positionAsOfTimestamp: 4000, timestamp: 0, duration: 9000 }, 99999).positionMs).toBe(4000);
        expect(statusFromPlayerState({ isPaused: false, positionAsOfTimestamp: 8000, timestamp: 0, duration: 9000 }, 5000).positionMs).toBe(9000);
    });

    it('names no track for an advertisement', () => {
        const status = statusFromPlayerState({ item: { uri: 'spotify:ad:x', metadata: { is_advertisement: 'true' } }, duration: 30000 }, 0);
        expect(status.ad).toBe(true);
        expect(status.id).toBe('');
    });

    it('answers an empty state without a track', () => {
        expect(statusFromPlayerState(null, 0)).toEqual({ id: '', ad: false, isPaused: false, isBuffering: false, positionMs: 0, durationMs: 0, repeat: null });
    });
});

describe('isAdvertisementItem', () => {
    it('reads Spotify advertisement marks', () => {
        expect(isAdvertisementItem({ metadata: { is_advertisement: 'true' } })).toBe(true);
        expect(isAdvertisementItem({ type: 'ad' })).toBe(true);
        expect(isAdvertisementItem({ metadata: { is_advertisement: 'false' } })).toBe(false);
        expect(isAdvertisementItem(null)).toBe(false);
    });
});

describe('repeat modes', () => {
    it('maps the names to Spotify values and refuses others', () => {
        expect([repeatModeOf('off'), repeatModeOf('all'), repeatModeOf('one')]).toEqual([0, 1, 2]);
        expect(() => repeatModeOf('shuffle')).toThrow();
    });

    it('reads the media session own repeat values', () => {
        expect(statusFromMediaSession({ repeat: 1 }).repeat).toBe('one');
        expect(statusFromMediaSession({ repeat: 2 }).repeat).toBe('all');
        expect(statusFromMediaSession({ repeat: -1 }).repeat).toBeNull();
    });

    it('names the track only by the title and artist the session shows (M4)', () => {
        const status = statusFromMediaSession({ title: 'Song', artist: 'Artist' });
        expect(status.id).toBe('');
        expect(status.title).toBe('Song');
        expect(status.artist).toBe('Artist');
    });
});

// --- the app itself, with the page it is steered in replaced by a stand-in ---------------

type Outcome = { value?: unknown; details?: string };
let handle: (expression: string) => Outcome = () => ({ value: true });

/** One DevTools socket of the stand-in page, opened, refused or left hanging by the test. */
class FakeSocket {
    static sockets: FakeSocket[] = [];
    static failuresLeft = 0;
    static alwaysFail = false;
    static silent = false;
    static closeBeforeOpen = false;
    url: string;
    expressions: string[] = [];
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    constructor(url: string) {
        this.url = url;
        FakeSocket.sockets.push(this);
        if (FakeSocket.closeBeforeOpen) { queueMicrotask(() => this.onclose?.()); return; }
        if (FakeSocket.silent) return;
        if (FakeSocket.alwaysFail || FakeSocket.failuresLeft > 0) {
            if (!FakeSocket.alwaysFail) FakeSocket.failuresLeft -= 1;
            queueMicrotask(() => this.onerror?.());
            return;
        }
        queueMicrotask(() => this.onopen?.());
    }
    send(text: string) {
        const command = JSON.parse(text);
        const expression = String(command.params && command.params.expression ? command.params.expression : '');
        this.expressions.push(expression);
        const outcome = handle(expression);
        queueMicrotask(() => {
            if (outcome.details !== undefined) {
                this.onmessage?.({ data: JSON.stringify({ id: command.id, result: { exceptionDetails: { text: outcome.details, exception: { description: outcome.details } } } }) });
                return;
            }
            this.onmessage?.({ data: JSON.stringify({ id: command.id, result: { result: { value: outcome.value } } }) });
        });
    }
    close() { this.onclose?.(); }
}

const mediaAnswers: Record<string, unknown> = {};
const waitFor = vi.fn(async (ms: number) => { vi.setSystemTime(Date.now() + ms); });
// The op a helper is told to stay silent on: the command stays unanswered, as a helper that hangs.
let heldOp: string | null = null;
// A start that fails: the process emits 'error' instead of running, as a PowerShell that is not there.
let spawnError = false;

/**
 * A PowerShell stand-in: it answers every command with what the test put under its op, unless the
 * test holds that op. Each process it made is kept, with the lines written to it, so a test can end
 * the old one by hand (N4).
 */
const makeSpawn = () => {
    const spawned: string[] = [];
    const procs: any[] = [];
    const spawnProcess = vi.fn((file: string) => {
        spawned.push(file);
        const proc: any = Object.assign(new EventEmitter(), {
            lines: [] as string[],
            stdout: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
            stdin: Object.assign(new EventEmitter(), {
                write(line: string) {
                    proc.lines.push(line);
                    const command = JSON.parse(line);
                    if (heldOp === command.op) return;
                    const data = command.op in mediaAnswers ? mediaAnswers[command.op] : true;
                    queueMicrotask(() => proc.stdout.emit('data', JSON.stringify({ id: command.id, ok: true, data }) + NEWLINE));
                },
            }),
            kill: vi.fn(),
            unref: vi.fn(),
        });
        if (spawnError) queueMicrotask(() => proc.emit('error', new Error('powershell.exe was not found')));
        procs.push(proc);
        return proc;
    });
    return { spawnProcess, spawned, procs };
};

const makeLauncherDirectory = () => {
    const directory = mkdtempSync(join(tmpdir(), 'folia-spotify-'));
    mkdirSync(join(directory, 'Microsoft', 'WindowsApps'), { recursive: true });
    writeFileSync(join(directory, 'Microsoft', 'WindowsApps', 'Spotify.exe'), '');
    return directory;
};

type ClientOptions = {
    running?: boolean;
    portAnswers?: boolean;
    /** Who answers on the DevTools port: Spotify itself, or another program that happens to hold it. */
    portIdentity?: 'spotify' | 'other';
    listOk?: boolean;
    appDirectory?: string;
};

const makeClient = (options: ClientOptions = {}) => {
    const { spawnProcess, spawned, procs } = makeSpawn();
    const runFile = vi.fn((file: string, _args: string[], _options: object, callback: (error: Error | null, stdout?: string) => void) => {
        if (String(file).includes('tasklist')) {
            callback(null, options.running === false ? 'INFO: No tasks are running' : 'Spotify.exe    1234 Console    1    120,000 K');
            return;
        }
        callback(null, '');
    });
    const fetch = vi.fn(async (url: string) => {
        if (String(url).includes('/json/version')) {
            return {
                ok: options.portAnswers === true,
                // What the port says about itself: Spotify's own DevTools endpoint names it (N9).
                json: async () => ({
                    Browser: 'Chrome/122.0.0.0',
                    'User-Agent': options.portIdentity === 'other'
                        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Spotify/1.2.31',
                }),
            };
        }
        if (options.listOk === false) throw new TypeError('fetch failed');
        return { ok: true, json: async () => [{ type: 'page', url: 'https://xpui.app.spotify.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9283/devtools/page/1' }] };
    });
    const env = options.appDirectory ? { LOCALAPPDATA: options.appDirectory } : {};
    const warn = vi.fn();
    const client = createSpotifyOfficialClient({
        platform: 'win32', env, fetch, spawnProcess, runFile, waitFor, log: () => {}, warn,
    });
    const helperSpawns = () => spawned.filter(file => /powershell\.exe$/i.test(file)).length;
    const spotifySpawns = () => spawned.filter(file => !/powershell\.exe$/i.test(file)).length;
    const taskkills = () => runFile.mock.calls.filter(call => String(call[0]).includes('taskkill')).length;
    const tasklists = () => runFile.mock.calls.filter(call => String(call[0]).includes('tasklist')).length;
    return { client, runFile, spawnProcess, spawned, procs, fetch, warn, helperSpawns, spotifySpawns, taskkills, tasklists };
};

beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.sockets = [];
    FakeSocket.failuresLeft = 0;
    FakeSocket.alwaysFail = false;
    FakeSocket.silent = false;
    FakeSocket.closeBeforeOpen = false;
    heldOp = null;
    spawnError = false;
    // The stand-in page runs nothing: a start is answered with the word the real page answers with
    // (N8), and every other call with true.
    handle = expression => ({ value: expression.includes('window.__foliaPlay') ? 'loaded' : true });
    waitFor.mockClear();
    for (const key of Object.keys(mediaAnswers)) delete mediaAnswers[key];
    vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('D1: what a call may do to Spotify', () => {
    it('reads the status without starting or closing Spotify, even while it runs without the port', async () => {
        mediaAnswers.status = { isPaused: true, positionMs: 5000, durationMs: 3000, repeat: 2 };
        const app = makeClient({ running: true, portAnswers: false, listOk: false });
        const status = await app.client.status();
        expect(status.fallback).toBe(true);
        expect(app.tasklists()).toBe(0);
        expect(app.taskkills()).toBe(0);
        expect(app.spotifySpawns()).toBe(0);
        await app.client.close();
    });

    it('pauses through the media session without starting Spotify', async () => {
        const app = makeClient({ running: true, portAnswers: false, listOk: false });
        await expect(app.client.pause()).resolves.toBe(true);
        expect(app.tasklists()).toBe(0);
        expect(app.taskkills()).toBe(0);
        expect(app.spotifySpawns()).toBe(0);
        await app.client.close();
    });

    it('only starts Spotify when it is not running, and never closes it then', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        expect(app.spotifySpawns()).toBe(1);
        expect(app.taskkills()).toBe(0);
        await app.client.close();
    });

    it('restarts Spotify once for a play when it runs without the port, and not a second time', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        expect(app.taskkills()).toBe(1);
        expect(app.spotifySpawns()).toBe(1);

        // The page stops answering: the next play is a listener action too, but the run has spent
        // its one restart, so it stays on the media session instead of closing Spotify again.
        handle = () => ({ details: 'Error: player-unavailable' });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({ code: 'unavailable' });
        expect(app.taskkills()).toBe(1);
        expect(app.spotifySpawns()).toBe(1);
        await app.client.close();
    });

    it('restarts Spotify once for the launch switch as well', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.launch()).resolves.toBe(true);
        expect(app.taskkills()).toBe(1);
        expect(app.spotifySpawns()).toBe(1);
        await app.client.close();
    });

    it('does not ask again within the cool-down after a start that failed', async () => {
        FakeSocket.alwaysFail = true;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: mkdtempSync(join(tmpdir(), 'folia-empty-')) });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({ code: 'unavailable' });
        const askedOnce = app.fetch.mock.calls.filter(call => String(call[0]).includes('/json/version')).length;
        expect(askedOnce).toBe(1);

        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({ code: 'unavailable' });
        expect(app.fetch.mock.calls.filter(call => String(call[0]).includes('/json/version')).length).toBe(askedOnce);
        await app.client.close();
    });

    it('tells whether the app is installed without starting it (D2)', async () => {
        const installed = makeClient({ appDirectory: makeLauncherDirectory() });
        expect(installed.client.available()).toEqual({ available: true });
        expect(installed.spawned).toEqual([]);
        const missing = makeClient({ appDirectory: mkdtempSync(join(tmpdir(), 'folia-empty-')) });
        expect(missing.client.available()).toEqual({ available: false, reason: 'not-installed' });
        await installed.client.close();
        await missing.client.close();
    });

    it('runs Windows own tools by their absolute path (L5)', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        const tools = app.runFile.mock.calls.map(call => String(call[0]));
        expect(tools.some(file => file.endsWith('tasklist.exe') && file.includes('System32'))).toBe(true);
        expect(tools.some(file => file.endsWith('taskkill.exe') && file.includes('System32'))).toBe(true);
        await app.client.close();
    });
});

describe('M2: the player cached in the page', () => {
    it('is dropped and looked for once more before a call is called a failure', async () => {
        let seen = 0;
        handle = expression => {
            if (expression.includes('delete window.__foliaSpotify')) return { value: true };
            seen += 1;
            return seen === 1 ? { details: 'Error: player-unavailable' } : { value: true };
        };
        const app = makeClient({ running: true, portAnswers: true });
        await expect(app.client.pause()).resolves.toBe(true);
        const expressions = FakeSocket.sockets.flatMap(socket => socket.expressions);
        expect(expressions.some(text => text.includes('delete window.__foliaSpotify'))).toBe(true);
        // No Spotify was started and no helper was asked: the second look found the player.
        expect(app.spotifySpawns()).toBe(0);
        expect(app.spawned).toEqual([]);
        await app.client.close();
    });
});

describe('M7: the DevTools connection', () => {
    it('treats a socket that closes before it opened as a refused connection', async () => {
        FakeSocket.closeBeforeOpen = true;
        const app = makeClient({ running: true, portAnswers: true });
        // It is not waited on and not taken for a connection: the call goes to the media session.
        await expect(app.client.pause()).resolves.toBe(true);
        expect(app.helperSpawns()).toBe(1);
        await app.client.close();
    });

    it('gives up on a socket that never opens, and clears the timer it waited on', async () => {
        FakeSocket.silent = true;
        mediaAnswers.pause = true;
        const app = makeClient({ running: true, portAnswers: true });
        let settled = false;
        const paused = app.client.pause().then((value: unknown) => { settled = true; return value; });
        // Each look at the page waits its own connection limit before it is given up, and the next
        // one starts its own: the clock is moved until the call has settled.
        for (let attempt = 0; attempt < 20 && !settled; attempt += 1) {
            await vi.runOnlyPendingTimersAsync();
        }
        await expect(paused).resolves.toBe(true);
        // The media session answered instead: the connection was given up, not waited on for ever.
        expect(app.helperSpawns()).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
        await app.client.close();
    });
});

describe('L2: the advertisement mute', () => {
    it('switches the mute on for an advertisement and off again after it', async () => {
        let advertisement: unknown = { item: { uri: 'spotify:ad:1', metadata: { is_advertisement: 'true' } }, isPaused: false, isBuffering: false, duration: 30000, adMuted: false };
        handle = expression => (expression.includes('positionAsOfTimestamp') ? { value: advertisement } : { value: true });
        const app = makeClient({ running: true, portAnswers: true });

        expect((await app.client.status()).ad).toBe(true);
        // The page keeps the mute: the second read sees it already on, and does not mute again.
        (advertisement as { adMuted: boolean }).adMuted = true;
        expect((await app.client.status()).ad).toBe(true);
        let expressions = FakeSocket.sockets.flatMap(socket => socket.expressions);
        expect(expressions.filter(text => text.includes('ad.muted = true')).length).toBe(1);

        advertisement = { item: { uri: 'spotify:track:' + TRACK }, isPaused: false, isBuffering: false, duration: 200000, adMuted: true };
        expect((await app.client.status()).ad).toBe(false);
        expressions = FakeSocket.sockets.flatMap(socket => socket.expressions);
        expect(expressions.filter(text => text.includes('ad.muted = false')).length).toBe(1);
        await app.client.close();
    });

    it('keeps the mute state apart from the player the page forgets (N5)', async () => {
        let seen = 0;
        handle = expression => {
            if (expression.includes('delete window.__foliaSpotify')) return { value: true };
            seen += 1;
            return seen === 1 ? { details: 'Error: player-unavailable' } : { value: true };
        };
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.pause();
        const expressions = FakeSocket.sockets.flatMap(socket => socket.expressions);
        // Forgetting the player leaves the advertisement state alone, and the calls read it from the window.
        expect(expressions.find(text => text.includes('delete window.__foliaSpotify'))).not.toContain('__foliaAd');
        expect(expressions.some(text => text.includes('window.__foliaAd'))).toBe(true);
        await app.client.close();
    });

    it('gives a muted advertisement its volume back as Folia quits', async () => {
        handle = expression => (expression.includes('positionAsOfTimestamp')
            ? { value: { item: { uri: 'spotify:ad:1', metadata: { is_advertisement: 'true' } }, isPaused: false, isBuffering: false, duration: 30000, adMuted: false } }
            : { value: true });
        const app = makeClient({ running: true, portAnswers: true });
        // The mute is kept in the page, so the page has to be open for it to be given back.
        expect((await app.client.status()).ad).toBe(true);
        await app.client.close();
        const expressions = FakeSocket.sockets.flatMap(socket => socket.expressions);
        expect(expressions.some(text => text.includes('ad.muted = false'))).toBe(true);
    });
});

describe('the bridge over the official client', () => {
    const makeBridge = (officialClient: any, now = () => 0) => createSpotifyApiBridge({
        store: { get: () => undefined, set: () => {}, delete: () => {} }, safeStorage: {}, fetch: vi.fn(),
        openExternal: vi.fn(), officialClient, now, log: () => {}, warn: () => {},
    });
    const makeOfficialClient = () => ({
        launch: vi.fn(async () => true), restart: vi.fn(async () => true), play: vi.fn(async () => true),
        queue: vi.fn(async () => 0), pause: vi.fn(async () => true), resume: vi.fn(async () => true),
        seek: vi.fn(async () => true), setVolume: vi.fn(async () => true), status: vi.fn(async () => ({ id: TRACK })),
        available: vi.fn(() => ({ available: true })), closeForQuit: vi.fn(async () => true), close: vi.fn(async () => {}),
    });

    it('keeps the answer about the installed app instead of asking before every song (D2)', async () => {
        const officialClient = makeOfficialClient();
        const bridge = makeBridge(officialClient, () => 0);
        expect(await bridge.request('client_probe')).toEqual({ ok: true, data: { available: true } });
        expect(await bridge.request('client_probe')).toEqual({ ok: true, data: { available: true } });
        expect(officialClient.available).toHaveBeenCalledTimes(1);
        await bridge.shutdown();
    });

    it('no longer offers the operations the renderer never called (L6)', async () => {
        const officialClient = makeOfficialClient();
        const bridge = makeBridge(officialClient);
        for (const operation of ['client_next', 'client_previous', 'client_repeat']) {
            expect(SPOTIFY_OPERATIONS).not.toContain(operation);
            expect(await bridge.request(operation, {})).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        }
        await bridge.shutdown();
    });

    it('closes Spotify at the quit only when the setting asked for it (D3)', async () => {
        const quiet = makeOfficialClient();
        await makeBridge(quiet).shutdown();
        expect(quiet.closeForQuit).not.toHaveBeenCalled();
        expect(quiet.close).toHaveBeenCalled();

        const asked = makeOfficialClient();
        await makeBridge(asked).shutdown({ closePlayerOnQuit: true });
        expect(asked.closeForQuit).toHaveBeenCalled();
        expect(asked.close).toHaveBeenCalled();
    });

    it('answers the calls the renderer makes with what the app said', async () => {
        const officialClient = makeOfficialClient();
        const bridge = makeBridge(officialClient);
        expect(await bridge.request('client_seek', { ms: 1200 })).toMatchObject({ ok: true });
        expect(officialClient.seek).toHaveBeenCalledWith({ ms: 1200 });
        expect(await bridge.request('client_volume', { value: 0.4 })).toMatchObject({ ok: true });
        expect(officialClient.setVolume).toHaveBeenCalledWith({ value: 0.4 });
        expect(await bridge.request('client_pause')).toMatchObject({ ok: true });
        expect(officialClient.pause).toHaveBeenCalled();
        // A call the app refused reaches the renderer as the code it gave, not as a success.
        officialClient.play.mockRejectedValueOnce(spotifyError('unavailable', 'The Spotify app is not installed'));
        expect(await bridge.request('client_play', { id: TRACK })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        await bridge.shutdown();
    });
});

describe('the quit, the helper and the port', () => {
    const makeBridge = (officialClient: any) => createSpotifyApiBridge({
        store: { get: () => undefined, set: () => {}, delete: () => {} }, safeStorage: {}, fetch: vi.fn(),
        openExternal: vi.fn(), officialClient, now: () => 0, log: () => {}, warn: () => {},
    });

    // The page says an advertisement plays, and keeps the mute the test can watch.
    const adPlaying = () => {
        const page = { muted: false, mutedWhenKilled: null as boolean | null };
        handle = expression => {
            if (expression.includes('positionAsOfTimestamp')) {
                return { value: { item: { uri: 'spotify:ad:1', metadata: { is_advertisement: 'true' } }, isPaused: false, isBuffering: false, duration: 30000, adMuted: page.muted } };
            }
            if (expression.includes('ad.muted = true')) { page.muted = true; return { value: true }; }
            if (expression.includes('ad.muted = false')) { page.muted = false; return { value: true }; }
            return { value: 'loaded' };
        };
        return page;
    };

    it('gives the advertisement mute back before it closes Spotify (N2)', async () => {
        const page = adPlaying();
        const app = makeClient({ portAnswers: true });
        const order: string[] = [];
        app.runFile.mockImplementation((file: string, _args: string[], _options: object, callback: (error: Error | null, stdout?: string) => void) => {
            if (String(file).includes('taskkill')) {
                page.mutedWhenKilled = page.muted;
                order.push('taskkill');
                callback(null, '');
                return;
            }
            callback(null, '');
        });
        expect((await app.client.status()).ad).toBe(true);
        expect(page.muted).toBe(true);
        // Quitting has something to wait for only while the mute is still on (N3).
        expect(app.client.releasePending()).toBe(true);

        await expect(app.client.closeForQuit()).resolves.toBe(true);
        // The volume was given back before the app was closed, and the page no longer holds a mute.
        expect(page.mutedWhenKilled).toBe(false);
        expect(page.muted).toBe(false);
        expect(app.client.releasePending()).toBe(false);
    });

    it('closes Spotify when the port answering is Spotify itself, and leaves the port alone otherwise (N9)', async () => {
        const spotify = makeClient({ portAnswers: true });
        expect(await spotify.client.closeForQuit()).toBe(true);

        // Another program holds 9283: it is not Folia's Spotify, and Spotify is not closed for it.
        const other = makeClient({ portAnswers: true, portIdentity: 'other' });
        expect(await other.client.closeForQuit()).toBe(false);
        expect(other.taskkills()).toBe(0);

        // No port, and this run did not start it: nothing to close.
        const quiet = makeClient({ portAnswers: false });
        expect(await quiet.client.closeForQuit()).toBe(false);
        expect(quiet.taskkills()).toBe(0);
    });

    it('closes the Spotify this run started, even with no port answering (D3)', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        // One restart to get the port, and then the quit closes what this run started.
        expect(app.taskkills()).toBe(1);
        app.fetch.mockImplementation((async () => ({ ok: false, json: async () => ({}) })) as never);
        await expect(app.client.closeForQuit()).resolves.toBe(true);
        expect(app.taskkills()).toBe(2);
    });

    it('does not close a Spotify this run started and the listener closed meanwhile (N9)', async () => {
        // The page cannot be reached at first, so the play starts Spotify with the port as D1 allows.
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        expect(app.spotifySpawns()).toBe(1);
        const killedWhileStarting = app.taskkills();

        // The listener closed it: the next look at the process finds nothing.
        app.runFile.mockImplementation((file: string, _args: string[], _options: object, callback: (error: Error | null, stdout?: string) => void) => {
            callback(null, String(file).includes('tasklist') ? 'INFO: No tasks are running' : '');
        });
        expect(await app.client.closeForQuit()).toBe(false);
        expect(app.taskkills()).toBe(killedWhileStarting);
    });

    it('does not ask the bridges to shut down twice for one quit (N9)', async () => {
        // The flag lives in main.cjs, which the bridge cannot see: what is pinned here is the one
        // wire the flag leans on — a shutdown that already finished answers nothing to hold, and a
        // second call is what main.cjs must not make.
        const officialClient: any = { close: vi.fn(async () => {}), releasePending: () => false, closeForQuit: vi.fn(async () => true) };
        const bridge = makeBridge(officialClient);
        expect(await bridge.shutdown()).toBeNull();
        expect(officialClient.closeForQuit).not.toHaveBeenCalled();
    });

    it('ends the quit within its limit even when taskkill hangs (N3)', async () => {
        const app = makeClient({ portAnswers: true });
        const timeouts: unknown[] = [];
        app.runFile.mockImplementation((file: string, _args: string[], options: { timeout?: number }, _callback: (error: Error | null, stdout?: string) => void) => {
            if (String(file).includes('taskkill')) {
                timeouts.push(options.timeout);
                return; // never answers: a taskkill that hangs
            }
        });
        const bridge = makeBridge(app.client);
        const quit = bridge.shutdown({ closePlayerOnQuit: true });
        await vi.advanceTimersByTimeAsync(3100);
        await expect(quit).resolves.toBeUndefined();
        // Both Windows tools are bounded as well, so the window itself ends the call.
        expect(timeouts).toEqual([2000]);
    });

    it('does not hold the quit when the setting is off and no advertisement is muted (N3)', async () => {
        const app = makeClient({ portAnswers: true });
        const bridge = makeBridge(app.client);
        expect(await bridge.shutdown()).toBeNull();
        // With the setting on it is held: the app is closed, and that is waited for.
        await expect(bridge.shutdown({ closePlayerOnQuit: true })).resolves.toBeUndefined();
    });

    it('does not wake or restart Spotify for an advance Folia made by itself (T5)', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        // The call fails where it stands: no restart, no start, whatever the socket said.
        await expect(app.client.play({ id: TRACK, startMs: 0, userAction: false })).rejects.toBeTruthy();
        expect(app.taskkills()).toBe(0);
        expect(app.spotifySpawns()).toBe(0);
    });
});

describe('how Folia raises Spotify: in the tray, out of the way', () => {
    const minimizers = (app: ReturnType<typeof makeClient>) => app.runFile.mock.calls
        .filter(call => String(call[0]).endsWith('powershell.exe') && (call[1] as string[]).includes('-EncodedCommand'));

    it('starts Spotify with the minimized flag next to its DevTools port and hides the window it started into the tray', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.launch()).resolves.toBe(true);
        const args = (app.spawnProcess.mock.calls as unknown as unknown[][]).find(call => !/powershell\.exe$/i.test(String(call[0])))?.[1] as string[];
        expect(args).toContain('--minimized');
        expect(args.some(arg => arg.startsWith('--remote-debugging-port='))).toBe(true);
        const script = Buffer.from(String((minimizers(app)[0]?.[1] as string[]).at(-1)), 'base64').toString('utf16le');
        // Hidden into the tray without activation (SW_HIDE), never closed: the tray icon still restores it,
        // and only a non-zero handle is touched.
        expect(script).toContain('ShowWindowAsync($p.MainWindowHandle, 0)');
        expect(script).toContain('$p.MainWindowHandle -ne [System.IntPtr]::Zero');
        await app.client.close();
    });

    it('leaves the window of a Spotify that already answers on its port alone', async () => {
        const app = makeClient({ running: true, portAnswers: true, appDirectory: makeLauncherDirectory() });
        await expect(app.client.launch()).resolves.toBe(true);
        expect(app.spotifySpawns()).toBe(0);
        expect(minimizers(app)).toHaveLength(0);
        await app.client.close();
    });

    it('does not fail a start when the window cannot be minimized', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        app.runFile.mockImplementation((file: string, _args: string[], _options: object, callback: (error: Error | null, stdout?: string) => void) => {
            if (String(file).includes('tasklist')) { callback(null, 'INFO: No tasks are running'); return; }
            callback(String(file).endsWith('powershell.exe') ? new Error('blocked') : null, '');
        });
        await expect(app.client.launch()).resolves.toBe(true);
        expect(app.warn).toHaveBeenCalled();
        await app.client.close();
    });
});

describe('the press of play on a song whose Spotify is gone', () => {
    it('a resume never starts or closes Spotify, a play of the listener does, once, and seeks to the position', async () => {
        const app = makeClient({ running: false, portAnswers: false, listOk: false, appDirectory: makeLauncherDirectory() });
        // Resuming goes to the media session at most: Spotify stays as it is.
        await app.client.resume();
        expect(app.spotifySpawns()).toBe(0);
        expect(app.taskkills()).toBe(0);

        await app.client.close();

        // The renderer's answer to a refused resume is a play of the song at its position (userAction): that one starts Spotify.
        const playing = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const scripts: string[] = [];
        handle = expression => {
            scripts.push(expression);
            return { value: expression.includes('window.__foliaPlay') ? 'loaded' : true };
        };
        await expect(playing.client.play({ id: TRACK, startMs: 83000, userAction: true })).resolves.toBe('loaded');
        expect(playing.spotifySpawns()).toBe(1);
        expect(playing.taskkills()).toBe(0);
        expect(scripts.some(script => script.includes('seekTo(83000)'))).toBe(true);
        await playing.client.close();
    });
});

describe('the media session helper', () => {
    it('does not fail the new helper with the old one ending (N4)', async () => {
        heldOp = 'pause';
        const app = makeClient({ running: true, portAnswers: false, listOk: false });
        // The first helper never answers: it is given up, and the run waits out the backoff.
        const first = expect(app.client.pause()).rejects.toBeTruthy();
        await vi.advanceTimersByTimeAsync(20100);
        await first;
        expect(app.procs).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(21000);

        // A new helper, still unanswered: the old process ending now must not fail its answer.
        const second = app.client.pause();
        await vi.advanceTimersByTimeAsync(10);
        expect(app.procs).toHaveLength(2);
        app.procs[0].emit('exit');

        const asked = JSON.parse(app.procs[1].lines.at(-1) as string);
        app.procs[1].stdout.emit('data', JSON.stringify({ id: asked.id, ok: true, data: true }) + NEWLINE);
        await expect(second).resolves.toBe(true);
    });

    it('ends a helper that did not answer and starts a fresh one after the backoff (N7)', async () => {
        heldOp = 'pause';
        const app = makeClient({ running: true, portAnswers: false, listOk: false });
        const first = expect(app.client.pause()).rejects.toMatchObject({ code: 'network' });
        await vi.advanceTimersByTimeAsync(20100);
        await first;
        // The helper that hung is ended, not kept for the next command.
        expect(app.procs[0].kill).toHaveBeenCalled();
        // Inside the backoff nothing is started.
        await expect(app.client.pause()).rejects.toMatchObject({ code: 'unavailable' });
        expect(app.helperSpawns()).toBe(1);

        heldOp = null;
        await vi.advanceTimersByTimeAsync(20000);
        await expect(app.client.pause()).resolves.toBe(true);
        expect(app.helperSpawns()).toBe(2);
    });

    it('lets a helper go when its input fails, and fails what it still owed (N7)', async () => {
        const app = makeClient({ running: true, portAnswers: false, listOk: false });
        await expect(app.client.pause()).resolves.toBe(true);

        heldOp = 'resume';
        const owed = expect(app.client.resume()).rejects.toMatchObject({ code: 'unavailable' });
        await vi.advanceTimersByTimeAsync(10);
        app.procs[0].stdin.emit('error', new Error('EPIPE'));
        await owed;
        expect(app.procs[0].kill).toHaveBeenCalled();
        expect(app.warn.mock.calls.some(call => String(call[0]).includes('lost its input'))).toBe(true);

        // The next command waits out the backoff, and is then answered by a new helper.
        heldOp = null;
        await expect(app.client.pause()).rejects.toMatchObject({ code: 'unavailable' });
        await vi.advanceTimersByTimeAsync(20000);
        await expect(app.client.pause()).resolves.toBe(true);
        expect(app.helperSpawns()).toBe(2);
    });

    it('starts the helper again only after the backoff it has reached (N6)', async () => {
        spawnError = true;
        const app = makeClient({ running: true, portAnswers: false, listOk: false });
        await expect(app.client.pause()).rejects.toBeTruthy();
        expect(app.helperSpawns()).toBe(1);
        // Inside the first backoff nothing is started again.
        await expect(app.client.pause()).rejects.toBeTruthy();
        expect(app.helperSpawns()).toBe(1);
        await vi.advanceTimersByTimeAsync(20000);
        await expect(app.client.pause()).rejects.toBeTruthy();
        expect(app.helperSpawns()).toBe(2);
        // The second backoff is longer: 20 seconds are not enough any more.
        await vi.advanceTimersByTimeAsync(20000);
        await expect(app.client.pause()).rejects.toBeTruthy();
        expect(app.helperSpawns()).toBe(2);
        await vi.advanceTimersByTimeAsync(40000);
        await expect(app.client.pause()).rejects.toBeTruthy();
        expect(app.helperSpawns()).toBe(3);
        // One start failure, one line: the same error is not written on every read.
        expect(app.warn.mock.calls.filter(call => String(call[0]).includes('could not be started'))).toHaveLength(1);
    });

    it('starts the helper by its absolute path, not by whatever PATH says (N6)', async () => {
        const app = makeClient({ running: true, portAnswers: false, listOk: false });
        await expect(app.client.pause()).resolves.toBe(true);
        expect(app.spawned[0]).toMatch(/System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
    });
});

describe('without the DevTools port, off Windows', () => {
    it('is not steered', async () => {
        const client = createSpotifyOfficialClient({ platform: 'linux', fetch: () => Promise.reject(new TypeError('fetch failed')) });
        await expect(client.launch()).rejects.toMatchObject({ code: 'unsupported' });
    });
});

const makeShortcut = (refused: string[] = []) => {
    const handlers = new Map<string, () => void>();
    return {
        handlers,
        register: vi.fn((accelerator: string, handler: () => void) => {
            if (refused.includes(accelerator)) return false;
            handlers.set(accelerator, handler);
            return true;
        }),
        unregister: vi.fn((accelerator: string) => { handlers.delete(accelerator); }),
    };
};

describe('the media key takeover', () => {
    it('holds the three keys and tells which transport action each one is', () => {
        const globalShortcut = makeShortcut();
        const onKey = vi.fn();
        const takeover = createMediaKeyTakeover({ globalShortcut, onKey, log: () => {}, warn: () => {} });

        expect(takeover.set(true).held.sort()).toEqual(Object.keys(MEDIA_KEYS).sort());
        globalShortcut.handlers.get('MediaNextTrack')!();
        globalShortcut.handlers.get('MediaPreviousTrack')!();
        globalShortcut.handlers.get('MediaPlayPause')!();
        expect(onKey.mock.calls.map(call => call[0])).toEqual(['next', 'previous', 'play-pause']);
    });

    it('registers nothing twice and gives every key back when asked', () => {
        const globalShortcut = makeShortcut();
        const takeover = createMediaKeyTakeover({ globalShortcut, onKey: () => {}, log: () => {}, warn: () => {} });
        takeover.set(true);
        takeover.set(true);
        expect(globalShortcut.register).toHaveBeenCalledTimes(3);

        expect(takeover.set(false)).toEqual({ enabled: false, held: [] });
        expect(globalShortcut.unregister).toHaveBeenCalledTimes(3);
        expect(globalShortcut.handlers.size).toBe(0);
    });

    it('reports a key the system refused and tries it again on the next call', () => {
        const refused = ['MediaNextTrack'];
        const globalShortcut = makeShortcut(refused);
        const warn = vi.fn();
        const takeover = createMediaKeyTakeover({ globalShortcut, onKey: () => {}, log: () => {}, warn });

        expect(takeover.set(true).held).not.toContain('MediaNextTrack');
        expect(warn).toHaveBeenCalled();
        refused.length = 0;
        expect(takeover.set(true).held).toContain('MediaNextTrack');
    });

    it('does not throw when the system throws on register', () => {
        const globalShortcut = makeShortcut();
        globalShortcut.register.mockImplementation(() => { throw new Error('no'); });
        const takeover = createMediaKeyTakeover({ globalShortcut, onKey: () => {}, log: () => {}, warn: () => {} });
        expect(takeover.set(true)).toEqual({ enabled: false, held: [] });
    });
});
