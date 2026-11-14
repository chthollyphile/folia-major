import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyOfficialClient.test.ts — steering Spotify's own app: the player state
// turned into Folia's status, the repeat names, the media session answering when the DevTools port
// does not, and — the part that is behaviour rather than wiring — what a call may do to Spotify.
// Only a play or the launch switch may close and start it again, once in a run; a status read, a
// pause, a seek and a queue write never start it and never close it. A page that throws is given one
// more look with the cached player dropped, and the whole DevTools connection is bounded: a socket
// that closes before it opened is a refused connection. Windows' own tools run by their absolute
// path. The system media keys Folia holds are not this player's: the module and its tests are
// generic and live with every route (test/unit/mediaKeys/mediaKeyTakeover.test.ts).

const require = createRequire(import.meta.url);
const {
    PLAY_STATE_SOURCE, QUEUE_SOURCE, RELEASE_STATE_SOURCE, REPEAT_TRACK_SOURCE, RESTORE_STATE_SOURCE, START_QUEUE_SOURCE, START_WAIT_SOURCE,
    createSpotifyOfficialClient, isAdvertisementItem, repeatModeOf, repeatWordsOf, statusFromMediaSession, statusFromPlayerState,
} = require('../../../electron/spotify/officialClient.cjs');
const { createSpotifyApiBridge, SPOTIFY_OPERATIONS } = require('../../../electron/spotify/spotifyApiBridge.cjs');
const { spotifyError } = require('../../../electron/spotify/errors.cjs');

import { OnlineProviderError } from '@/types/onlineMusic';
import { onlineFailureOf, stopsPlayback } from '@/services/onlineMusic/failure/onlineFailureCase';
import { describeSpotifyFailure } from '@/services/onlineMusic/spotify/spotifyFailure';

const TRACK = '4uLU6hMCjMI75M1A2tKUQC';
// A call that cannot reach the page costs three connections: the call itself, the look again with
// the cached player dropped, and the call once more (officialClient.cjs's `evaluateInPage`).
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

    it('names the track only by the title and artist the session shows', () => {
        const status = statusFromMediaSession({ title: 'Song', artist: 'Artist' });
        expect(status.id).toBe('');
        expect(status.title).toBe('Song');
        expect(status.artist).toBe('Artist');
    });
});

// --- the app itself, with the page it is steered in replaced by a stand-in ---------------

type Outcome = { value?: unknown; details?: string; error?: string };
// A page runs the script it is given and answers what it says: a handler that runs a source of the
// app's own answers a promise, which is read the way the page's own await would read it.
let handle: (expression: string) => Outcome | Promise<Outcome> = () => ({ value: true });

/** One DevTools socket of the stand-in page, opened, refused or left hanging by the test. */
class FakeSocket {
    static sockets: FakeSocket[] = [];
    static failuresLeft = 0;
    static alwaysFail = false;
    static silent = false;
    static muteSend = false;
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
        if (FakeSocket.muteSend) return;
        // The page evaluates the script and awaits it, so a stand-in that runs one of the app's own
        // sources answers the promise its evaluation makes. A script that throws is the page's own
        // exception, which the caller reads as the call having failed.
        void Promise.resolve()
            .then(() => handle(expression))
            .then(outcome => {
                queueMicrotask(() => {
                    if (outcome.error !== undefined) {
                        // A DevTools protocol error: the call failed, and no answer came with it.
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
    closed = false;
    close() { this.closed = true; this.onclose?.(); }
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
 * the old one by hand.
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
    /** The DevTools port to ask for; 0 lets the app pick one, which is then looked for. Default 9283. */
    port?: number;
    /** The port written into the profile's DevToolsActivePort file, as CEF writes the one it took. */
    activePort?: number;
    /** What `netstat -ano` answers: the loopback listeners of the machine, as it lays them out. */
    netstat?: string;
    /** Whether the listener already agreed to a restart. Default true: most tests are about the restart. */
    consented?: boolean;
    /** `tasklist` fails or hangs, as Windows' own tool does when it is busy: nothing says whether Spotify runs. */
    tasklistFails?: boolean;
};

const makeClient = (options: ClientOptions = {}) => {
    const { spawnProcess, spawned, procs } = makeSpawn();
    const runFile = vi.fn((file: string, _args: string[], _options: object, callback: (error: Error | null, stdout?: string) => void) => {
        if (String(file).includes('tasklist')) {
            if (options.tasklistFails) {
                callback(new Error('tasklist.exe timed out'), '');
                return;
            }
            callback(null, options.running === false ? 'INFO: No tasks are running' : '"Spotify.exe","1234","Console","1","120,000 K"');
            return;
        }
        if (String(file).includes('netstat')) {
            callback(null, options.netstat ?? '');
            return;
        }
        callback(null, '');
    });
    const fetch = vi.fn(async (url: string) => {
        if (String(url).includes('/json/version')) {
            return {
                ok: options.portAnswers === true,
                // What the port says about itself: Spotify's own DevTools endpoint names it.
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
    // A profile is what the app writes its DevTools port into: the caller's own folder when it named
    // one, else a folder of its own where the port file is put as the app would put it.
    const root = options.appDirectory
        ?? (options.activePort === undefined ? undefined : mkdtempSync(join(tmpdir(), 'folia-spotify-profile-')));
    if (root && options.activePort !== undefined) {
        const profile = join(root, 'Packages', 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0', 'LocalCache', 'Spotify');
        mkdirSync(profile, { recursive: true });
        writeFileSync(join(profile, 'DevToolsActivePort'), `${options.activePort}\n/devtools/browser/stand-in${NEWLINE}`);
    }
    const env = root ? { LOCALAPPDATA: root } : {};
    const warn = vi.fn();
    const log = vi.fn();
    // Whether the listener already agreed to Folia closing and starting Spotify again: a plain
    // object, so a test can answer no and then yes in the same run.
    const consent = { value: options.consented !== false };
    const client = createSpotifyOfficialClient({
        platform: 'win32', env, fetch, spawnProcess, runFile, waitFor, log, warn,
        port: options.port ?? 9283, restartConsented: () => consent.value,
    });
    // The script a PowerShell was started with: the file it was given as -File, read from the
    // repository. Nothing of a script is written on a command line any more.
    const scriptOf = (args: string[]) => {
        const at = args.indexOf('-File');
        return at < 0 ? '' : readFileSync(String(args[at + 1]), 'utf8');
    };
    // The script file a PowerShell was given, as the folder and name the test knows it by.
    const scriptNameOf = (args: string[]) => String(args[args.indexOf('-File') + 1] ?? '').split(/[\\/]/).pop() ?? '';
    const powershellSpawns = () => (spawnProcess.mock.calls as unknown as [string, string[]][])
        .filter(call => /powershell\.exe$/i.test(String(call[0])));
    // The window watcher of a start is a PowerShell of its own (windowWatch.ps1), not a helper.
    const watchSpawns = () => powershellSpawns().filter(call => scriptNameOf(call[1]) === 'windowWatch.ps1');
    const helperSpawns = () => powershellSpawns().filter(call => scriptNameOf(call[1]) === 'mediaSession.ps1').length;
    const spotifySpawns = () => spawned.filter(file => !/powershell\.exe$/i.test(file)).length;
    const taskkills = () => runFile.mock.calls.filter(call => String(call[0]).includes('taskkill')).length;
    const tasklists = () => runFile.mock.calls.filter(call => String(call[0]).includes('tasklist')).length;
    return { client, consent, runFile, spawnProcess, spawned, procs, fetch, log, warn, helperSpawns, watchSpawns, spotifySpawns, taskkills, tasklists, scriptOf };
};

beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.sockets = [];
    FakeSocket.failuresLeft = 0;
    FakeSocket.alwaysFail = false;
    FakeSocket.silent = false;
    FakeSocket.muteSend = false;
    FakeSocket.closeBeforeOpen = false;
    heldOp = null;
    spawnError = false;
    // The stand-in page runs nothing: a start is answered with the word the real page answers with,
    // and every other call with true.
    handle = expression => ({ value: expression.includes('window.__foliaPlay') ? 'loaded' : true });
    waitFor.mockClear();
    for (const key of Object.keys(mediaAnswers)) delete mediaAnswers[key];
    vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

// Spotify names the songs behind the one playing in one nextItems list, and it holds two kinds of
// song: what the listener queued there (provider 'queue', metadata.is_queued 'true') and the autoplay
// the app would go on to by itself (provider 'autoplay'). Only the first kind is a song of the queue;
// an entry of an older app, which marks neither, is taken as one rather than lost.
const idOfTrack = (letter: string) => letter.repeat(22);

/**
 * The app as it really names its queue: one nextItems list holds the songs really queued and the
 * autoplay beside them. A song is a song of the queue until it is put there as autoplay; what a
 * write puts in with addToQueue is a song of the queue afterwards.
 */
const appNamingQueue = (
    queued: string[], autoplay: string[], clearQueue: 'works' | 'noop' | 'none' = 'works',
    shape: 'marks' | 'old' | 'metadataOnly' = 'marks',
) => {
    const held: { id: string; provider: string | null }[] = [
        ...queued.map(id => ({ id: idOfTrack(id), provider: 'queue' })),
        ...autoplay.map(id => ({ id: idOfTrack(id), provider: 'autoplay' })),
    ];
    const added: string[] = [];
    const player: Record<string, unknown> = {
        getState: () => ({ nextItems: held.map(entry => {
            const queued = entry.provider === 'queue';
            if (shape === 'old') return { uri: 'spotify:track:' + entry.id };
            if (shape === 'metadataOnly') return { uri: 'spotify:track:' + entry.id, metadata: { is_queued: queued ? 'true' : 'false' } };
            return { uri: 'spotify:track:' + entry.id, provider: entry.provider, metadata: { is_queued: queued ? 'true' : 'false' } };
        }) }),
        // A song queued takes its place ahead of the autoplay, which is what the app does with it: the
        // queue it plays after this song comes before the songs it would go on to by itself.
        addToQueue: (entries: { uri: string }[]) => {
            for (const entry of entries) {
                added.push(entry.uri.slice(14));
                const queued = { id: entry.uri.slice(14), provider: 'queue' };
                const first = held.findIndex(held => held.provider !== 'queue');
                held.splice(first < 0 ? held.length : first, 0, queued);
            }
        },
    };
    // The app's own clear takes the songs queued, and the autoplay behind them stays: it is the app's
    // idea of what comes next, not a song of the queue.
    if (clearQueue === 'works') {
        player.clearQueue = async () => {
            for (let i = held.length - 1; i >= 0; i -= 1) if (held[i].provider === 'queue') held.splice(i, 1);
        };
    }
    if (clearQueue === 'noop') player.clearQueue = async () => {};
    return { api: { player }, held, added, ids: () => held.map(entry => entry.id) };
};

// --- the queue a start leaves alone, driven by a stand-in player -------------------------------

describe('the queue a start leaves of the listener\'s own', () => {
    const idOf = (letter: string) => letter.repeat(22);
    type Answer = { cleared?: boolean; canClear?: boolean | null; restored?: boolean; written: string[]; read: string[] | null };
    const startQueue = (new Function('return (' + String(START_QUEUE_SOURCE) + ')')()) as (input: unknown) => Promise<Answer>;

    /** A player holding `start` behind the song playing, with the queue API the test gives it. */
    const playerWith = (start: string[], clearQueue?: 'works' | 'noop') => {
        const held = start.map(idOf);
        const added: string[] = [];
        const player: Record<string, unknown> = {
            getState: () => ({ nextTracks: held.map(id => ({ uri: 'spotify:track:' + id })) }),
            addToQueue: (entries: { uri: string }[]) => {
                for (const entry of entries) { held.push(entry.uri.slice(14)); added.push(entry.uri.slice(14)); }
            },
        };
        if (clearQueue === 'works') player.clearQueue = async () => { held.length = 0; };
        if (clearQueue === 'noop') player.clearQueue = async () => {};
        return { api: { player }, held, added };
    };
    const call = (api: unknown, owned: string[] = []) => startQueue({ api, owned: owned.map(idOf) });

    it('keeps a song the listener queued in the app, where it was', async () => {
        // The listener queued one of their own in Spotify's window, then picked a song in Folia: a
        // start empties the queue for its own reason, and that song is not Folia's to take.
        const app = playerWith(['u'], 'works');
        const answer = await call(app.api);

        expect(answer.cleared).toBe(true);
        expect(answer.written).toEqual([]);
        expect(app.held).toEqual([idOf('u')]);
    });

    it('keeps every song the listener queued, in the order they were in', async () => {
        const app = playerWith(['u', 'v'], 'works');
        await call(app.api);
        expect(app.held).toEqual([idOf('u'), idOf('v')]);
    });

    it('leaves the listener\'s songs among Folia\'s where they were, and takes back only Folia\'s', async () => {
        // Folia wrote b and c behind this song, the listener put u between them: the two of Folia's
        // were played or are gone, and u keeps the place it held.
        const app = playerWith(['b', 'u'], 'works');
        await call(app.api, ['b']);
        expect(app.held).toEqual([idOf('u')]);
    });

    it('changes nothing where the app cannot empty its queue', async () => {
        // A queue that only grows: emptying it would be the only way to take a song back, so
        // nothing of the listener's is touched and nothing is written here.
        const app = playerWith(['u'], 'noop');
        const answer = await call(app.api, ['b']);

        expect(answer.cleared).toBe(false);
        expect(answer.canClear).toBe(false);
        expect(answer.written).toEqual([]);
        expect(app.held).toEqual([idOf('u')]);
        expect(app.added).toEqual([]);
    });

    it('says the songs could not be put back rather than failing the start', async () => {
        const app = playerWith(['u'], 'works');
        (app.api.player as Record<string, unknown>).addToQueue = () => { throw new Error('refused'); };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const answer = await call(app.api);
        // The start itself goes on: only the listener's songs are gone, and that is said.
        expect(answer.restored).toBe(false);
        expect(answer.written).toEqual([]);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('empties nothing where the app offers no clearQueue', async () => {
        const app = playerWith(['u'], undefined);
        const answer = await call(app.api, ['b']);

        expect(answer.cleared).toBe(false);
        expect(answer.written).toEqual([]);
        expect(app.held).toEqual([idOf('u')]);
    });

    // 清空之后读不出队列（getState 抛错、或几种名字都说不清）时，没有证据说这一份队列被清掉了：
    // 不能对整轮声称「能清」。QUEUE_SOURCE 在同样的情况下保留原来的判断（:206-219），这里照它来。
    it('claims nothing about emptying the queue where it cannot be read back', async () => {
        const held = [idOf('u')];
        let cleared = false;
        const api = { player: {
            getState: () => {
                // 清空之前读得出，清空之后就读不出了：这一份说不清，不是空的。
                if (cleared) throw new Error('the state is not readable now');
                return { nextTracks: held.map(id => ({ uri: 'spotify:track:' + id })) };
            },
            clearQueue: async () => { cleared = true; },
            addToQueue: () => { throw new Error('nothing may be put back: nothing is known to be gone'); },
        } };
        const answer = await call(api, ['b']);

        expect(answer.canClear).not.toBe(true);
        expect(answer.cleared).toBe(false);
    });

    // Spotify 把听众排的队列和自己往下接的推荐放在同一份 nextItems 里：排队的那首 provider 是 queue
    // （metadata.is_queued 也是 true），推荐是 autoplay。整份读进来会把四五十首推荐当成听众排的歌，
    // 清空之后永远「还剩歌」：整表替换一次也走不到，只能一首一首往后补。
    it('counts only the songs really queued, not the autoplay the app would go on to', async () => {
        const app = appNamingQueue(['u'], ['p', 'q']);
        const answer = await call(app.api);

        // 清空之后只剩推荐，队列是真的空了：这次起播算清掉了，听众排的那一首照旧放回原位。
        expect(answer.cleared).toBe(true);
        expect(answer.canClear).toBe(true);
        expect(answer.read).toEqual([idOf('u')]);
        expect(app.added).toEqual([idOf('u')]);
        expect(app.ids()).toEqual([idOf('u'), idOf('p'), idOf('q')]);
    });

    it('reads a queue of nothing but autoplay as the empty queue it is', async () => {
        // 一份只有推荐的队列就是空队列：没有听众的歌要放回，也不能读成「清空之后还留着歌」。
        const app = appNamingQueue([], ['p', 'q']);
        const answer = await call(app.api);

        expect(answer.cleared).toBe(true);
        expect(answer.canClear).toBe(true);
        expect(answer.read).toEqual([]);
        expect(app.added).toEqual([]);
    });

    it('still counts an entry that marks no provider, as an older app names its queue', async () => {
        // 没有 provider 也没有 is_queued 的一份数据说不清哪一首是推荐，就整份算作排队：宁可多留一首，
        // 也不能把听众自己排的歌当成推荐丢掉。
        const app = appNamingQueue(['u', 'v'], [], 'works', 'old');
        const answer = await call(app.api);

        expect(answer.cleared).toBe(true);
        expect(app.added).toEqual([idOf('u'), idOf('v')]);
    });
});


describe('the repeat and the shuffle a play changes in the page', () => {
    type Changed = { repeat: string | null; shuffle: boolean | null };
    const settle = (new Function('return (' + String(PLAY_STATE_SOURCE) + ')')()) as (input: unknown) => Promise<Changed>;

    /** A player that reports this repeat and shuffle, and records every call the source made on it. */
    const playerAt = (state: { repeat?: number; shuffle?: boolean; shuffleKnown?: boolean } = {}) => {
        const player: Record<string, unknown> = {
            calls: [] as string[],
            reads: 0,
            repeat: state.repeat ?? 0,
            shuffle: state.shuffle ?? false,
            getState() {
                (player.reads as number) += 1;
                const shown: Record<string, unknown> = { repeat: this.repeat };
                // A player that does not report a shuffle at all says nothing about it.
                if (state.shuffleKnown !== false) shown.shuffle = this.shuffle;
                return shown;
            },
            setRepeat: async (value: number) => { (player.calls as string[]).push('setRepeat ' + value); player.repeat = value; },
            setShuffle: async (value: boolean) => { (player.calls as string[]).push('setShuffle ' + value); player.shuffle = value; },
        };
        return player;
    };
    const settleWith = (player: Record<string, unknown>) => settle({ api: { player } });

    it('leaves a repeat that is off alone', async () => {
        const player = playerAt({ repeat: 0 });
        await expect(settleWith(player)).resolves.toEqual({ repeat: null, shuffle: null });
        expect(player.calls).toEqual([]);
    });

    it('turns a repeat of the track off, and says what it was', async () => {
        const player = playerAt({ repeat: 2 });
        // Repeat of the track is what stalls a handoff: the app replays this one whatever queue holds.
        await expect(settleWith(player)).resolves.toEqual({ repeat: 'one', shuffle: null });
        expect(player.calls).toEqual(['setRepeat 0']);
    });

    it('leaves a repeat of the list alone: one track is one track, list or not', async () => {
        // A play names a track uri and no context, which is what the page calls with, so the list
        // repeat has nothing to repeat here and the player's own setting is the listener's.
        const player = playerAt({ repeat: 1 });
        await expect(settleWith(player)).resolves.toEqual({ repeat: null, shuffle: null });
        expect(player.calls).toEqual([]);
    });

    it('turns a shuffle off, and says what it was', async () => {
        // Spotify's shuffle reorders the queue the app plays from: what Folia put behind this song
        // would come out in another order, so it is turned off for the order Folia wrote.
        const player = playerAt({ shuffle: true });
        await expect(settleWith(player)).resolves.toEqual({ repeat: null, shuffle: true });
        expect(player.calls).toEqual(['setShuffle false']);
    });

    it('leaves a shuffle that is already off alone', async () => {
        const player = playerAt({ shuffle: false });
        await expect(settleWith(player)).resolves.toEqual({ repeat: null, shuffle: null });
        expect(player.calls).toEqual([]);
    });

    it('leaves a shuffle a player does not report alone', async () => {
        const player = playerAt({ shuffleKnown: false });
        await expect(settleWith(player)).resolves.toEqual({ repeat: null, shuffle: null });
        expect(player.calls).toEqual([]);
    });

    it('changes both where both would stall the order, and says what each was', async () => {
        const player = playerAt({ repeat: 2, shuffle: true });
        await expect(settleWith(player)).resolves.toEqual({ repeat: 'one', shuffle: true });
        expect(player.calls).toEqual(['setRepeat 0', 'setShuffle false']);
    });

    it('says nothing it did not change where the player refuses the call', async () => {
        const player = playerAt({ repeat: 2 });
        player.setRepeat = async () => { throw new Error('refused'); };
        await expect(settleWith(player)).resolves.toEqual({ repeat: null, shuffle: null });
    });

    // Repeat one of Folia's is the app's own repeat of the track: a start made while Folia is in it
    // keeps that repeat or turns it on in this same call. Turning it off here and on again a moment
    // later (setTrackRepeat) would be two writes of one setting, and a read between them would see a
    // repeat that is neither.
    const settleInRepeatOneWith = async (player: Record<string, unknown>) => settle({ api: { player }, singleLoop: true });

    it('keeps a repeat of the track a start in repeat one finds', async () => {
        const player = playerAt({ repeat: 2 });
        await expect(settleInRepeatOneWith(player)).resolves.toMatchObject({ repeat: null, shuffle: null, left: 2 });
        expect(player.calls).toEqual([]);
    });

    it('turns the repeat of the track on for a start in repeat one, and keeps the value it found', async () => {
        const player = playerAt({ repeat: 0 });
        await expect(settleInRepeatOneWith(player)).resolves.toMatchObject({ repeat: 'off', shuffle: null, left: 2 });
        expect(player.calls).toEqual(['setRepeat 2']);
    });

    it('keeps a repeat of the list as the listener\'s own, and still repeats the track', async () => {
        const player = playerAt({ repeat: 1 });
        await expect(settleInRepeatOneWith(player)).resolves.toMatchObject({ repeat: 'all', left: 2 });
        expect(player.calls).toEqual(['setRepeat 2']);
    });

    it('says nothing was left where the player would not repeat the track', async () => {
        // A call the app refused wrote nothing: the value it found is the listener's own, so no
        // restore of a later play may take it for one Folia left behind.
        const player = playerAt({ repeat: 0 });
        player.setRepeat = async () => { throw new Error('refused'); };
        await expect(settleInRepeatOneWith(player)).resolves.toMatchObject({ repeat: null, left: null });
    });

    it('turns a shuffle off in a start in repeat one as well, and says so once', async () => {
        const player = playerAt({ repeat: 2, shuffle: true });
        await expect(settleInRepeatOneWith(player)).resolves.toMatchObject({ repeat: null, shuffle: true, left: 2 });
        expect(player.calls).toEqual(['setShuffle false']);
    });

    // A start in repeat one reads the player once: what it holds is the one account of both the value
    // it has to keep and the value it leaves, and a second read could only repeat the first - while
    // costing the page a round trip in the middle of a start.
    it('reads the player once, whatever it found and whatever it did', async () => {
        for (const repeat of [0, 1, 2]) {
            const player = playerAt({ repeat, shuffle: true });
            await settleInRepeatOneWith(player);
            expect(player.reads).toBe(1);
        }
        const refused = playerAt({ repeat: 0, shuffle: true });
        refused.setRepeat = async () => { throw new Error('refused'); };
        await settleInRepeatOneWith(refused);
        expect(refused.reads).toBe(1);
    });
});

describe('the repeat and the shuffle Folia put back', () => {
    /** What a play answers when the page changed this of the listener's state, as the real one does. */
    const playedWith = (changed: { repeat?: string | null; shuffle?: boolean | null }) => {
        handle = expression => ({ value: expression.includes('window.__foliaPlay')
            ? { answer: 'loaded', changed: { repeat: changed.repeat ?? null, shuffle: changed.shuffle ?? null } }
            : true });
    };

    it('keeps the original of each one it changed, and only those', async () => {
        playedWith({ repeat: 'one', shuffle: true });
        const app = makeClient({ running: true, portAnswers: true });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        expect(app.client.changedState()).toEqual({ repeat: 'one', shuffle: true });
        await app.client.close();
    });

    it('says in the log which repeat it found rather than calling them all the track', async () => {
        // The three values a play can find, each named as it was: off, the list, the track itself.
        for (const [repeat, words] of [['off', 'repeat that was off'], ['all', 'repeat of the list'], ['one', 'repeat of the track']]) {
            playedWith({ repeat });
            const app = makeClient({ running: true, portAnswers: true });
            await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
            const said = app.log.mock.calls.map(call => String(call[0]))
                .filter(line => line.includes('had to be changed for Folia\'s order'));
            expect(said).toEqual([expect.stringContaining(words)]);
            await app.client.close();
        }
        // The words are the ones `repeatNameOf` names the values with, and nothing else is one.
        expect([repeatWordsOf('off'), repeatWordsOf('all'), repeatWordsOf('one')]).toEqual(['repeat that was off', 'repeat of the list', 'repeat of the track']);
        expect(repeatWordsOf(null)).toBeNull();
    });

    it('keeps the first original of a run, never the one Folia itself set', async () => {
        playedWith({ repeat: 'one' });
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0 });
        // The app was left with repeat of the track off by the play before: a second play has
        // nothing of its own to change, and what the listener had is still the one first kept.
        playedWith({});
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        expect(app.client.changedState()).toEqual({ repeat: 'one', shuffle: null });
        await app.client.close();
    });

    it('puts both back, forgets them, and answers what was put back', async () => {
        playedWith({ repeat: 'one', shuffle: true });
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0 });
        const scripts: string[] = [];
        // The page put both back, as it answers when it could.
        handle = expression => {
            scripts.push(expression);
            return { value: { repeat: true, shuffle: true } };
        };

        await expect(app.client.restoreUserState()).resolves.toEqual({ repeat: null, shuffle: null });
        // What the page was told: repeat of the track (Spotify's 2) and a shuffle that was on.
        expect(scripts.some(script => script.includes('const repeat = 2') && script.includes('const shuffle = true'))).toBe(true);
        expect(app.client.changedState()).toEqual({ repeat: null, shuffle: null });
        await app.client.close();
    });

    it('forgets one the listener changed themselves meanwhile, rather than trying it again', async () => {
        playedWith({ repeat: 'one', shuffle: true });
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0 });
        // The page found both set to something else than what Folia left: they are the listener's
        // own now, and a record of them would only write over that at the next restore.
        handle = () => ({ value: { repeat: 'theirs', shuffle: 'theirs' } });

        await expect(app.client.restoreUserState()).resolves.toEqual({ repeat: null, shuffle: null });
        expect(app.client.changedState()).toEqual({ repeat: null, shuffle: null });
        await app.client.close();
    });

    it('keeps one the player refused, so it is tried again', async () => {
        playedWith({ repeat: 'one', shuffle: true });
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0 });
        // The page refused the repeat and took the shuffle.
        handle = () => ({ value: { repeat: false, shuffle: true } });

        await expect(app.client.restoreUserState()).resolves.toEqual({ repeat: 'one', shuffle: null });
        expect(app.client.changedState()).toEqual({ repeat: 'one', shuffle: null });
        await app.client.close();
    });

    it('has nothing to put back, and touches nothing, where it changed nothing', async () => {
        playedWith({});
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0 });
        const scripts: string[] = [];
        handle = expression => {
            scripts.push(expression);
            return { value: true };
        };

        await expect(app.client.restoreUserState()).resolves.toEqual({ repeat: null, shuffle: null });
        expect(scripts).toEqual([]);
        await app.client.close();
    });

    it('never starts or closes Spotify to put it back', async () => {
        playedWith({ repeat: 'one' });
        const app = makeClient({ running: true, portAnswers: true, appDirectory: makeLauncherDirectory() });
        await app.client.play({ id: TRACK, startMs: 0 });

        // Spotify was closed meanwhile: the state it had is gone with it, and starting it again to
        // put one setting back would be a bigger change than leaving it.
        FakeSocket.alwaysFail = true;
        await expect(app.client.restoreUserState()).resolves.toEqual({ repeat: 'one', shuffle: null });
        expect(app.spotifySpawns()).toBe(0);
        expect(app.taskkills()).toBe(0);
        await app.client.close();
    });

    it('reads back the value a start in repeat one left, so that value is what a restore compares against', async () => {
        // A start made in repeat one leaves the app repeating the track: what a restore finds then
        // is still Folia's, and the listener's own value goes back. A start of anything else leaves
        // it off, which is the other value that same record covers.
        handle = expression => ({
            value: expression.includes('window.__foliaPlay')
                ? { answer: 'loaded', changed: { repeat: 'off', shuffle: null, left: 2 } }
                : true,
        });
        const app = makeClient({ running: true, portAnswers: true });
        await expect(app.client.play({ id: TRACK, startMs: 0, singleLoop: true })).resolves.toEqual({ answer: 'loaded', repeat: 2 });
        expect(app.client.changedState()).toEqual({ repeat: 'off', shuffle: null });

        const scripts: string[] = [];
        handle = expression => {
            scripts.push(expression);
            return { value: { repeat: true, shuffle: false } };
        };
        await expect(app.client.restoreUserState()).resolves.toEqual({ repeat: null, shuffle: null });
        // The repeat goes to the value the listener had, and it is written only where the app still
        // holds the track repeat this run left.
        expect(scripts.some(script => script.includes('const repeat = 0') && script.includes('repeatExpected: 2'))).toBe(true);
        await app.client.close();
    });

    it('keeps no record where a start in repeat one could not write the repeat at all', async () => {
        // The listener's own repeat was off and the start could not write the track one: Folia left
        // nothing of it behind, so the value the app holds afterwards - theirs, set in Spotify's own
        // window - is not a value of Folia's to put back.
        handle = expression => ({
            value: expression.includes('window.__foliaPlay')
                ? { answer: 'loaded', changed: { repeat: null, shuffle: null, left: null } }
                : true,
        });
        const app = makeClient({ running: true, portAnswers: true });
        await expect(app.client.play({ id: TRACK, startMs: 0, singleLoop: true })).resolves.toEqual({ answer: 'loaded', repeat: null });
        expect(app.client.changedState()).toEqual({ repeat: null, shuffle: null });

        const scripts: string[] = [];
        handle = expression => {
            scripts.push(expression);
            return { value: { repeat: true, shuffle: false } };
        };
        await expect(app.client.restoreUserState()).resolves.toEqual({ repeat: null, shuffle: null });
        expect(scripts).toEqual([]);
        await app.client.close();
    });

    it('answers the repeat a start in repeat one left for the renderer, without changing the word it answers', async () => {
        handle = expression => ({
            value: expression.includes('window.__foliaPlay')
                ? { answer: 'loaded', changed: { repeat: 'off', shuffle: null, left: 2 } }
                : true,
        });
        const app = makeClient({ running: true, portAnswers: true });
        // The word a start has always answered stays the one it answers; the repeat rides beside it,
        // which is what tells the renderer the app's own repeat is the one repeating this song.
        await expect(app.client.play({ id: TRACK, startMs: 0, singleLoop: true })).resolves.toEqual({ answer: 'loaded', repeat: 2 });
        await app.client.close();
    });

    it('answers the repeat the app holds after a repeat of the track was written', async () => {
        handle = expression => {
            if (expression.includes('setRepeat(2)') || expression.includes('api.player.setRepeat')) return { value: { read: true, before: 0, now: 2 } };
            return { value: { answer: 'loaded', changed: {} } };
        };
        const app = makeClient({ running: true, portAnswers: true });
        await expect(app.client.setTrackRepeat({ on: true })).resolves.toEqual({ read: true, changed: true, now: 2 });
        await app.client.close();
    });

    it('answers no repeat where the app would not take the repeat of the track', async () => {
        handle = expression => {
            if (expression.includes('api.player.setRepeat')) return { value: { read: true, before: 0, now: 0 } };
            return { value: { answer: 'loaded', changed: {} } };
        };
        const app = makeClient({ running: true, portAnswers: true });
        await expect(app.client.setTrackRepeat({ on: true })).resolves.toEqual({ read: true, changed: false, now: 0 });
        await app.client.close();
    });

    it('answers a repeat put back as the value the restore left', async () => {
        handle = expression => ({
            value: expression.includes('window.__foliaPlay')
                ? { answer: 'loaded', changed: { repeat: 'off', shuffle: null, left: 2 } }
                : true,
        });
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0, singleLoop: true });
        handle = () => ({ value: { read: true, action: 'put', now: 0 } });
        // Put back: the listener's own value is written where the app still holds what Folia left.
        await expect(app.client.setTrackRepeat({ on: false })).resolves.toMatchObject({ read: true, now: 0 });
        await app.client.close();
    });

    it('leaves a repeat the listener set to something other than the track after a repeat one that wrote nothing', async () => {
        // The app would not take the repeat of the track: Folia wrote nothing, so a repeat of the
        // list the listener sets afterwards is theirs, and nothing writes over it. A repeat of the
        // track is the one value that would keep Folia from moving on, and it is turned off instead.
        handle = expression => ({
            value: expression.includes('window.__foliaPlay')
                ? { answer: 'loaded', changed: { repeat: null, shuffle: null, left: 0 } }
                : true,
        });
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0, singleLoop: true });
        // The listener turned the app's repeat to the list themselves after that start.
        const scripts: string[] = [];
        handle = expression => {
            scripts.push(expression);
            return { value: { read: true, action: 'theirs', now: 1 } };
        };
        await expect(app.client.setTrackRepeat({ on: false })).resolves.toMatchObject({ read: true, now: 1 });
        // One ask, which the page answers as a value of the listener's own: the record is done and
        // the value it holds is what the call answers.
        expect(scripts).toHaveLength(1);
        expect(app.client.changedState()).toEqual({ repeat: null, shuffle: null });
        await app.client.close();
    });

    it('leaves the shuffle for leaving this way of playing when repeat one goes off', async () => {
        // Repeat one going off puts the repeat right and nothing else: the shuffle belongs to leaving
        // this way of playing, and turning it back on here would reorder the queue Folia is about to
        // play from.
        handle = expression => ({
            value: expression.includes('window.__foliaPlay')
                ? { answer: 'loaded', changed: { repeat: 'off', shuffle: true, left: 0 } }
                : true,
        });
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0 });
        expect(app.client.changedState()).toEqual({ repeat: 'off', shuffle: true });

        const scripts: string[] = [];
        handle = expression => {
            scripts.push(expression);
            return { value: { read: true, action: 'theirs', now: 1 } };
        };
        await expect(app.client.setTrackRepeat({ on: false })).resolves.toMatchObject({ read: true });
        // The script asked for the repeat alone: the shuffle it turned off is still Folia's to put
        // back when this way of playing is left.
        expect(scripts.some(script => script.includes('const keep =') && !script.includes('setShuffle'))).toBe(true);
        expect(app.client.changedState()).toEqual({ repeat: null, shuffle: true });
        await app.client.close();
    });
});

describe('the listener\'s own repeat across one run', () => {
    // Repeat one going off runs the app's own source against the stand-in player, rather than a
    // second copy of its rules here: the order the record and the value held are read in is the
    // whole of that source's behaviour, and a stand-in that repeats it would pass whatever the
    // source did. Every call it makes on the player is recorded as a write of the page's own.
    const runRelease = (new Function('return (' + String(RELEASE_STATE_SOURCE) + ')')()) as
        (input: unknown) => Promise<{ read: boolean; action: string; now: number | null }>;

    /**
     * A stand-in page whose player holds one repeat value, as Spotify's own does: each call answers
     * the way the source it runs would, and every value written to it is recorded.
     */
    const pageOf = (initial: number) => {
        const state = { repeat: initial, scripts: [] as string[], written: [] as number[] };
        // The player the app's own source is given: the one repeat value the page holds.
        const player = {
            getState: () => ({ repeat: state.repeat }),
            setRepeat: async (value: number) => { state.repeat = value; state.written.push(value); },
        };
        handle = expression => {
            state.scripts.push(expression);
            const put = (value: number) => { state.repeat = value; state.written.push(value); };
            // The play: a start in repeat one keeps or turns on the app's repeat of the track, every
            // other start turns it off and keeps what it found.
            if (expression.includes('window.__foliaPlay')) {
                if (expression.includes('singleLoop: true')) {
                    const before = state.repeat;
                    if (before === 2) return { value: { answer: 'loaded', changed: { repeat: null, shuffle: null, left: 2 } } };
                    put(2);
                    return { value: { answer: 'loaded', changed: { repeat: before === 1 ? 'all' : 'off', shuffle: null, left: 2 } } };
                }
                if (state.repeat === 2) {
                    put(0);
                    return { value: { answer: 'loaded', changed: { repeat: 'one', shuffle: null } } };
                }
                return { value: { answer: 'loaded', changed: { repeat: null, shuffle: null } } };
            }
            // The restore that leaves this way of playing: the listener's own value goes back only
            // where the app still holds the one Folia left, and a value they set meanwhile is theirs.
            if (expression.includes('const shuffle =')) {
                const wanted = /const repeat = (\d+|null)/.exec(expression)?.[1] ?? 'null';
                const expected = Number(/repeatExpected: (\d+|null)/.exec(expression)?.[1] ?? 'null');
                if (wanted === 'null') return { value: { repeat: false, shuffle: false, read: true, now: state.repeat } };
                if (state.repeat !== expected) return { value: { repeat: 'theirs', shuffle: false, read: true, now: state.repeat } };
                put(Number(wanted));
                return { value: { repeat: true, shuffle: false, read: true, now: state.repeat } };
            }
            // Repeat one going off: the app's own source, run against this page's player. The record
            // and the value the run left go to it as the call writes them, so a source that reads
            // them in the wrong order is caught here rather than by a second copy of its rules.
            if (expression.includes('const keep =')) {
                const keep = /const keep = (null|\d+)/.exec(expression)?.[1] ?? 'null';
                const expected = Number(/expected: (null|\d+)/.exec(expression)?.[1] ?? '0');
                return runRelease({ api: { player }, keep: keep === 'null' ? null : Number(keep), expected })
                    .then(value => ({ value }));
            }
            // Repeat one handed to the app's own repeat of the track.
            const before = state.repeat;
            if (before !== 2) put(2);
            return { value: { read: true, before, now: 2 } };
        };
        return state;
    };

    it('turns the listener\'s own repeat off by a play, on for repeat one, and writes it back when that goes off', async () => {
        const state = pageOf(2);
        const app = makeClient({ running: true, portAnswers: true });

        // A song started in another mode: the app's repeat of the track would stall Folia's queue, so
        // it is turned off, and the value it was is kept as the listener's own.
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        expect(state.repeat).toBe(0);
        expect(app.client.changedState()).toEqual({ repeat: 'one', shuffle: null });

        // Repeat one while the song plays: the app's own repeat of the track goes on, and the value
        // kept is still the one the listener had.
        await expect(app.client.setTrackRepeat({ on: true })).resolves.toEqual({ read: true, changed: true, now: 2 });
        expect(state.repeat).toBe(2);
        expect(app.client.changedState()).toEqual({ repeat: 'one', shuffle: null });

        // Repeat one goes off: the app is not left repeating this song, and the value the listener
        // had goes back when this way of playing is left.
        await expect(app.client.setTrackRepeat({ on: false })).resolves.toMatchObject({ read: true, now: 0 });
        expect(state.repeat).toBe(0);
        expect(state.written).toEqual([0, 2, 0]);
        expect(app.client.changedState()).toEqual({ repeat: 'one', shuffle: null });

        // Leaving this way of playing puts their repeat of the track back, once.
        await expect(app.client.restoreUserState()).resolves.toEqual({ repeat: null, shuffle: null });
        expect(state.repeat).toBe(2);
        expect(state.written).toEqual([0, 2, 0, 2]);
        await app.client.close();
    });

    it('turns the app\'s own repeat off when repeat one goes off and the listener had it on themselves', async () => {
        // The listener had Spotify repeating the track before Folia started in repeat one, so the
        // start kept it and left no record. Repeat one going off may not leave it: the app would
        // sound this song again by itself and Folia would never move on. The value is theirs, so it
        // is kept as the one to put back and written out with the leaving.
        const state = pageOf(2);
        const app = makeClient({ running: true, portAnswers: true });
        await expect(app.client.play({ id: TRACK, startMs: 0, singleLoop: true })).resolves.toEqual({ answer: 'loaded', repeat: 2 });
        expect(app.client.changedState()).toEqual({ repeat: null, shuffle: null });

        await expect(app.client.setTrackRepeat({ on: false })).resolves.toEqual({ read: true, changed: false, now: 0 });
        expect(state.repeat).toBe(0);
        expect(state.written).toEqual([0]);
        expect(app.client.changedState()).toEqual({ repeat: 'one', shuffle: null });

        // Leaving this way of playing puts the repeat of the track back as it was.
        await expect(app.client.restoreUserState()).resolves.toEqual({ repeat: null, shuffle: null });
        expect(state.repeat).toBe(2);
        expect(state.written).toEqual([0, 2]);
        await app.client.close();
    });

    it('puts the value a record names back when repeat one goes off, rather than leaving the app repeating', async () => {
        // The listener's own repeat was a repeat of the list: the record says so, and that value is
        // what goes back - it repeats nothing by itself, so the app never stalls Folia's queue.
        const state = pageOf(1);
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0, singleLoop: true });
        expect(app.client.changedState()).toEqual({ repeat: 'all', shuffle: null });
        expect(state.repeat).toBe(2);

        await expect(app.client.setTrackRepeat({ on: false })).resolves.toEqual({ read: true, changed: false, now: 1 });
        expect(state.repeat).toBe(1);
        expect(state.written).toEqual([2, 1]);
        expect(app.client.changedState()).toEqual({ repeat: null, shuffle: null });
        await app.client.close();
    });

    it('puts a recorded repeat of the list back where the app is still repeating the track', async () => {
        // The listener had the list repeat before Folia started in repeat one, so the record names
        // it. The app is repeating the track when repeat one goes off: that is Folia's own write,
        // not a value of the listener's, so the record goes back rather than the track being turned
        // off. Turning it off would lose their list repeat and leave the app repeating nothing.
        const state = pageOf(1);
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0, singleLoop: true });
        expect(app.client.changedState()).toEqual({ repeat: 'all', shuffle: null });
        expect(state.repeat).toBe(2);

        // Repeat one handed to the app's own repeat, which is what it holds going off.
        await app.client.setTrackRepeat({ on: true });
        expect(state.repeat).toBe(2);

        await expect(app.client.setTrackRepeat({ on: false })).resolves.toEqual({ read: true, changed: false, now: 1 });
        expect(state.repeat).toBe(1);
        expect(state.written).toEqual([2, 1]);
        // The record is done: their value is back, so leaving this way of playing writes nothing.
        expect(app.client.changedState()).toEqual({ repeat: null, shuffle: null });
        const written = state.written.length;
        await app.client.restoreUserState();
        expect(state.written.length).toBe(written);
        expect(state.repeat).toBe(1);
        await app.client.close();
    });

    it('puts a recorded off back where the app is still repeating the track', async () => {
        // The listener had no repeat at all before Folia started in repeat one, and the record names
        // that. A repeat of the track found going off is the one Folia left, so what goes back is
        // their off, and nothing is left for the leaving to write.
        const state = pageOf(0);
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0, singleLoop: true });
        expect(app.client.changedState()).toEqual({ repeat: 'off', shuffle: null });
        expect(state.repeat).toBe(2);

        await expect(app.client.setTrackRepeat({ on: false })).resolves.toEqual({ read: true, changed: false, now: 0 });
        expect(state.repeat).toBe(0);
        expect(state.written).toEqual([2, 0]);
        expect(app.client.changedState()).toEqual({ repeat: null, shuffle: null });

        // Their off is already the app's: leaving this way of playing writes nothing.
        const written = state.written.length;
        await app.client.restoreUserState();
        expect(state.written.length).toBe(written);
        await app.client.close();
    });

    it('writes nothing and keeps what it has where repeat one going off cannot read the app', async () => {
        // Nothing is written over a state nobody can see, and what is to be put back stays for the
        // next call: the app repeating this song is cleared by a read, not by a guess.
        const state = pageOf(2);
        const app = makeClient({ running: true, portAnswers: true });
        await app.client.play({ id: TRACK, startMs: 0, singleLoop: true });
        const readable = handle;
        handle = expression => (expression.includes('const keep =')
            ? { value: { read: false, action: 'none', now: null } }
            : readable(expression));

        await expect(app.client.setTrackRepeat({ on: false })).resolves.toEqual({ read: false, changed: false, now: null });
        expect(state.repeat).toBe(2);
        expect(state.written).toEqual([]);
        expect(app.client.changedState()).toEqual({ repeat: null, shuffle: null });

        // The page answers again, and the write lands on the second ask.
        handle = readable;
        await expect(app.client.setTrackRepeat({ on: false })).resolves.toMatchObject({ read: true, now: 0 });
        expect(state.repeat).toBe(0);
        await app.client.close();
    });

    it('leaves the repeat the listener set themselves during repeat one, and writes nothing back', async () => {
        for (const theirs of [0, 1]) {
            const state = pageOf(2);
            const app = makeClient({ running: true, portAnswers: true });
            await app.client.play({ id: TRACK, startMs: 0 });
            await app.client.setTrackRepeat({ on: true });

            // They turned the app's repeat to this of their own while repeat one went on.
            state.repeat = theirs;
            const written = state.written.length;
            await expect(app.client.setTrackRepeat({ on: false })).resolves.toMatchObject({ read: true });
            // Their value is theirs: nothing is written over it, and the record goes all the same.
            expect(state.written.length).toBe(written);
            expect(state.repeat).toBe(theirs);
            expect(app.client.changedState()).toEqual({ repeat: null, shuffle: null });

            // What is left is still nothing: a restore after that writes nothing either.
            const scripts = state.scripts.length;
            await expect(app.client.restoreUserState()).resolves.toEqual({ repeat: null, shuffle: null });
            expect(state.scripts.length).toBe(scripts);
            await app.client.close();
        }
    });
});

describe('the repeat and the shuffle a restore puts back in the page', () => {
    type Restore = (input: unknown) => Promise<{ repeat: unknown; shuffle: unknown }>;
    const restore = (new Function('return (' + String(RESTORE_STATE_SOURCE) + ')')()) as Restore;

    /** A player that reports this repeat and shuffle, and records every call the source made on it. */
    const playerSaying = (state: { repeat?: number; shuffle?: boolean; unreadable?: boolean }) => {
        const player: Record<string, unknown> = {
            calls: [] as string[],
            repeat: state.repeat ?? 0,
            shuffle: state.shuffle ?? false,
            getState() {
                if (state.unreadable) throw new Error('the state is not readable now');
                return { repeat: player.repeat, shuffle: player.shuffle };
            },
            setRepeat: async (value: number) => { (player.calls as string[]).push('setRepeat ' + value); player.repeat = value; },
            setShuffle: async (value: boolean) => { (player.calls as string[]).push('setShuffle ' + value); player.shuffle = value; },
        };
        return player;
    };
    const restoreWith = (player: Record<string, unknown>, repeat: number | null, shuffle: boolean) =>
        restore({ api: { player }, repeat, shuffle });

    it('puts the repeat of the track back where it is still the one Folia turned off', async () => {
        // Folia left the app with repeat off; nothing came between that and the restore.
        const player = playerSaying({ repeat: 0 });
        await expect(restoreWith(player, 2, false)).resolves.toMatchObject({ repeat: true });
        expect(player.calls).toEqual(['setRepeat 2']);
    });

    it('leaves alone a repeat the listener set to the list meanwhile', async () => {
        // The listener had repeat of the track, Folia turned it off, and they then asked for the
        // list: that is a setting of their own made after the play, not Folia's to undo.
        const player = playerSaying({ repeat: 1 });
        await expect(restoreWith(player, 2, false)).resolves.toMatchObject({ repeat: 'theirs' });
        expect(player.calls).toEqual([]);
    });

    it('leaves alone a repeat the listener turned to the track again meanwhile', async () => {
        const player = playerSaying({ repeat: 2 });
        await expect(restoreWith(player, 2, false)).resolves.toMatchObject({ repeat: 'theirs' });
        expect(player.calls).toEqual([]);
    });

    it('turns a shuffle back on where it is still the off Folia left it as', async () => {
        const player = playerSaying({ shuffle: false });
        await expect(restoreWith(player, null, true)).resolves.toMatchObject({ shuffle: true });
        expect(player.calls).toEqual(['setShuffle true']);
    });

    it('leaves alone a shuffle the listener turned on meanwhile', async () => {
        const player = playerSaying({ shuffle: true });
        await expect(restoreWith(player, null, true)).resolves.toMatchObject({ shuffle: 'theirs' });
        expect(player.calls).toEqual([]);
    });

    it('changes nothing at all where the player state cannot be read, and says so', async () => {
        // Without a state there is no sign the value is still Folia's, so both are kept for the next
        // restore rather than written over a setting the listener may have made after the play.
        const player = playerSaying({ unreadable: true });
        await expect(restoreWith(player, 2, true)).resolves.toMatchObject({ repeat: false, shuffle: false, read: false });
        expect(player.calls).toEqual([]);
    });

    it('touches only what the play changed', async () => {
        const player = playerSaying({ repeat: 1, shuffle: true });
        await expect(restoreWith(player, null, false)).resolves.toMatchObject({ repeat: false, shuffle: false });
        expect(player.calls).toEqual([]);
    });
});

describe('repeat one carried out by Spotify\'s own repeat of the track', () => {
    type Repeat = (input: unknown) => Promise<{ read: boolean; before: number | null; now: number | null }>;
    const turnOn = (new Function('return (' + String(REPEAT_TRACK_SOURCE) + ')')()) as Repeat;


    /** A player that reports this repeat and records every call the source made on it. */
    const playerRepeating = (state: { repeat?: number | null; unreadable?: boolean; refuses?: boolean }) => {
        const player: Record<string, unknown> = {
            calls: [] as string[],
            repeat: state.repeat ?? 0,
            getState() {
                if (state.unreadable) throw new Error('the state is not readable now');
                return { repeat: player.repeat };
            },
            setRepeat: async (value: number) => {
                if (state.refuses) throw new Error('refused');
                (player.calls as string[]).push('setRepeat ' + value);
                player.repeat = value;
            },
        };
        return player;
    };

    it('turns repeat of the track on and says what it was', async () => {
        const player = playerRepeating({ repeat: 0 });
        await expect(turnOn({ api: { player } })).resolves.toEqual({ read: true, before: 0, now: 2 });
        expect(player.calls).toEqual(['setRepeat 2']);
    });

    it('leaves a repeat of the track it already holds alone', async () => {
        const player = playerRepeating({ repeat: 2 });
        await expect(turnOn({ api: { player } })).resolves.toEqual({ read: true, before: 2, now: 2 });
        expect(player.calls).toEqual([]);
    });

    it('keeps a repeat of the list it found, and still turns the track on', async () => {
        // A play names one track uri and no context, so repeat of the track repeats this song and
        // nothing else: the list repeat it found is what goes back when repeat one goes off.
        const player = playerRepeating({ repeat: 1 });
        await expect(turnOn({ api: { player } })).resolves.toEqual({ read: true, before: 1, now: 2 });
        expect(player.calls).toEqual(['setRepeat 2']);
    });

    it('changes nothing, and says it could read nothing, where the player will not say', async () => {
        const player = playerRepeating({ unreadable: true });
        await expect(turnOn({ api: { player } })).resolves.toEqual({ read: false, before: null, now: null });
        expect(player.calls).toEqual([]);
    });

    it('says the repeat is still off where the player refuses the call', async () => {
        const player = playerRepeating({ repeat: 0, refuses: true });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(turnOn({ api: { player } })).resolves.toEqual({ read: true, before: 0, now: 0 });
        warn.mockRestore();
    });
});

describe('the repeat of the track given back when repeat one goes off', () => {
    type Release = (input: unknown) => Promise<{ read: boolean; action: string; now: number | null }>;
    const release = (new Function('return (' + String(RELEASE_STATE_SOURCE) + ')')()) as Release;

    /** A player that reports this repeat and records every call the source made on it. */
    const playerHolding = (repeat: number, { refuses = false }: { refuses?: boolean } = {}) => {
        const player: Record<string, unknown> = {
            calls: [] as string[],
            repeat,
            getState() { return { repeat: player.repeat }; },
            setRepeat: async (value: number) => {
                if (refuses) throw new Error('refused');
                (player.calls as string[]).push('setRepeat ' + value);
                player.repeat = value;
            },
        };
        return player;
    };

    it('puts a recorded value back even where the app is still repeating the track', async () => {
        // Folia left the app repeating the track for a repeat one of its own, and the listener had
        // the list repeat before the run. Repeat one going off finds the track still repeating: that
        // is Folia's own write, so the record decides what becomes of it - their list repeat goes
        // back rather than being turned off, and turning it off would lose what they had.
        const player = playerHolding(2);
        await expect(release({ api: { player }, keep: 1, expected: 2 })).resolves.toEqual({ read: true, action: 'put', now: 1 });
        expect(player.calls).toEqual(['setRepeat 1']);
        expect(player.repeat).toBe(1);
    });

    it('turns it off with no record either, as the one value nothing may be left on', async () => {
        // Nothing of the listener's was recorded, and the app is repeating the track: there is no
        // value of theirs to write back, and the track is what Folia cannot play on from.
        const player = playerHolding(2);
        await expect(release({ api: { player }, keep: null, expected: 2 })).resolves.toEqual({ read: true, action: 'release', now: 0 });
        expect(player.calls).toEqual(['setRepeat 0']);
    });

    it('turns it off where the record names the track itself', async () => {
        // A record naming the track is the listener's own repeat of it, and it is no value to write
        // back either: writing it on would hand this song to Spotify to sound again.
        const player = playerHolding(2);
        await expect(release({ api: { player }, keep: 2, expected: 2 })).resolves.toEqual({ read: true, action: 'release', now: 0 });
        expect(player.calls).toEqual(['setRepeat 0']);
    });

    it('puts a recorded value back where the app still holds what Folia left', async () => {
        const player = playerHolding(0);
        await expect(release({ api: { player }, keep: 1, expected: 0 })).resolves.toEqual({ read: true, action: 'put', now: 1 });
        expect(player.calls).toEqual(['setRepeat 1']);
    });

    it('leaves a value the listener set meanwhile alone where it repeats nothing by itself', async () => {
        // The list repeat is the listener's own, and it does not hold this song: nothing is written.
        const player = playerHolding(1);
        await expect(release({ api: { player }, keep: 0, expected: 0 })).resolves.toEqual({ read: true, action: 'theirs', now: 1 });
        expect(player.calls).toEqual([]);
    });

    it('never writes a recorded repeat of the track on, since that is what stalls Folia', async () => {
        // The record names the listener's own repeat of the track, and the app still holds what
        // Folia left - which is no repeat at all. Writing the track's repeat back would hand the
        // song to Spotify to play again, so nothing is written: the value holding it was never left.
        const player = playerHolding(0);
        await expect(release({ api: { player }, keep: 2, expected: 0 })).resolves.toEqual({ read: true, action: 'none', now: 0 });
        expect(player.calls).toEqual([]);
    });

    it('writes nothing and says it could read nothing where the state cannot be read', async () => {
        const player = playerHolding(2);
        player.getState = () => { throw new Error('the state is not readable now'); };
        await expect(release({ api: { player }, keep: 1, expected: 0 })).resolves.toEqual({ read: false, action: 'none', now: null });
        expect(player.calls).toEqual([]);
    });
});

describe('what a call may do to Spotify', () => {
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

    it('does not start Spotify on top of one that may be running when the restart was never agreed to', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        // tasklist failed or ran out of its two seconds: nothing on this computer says whether Spotify
        // is up. The app the listener opened is theirs, so a start that may land on top of it is the
        // same question a restart is.
        const app = makeClient({ tasklistFails: true, portAnswers: false, appDirectory: makeLauncherDirectory(), consented: false });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({
            code: 'unavailable', reason: 'player-restart-consent',
        });
        expect(app.taskkills()).toBe(0);
        expect(app.spotifySpawns()).toBe(0);
        await app.client.close();
    });

    it('starts Spotify when tasklist cannot say whether it runs and the listener already agreed', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ tasklistFails: true, portAnswers: false, appDirectory: makeLauncherDirectory(), consented: true });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        expect(app.taskkills()).toBe(0);
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

    it('does not close a Spotify the listener runs when the restart was never agreed to', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory(), consented: false });
        // Spotify is the listener's, running without Folia's port: closing it is a question they have
        // not answered, so the call stops where it stands and names that answer as its reason.
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({
            code: 'unavailable', reason: 'player-restart-consent',
        });
        expect(app.taskkills()).toBe(0);
        expect(app.spotifySpawns()).toBe(0);
        await app.client.close();
    });

    it('closes and starts Spotify once the listener agreed, and remembers the answer for the run', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory(), consented: false });
        await expect(app.client.launch()).rejects.toMatchObject({ reason: 'player-restart-consent' });
        expect(app.taskkills()).toBe(0);
        // The listener said yes while the player was still up: the next press goes ahead.
        app.consent.value = true;
        await expect(app.client.launch()).resolves.toBe(true);
        expect(app.taskkills()).toBe(1);
        expect(app.spotifySpawns()).toBe(1);
        await app.client.close();
    });

    it('plays at once when the listener agrees after a play was stopped for the question', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory(), consented: false });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({ code: 'unavailable', reason: 'player-restart-consent' });
        expect(app.taskkills()).toBe(0);

        // The listener said yes in the question that play raised: that play goes ahead at once.
        // Spotify was not touched by the start that was never made, so there is no cool-down of a
        // failed start to wait out, and the app is closed and started again as they agreed.
        app.consent.value = true;
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        expect(app.taskkills()).toBe(1);
        expect(app.spotifySpawns()).toBe(1);
        await app.client.close();
    });

    it('still asks before a play that follows a wake-up stopped for the question', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory(), consented: false });
        // The wake-up at launch (client_launch) and a play are the same start: the listener has not
        // agreed to a restart, so the wake-up stops where it stands. The renderer swallows that
        // failure, and the first song is what tells the listener about it.
        await expect(app.client.launch()).rejects.toMatchObject({ code: 'unavailable', reason: 'player-restart-consent' });
        expect(app.taskkills()).toBe(0);
        expect(app.spotifySpawns()).toBe(0);

        // That wake-up was not a start that failed: Spotify was never touched, so there is no
        // cool-down to wait out. The play must raise the question in its own words rather than
        // report an app it cannot reach, or the listener is never asked.
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({
            code: 'unavailable', reason: 'player-restart-consent',
        });
        expect(app.taskkills()).toBe(0);
        expect(app.spotifySpawns()).toBe(0);
        await app.client.close();
    });

    it('still holds a play back for thirty seconds after a start that really failed', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        playerNeverFound(() => true);
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({ code: 'unavailable', reason: 'player-not-found' });
        expect(app.spotifySpawns()).toBe(1);

        // That start failed for real: the page loaded and showed no player. A play a moment later is
        // told the app cannot be reached instead of starting it once more.
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({
            code: 'unavailable', message: 'The Spotify app cannot be reached',
        });
        expect(app.spotifySpawns()).toBe(1);

        // Past the cool-down, a play starts it again.
        vi.setSystemTime(Date.now() + 31000);
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({ code: 'unavailable', reason: 'player-not-found' });
        expect(app.spotifySpawns()).toBe(2);
        await app.client.close();
    });

    it('starts a Spotify that is not running without asking anything', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory(), consented: false });
        // Nothing is closed, so there is no question to answer: the app is only started.
        await expect(app.client.launch()).resolves.toBe(true);
        expect(app.taskkills()).toBe(0);
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

    // The wait for the player belongs to the page, not to the way the start began: a build whose UI
    // changed answers no player at all however long it is waited for, and the wait for the app and its
    // page is a different wait from the one for the player inside it. A press is held to the short
    // wait once the page says it has finished loading - a cold start, a Spotify closed and started
    // again, and a Spotify already running alike - and a page still loading keeps the whole of the
    // long one.
    const playerNeverFound = (loaded: () => boolean, found: () => boolean = () => false) => {
        handle = expression => {
            if (expression.includes('window.__foliaPlay')) return { details: 'Error: player-unavailable' };
            if (expression.includes('document.readyState')) return { value: loaded() };
            return { value: found() };
        };
    };

    it('ends a cold start whose page loaded but showed no player after eight seconds', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        playerNeverFound(() => true);
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        const startedAt = Date.now();
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({ code: 'unavailable', reason: 'player-not-found' });
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(8000);
        expect(Date.now() - startedAt).toBeLessThan(15000);
        await app.client.close();
    });

    it('gives the same eight seconds to a Spotify it closed and started again', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        playerNeverFound(() => true);
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        const startedAt = Date.now();
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({ code: 'unavailable', reason: 'player-not-found' });
        expect(app.taskkills()).toBe(1);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(8000);
        expect(Date.now() - startedAt).toBeLessThan(15000);
        await app.client.close();
    });

    it('gives the same eight seconds to a Spotify it joined, without closing or starting it', async () => {
        playerNeverFound(() => true);
        const app = makeClient({ running: true, portAnswers: true });
        const startedAt = Date.now();
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({ code: 'unavailable', reason: 'player-not-found' });
        expect(app.taskkills()).toBe(0);
        expect(app.spotifySpawns()).toBe(0);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(8000);
        expect(Date.now() - startedAt).toBeLessThan(15000);
        await app.client.close();
    });

    // 页面说加载完了就算加载完：不靠 app 里某个 id（Spotify 改版会换掉它，那时这个判断永远为假，
    // 于是一路空等到第一段的上限）。这里页面 complete、body 在，但既没有 #main 也找不到播放器。
    it('ends within eight seconds without an element id it was never promised', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const asked: string[] = [];
        handle = expression => {
            asked.push(expression);
            if (expression.includes('window.__foliaPlay')) return { details: 'Error: player-unavailable' };
            if (expression.includes('document.readyState')) {
                // 一个改过版的界面：complete 与 body 都在，但界面里那个 id 已经没有了。
                // 只有不去问元素 id 的写法才判得出来「页面加载完了」。
                return { value: !expression.includes('getElementById') };
            }
            return { value: false };
        };
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        const startedAt = Date.now();
        await expect(app.client.play({ id: TRACK, startMs: 0 })).rejects.toMatchObject({ code: 'unavailable', reason: 'player-not-found' });
        // 短的那一段照样是 8 秒：不是空等完 25 秒才知道找不到播放器。
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(8000);
        expect(Date.now() - startedAt).toBeLessThan(15000);
        const askedLoaded = asked.filter(expression => expression.includes('document.readyState'));
        expect(askedLoaded.length).toBeGreaterThan(0);
        for (const expression of askedLoaded) expect(expression).not.toContain('getElementById');
        await app.client.close();
    });

    it('keeps its long wait for a page that is still loading', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const startedAt = Date.now();
        // The page says it is loaded long after the start, and its player shows up past the short
        // wait: the short wait is counted from the page, not from the start.
        const loadedAt = startedAt + 18000;
        const playerAt = startedAt + 23000;
        handle = expression => {
            if (expression.includes('window.__foliaPlay')) return { value: 'loaded' };
            if (expression.includes('document.readyState')) return { value: Date.now() >= loadedAt };
            return { value: Date.now() >= playerAt };
        };
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20000);
        await app.client.close();
    });

    it('keeps its long wait for a page that never loads', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        playerNeverFound(() => false);
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        const startedAt = Date.now();
        await expect(app.client.launch()).rejects.toMatchObject({ code: 'unavailable', reason: 'player-not-found' });
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20000);
        await app.client.close();
    });

    it('tells whether the app is installed without starting it', async () => {
        const installed = makeClient({ appDirectory: makeLauncherDirectory() });
        expect(installed.client.available()).toEqual({ available: true });
        expect(installed.spawned).toEqual([]);
        const missing = makeClient({ appDirectory: mkdtempSync(join(tmpdir(), 'folia-empty-')) });
        expect(missing.client.available()).toEqual({ available: false, reason: 'not-installed' });
        await installed.client.close();
        await missing.client.close();
    });

    it('runs Windows own tools by their absolute path', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        const tools = app.runFile.mock.calls.map(call => String(call[0]));
        expect(tools.some(file => file.endsWith('tasklist.exe') && file.includes('System32'))).toBe(true);
        expect(tools.some(file => file.endsWith('taskkill.exe') && file.includes('System32'))).toBe(true);
        await app.client.close();
    });
});

describe('letting the player go', () => {
    const openSockets = () => FakeSocket.sockets.filter(socket => !socket.closed);
    // The page answers everything, and the media session answers what the page cannot: the helper is
    // started only for a call that goes to it, so one is forced there on purpose.
    const steerBothWays = async (app: ReturnType<typeof makeClient>) => {
        handle = () => ({ value: true });
        await app.client.status();
        expect(openSockets().length).toBe(1);
        handle = () => ({ details: 'Error: the page does not answer' });
        mediaAnswers.pause = true;
        await expect(app.client.pause()).resolves.toBe(true);
        expect(app.helperSpawns()).toBe(1);
    };

    it('ends the media session helper and the DevTools connection, and builds both again on the next call', async () => {
        const app = makeClient({ running: true, portAnswers: true });
        await steerBothWays(app);

        await app.client.release();

        // Both are let go: the PowerShell helper is ended, and the DevTools connection is closed.
        expect(app.procs.every((proc: any) => proc.kill.mock.calls.length > 0)).toBe(true);
        expect(openSockets().length).toBe(0);
        // Spotify itself is not closed: letting the player go is not the listener closing it.
        expect(app.taskkills()).toBe(0);

        // Used again, both are made again: the page is opened, and a fresh helper answers.
        handle = () => ({ value: true });
        await app.client.status();
        expect(openSockets().length).toBe(1);
        handle = () => ({ details: 'Error: the page does not answer' });
        mediaAnswers.pause = true;
        await expect(app.client.pause()).resolves.toBe(true);
        expect(app.helperSpawns()).toBe(2);
        await app.client.close();
    });

    it('lets go of what was never started without failing', async () => {
        const app = makeClient({ running: false, portAnswers: false });
        await expect(app.client.release()).resolves.toBeUndefined();
        expect(app.helperSpawns()).toBe(0);
        expect(openSockets().length).toBe(0);
        await app.client.close();
    });
});

describe('the player cached in the page', () => {
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

describe('the DevTools connection', () => {
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

describe('the bridge over the official client', () => {
    const makeBridge = (officialClient: any, now = () => 0) => createSpotifyApiBridge({
        store: { get: () => undefined, set: () => {}, delete: () => {} }, safeStorage: {}, fetch: vi.fn(),
        openExternal: vi.fn(), officialClient, now, log: () => {}, warn: () => {},
    });
    const makeOfficialClient = () => ({
        launch: vi.fn(async () => true), restart: vi.fn(async () => true), play: vi.fn(async () => true),
        queue: vi.fn(async () => 0), pause: vi.fn(async () => true), resume: vi.fn(async () => true),
        seek: vi.fn(async () => true), setVolume: vi.fn(async () => true), status: vi.fn(async () => ({ id: TRACK })),
        setTrackRepeat: vi.fn(async () => ({ read: true, changed: false, now: 2 })),
        available: vi.fn(() => ({ available: true })), closeForQuit: vi.fn(async () => true), close: vi.fn(async () => {}),
    });

    it('keeps the answer about the installed app instead of asking before every song', async () => {
        const officialClient = makeOfficialClient();
        const bridge = makeBridge(officialClient, () => 0);
        expect(await bridge.request('client_probe')).toEqual({ ok: true, data: { available: true } });
        expect(await bridge.request('client_probe')).toEqual({ ok: true, data: { available: true } });
        expect(officialClient.available).toHaveBeenCalledTimes(1);
        await bridge.shutdown();
    });

    it('offers no operation the renderer never called', async () => {
        const officialClient = makeOfficialClient();
        const bridge = makeBridge(officialClient);
        for (const operation of ['client_next', 'client_previous', 'client_shuffle']) {
            expect(SPOTIFY_OPERATIONS).not.toContain(operation);
            expect(await bridge.request(operation, {})).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        }
        await bridge.shutdown();
    });

    it('closes Spotify at the quit only when the setting asked for it', async () => {
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
        expect(await bridge.request('client_repeat', { on: true })).toMatchObject({ ok: true, data: { now: 2 } });
        expect(officialClient.setTrackRepeat).toHaveBeenCalledWith({ on: true });
        // Only a plain true turns the repeat of the track on; anything else is a write of off.
        expect(await bridge.request('client_repeat', { on: 'true' })).toMatchObject({ ok: true });
        expect(officialClient.setTrackRepeat).toHaveBeenLastCalledWith({ on: false });
        expect(await bridge.request('client_pause')).toMatchObject({ ok: true });
        expect(officialClient.pause).toHaveBeenCalled();
        // A call the app refused reaches the renderer as the code it gave, not as a success.
        officialClient.play.mockRejectedValueOnce(spotifyError('unavailable', 'The Spotify app is not installed'));
        expect(await bridge.request('client_play', { id: TRACK })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        await bridge.shutdown();
    });
});

describe('what the app\'s failures mean for Folia', () => {
    it('says the player was not found inside the app apart from the app not being installed', () => {
        expect(describeSpotifyFailure('audio', new OnlineProviderError('unavailable', 'x', 'spotify', 'player-not-found')))
            .toEqual({ case: 'unreachable', playerCause: 'player-not-found' });
        expect(describeSpotifyFailure('audio', new OnlineProviderError('unavailable', 'x', 'spotify', 'player-not-installed')))
            .toEqual({ case: 'not-configured', playerCause: 'player-not-installed' });
        // The app not being on this computer is the same answer it always was: a source not set up.
        expect(describeSpotifyFailure('audio', new OnlineProviderError('unavailable', 'x', 'spotify', 'client-missing')))
            .toEqual({ case: 'not-configured' });
    });

    it('says the listener has not agreed to close their Spotify, and stops where it is', () => {
        const said = describeSpotifyFailure('audio', new OnlineProviderError('unavailable', 'x', 'spotify', 'player-restart-consent'));
        expect(said).toEqual({ case: 'not-configured', playerCause: 'player-restart-consent' });
        const shown = onlineFailureOf({ operation: 'audio', providerId: 'spotify' }, { detail: said! });
        expect(shown.facts.playerCause).toBe('player-restart-consent');
        expect(stopsPlayback(shown)).toBe(true);
    });

    it('keeps a player cause it does not know out of the failure it shows', () => {
        const shown = onlineFailureOf({ operation: 'audio', providerId: 'spotify' }, {
            detail: { case: 'unreachable', playerCause: 'player-went-for-a-walk' as never },
        });
        expect(shown.facts.playerCause).toBeUndefined();
    });
});

describe('closing Spotify at the quit', () => {
    // main.cjs cannot be imported (requiring it boots the app), so what it hands the bridges is read
    // from the file itself, the way test/unit/electron/ipcSecurity.test.ts pins its own wiring.
    const mainCjs = readFileSync(join(import.meta.dirname, '../../../electron/main.cjs'), 'utf8');

    it('closes the player at the quit for a listener who never set the switch', async () => {
        const client = {
            launch: vi.fn(async () => true), restart: vi.fn(async () => true), play: vi.fn(async () => true),
            queue: vi.fn(async () => 0), pause: vi.fn(async () => true), resume: vi.fn(async () => true),
            seek: vi.fn(async () => true), setVolume: vi.fn(async () => true), status: vi.fn(async () => ({ id: TRACK })),
            available: vi.fn(() => ({ available: true })), closeForQuit: vi.fn(async () => true), close: vi.fn(async () => {}),
        };
        // The switch is the main process's to read, and a listener who never set it reads as on:
        // only a stored false turns it off.
        const site = mainCjs.match(/const closePlayerOnQuit = store\.get\(CLOSE_EXTERNAL_PLAYER_ON_QUIT_SETTING_KEY\)[^;]*;/)?.[0] ?? '';
        expect(site).not.toBe('');
        expect(site).toContain('!== false');
        expect(site).not.toContain('=== true');
        // And a session held for it is the one that closes the app.
        const bridge = createSpotifyApiBridge({
            store: { get: () => undefined, set: () => {}, delete: () => {} }, safeStorage: {}, fetch: vi.fn(),
            openExternal: vi.fn(), officialClient: client, now: () => 0, log: () => {}, warn: () => {},
        });
        await expect(bridge.shutdown({ closePlayerOnQuit: true })).resolves.toBeUndefined();
        expect(client.closeForQuit).toHaveBeenCalled();
    });

    it('keeps the store key the renderer writes', () => {
        expect(mainCjs).toContain("const CLOSE_EXTERNAL_PLAYER_ON_QUIT_SETTING_KEY = 'CLOSE_EXTERNAL_PLAYER_ON_QUIT';");
    });
});

describe('the quit, the helper and the port', () => {
    const makeBridge = (officialClient: any) => createSpotifyApiBridge({
        store: { get: () => undefined, set: () => {}, delete: () => {} }, safeStorage: {}, fetch: vi.fn(),
        openExternal: vi.fn(), officialClient, now: () => 0, log: () => {}, warn: () => {},
    });

    it('closes Spotify when the port answering is Spotify itself, and leaves the port alone otherwise', async () => {
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

    it('closes the Spotify this run started, even with no port answering', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        // One restart to get the port, and then the quit closes what this run started.
        expect(app.taskkills()).toBe(1);
        app.fetch.mockImplementation((async () => ({ ok: false, json: async () => ({}) })) as never);
        await expect(app.client.closeForQuit()).resolves.toBe(true);
        expect(app.taskkills()).toBe(2);
    });

    it('does not take a start made on top of an unseen Spotify for one of its own', async () => {
        // tasklist says nothing about whether Spotify runs, and the listener agreed to a restart: the
        // start is made on top of whatever is there, which is the launcher handing the command line to
        // an app that may already be up. Nothing there proves this run started it, so the quit must not
        // close it as the app this run started.
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ tasklistFails: true, portAnswers: false, appDirectory: makeLauncherDirectory(), consented: true });
        await expect(app.client.play({ id: TRACK, startMs: 0 })).resolves.toBe('loaded');
        expect(app.taskkills()).toBe(0);
        expect(app.spotifySpawns()).toBe(1);

        // The DevTools port answers for nobody at the quit either: with nothing saying Folia started
        // that Spotify, there is nothing to close.
        app.fetch.mockImplementation((async () => ({ ok: false, json: async () => ({}) })) as never);
        await expect(app.client.closeForQuit()).resolves.toBe(false);
        expect(app.taskkills()).toBe(0);
    });

    it('does not close a Spotify this run started and the listener closed meanwhile', async () => {
        // The page cannot be reached at first, so the play starts Spotify with the port, as a
        // listener's play may.
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

    it('does not ask the bridges to shut down twice for one quit', async () => {
        // The flag lives in main.cjs, which the bridge cannot see: what is pinned here is the one
        // wire the flag leans on — a shutdown that already finished answers nothing to hold, and a
        // second call is what main.cjs must not make.
        const officialClient: any = { close: vi.fn(async () => {}), closeForQuit: vi.fn(async () => true) };
        const bridge = makeBridge(officialClient);
        expect(await bridge.shutdown()).toBeNull();
        expect(officialClient.closeForQuit).not.toHaveBeenCalled();
    });

    it('ends the quit within its limit even when taskkill hangs', async () => {
        const app = makeClient({ portAnswers: true });
        const timeouts: unknown[] = [];
        app.runFile.mockImplementation((file: string, args: string[], options: { timeout?: number }) => {
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

    it('narrows what it waits for so the taskkill is issued inside the quit gate', async () => {
        const app = makeClient({ port: 0, portAnswers: true });
        const startedAt = Date.now();
        let netstatTimeout = 0;
        let taskkillTimeout = 0;
        let taskkillAt = 0;
        app.runFile.mockImplementation((file: string, _args: string[], options: { timeout?: number }, callback: (error: Error | null, stdout?: string) => void) => {
            if (String(file).includes('netstat')) {
                netstatTimeout = options.timeout ?? 0;
                // A slow netstat: it answers inside its own limit, but has taken most of the gate.
                setTimeout(() => callback(null, ''), 1990);
                return;
            }
            if (String(file).includes('taskkill')) {
                taskkillTimeout = options.timeout ?? 0;
                taskkillAt = Date.now() - startedAt;
                setTimeout(() => callback(null, ''), 50);
                return;
            }
            callback(null, '');
        });
        const quit = app.client.closeForQuit();
        await vi.advanceTimersByTimeAsync(3000);
        await expect(quit).resolves.toBe(true);
        expect(netstatTimeout).toBe(2000);
        // What the probing spends comes out of the taskkill's own limit, not the quit's gate: the
        // taskkill is issued inside 3 s, and only what the gate has left is left for its wait.
        expect(taskkillAt).toBeLessThan(3000);
        expect(taskkillTimeout).toBeLessThan(2000);
    });

    it('gives up a port it cannot confirm inside the gate instead of holding the quit for it', async () => {
        const app = makeClient({ port: 0, portAnswers: true });
        const startedAt = Date.now();
        app.runFile.mockImplementation((file: string, _args: string[], options: { timeout?: number }, callback: (error: Error | null, stdout?: string) => void) => {
            if (String(file).includes('netstat')) {
                // Slow enough that only its own limit ends it: the port probe starts with little
                // budget left.
                setTimeout(() => callback(null, ''), options.timeout ?? 0);
                return;
            }
            callback(null, '');
        });
        // The port takes 1.4 s to answer every time: the first answer lands inside the gate, the
        // confirming one is past it.
        app.fetch.mockImplementation(((url: string) => {
            if (!String(url).includes('/json/version')) return Promise.resolve({ ok: true, json: async () => [] });
            return new Promise(resolve => setTimeout(() => resolve({
                ok: true, json: async () => ({ 'User-Agent': 'Mozilla/5.0 Spotify/1.2.31' }),
            }), 1400));
        }) as never);
        let answeredAt = 0;
        const quit = app.client.closeForQuit().then((answer: boolean) => {
            answeredAt = Date.now();
            return answer;
        });
        await vi.advanceTimersByTimeAsync(6000);
        // Unconfirmed is not closed: the quit is not held past its gate to close it.
        await expect(quit).resolves.toBe(false);
        expect(answeredAt - startedAt).toBeLessThan(3000);
        expect(app.taskkills()).toBe(0);
    });

    it('does not hold the quit when the setting is off', async () => {
        const app = makeClient({ portAnswers: true });
        const bridge = makeBridge(app.client);
        expect(await bridge.shutdown()).toBeNull();
        // With the setting on it is held: the app is closed, and that is waited for.
        await expect(bridge.shutdown({ closePlayerOnQuit: true })).resolves.toBeUndefined();
    });

    it('does not wake or restart Spotify for an advance Folia made by itself', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        // The call fails where it stands: no restart, no start, whatever the socket said.
        await expect(app.client.play({ id: TRACK, startMs: 0, userAction: false })).rejects.toBeTruthy();
        expect(app.taskkills()).toBe(0);
        expect(app.spotifySpawns()).toBe(0);
    });
});

describe('how Folia raises Spotify: in the tray, out of the way', () => {
    // The sweeping fallback, run through runFile rather than as a process of its own.
    const sweeps = (app: ReturnType<typeof makeClient>) => app.runFile.mock.calls
        .filter(call => app.scriptOf(call[1] as string[]).includes('Folia.SpotifyWin'));
    const spotifyCall = (app: ReturnType<typeof makeClient>) => (app.spawnProcess.mock.calls as unknown as [string, string[], object][])
        .find(call => !/powershell\.exe$/i.test(String(call[0])));

    it('starts Spotify in the tray and hides the window it started the moment Spotify shows it', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.launch()).resolves.toBe(true);
        const spotify = spotifyCall(app);
        const args = spotify?.[1] as string[];
        expect(args).toContain('--minimized');
        expect(args.some(arg => arg.startsWith('--remote-debugging-port='))).toBe(true);
        // A port Folia names itself gets exactly its own origin, and nothing wider.
        expect(args).toContain('--remote-allow-origins=http://127.0.0.1:9283');
        // The start is asked for without a window as well (STARTUPINFO's SW_HIDE). Measured, this Spotify
        // ignores it, which is why the watcher below is what keeps the window off the screen.
        expect(spotify?.[2]).toMatchObject({ windowsHide: true });

        // The watcher is armed before Spotify is run: a hook that arrives after the window is shown is a
        // window on the screen, and a start that arms late is what shows one for 1.4 s.
        const calls = app.spawnProcess.mock.calls as unknown as [string, string[]][];
        const watchIndex = app.watchSpawns().length ? calls.findIndex(call => app.scriptOf(call[1]).includes('FoliaSpotifyWindow')) : -1;
        const spotifyIndex = calls.findIndex(call => /Spotify\.exe$/i.test(String(call[0])));
        expect(watchIndex).toBeGreaterThan(-1);
        expect(watchIndex).toBeLessThan(spotifyIndex);

        const script = app.scriptOf(calls[watchIndex][1]);
        // The show itself is caught (EVENT_OBJECT_SHOW) and the hide is ShowWindow, which waits for
        // Spotify's own thread to take it: the window is hidden in the frame it is shown in, before the
        // taskbar has anything to draw.
        expect(script).toContain('SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW');
        expect(script).toContain('ShowWindow(window, SW_HIDE)');
        expect(script).toContain('Chrome_WidgetWin_1');
        // Hidden, never closed: the tray icon still restores it.
        expect(script).not.toContain('CloseWindow');
        // Nothing was running before this start, so every Spotify window it can see is the one it made:
        // the PIDs that are not to be touched are a parameter, and here it is empty.
        const watcherArgs = calls[watchIndex][1];
        expect(watcherArgs[watcherArgs.indexOf('-SkipPids') + 1]).toBe('');
        expect(watcherArgs[watcherArgs.indexOf('-LifetimeMs') + 1]).toBe('60000');
        await app.client.close();
    });

    it('hides the window it made at the first moment a window can exist, not at the third round', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        const order: string[] = [];
        const runFileImpl = app.runFile.getMockImplementation();
        app.runFile.mockImplementation((file: string, args: string[], options: object, callback: (error: Error | null, stdout?: string) => void) => {
            if (app.scriptOf(args).includes('Folia.SpotifyWin')) order.push('sweep');
            return (runFileImpl as (...call: unknown[]) => unknown)(file, args, options, callback);
        });
        const waitImpl = waitFor.getMockImplementation();
        waitFor.mockImplementation(async (ms: number) => {
            order.push('wait:' + ms);
            await (waitImpl as unknown as (ms: number) => Promise<void>)(ms);
        });
        await expect(app.client.launch()).resolves.toBe(true);
        // One cadence (700 ms) between the start and the first sweep: measured, Spotify shows its window
        // 0.5-1.1 s in, so the third round (1.4 s) hid it a second late. The second sweep is the one that
        // runs with the page ready.
        const beforeFirstSweep = order.slice(0, order.indexOf('sweep'));
        expect(beforeFirstSweep.filter(step => step === 'wait:700')).toHaveLength(1);
        expect(order.filter(step => step === 'sweep')).toHaveLength(2);
        await app.client.close();
    });

    it('hides the window of the Spotify this start made and leaves the one that was already there', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: true, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.launch()).resolves.toBe(true);
        // A Spotify was running before this start (the mock's 1234): its window is the listener's to keep,
        // and both the watcher and the fallback sweep are told so.
        const watchArgs = app.watchSpawns()[0]?.[1];
        expect(watchArgs[watchArgs.indexOf('-SkipPids') + 1]).toBe('1234');
        const sweepArgs = sweeps(app)[0]?.[1] as string[];
        expect(sweepArgs[sweepArgs.indexOf('-SkipPids') + 1]).toBe('1234');
        await app.client.close();
    });

    it('lets the watcher go once the start is over, so the tray opens the window as usual', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.launch()).resolves.toBe(true);
        // The watcher is the process of the start: it ends with it, and nothing hides a window afterwards.
        const calls = app.spawnProcess.mock.calls as unknown as [string, string[]][];
        const watcher = app.procs[calls.findIndex(call => app.scriptOf(call[1]).includes('FoliaSpotifyWindow'))];
        expect(watcher.kill).toHaveBeenCalled();
        await app.client.close();
    });

    it('never lets a page in a browser steer the DevTools port it let Spotify pick', async () => {
        const app = makeClient({ running: false, port: 0, activePort: 54123, appDirectory: makeLauncherDirectory() });
        // The port answers only once Spotify has been started: before that none is found, so the
        // launch happens as it does on a machine where Spotify is not running.
        app.fetch.mockImplementation((async (url: string) => {
            if (String(url).includes('/json/version')) {
                return {
                    ok: app.spotifySpawns() > 0,
                    json: async () => ({ Browser: 'Chrome/122.0.0.0', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Spotify/1.2.31' }),
                };
            }
            return {
                ok: true,
                json: async () => [{ type: 'page', url: 'https://xpui.app.spotify.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:54123/devtools/page/1' }],
            };
        }) as never);
        await expect(app.client.launch()).resolves.toBe(true);
        const args = (app.spawnProcess.mock.calls as unknown as unknown[][]).find(call => !/powershell\.exe$/i.test(String(call[0])))?.[1] as string[];
        expect(args).toContain('--remote-debugging-port=0');
        // No origin is allowed at all: Folia's own DevTools client sends no Origin header, and a page
        // in a browser always sends one — a wildcard here would let any page steer the signed-in
        // Spotify through the port it scans for.
        expect(args.some(arg => arg.startsWith('--remote-allow-origins'))).toBe(false);
        expect(args).not.toContain('--remote-allow-origins=*');
        await app.client.close();
    });

    it('leaves the window of a Spotify that already answers on its port alone', async () => {
        const app = makeClient({ running: true, portAnswers: true, appDirectory: makeLauncherDirectory() });
        await expect(app.client.launch()).resolves.toBe(true);
        expect(app.spotifySpawns()).toBe(0);
        // Nothing was started, so there is no window of Folia's to hide: no watcher, no sweep.
        expect(app.watchSpawns()).toHaveLength(0);
        expect(sweeps(app)).toHaveLength(0);
        await app.client.close();
    });

    it('does not fail a start when the window cannot be hidden at all', async () => {
        FakeSocket.failuresLeft = FAILED_CONNECTIONS;
        spawnError = true;
        const app = makeClient({ running: false, portAnswers: false, appDirectory: makeLauncherDirectory() });
        app.runFile.mockImplementation((file: string, args: string[], _options: object, callback: (error: Error | null, stdout?: string) => void) => {
            if (String(file).includes('tasklist')) { callback(null, 'INFO: No tasks are running'); return; }
            if (String(file).includes('taskkill')) { callback(null, ''); return; }
            callback(app.scriptOf(args).includes('Folia.SpotifyWin') ? new Error('blocked') : null, '');
        });
        await expect(app.client.launch()).resolves.toBe(true);
        // Both the watcher and the sweep failed: said once each, and the start itself still went on.
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
    it('does not fail the new helper with the old one ending', async () => {
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

    it('ends a helper that did not answer and starts a fresh one after the backoff', async () => {
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

    it('lets a helper go when its input fails, and fails what it still owed', async () => {
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

    it('starts the helper again only after the backoff it has reached', async () => {
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

    it('starts the helper by its absolute path, not by whatever PATH says', async () => {
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

// --- the wait a play makes for its track, driven by a stand-in player --------------------------

describe('a start an advertisement plays before', () => {
    const TRACK_URI = `spotify:track:${TRACK}`;
    const AD = { uri: 'spotify:ad:1', type: 'ad' };
    const OTHER = { uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQD' };
    const startWait = (new Function(`return (${String(START_WAIT_SOURCE)})`)()) as (input: unknown) => Promise<string>;
    /** A player that shows these states one look each, then keeps showing the last one. */
    const playerShowing = (states: unknown[]) => {
        let look = 0;
        return { getState: () => states[Math.min(look++, states.length - 1)] };
    };
    const run = (states: unknown[], current: () => boolean = () => true) => startWait({
        api: { player: playerShowing(states) }, uri: TRACK_URI, isAd: isAdvertisementItem, current, sleep: () => Promise.resolve(),
    });

    it('waits an advertisement out and takes the track that comes after it', async () => {
        await expect(run([{ item: AD }, { item: AD }, { item: AD }, { item: { uri: TRACK_URI } }])).resolves.toBe('loaded');
    });

    it('takes an advertisement that outlasts the whole wait as an accepted start', async () => {
        // The advertisement never ends: the start is accepted rather than reported as a track that
        // did not load, and the status reads follow it.
        await expect(run([{ item: AD }])).resolves.toBe('advertisement');
    });

    it('reports a track that never came when no advertisement ran', async () => {
        await expect(run([{ item: OTHER }])).resolves.toBe('not-loaded');
    });

    it('reports a track that never came after an advertisement ended', async () => {
        // An advertisement that is over is no accepted start: the track itself still did not load.
        await expect(run([{ item: AD }, { item: OTHER }])).resolves.toBe('not-loaded');
    });

    it('stops where a newer play took the app', async () => {
        let looks = 0;
        await expect(run([{ item: AD }], () => ++looks < 3)).resolves.toBe('preempted');
    });

    // The page's player keeps the error of the last track it was told to play on its context
    // player: a track Spotify will not play is named there at once instead of being waited out.
    const refusing = (states: unknown[], getError: () => unknown) => {
        let look = 0;
        return {
            getState: () => states[Math.min(look++, states.length - 1)],
            _contextPlayer: { getError },
        };
    };
    const runRefusing = (getError: () => unknown, states: unknown[] = [{ item: OTHER }]) => startWait({
        api: { player: refusing(states, getError) }, uri: TRACK_URI, isAd: isAdvertisementItem,
        current: () => true, sleep: () => Promise.resolve(),
    });

    it('answers a track the page says cannot be played without waiting the start out', async () => {
        await expect(runRefusing(() => ({ code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'] })))
            .resolves.toEqual({ answer: 'unavailable', code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'] });
    });

    it('reads the error whatever the case and spacing of its words', async () => {
        await expect(runRefusing(() => ({ code: 'one_track_unplayable', reasons: ['NOT_AVAILABLE_IN_CURRENT_REGION'] })))
            .resolves.toMatchObject({ answer: 'unavailable', code: 'one_track_unplayable' });
    });

    it('answers a track only a paying account may play as its own answer', async () => {
        // NOT_AVAILABLE_IN_NON_PREMIUM alone says the free account is what stops it, which is not the
        // song being taken down: the renderer shows it as needing a plan.
        await expect(runRefusing(() => ({ code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE_IN_NON_PREMIUM'] })))
            .resolves.toEqual({ answer: 'premium-only', code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE_IN_NON_PREMIUM'] });
        await expect(runRefusing(() => ({ code: 'one_track_unplayable', reasons: ['not_available_in_non_premium'] })))
            .resolves.toMatchObject({ answer: 'premium-only' });
    });

    it('answers a track that is gone as well as out of a free account as unavailable', async () => {
        // A reason beside NOT_AVAILABLE_IN_NON_PREMIUM says the track itself is gone: the song is
        // taken down rather than one a plan would bring back.
        await expect(runRefusing(() => ({
            code: 'ONE_TRACK_UNPLAYABLE',
            reasons: ['NOT_AVAILABLE_IN_NON_PREMIUM', 'NOT_AVAILABLE_IN_CURRENT_REGION'],
        }))).resolves.toMatchObject({ answer: 'unavailable' });
    });

    it('waits the start out for an error that names something else', async () => {
        // A code or a reason of another kind says nothing about this track: the track may still come.
        await expect(runRefusing(() => ({ code: 'OTHER', reasons: ['NOT_AVAILABLE'] }))).resolves.toBe('not-loaded');
        await expect(runRefusing(() => ({ code: 'ONE_TRACK_UNPLAYABLE', reasons: ['SOMETHING'] }))).resolves.toBe('not-loaded');
    });

    it('waits the start out when the page has no error to read', async () => {
        await expect(runRefusing(() => null)).resolves.toBe('not-loaded');
        await expect(runRefusing(() => ({}))).resolves.toBe('not-loaded');
        await expect(runRefusing(() => 'nonsense')).resolves.toBe('not-loaded');
    });

    it('waits the start out when reading the error throws', async () => {
        // The page's own state reads are made defensively everywhere: one that throws says nothing.
        await expect(runRefusing(() => { throw new Error('gone'); })).resolves.toBe('not-loaded');
    });

    // The page's player keeps the error of the last track it was told to play: a song before this one
    // may still be named there, so one look at it does not say this start failed.
    const refusedEachLook = (errors: unknown[]) => {
        let look = 0;
        return () => errors[Math.min(look++, errors.length - 1)];
    };

    it('waits the start out when the page names a track gone on the first look only', async () => {
        const gone = { code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'] };
        await expect(runRefusing(refusedEachLook([gone, null]))).resolves.toBe('not-loaded');
    });

    it('answers a refusal that is still there one look later, on the second look', async () => {
        const getError = vi.fn(refusedEachLook([{ code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'] }]));
        await expect(runRefusing(getError)).resolves.toMatchObject({ answer: 'unavailable' });
        expect(getError).toHaveBeenCalledTimes(2);
    });

    it('answers a refusal of the free account on the second look as well', async () => {
        const getError = vi.fn(refusedEachLook([{ code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE_IN_NON_PREMIUM'] }]));
        await expect(runRefusing(getError)).resolves.toMatchObject({ answer: 'premium-only' });
        expect(getError.mock.calls.length).toBeLessThanOrEqual(2);
    });

    // 免费账号点歌常常先放一段广告，而页面留着的错误是上一首的：广告在屏上时它说的不是点的那首。
    const goneEachLook = () => ({ code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'] });

    it('does not answer an unavailable song while an advertisement plays', async () => {
        // The error stays the same on every look and the advertisement never ends: the start is the
        // advertisement's, not the track being gone.
        await expect(runRefusing(goneEachLook, [{ item: AD }])).resolves.toBe('advertisement');
    });

    it('answers a refusal that outlives the advertisement, on the second look after it', async () => {
        await expect(runRefusing(goneEachLook, [{ item: AD }, { item: AD }, { item: OTHER }]))
            .resolves.toMatchObject({ answer: 'unavailable' });
    });

    it('counts the refusal again from the advertisement\'s end', async () => {
        // An advertisement on the screen drops the refusal held before it: the look right after it is
        // the first one, and a refusal read there alone is still the error of the song before this one.
        const readOnce = refusedEachLook([goneEachLook(), null]);
        await expect(runRefusing(readOnce, [{ item: AD }, { item: AD }, { item: OTHER }, { item: OTHER }]))
            .resolves.toBe('not-loaded');
    });

    it('takes the track an error names instead of the one the start asked for', async () => {
        // An error that names a track of its own is this start's only when it names this track.
        const other = { code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'], uri: OTHER.uri };
        await expect(runRefusing(() => other)).resolves.toBe('not-loaded');
        const own = { code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'], track: { uri: TRACK_URI } };
        await expect(runRefusing(() => own)).resolves.toMatchObject({ answer: 'unavailable' });
        const inItem = { code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'], item: { uri: TRACK_URI } };
        await expect(runRefusing(() => inItem)).resolves.toMatchObject({ answer: 'unavailable' });
    });

    it('takes a track named by the error\'s item or track, and one named there as another song either way', async () => {
        // The error may name the track in any of three places; whichever one it uses, a song that is not
        // this start's is not this start's answer, and the wait goes on as it does without one.
        const inItem = { code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'], item: { uri: OTHER.uri } };
        await expect(runRefusing(() => inItem)).resolves.toBe('not-loaded');
        const inTrack = { code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'], track: { uri: OTHER.uri } };
        await expect(runRefusing(() => inTrack)).resolves.toBe('not-loaded');
        const both = { code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'], item: { uri: OTHER.uri }, track: { uri: OTHER.uri } };
        await expect(runRefusing(() => both)).resolves.toBe('not-loaded');
    });

    it('reads no track from the error\'s context track', async () => {
        // The context track is the list the app was playing, not the song this start asked for: named
        // there, it says nothing about which track went, so the refusal is the one every start gets.
        const contextOnly = { code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'], contextTrack: { uri: OTHER.uri } };
        await expect(runRefusing(() => contextOnly)).resolves.toMatchObject({ answer: 'unavailable' });
        const ownBesideContext = { code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'], uri: TRACK_URI, contextTrack: { uri: OTHER.uri } };
        await expect(runRefusing(() => ownBesideContext)).resolves.toMatchObject({ answer: 'unavailable' });
    });
});
// --- the songs that follow, written into the app's queue, driven by a stand-in player ------------

describe('a queue write in the app', () => {
    const idOf = (letter: string) => letter.repeat(22);
    const trackUri = (letter: string) => 'spotify:track:' + idOf(letter);
    type Answer = {
        aborted?: boolean; canClear: boolean | null; cleared: boolean; restored?: boolean;
        written: string[]; read: string[] | null;
    };
    const writeQueue = (new Function('return (' + String(QUEUE_SOURCE) + ')')()) as (input: unknown) => Promise<Answer>;

    /**
     * The page the queue code runs in. It keeps the play generation on its own global, so the test
     * gives it the window the page would have; a fresh one is a page loaded again.
     */
    const page: { __foliaPlay?: number } = {};
    beforeEach(() => {
        (globalThis as unknown as { window?: unknown }).window = page;
        delete page.__foliaPlay;
    });
    afterEach(() => {
        delete (globalThis as unknown as { window?: unknown }).window;
    });

    /**
     * A player whose queue holds `start`, with the queue API the test gives it: `works` empties it,
     * `noop` answers and empties nothing, and no `clearQueue` at all is a player without one.
     */
    const playerWith = (start: string[], clearQueue?: 'works' | 'noop', queue: true | false | 'alias' = true) => {
        const held = start.map(idOf);
        const added: string[] = [];
        const named = () => held.map(id => ({ uri: 'spotify:track:' + id }));
        const player: Record<string, unknown> = {
            // `alias` is the state whose first queue name is always empty while the queue is in the next.
            getState: () => (queue === false
                ? {}
                : queue === 'alias' ? { nextTracks: [], nextItems: named() } : { nextTracks: named() }),
            addToQueue: (entries: { uri: string }[]) => {
                for (const entry of entries) { held.push(entry.uri.slice(14)); added.push(entry.uri.slice(14)); }
            },
        };
        if (clearQueue === 'works') player.clearQueue = async () => { held.length = 0; };
        if (clearQueue === 'noop') player.clearQueue = async () => {};
        return { api: { player }, held, added };
    };

    /** One write as the page makes it: the capability this run found (null the first time), and the play it belongs to. */
    const write = (
        api: unknown, letters: string[], queued: string[], probed: boolean | null = null, generation = 0,
    ) => writeQueue({ api, uris: letters.map(trackUri), queued, probed, generation });

    it('takes every song once the app emptied its queue, and says the queue was emptied', async () => {
        const app = playerWith(['c', 'd'], 'works');
        const answer = await write(app.api, ['c', 'd', 'e'], []);

        expect(answer.cleared).toBe(true);
        expect(answer.canClear).toBe(true);
        expect(answer.written).toEqual([idOf('c'), idOf('d'), idOf('e')]);
        expect(answer.read).toEqual([idOf('c'), idOf('d'), idOf('e')]);
    });

    it('asks once per run whether the queue can be emptied, and adds one song at a time when it cannot', async () => {
        // The player offers no clearQueue here: the songs it holds are left alone, and only a song
        // Folia has not written is added.
        const app = playerWith(['c'], undefined);
        const first = await write(app.api, ['c', 'd'], []);
        expect(first.cleared).toBe(false);
        expect(first.canClear).toBe(false);
        expect(app.added).toEqual([idOf('d')]);

        // The next write is handed what this run found, so the app is not asked again.
        const second = await write(app.api, ['d', 'e'], [idOf('c'), idOf('d')], first.canClear);
        expect(second.canClear).toBe(false);
        expect(app.added).toEqual([idOf('d'), idOf('e')]);
    });

    it('treats a clear that leaves songs behind as no clear at all, and adds only what is missing', async () => {
        const app = playerWith(['c'], 'noop');
        const answer = await write(app.api, ['c', 'd'], []);

        expect(answer.cleared).toBe(false);
        expect(answer.canClear).toBe(false);
        expect(app.added).toEqual([idOf('d')]);
    });

    it('reads the queue from the name that holds it, not from an alias left empty', async () => {
        // One of the state's queue names is an alias the app always leaves empty: read as a queue
        // that is empty, every write would put the whole tail in again.
        const app = playerWith(['c', 'd'], undefined, 'alias');
        const answer = await write(app.api, ['c', 'd', 'e'], []);

        expect(app.added).toEqual([idOf('e')]);
        expect(answer.read).toEqual([idOf('c'), idOf('d'), idOf('e')]);
    });

    it('leaves the tail a window before this one wrote where it is', async () => {
        // This run wrote nothing of these: they were queued before it, and a song is never added
        // behind itself.
        const app = playerWith(['c', 'd'], undefined);
        const answer = await write(app.api, ['c', 'd', 'e'], []);

        expect(answer.written).toEqual([idOf('e')]);
        expect(app.added).toEqual([idOf('e')]);
    });

    it('counts from the songs the caller holds when the app names no queue', async () => {
        const app = playerWith([], undefined, false);
        const answer = await write(app.api, ['c', 'd'], [idOf('c')]);

        expect(answer.read).toBeNull();
        expect(app.added).toEqual([idOf('d')]);
    });

    // 写入这一侧读的是同一份 nextItems：它既决定清空之后队列算不算空，也是写给日志的读回。
    // 把推荐算进去，清空成功的队列永远读成「还剩歌」，这一轮就只能一首一首地排，整表替换走不到。
    it('counts only the songs really queued when it reads back what a clear left', async () => {
        const app = appNamingQueue(['u'], ['p', 'q', 'r']);
        const answer = await write(app.api, ['c', 'd'], []);

        // 队列清掉了，听众排的那一首放回原位，这次写的两首排在它后面；读回只看排队的那几首。
        expect(answer.cleared).toBe(true);
        expect(answer.canClear).toBe(true);
        expect(answer.written).toEqual([idOf('c'), idOf('d')]);
        expect(app.added).toEqual([idOf('u'), idOf('c'), idOf('d')]);
        expect(answer.read).toEqual([idOf('u'), idOf('c'), idOf('d')]);
    });

    it('reads a queue of nothing but autoplay back as the empty queue it is', async () => {
        // 只有推荐的一份队列清空后读回是空的：这一轮记下「能清」，之后整表替换就都走得到。
        const app = appNamingQueue([], ['p', 'q']);
        const answer = await write(app.api, ['c'], []);

        expect(answer.cleared).toBe(true);
        expect(answer.canClear).toBe(true);
        expect(answer.read).toEqual([idOf('c')]);
        expect(app.added).toEqual([idOf('c')]);
    });

    it('reads the queue by its metadata mark where the app sets no provider', async () => {
        // 一份数据只有 metadata.is_queued、没有 provider：排队的那首照旧算排队，推荐照旧不算。
        const app = appNamingQueue(['u'], ['p'], 'works', 'metadataOnly');
        const answer = await write(app.api, ['c'], []);

        expect(answer.cleared).toBe(true);
        expect(answer.read).toEqual([idOf('u'), idOf('c')]);
    });

    it('still treats an entry that marks no provider as a song of the queue', async () => {
        // 旧版的一份数据没有 provider：整份都算排队，清完之后还读得出歌就是没清掉，照旧只往后补。
        const app = appNamingQueue(['u'], [], 'none', 'old');
        const answer = await write(app.api, ['c'], []);

        expect(answer.cleared).toBe(false);
        expect(answer.canClear).toBe(false);
        expect(app.added).toEqual([idOf('c')]);
    });

    it('drops a write a newer play took the app from, and writes nothing', async () => {
        const app = playerWith(['c'], 'works');
        // The page is on a later play than the one this write was handed over for: the queue that
        // play emptied is not filled with the songs of the song before it.
        page.__foliaPlay = 2;
        const answer = await write(app.api, ['d'], [], null, 1);

        expect(answer.aborted).toBe(true);
        expect(answer.written).toEqual([]);
        expect(app.added).toEqual([]);
    });

    it('gives back the songs the listener queued in the app itself, and takes back only Folia own', async () => {
        // The listener added songs of their own beside the ones Folia wrote behind this one. Writing
        // nothing takes Folia's back and leaves theirs, in the order they put them in.
        const app = playerWith(['u', 'c', 'v'], 'works');
        const answer = await write(app.api, [], [idOf('c')]);

        expect(answer.cleared).toBe(true);
        expect(answer.written).toEqual([]);
        expect(app.held).toEqual([idOf('u'), idOf('v')]);
        expect(app.added).toEqual([idOf('u'), idOf('v')]);
    });

    it('gives back nothing where the listener queued nothing of their own', async () => {
        const app = playerWith(['c', 'd'], 'works');
        const answer = await write(app.api, [], [idOf('c'), idOf('d')]);

        expect(answer.written).toEqual([]);
        expect(app.added).toEqual([]);
        expect(app.held).toEqual([]);
    });

    it('leaves a queue it cannot empty as it is, songs of the listener included', async () => {
        // Nothing was emptied, so there is nothing to give back: Folia wrote nothing and took nothing.
        const app = playerWith(['u', 'c'], 'noop');
        const answer = await write(app.api, [], [idOf('c')]);

        expect(answer.cleared).toBe(false);
        expect(answer.written).toEqual([]);
        expect(app.added).toEqual([]);
        expect(app.held).toEqual([idOf('u'), idOf('c')]);
    });

    it('puts the songs the listener queued back where they were, not before the songs of Folia own', async () => {
        // The listener queued one song of their own behind the ones Folia wrote: the clear takes it
        // too, and it is given back at the place it held, Folia's songs filling theirs again.
        const app = playerWith(['c', 'd', 'u'], 'works');
        const answer = await write(app.api, ['e', 'f'], [idOf('c'), idOf('d')]);

        expect(answer.written).toEqual([idOf('e'), idOf('f')]);
        expect(app.held).toEqual([idOf('e'), idOf('f'), idOf('u')]);
    });

    it('keeps the songs the listener queued twice, one entry each', async () => {
        // A song the listener put in the queue twice is there twice: giving one of them back loses
        // a place they made on purpose.
        const app = playerWith(['u', 'c', 'u'], 'works');
        const answer = await write(app.api, ['e'], [idOf('c')]);

        expect(answer.written).toEqual([idOf('e')]);
        expect(app.held).toEqual([idOf('u'), idOf('e'), idOf('u')]);
    });

    it('says the queue was emptied but not put back when giving the songs back fails, and never fails the write', async () => {
        // The clear already ran: the songs are gone from the app, and a write that throws here would
        // leave the caller believing nothing happened at all.
        const app = playerWith(['u', 'c'], 'works');
        (app.api.player as { addToQueue: () => Promise<void> }).addToQueue = async () => { throw new Error('the queue was refused'); };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const answer = await write(app.api, ['e'], [idOf('c')]);

        expect(answer.cleared).toBe(true);
        expect(answer.restored).toBe(false);
        expect(answer.written).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('[SpotifyClient]'), expect.any(Error));
        warn.mockRestore();
    });

    it('takes the generation of a page loaded again as it stands', async () => {
        // Spotify navigated and the page was loaded again: no play has run there, and the write is
        // not dropped for a generation the page has never seen.
        const app = playerWith([], 'works');
        const answer = await write(app.api, ['d'], [], null, 4);

        expect(answer.aborted).toBe(false);
        expect(app.added).toEqual([idOf('d')]);
    });
});


describe('a call that may not be made twice', () => {
    it('does not run a play again when the connection failed after the call went out', async () => {
        FakeSocket.muteSend = true;
        const app = makeClient({ running: true, portAnswers: true });
        // The expectation is attached before the clock moves, so the rejection has a handler on it.
        // A start's own limit covers the whole wait for its track (a free account's advertisement
        // included), so the clock is moved past that limit.
        const playing = expect(app.client.play({ id: TRACK, startMs: 0, userAction: false })).rejects.toMatchObject({ code: 'network' });
        await vi.advanceTimersByTimeAsync(70000);
        await playing;
        const plays = FakeSocket.sockets.flatMap(socket => socket.expressions).filter(text => text.includes('window.__foliaPlay'));
        expect(plays).toHaveLength(1);
    });

    it('does not run a queue write again when the connection failed after the call went out', async () => {
        FakeSocket.muteSend = true;
        const app = makeClient({ running: true, portAnswers: true });
        const queued = expect(app.client.queue({ ids: [TRACK] })).rejects.toMatchObject({ code: 'network' });
        await vi.advanceTimersByTimeAsync(20000);
        await queued;
        const writes = FakeSocket.sockets.flatMap(socket => socket.expressions).filter(text => text.includes('addToQueue'));
        expect(writes).toHaveLength(1);
    });

    it('looks at the page again for a read-only call whose first look failed', async () => {
        let looks = 0;
        handle = expression => {
            if (expression.includes('delete window.__foliaSpotify')) return { value: true };
            looks += 1;
            return looks === 1 ? { details: 'Error: player-unavailable' } : { value: { isPaused: true, positionMs: 0, durationMs: 1000, repeat: 0 } };
        };
        const app = makeClient({ running: true, portAnswers: true });
        // The player cached in the page was dropped and looked for once more.
        await expect(app.client.status()).resolves.toMatchObject({ isPaused: true });
        expect(looks).toBe(2);
        await app.client.close();
    });

    it('does not look at the page again for a play whose first look failed', async () => {
        let looks = 0;
        handle = expression => {
            if (expression.includes('delete window.__foliaSpotify')) return { value: true };
            looks += 1;
            return { details: 'Error: player-unavailable' };
        };
        const app = makeClient({ running: true, portAnswers: true });
        await expect(app.client.play({ id: TRACK, startMs: 0, userAction: false })).rejects.toMatchObject({ code: 'unavailable' });
        expect(looks).toBe(1);
        await app.client.close();
    });
});

describe('a DevTools protocol error', () => {
    it('is a call that failed, never an answer with nothing in it', async () => {
        mediaAnswers.pause = true;
        handle = () => ({ error: 'Runtime.evaluate was refused' });
        const app = makeClient({ running: true, portAnswers: true });
        // The player could not be asked: the pause is answered by the media session instead of
        // reading as an empty result.
        await expect(app.client.pause()).resolves.toBe(true);
        expect(app.helperSpawns()).toBe(1);
        await app.client.close();
    });
});

describe('the DevTools port Spotify chose', () => {
    it('reads the port the app wrote into its profile', async () => {
        const app = makeClient({ running: true, port: 0, activePort: 54123, portAnswers: true });
        await expect(app.client.pause()).resolves.toBe(true);
        const urls = app.fetch.mock.calls.map(call => String(call[0]));
        // Only 127.0.0.1 is ever asked, and the page is reached on the port the app wrote down.
        expect(urls.every(url => url.startsWith('http://127.0.0.1:'))).toBe(true);
        expect(urls).toContain('http://127.0.0.1:54123/json/list');
        await app.client.close();
    });

    it('finds the port from a listener of the running app when the profile names none', async () => {
        const netstat = [
            '  TCP    127.0.0.1:54124        0.0.0.0:0              LISTENING       4321',
            '  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4',
            '  TCP    127.0.0.1:54124        127.0.0.1:52000        ESTABLISHED     4321',
        ].join(NEWLINE);
        const app = makeClient({ running: true, port: 0, netstat, portAnswers: true });
        await expect(app.client.pause()).resolves.toBe(true);
        const urls = app.fetch.mock.calls.map(call => String(call[0]));
        expect(urls).toContain('http://127.0.0.1:54124/json/list');
        // A listener that is not the page's is asked what it is and left alone; an established
        // connection is no listener at all.
        expect(urls).toContain('http://127.0.0.1:445/json/version');
        expect(urls.some(url => url.includes(':445/json/list'))).toBe(false);
        await app.client.close();
    });

    it('takes no port when the program answering is not Spotify', async () => {
        mediaAnswers.pause = true;
        const app = makeClient({ running: true, port: 0, activePort: 54125, portAnswers: true, portIdentity: 'other' });
        await expect(app.client.pause()).resolves.toBe(true);
        // Nothing was opened against it: the pause went to the media session.
        expect(app.helperSpawns()).toBe(1);
        expect(app.fetch.mock.calls.every(call => String(call[0]).startsWith('http://127.0.0.1:'))).toBe(true);
        await app.client.close();
    });
});

describe('what a polled status read costs', () => {
    const netstats = (app: ReturnType<typeof makeClient>) => app.runFile.mock.calls
        .filter(call => String(call[0]).includes('netstat')).length;

    it('never searches the machine for a port: it takes the one already found, or the media session', async () => {
        mediaAnswers.status = { isPaused: true, positionMs: 5000, durationMs: 3000, repeat: 2 };
        const netstat = [
            '  TCP    127.0.0.1:54124        0.0.0.0:0              LISTENING       4321',
        ].join(NEWLINE);
        const app = makeClient({ running: true, port: 0, netstat, portAnswers: false, listOk: false });
        // It is asked twice a second while a song plays: none of those may run a netstat or probe the
        // machine's loopback ports.
        await expect(app.client.status()).resolves.toMatchObject({ fallback: true });
        await expect(app.client.status()).resolves.toMatchObject({ fallback: true });
        await expect(app.client.status()).resolves.toMatchObject({ fallback: true });
        expect(netstats(app)).toBe(0);
        await app.client.close();
    });

    it('leaves the search to the listener\'s own action, and waits longer each time one finds nothing', async () => {
        const app = makeClient({ running: true, port: 0, netstat: '', portAnswers: false, listOk: false });
        // The first one: no port cached yet, so one pause starts one search.
        await app.client.pause();
        expect(netstats(app)).toBe(1);
        // No search within 1 s: the machine's listeners do not change because the question was
        // asked again.
        await app.client.pause();
        expect(netstats(app)).toBe(1);
        vi.setSystemTime(Date.now() + 1000);
        await app.client.pause();
        expect(netstats(app)).toBe(2);
        // After two searches that found nothing, the next one waits 5 s.
        vi.setSystemTime(Date.now() + 4999);
        await app.client.pause();
        expect(netstats(app)).toBe(2);
        vi.setSystemTime(Date.now() + 1);
        await app.client.pause();
        expect(netstats(app)).toBe(3);
        // After the third, 30 s.
        vi.setSystemTime(Date.now() + 29999);
        await app.client.pause();
        expect(netstats(app)).toBe(3);
        vi.setSystemTime(Date.now() + 1);
        await app.client.pause();
        expect(netstats(app)).toBe(4);
        await app.client.close();
    });

    it('stops searching once the port is found', async () => {
        const netstat = [
            '  TCP    127.0.0.1:54124        0.0.0.0:0              LISTENING       4321',
        ].join(NEWLINE);
        const app = makeClient({ running: true, port: 0, netstat, portAnswers: true });
        await expect(app.client.pause()).resolves.toBe(true);
        expect(netstats(app)).toBe(1);
        // The port is kept: every later question uses it alone.
        await app.client.pause();
        await app.client.pause();
        expect(netstats(app)).toBe(1);
        await app.client.close();
    });
});

describe('the status read a session restore asks for', () => {
    const netstats = (app: ReturnType<typeof makeClient>) => app.runFile.mock.calls
        .filter(call => String(call[0]).includes('netstat')).length;
    // The page of an app that is playing one track: the state the status read asks for.
    const playingPage = () => {
        handle = expression => (expression.includes('getState')
            ? { value: { item: { uri: 'spotify:track:' + TRACK }, isPaused: false, isBuffering: false, positionAsOfTimestamp: 1000, timestamp: Date.now(), duration: 200000, repeat: 0 } }
            : { value: true });
    };
    const oneListener = ['  TCP    127.0.0.1:54124        0.0.0.0:0              LISTENING       4321'].join(NEWLINE);

    it('finds the port of an app Folia did not start and names the track it is on', async () => {
        playingPage();
        const app = makeClient({ running: true, port: 0, netstat: oneListener, portAnswers: true, appDirectory: makeLauncherDirectory() });
        const status = await app.client.statusWithPortSearch();
        expect(status).toMatchObject({ id: TRACK, isPaused: false });
        expect(status.fallback).toBeUndefined();
        // A read of its own: nothing was started, closed or paused for it.
        expect(app.spotifySpawns()).toBe(0);
        expect(app.taskkills()).toBe(0);
        expect(app.helperSpawns()).toBe(0);
        await app.client.close();
    });

    it('searches at most twice in a run, and no closer than a few seconds apart', async () => {
        playingPage();
        const app = makeClient({ running: true, port: 0, netstat: '', portAnswers: false, listOk: false, appDirectory: makeLauncherDirectory() });
        // The first look of a run.
        await app.client.statusWithPortSearch();
        expect(netstats(app)).toBe(1);
        // Asked again at once: the machine's listeners do not change because the question was repeated.
        await app.client.statusWithPortSearch();
        expect(netstats(app)).toBe(1);
        // The one more look a run is allowed, a few seconds later.
        vi.setSystemTime(Date.now() + 3000);
        await app.client.statusWithPortSearch();
        expect(netstats(app)).toBe(2);
        // And no third.
        vi.setSystemTime(Date.now() + 60000);
        await app.client.statusWithPortSearch();
        expect(netstats(app)).toBe(2);
        await app.client.close();
    });

    it('finds the port on the second look where the first found none', async () => {
        playingPage();
        const options: ClientOptions = {
            running: true, port: 0, netstat: '', portAnswers: false, appDirectory: makeLauncherDirectory(),
        };
        const app = makeClient(options);
        // Start both apps together: the first look comes before the app opened its port.
        await expect(app.client.statusWithPortSearch()).resolves.toMatchObject({ fallback: true });
        expect(netstats(app)).toBe(1);
        options.portAnswers = true;
        options.netstat = oneListener;
        vi.setSystemTime(Date.now() + 3000);
        // The app answered by then, and the track it is on is named from the second look.
        await expect(app.client.statusWithPortSearch()).resolves.toMatchObject({ id: TRACK });
        expect(netstats(app)).toBe(2);
        expect(app.spotifySpawns()).toBe(0);
        await app.client.close();
    });

    it('never looks for the port where the app is not installed', async () => {
        mediaAnswers.status = { isPaused: false, positionMs: 12000, durationMs: 200000, repeat: 0, title: 'Song', artist: 'Artist' };
        const app = makeClient({
            running: true, port: 0, netstat: oneListener, portAnswers: true, listOk: false,
            appDirectory: mkdtempSync(join(tmpdir(), 'folia-empty-')),
        });
        await expect(app.client.statusWithPortSearch()).resolves.toMatchObject({ fallback: true });
        expect(netstats(app)).toBe(0);
        expect(app.spotifySpawns()).toBe(0);
        await app.client.close();
    });

    it('does not look again where the port is already known', async () => {
        playingPage();
        const app = makeClient({ running: true, port: 0, netstat: oneListener, portAnswers: true, appDirectory: makeLauncherDirectory() });
        await app.client.pause();
        expect(netstats(app)).toBe(1);
        await app.client.statusWithPortSearch();
        await app.client.statusWithPortSearch();
        expect(netstats(app)).toBe(1);
        await app.client.close();
    });

    it('says in one line where the port it found came from, and which search it was', async () => {
        playingPage();
        const app = makeClient({
            running: true, port: 0, activePort: 54124, portAnswers: true, appDirectory: makeLauncherDirectory(),
        });

        await app.client.statusWithPortSearch();

        const lines = app.log.mock.calls.map(call => String(call[0])).filter(line => line.includes('the DevTools port'));
        expect(lines).toEqual(['[SpotifyClient] the DevTools port of Spotify is 54124, from the port file (search 1 of 2)']);
        await app.client.close();
    });

    it('falls back to the media session where no port answers, and starts nothing', async () => {
        mediaAnswers.status = { isPaused: false, positionMs: 12000, durationMs: 200000, repeat: 0, title: 'Song', artist: 'Artist' };
        const app = makeClient({ running: true, port: 0, netstat: '', portAnswers: false, listOk: false, appDirectory: makeLauncherDirectory() });
        await expect(app.client.statusWithPortSearch()).resolves.toMatchObject({ id: '', fallback: true, positionMs: 12000 });
        expect(netstats(app)).toBe(1);
        expect(app.spotifySpawns()).toBe(0);
        expect(app.taskkills()).toBe(0);
        await app.client.close();
    });
});

// The read the watcher of the app makes (externalPlayerFollow): every few seconds for the whole of a
// run. It must never spend the two looks a restore has, and it must still find a port that appears
// long after the run began.
describe('the status read the watcher of the app makes', () => {
    const netstats = (app: ReturnType<typeof makeClient>) => app.runFile.mock.calls
        .filter(call => String(call[0]).includes('netstat')).length;
    const playingPage = () => {
        handle = expression => (expression.includes('getState')
            ? { value: { item: { uri: 'spotify:track:' + TRACK }, isPaused: false, isBuffering: false, positionAsOfTimestamp: 1000, timestamp: Date.now(), duration: 200000, repeat: 0 } }
            : { value: true });
    };
    const oneListener = ['  TCP    127.0.0.1:54124        0.0.0.0:0              LISTENING       4321'].join(NEWLINE);

    it('finds the port of an app started long after the run began', async () => {
        playingPage();
        // The first six seconds: the app runs, but its DevTools port is not there yet.
        const options: ClientOptions = {
            running: true, port: 0, netstat: '', portAnswers: false, appDirectory: makeLauncherDirectory(),
        };
        const app = makeClient(options);
        await expect(app.client.statusFollowing()).resolves.toMatchObject({ fallback: true });
        vi.setSystemTime(Date.now() + 3000);
        await expect(app.client.statusFollowing()).resolves.toMatchObject({ fallback: true });
        // The app opened its port after those two looks: the watcher still finds it, a minute later.
        options.portAnswers = true;
        options.netstat = oneListener;
        vi.setSystemTime(Date.now() + 60000);
        await expect(app.client.statusFollowing()).resolves.toMatchObject({ id: TRACK });
        // Read again, in the same second: the port is kept, and nothing is searched for.
        const searched = netstats(app);
        await expect(app.client.statusFollowing()).resolves.toMatchObject({ id: TRACK });
        expect(netstats(app)).toBe(searched);
        expect(app.spotifySpawns()).toBe(0);
        expect(app.taskkills()).toBe(0);
        await app.client.close();
    });

    it('looks for the port no more than six times in a run, and no closer than a minute', async () => {
        playingPage();
        const app = makeClient({
            running: true, port: 0, netstat: '', portAnswers: false, listOk: false, appDirectory: makeLauncherDirectory(),
        });
        // Read every three seconds for ten minutes: one look a minute, six in all.
        for (let second = 0; second < 600; second += 3) {
            await app.client.statusFollowing();
            vi.setSystemTime(Date.now() + 3000);
        }
        expect(netstats(app)).toBe(6);
        await app.client.close();
    });

    it('looks for nothing where the app is not running at all', async () => {
        playingPage();
        const app = makeClient({
            running: false, port: 0, netstat: oneListener, portAnswers: true, appDirectory: makeLauncherDirectory(),
        });
        for (let second = 0; second < 300; second += 3) {
            await expect(app.client.statusFollowing()).resolves.toMatchObject({ fallback: true });
            vi.setSystemTime(Date.now() + 3000);
        }
        expect(netstats(app)).toBe(0);
        await app.client.close();
    });

    it('asks whether the app runs at most once every fifteen seconds while it is off', async () => {
        playingPage();
        const app = makeClient({
            running: false, port: 0, netstat: oneListener, portAnswers: true, appDirectory: makeLauncherDirectory(),
        });
        // Read every three seconds for five minutes: one tasklist every fifteen seconds, not one per read.
        for (let second = 0; second < 300; second += 3) {
            await expect(app.client.statusFollowing()).resolves.toMatchObject({ fallback: true });
            vi.setSystemTime(Date.now() + 3000);
        }
        expect(app.tasklists()).toBe(20);
        expect(netstats(app)).toBe(0);
        await app.client.close();
    });

    it('looks again as soon as fifteen seconds pass and the app has been started', async () => {
        playingPage();
        const options: ClientOptions = {
            running: false, port: 0, netstat: oneListener, portAnswers: true, appDirectory: makeLauncherDirectory(),
        };
        const app = makeClient(options);
        await expect(app.client.statusFollowing()).resolves.toMatchObject({ fallback: true });
        expect(app.tasklists()).toBe(1);
        // A read three seconds later is inside the gap: the machine is not asked again.
        vi.setSystemTime(Date.now() + 3000);
        await expect(app.client.statusFollowing()).resolves.toMatchObject({ fallback: true });
        expect(app.tasklists()).toBe(1);
        // The listener started the app meanwhile: the next read that is due finds it and looks at once.
        options.running = true;
        vi.setSystemTime(Date.now() + 12000);
        await expect(app.client.statusFollowing()).resolves.toMatchObject({ id: TRACK });
        expect(app.tasklists()).toBe(2);
        expect(netstats(app)).toBe(1);
        await app.client.close();
    });

    it('leaves the two looks a session restore has unspent', async () => {
        playingPage();
        const app = makeClient({
            running: true, port: 0, netstat: '', portAnswers: false, listOk: false, appDirectory: makeLauncherDirectory(),
        });
        // The watcher read every three seconds for two minutes first, as it does in a run.
        for (let second = 0; second < 120; second += 3) {
            await app.client.statusFollowing();
            vi.setSystemTime(Date.now() + 3000);
        }
        const byWatcher = netstats(app);
        expect(byWatcher).toBe(2);
        // A restore reopened here still has both of its own.
        await app.client.statusWithPortSearch();
        expect(netstats(app)).toBe(byWatcher + 1);
        vi.setSystemTime(Date.now() + 3000);
        await app.client.statusWithPortSearch();
        expect(netstats(app)).toBe(byWatcher + 2);
        vi.setSystemTime(Date.now() + 60000);
        await app.client.statusWithPortSearch();
        expect(netstats(app)).toBe(byWatcher + 2);
        await app.client.close();
    });

    it('gives the watcher its whole allowance again where Folia started Spotify itself', async () => {
        playingPage();
        const options: ClientOptions = {
            running: true, port: 0, netstat: '', portAnswers: false, appDirectory: makeLauncherDirectory(),
        };
        const app = makeClient(options);
        // The app runs without a port Folia can find, and the watcher spends all six looks.
        for (let second = 0; second < 400; second += 60) {
            await app.client.statusFollowing();
            vi.setSystemTime(Date.now() + 60000);
        }
        expect(netstats(app)).toBe(6);
        // Folia closes and starts that app itself, and that start finds no port either: the app it
        // opened shows its port only afterwards.
        await expect(app.client.restart()).rejects.toBeTruthy();
        expect(app.taskkills()).toBe(1);
        expect(app.spotifySpawns()).toBe(1);
        // The port is there now, and the watcher looks for it with its whole allowance again: what it
        // spent belongs to the Spotify that is gone, not to the one the start opened.
        options.netstat = oneListener;
        options.portAnswers = true;
        playingPage();
        vi.setSystemTime(Date.now() + 60000);
        await expect(app.client.statusFollowing()).resolves.toMatchObject({ id: TRACK });
        await app.client.close();
    });
});

describe('the bridge log', () => {
    const makeBridgeWith = (officialClient: unknown) => {
        const warn = vi.fn();
        const bridge = createSpotifyApiBridge({
            store: { get: () => undefined, set: () => {}, delete: () => {} }, safeStorage: {}, fetch: vi.fn(),
            openExternal: vi.fn(), officialClient, now: () => 0, log: () => {}, warn,
        });
        return { bridge, warn };
    };

    it('says a repeated failure once, and another operation own failure on its own account', async () => {
        const unreachable = async () => { throw spotifyError('unavailable', 'The Spotify app cannot be reached'); };
        const officialClient: any = { play: vi.fn(unreachable), pause: vi.fn(unreachable), close: vi.fn(async () => {}) };
        const { bridge, warn } = makeBridgeWith(officialClient);

        // A status read fails twice a second while the app is not running: one line, not two.
        await bridge.request('client_pause');
        await bridge.request('client_pause');
        expect(warn).toHaveBeenCalledTimes(1);

        // Another operation's failure is a line of its own: the first one does not keep it quiet.
        await bridge.request('client_play', { id: TRACK });
        expect(warn).toHaveBeenCalledTimes(2);

        // A success lets the same failure of that operation be said again.
        officialClient.pause.mockImplementationOnce(async () => true);
        await bridge.request('client_pause');
        officialClient.pause.mockImplementation(unreachable);
        await bridge.request('client_pause');
        expect(warn).toHaveBeenCalledTimes(3);
        await bridge.shutdown();
    });
});
