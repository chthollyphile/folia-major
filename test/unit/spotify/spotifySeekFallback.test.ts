import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifySeekFallback.test.ts
// What one move of the bar costs Spotify's own app. A move is one call, whether the player takes it
// or refuses it: a refused move is answered from the system media session rather than asked a second
// time, since a second seekTo on a player that already moved would sound the song from the wrong
// spot. Nothing else of Folia's reaches the app for a move - no start, no pause, no queue write.
//
// The log this was written against (2026-11-13, 16:57:39 to 16:57:44) shows four moves of one drag,
// each returning in 8-29 ms, one of them refused by the player and answered by the media session.

const require = createRequire(import.meta.url);
const { createSpotifyOfficialClient } = require('../../../electron/spotify/officialClient.cjs');

type Outcome = { value?: unknown; details?: string; error?: string };

/** One DevTools socket of the stand-in page, opened or refused by the test. */
class FakeSocket {
    static sockets: FakeSocket[] = [];
    url: string;
    expressions: string[] = [];
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    constructor(url: string) {
        this.url = url;
        FakeSocket.sockets.push(this);
        queueMicrotask(() => this.onopen?.());
    }
    send(text: string) {
        const command = JSON.parse(text);
        const expression = String(command.params && command.params.expression ? command.params.expression : '');
        this.expressions.push(expression);
        void Promise.resolve()
            .then(() => handle(expression))
            .then(outcome => {
                queueMicrotask(() => {
                    if (outcome.error !== undefined) {
                        this.onmessage?.({ data: JSON.stringify({ id: command.id, error: { code: -32000, message: outcome.error } }) });
                        return;
                    }
                    if (outcome.details !== undefined) {
                        this.onmessage?.({ data: JSON.stringify({ id: command.id, result: { exceptionDetails: { text: outcome.details, exception: { description: outcome.details } } } }) });
                        return;
                    }
                    this.onmessage?.({ data: JSON.stringify({ id: command.id, result: { result: { value: outcome.value } } }) });
                });
            });
    }
    close() { this.onclose?.(); }
}

let handle: (expression: string) => Outcome = () => ({ value: true });
const mediaAnswers: Record<string, unknown> = {};
const waitFor = vi.fn(async (ms: number) => { vi.setSystemTime(Date.now() + ms); });
const NEWLINE = String.fromCharCode(10);

const makeClient = () => {
    const mediaLines: { op: string; ms?: number }[] = [];
    const procs: any[] = [];
    const spawnProcess = vi.fn(() => {
        const proc: any = Object.assign(new EventEmitter(), {
            stdout: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
            stdin: Object.assign(new EventEmitter(), {
                write(line: string) {
                    const command = JSON.parse(line);
                    mediaLines.push({ op: command.op, ms: command.ms });
                    const data = command.op in mediaAnswers ? mediaAnswers[command.op] : true;
                    queueMicrotask(() => proc.stdout.emit('data', JSON.stringify({ id: command.id, ok: true, data }) + NEWLINE));
                },
            }),
            kill: vi.fn(),
            unref: vi.fn(),
        });
        procs.push(proc);
        return proc;
    });
    const runFile = vi.fn((_file: string, _args: string[], _options: object, callback: (error: Error | null, stdout?: string) => void) => {
        callback(null, '"Spotify.exe","1234","Console","1","120,000 K"');
    });
    const fetch = vi.fn(async (url: string) => {
        if (String(url).includes('/json/version')) {
            return { ok: true, json: async () => ({ Browser: 'Chrome/122.0.0.0', 'User-Agent': 'Mozilla/5.0 Spotify/1.2.31' }) };
        }
        return { ok: true, json: async () => [{ type: 'page', url: 'https://xpui.app.spotify.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9283/devtools/page/1' }] };
    });
    const warn = vi.fn();
    const client = createSpotifyOfficialClient({
        platform: 'win32', env: {}, fetch, spawnProcess, runFile, waitFor, log: vi.fn(), warn,
        port: 9283, restartConsented: () => true,
    });
    return { client, mediaLines, spawnProcess, procs, runFile };
};

beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.sockets = [];
    handle = () => ({ value: true });
    for (const key of Object.keys(mediaAnswers)) delete mediaAnswers[key];
    waitFor.mockClear();
    vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('one move of the bar, as Spotify pays for it', () => {
    it('asks the player once and never again when it takes the move', async () => {
        const app = makeClient();
        await expect(app.client.seek({ ms: 38500 })).resolves.toBe(true);
        const seeks = FakeSocket.sockets.flatMap(socket => socket.expressions).filter(text => text.includes('seekTo('));
        console.log('[seek] player calls=' + seeks.length + ' media session calls=' + app.mediaLines.length);
        expect(seeks, 'one move is one seekTo on the player').toHaveLength(1);
        expect(seeks[0]).toContain('seekTo(38500)');
        expect(app.mediaLines, 'a move the player took reaches no media session').toHaveLength(0);
        await app.client.close();
    });

    it('does not seek a second time when the player refuses the move', async () => {
        // The player refuses the call, which is what the log shows once: Spotify's own player answers
        // a DragAndDrop or an unloaded track with a thrown error. The move is then made through the
        // system media session, once, and never asked of the player again.
        const app = makeClient();
        handle = expression => (expression.includes('seekTo(') ? { details: 'Spotify\'s player refused the call' } : { value: true });
        await expect(app.client.seek({ ms: 38500 })).resolves.toBe(true);
        const seeks = FakeSocket.sockets.flatMap(socket => socket.expressions).filter(text => text.includes('seekTo('));
        const mediaSeeks = app.mediaLines.filter(line => line.op === 'seek');
        console.log('[refused seek] player calls=' + seeks.length + ' media session seeks=' + JSON.stringify(mediaSeeks));
        expect(seeks, 'a refused move is not handed to the player a second time').toHaveLength(1);
        expect(mediaSeeks, 'the move is made once through the media session').toHaveLength(1);
        expect(mediaSeeks[0].ms).toBe(38500);
        await app.client.close();
    });

    it('sends nothing but the move: no start, no pause, no queue write', async () => {
        const app = makeClient();
        await expect(app.client.seek({ ms: 38500 })).resolves.toBe(true);
        const texts = FakeSocket.sockets.flatMap(socket => socket.expressions);
        console.log('[seek] scripts=' + JSON.stringify(texts.map(text => (
            text.includes('seekTo(') ? 'seekTo' : text.includes('getState') ? 'getState' : text.includes('addToQueue') ? 'addToQueue' : text.includes('clearQueue') ? 'clearQueue' : text.includes('pause()') ? 'pause' : text.includes('resume()') ? 'resume' : 'other'
        ))));
        expect(texts.some(text => text.includes('addToQueue') || text.includes('clearQueue'))).toBe(false);
        expect(texts.some(text => text.includes('player.pause()') || text.includes('player.resume()'))).toBe(false);
        // The moves a start makes are absent: nothing of that call is here.
        expect(app.mediaLines.filter(line => line.op !== 'seek')).toHaveLength(0);
        await app.client.close();
    });
});
