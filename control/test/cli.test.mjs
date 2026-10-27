// control/test/cli.test.mjs
// node:test coverage for the control CLI + MCP package: argv/config parsing, the PROTOCOL §5
// command -> tool mapping, human formatting, the HTTP transport against a local stub server,
// CDP target selection and the MCP stdio handshake. No Folia app and no network are needed.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CONTROL_TOOLS } from '../../shared/controlCatalog.mjs';
import { UsageError, discoverLocalControl, loadConfig, parseArgv, readTokenFile } from '../lib/config.mjs';
import { resolveCommand } from '../lib/commands.mjs';
import {
    describeEnvelopeError,
    describeTransportError,
    formatEventLines,
    formatQueue,
    formatSearchResults,
    formatScreenshot,
    formatStateSnapshot,
    formatStatus,
    formatToolResult,
    formatVolume,
    renderTable,
    stringWidth,
} from '../lib/format.mjs';
import { TransportError, createHttpTransport, pickCdpTarget } from '../lib/transport.mjs';
import {
    createMcpHandler,
    envelopeToToolResult,
    exposedTools,
    runStdioMcpServer,
} from '../lib/mcpProtocol.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTROL_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(HERE, '..', '..');
const CLI = path.join(CONTROL_ROOT, 'cli.mjs');
const MCP = path.join(CONTROL_ROOT, 'mcp.mjs');
const TEST_TOKEN = 'test-token';

const CLEAN_ENV = (() => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key.startsWith('FOLIA_CONTROL_')) {
            delete env[key];
        }
    }
    return env;
})();

const STUB_STATE = {
    app: { version: '0.7.21-test', platform: 'test', isElectron: true, controlVersion: 1 },
    view: { view: 'player', panelOpen: false, panelTab: null, settingsOpen: false, paletteOpen: false },
    playback: {
        state: 'playing',
        isLoadingToPlay: false,
        isFmMode: false,
        song: {
            id: 'song-1',
            title: 'Stub Song',
            artist: 'Stub Artist',
            artists: ['Stub Artist'],
            album: 'Stub Album',
            durationMs: 210000,
            providerId: 'qishui',
            mediaId: 'media-1',
            isLocal: false,
        },
        positionSeconds: 42,
        durationSeconds: 210,
        queueLength: 2,
        currentQueueIndex: 0,
        replayGainMode: 'off',
        lyricOffsetMs: 0,
        liked: false,
    },
    volume: { level: 0.65, percent: 65, muted: false, loopMode: 'all' },
    visualizer: {
        mode: 'fume',
        background: 'common',
        randomPerSong: false,
        smartBeatEnabled: true,
        glowBlurQuantize: false,
        frameRate: 60,
    },
    theme: {
        daylight: false,
        followSystemTheme: false,
        coverColorBg: false,
        staticMode: false,
        disableHomeDynamicBackground: false,
    },
    lyrics: {
        available: true,
        format: 'lrc',
        lineCount: 2,
        currentLineIndex: 1,
        offsetMs: 0,
        globalOffsetMs: 0,
        currentLine: { index: 1, startTime: 12000, endTime: 15000, text: 'Stub lyric line' },
    },
    providers: [{ id: 'qishui', displayName: 'Qishui', status: 'ok', requiresAccount: false }],
    queue: {
        items: [
            { index: 0, song: { title: 'Stub Song', artist: 'Stub Artist', durationMs: 210000 } },
            { index: 1, song: { title: 'Second Song', artist: 'Other Artist', durationMs: 180000 } },
        ],
        total: 2,
    },
};

// ---------------------------------------------------------------------------------------------
// Helpers: config resolution, stub HTTP server, spawned processes
// ---------------------------------------------------------------------------------------------

function planFor(argv, env = {}) {
    const parsed = parseArgv(argv);
    const config = loadConfig(parsed, env);
    return resolveCommand(parsed, config);
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', chunk => {
            body += chunk;
        });
        request.on('end', () => resolve(body));
        request.on('error', reject);
    });
}

/** A local stand-in for electron/controlServer.cjs: same routes and envelope shapes. */
async function startStubServer() {
    const requests = [];
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const authorization = request.headers.authorization ?? '';
        requests.push({ method: request.method, path: url.pathname, authorization });

        const send = (status, payload) => {
            response.writeHead(status, { 'content-type': 'application/json' });
            response.end(JSON.stringify(payload));
        };
        const envelope = (name, data) => ({
            ok: true,
            tool: name,
            data,
            durationMs: 1,
            ts: Date.now(),
        });

        if (url.pathname === '/health') {
            send(200, {
                ok: true,
                app: 'folia',
                version: '0.7.21-test',
                controlApiVersion: 1,
                pid: process.pid,
                port: 4567,
            });
            return;
        }
        if (authorization !== `Bearer ${TEST_TOKEN}`) {
            send(401, { ok: false, error: { code: 'unauthorized', message: 'bad token' } });
            return;
        }
        if (url.pathname === '/tools' && request.method === 'GET') {
            send(200, { ok: true, tools: CONTROL_TOOLS });
            return;
        }
        if (url.pathname === '/state' && request.method === 'GET') {
            send(200, { ok: true, data: STUB_STATE });
            return;
        }
        if (url.pathname === '/events' && request.method === 'GET') {
            send(200, {
                ok: true,
                data: {
                    cursor: 3,
                    events: [{ seq: 3, ts: Date.now(), type: 'playback.songChanged', data: { title: 'Stub Song' } }],
                },
            });
            return;
        }
        if (url.pathname === '/invoke' && request.method === 'POST') {
            let body;
            try {
                body = JSON.parse(await readRequestBody(request));
            } catch {
                send(400, { ok: false, error: { code: 'bad_request', message: 'invalid JSON' } });
                return;
            }
            const name = body.name;
            if (name === 'folia_status') {
                send(200, envelope(name, {
                    app: STUB_STATE.app,
                    playback: STUB_STATE.playback,
                    volume: STUB_STATE.volume,
                    view: STUB_STATE.view,
                    controlApiVersion: 1,
                }));
                return;
            }
            if (name === 'folia_volume') {
                send(200, envelope(name, { level: 0.3, percent: 30, muted: false }));
                return;
            }
            if (name === 'folia_tools') {
                send(200, envelope(name, { tools: CONTROL_TOOLS }));
                return;
            }
            if (name === 'folia_events') {
                send(200, envelope(name, {
                    cursor: 3,
                    events: [{ seq: 3, ts: Date.now(), type: 'playback.songChanged', data: { title: 'Stub Song' } }],
                }));
                return;
            }
            if (name === 'folia_screenshot') {
                send(200, envelope(name, { base64: 'iVBORw0KGgo=', mimeType: 'image/png', width: 10, height: 10 }));
                return;
            }
            if (name === 'folia_play_search') {
                send(200, {
                    ok: false,
                    tool: name,
                    error: { code: 'no_song', message: 'no song is playing' },
                    durationMs: 1,
                    ts: Date.now(),
                });
                return;
            }
            send(200, envelope(name, { echo: { name, args: body.args ?? {} } }));
            return;
        }
        send(404, { ok: false, error: { code: 'not_found', message: `${request.method} ${url.pathname}` } });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        url: `http://127.0.0.1:${port}`,
        token: TEST_TOKEN,
        requests,
        state: STUB_STATE,
        close: async () => {
            server.closeAllConnections?.();
            await new Promise(resolve => server.close(resolve));
        },
    };
}

function runNode(file, args, { input = '', extraEnv = {}, timeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [file, ...args], {
            cwd: REPO_ROOT,
            env: { ...CLEAN_ENV, ...extraEnv },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            stdout += chunk;
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', chunk => {
            stderr += chunk;
        });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`spawn timeout: ${file} ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }, timeoutMs);
        child.on('error', error => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', code => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
        child.stdin.end(input);
    });
}

async function getClosedPort() {
    const server = http.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

function parseJsonLines(text) {
    return String(text)
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

// ---------------------------------------------------------------------------------------------
// argv / config
// ---------------------------------------------------------------------------------------------

test('parseArgv takes a command, positionals and global options', () => {
    const parsed = parseArgv([
        'search', '周杰伦', '晴天',
        '--url', 'http://127.0.0.1:4600',
        '--json',
        '--limit=5',
        '--provider', 'qishui',
    ]);
    assert.equal(parsed.command, 'search');
    assert.deepEqual(parsed.args, ['周杰伦', '晴天']);
    assert.equal(parsed.options.url, 'http://127.0.0.1:4600');
    assert.equal(parsed.options.json, true);
    assert.equal(parsed.options.limit, '5');
    assert.equal(parsed.options.provider, 'qishui');
    assert.equal(parseArgv([]).command, null);
    const afterDoubleDash = parseArgv(['search', '--', '--looks-like-a-flag']);
    assert.equal(afterDoubleDash.command, 'search');
    assert.deepEqual(afterDoubleDash.args, ['--looks-like-a-flag']);
});

test('parseArgv rejects missing values, unknown options and inline booleans', () => {
    assert.throws(() => parseArgv(['status', '--url']), UsageError);
    assert.throws(() => parseArgv(['status', '--nope']), UsageError);
    assert.throws(() => parseArgv(['status', '--json=1']), UsageError);
});

test('loadConfig applies the documented defaults', () => {
    const config = loadConfig(parseArgv(['status']), {});
    assert.equal(config.url, 'http://127.0.0.1:4567');
    assert.equal(config.cdpUrl, 'http://127.0.0.1:9222');
    assert.equal(config.transport, 'auto');
    assert.equal(config.timeoutMs, 30000);
    assert.equal(config.token, null);
    assert.equal(config.tokenSource, 'none');
    assert.equal(config.json, false);
});

test('loadConfig reads the environment and a token file without echoing the token', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-control-test-'));
    const tokenFile = path.join(directory, 'control-token');
    fs.writeFileSync(tokenFile, 'secret-token\n');
    try {
        assert.equal(readTokenFile(tokenFile), 'secret-token');
        const fromFile = loadConfig(parseArgv(['status', '--token-file', tokenFile]), { FOLIA_CONTROL_PORT: '4600' });
        assert.equal(fromFile.url, 'http://127.0.0.1:4600');
        assert.equal(fromFile.token, 'secret-token');
        assert.equal(fromFile.tokenSource, 'file');
        assert.equal(fromFile.tokenSourceText.includes('secret-token'), false);

        const fromEnv = loadConfig(parseArgv(['status']), {
            FOLIA_CONTROL_URL: 'http://127.0.0.1:9999',
            FOLIA_CONTROL_TOKEN: 'env-token',
            FOLIA_CONTROL_TRANSPORT: 'cdp',
            FOLIA_CONTROL_TIMEOUT: '1234',
        });
        assert.equal(fromEnv.url, 'http://127.0.0.1:9999');
        assert.equal(fromEnv.token, 'env-token');
        assert.equal(fromEnv.tokenSource, 'env');
        assert.equal(fromEnv.transport, 'cdp');
        assert.equal(fromEnv.timeoutMs, 1234);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('loadConfig rejects invalid transport, port, timeout, url and token files', () => {
    assert.throws(() => loadConfig(parseArgv(['status', '--transport', 'smoke']), {}), UsageError);
    assert.throws(() => loadConfig(parseArgv(['status']), { FOLIA_CONTROL_PORT: 'abc' }), UsageError);
    assert.throws(() => loadConfig(parseArgv(['status', '--timeout', '0']), {}), UsageError);
    assert.throws(() => loadConfig(parseArgv(['status', '--url', 'not-a-url']), {}), UsageError);
    assert.throws(() => loadConfig(parseArgv(['status', '--token-file', '/definitely/missing/token']), {}), UsageError);
});

test('discoverLocalControl reads control-server.json from an isolated profile', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-control-discover-'));
    const userData = path.join(home, 'test-results', 'run-desktop', 'userdata');
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(
        path.join(userData, 'control-server.json'),
        JSON.stringify({ url: 'http://127.0.0.1:4588', token: 'discovered-token', port: 4588 }),
    );
    try {
        const discovered = discoverLocalControl({}, { cwd: home, home });
        assert.equal(discovered.url, 'http://127.0.0.1:4588');
        assert.equal(discovered.token, 'discovered-token');
        assert.match(discovered.source, /control-server\.json$/);
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
    assert.equal(discoverLocalControl({}, { cwd: home, home }), null);
});

// ---------------------------------------------------------------------------------------------
// command -> tool mapping (PROTOCOL §5)
// ---------------------------------------------------------------------------------------------

test('maps introspection and search/play commands onto catalog tools', () => {
    assert.deepEqual(planFor(['status']), { tool: 'folia_status', args: {} });
    assert.deepEqual(planFor(['state']), { tool: 'folia_state', args: {} });
    assert.deepEqual(planFor(['state', '--lyrics', '--no-queue']), {
        tool: 'folia_state',
        args: { includeQueue: false, includeLyrics: true },
    });
    assert.deepEqual(planFor(['tools', '--group', 'playback']), { tool: 'folia_tools', args: { group: 'playback' } });

    assert.deepEqual(planFor(['search', 'jay', 'chou', '--provider', 'qishui', '--limit', '5', '--offset', '10']), {
        tool: 'folia_search',
        args: { query: 'jay chou', provider: 'qishui', limit: 5, offset: 10 },
    });
    assert.deepEqual(planFor(['play', 'jay chou']), { tool: 'folia_play_search', args: { query: 'jay chou' } });
    assert.deepEqual(planFor(['play', '--id', 'song-9', '--provider', 'netease']), {
        tool: 'folia_play',
        args: { id: 'song-9', provider: 'netease' },
    });
    assert.throws(() => planFor(['play']), UsageError);
    assert.throws(() => planFor(['search']), UsageError);
});

test('maps transport, seek, volume, mute, loop, like and sleep', () => {
    const expected = new Map([
        ['pause', 'pause'],
        ['resume', 'play'],
        ['toggle', 'toggle'],
        ['next', 'next'],
        ['prev', 'prev'],
        ['stop', 'stop'],
    ]);
    for (const [command, action] of expected) {
        assert.deepEqual(planFor([command]), { tool: 'folia_transport', args: { action } });
    }
    assert.deepEqual(planFor(['seek', '42']), { tool: 'folia_seek', args: { seconds: 42 } });
    assert.deepEqual(planFor(['seek', '50%']), { tool: 'folia_seek', args: { percent: 50 } });
    assert.deepEqual(planFor(['seek', '1:30']), { tool: 'folia_seek', args: { seconds: 90 } });

    assert.deepEqual(planFor(['volume']), { tool: 'folia_volume', args: { status: true } });
    assert.deepEqual(planFor(['volume', '35']), { tool: 'folia_volume', args: { level: 35 } });
    assert.deepEqual(planFor(['volume', '--delta', '-10']), { tool: 'folia_volume', args: { delta: -10 } });
    assert.deepEqual(planFor(['mute', 'on']), { tool: 'folia_volume', args: { mute: true } });
    assert.deepEqual(planFor(['mute']), { special: 'mute-toggle' });
    assert.throws(() => planFor(['mute', 'perhaps']), UsageError);

    assert.deepEqual(planFor(['loop', 'one']), { tool: 'folia_loop', args: { mode: 'one' } });
    assert.deepEqual(planFor(['loop']), { tool: 'folia_loop', args: { cycle: true } });
    assert.deepEqual(planFor(['shuffle']), { tool: 'folia_shuffle', args: {} });
    assert.deepEqual(planFor(['like', 'on']), { tool: 'folia_like', args: { liked: true } });
    assert.deepEqual(planFor(['like']), { tool: 'folia_like', args: {} });
    assert.deepEqual(planFor(['replaygain', 'album']), { tool: 'folia_replaygain', args: { mode: 'album' } });

    assert.deepEqual(planFor(['sleep', '90']), { tool: 'folia_sleep_timer', args: { hours: 1, minutes: 30 } });
    assert.deepEqual(planFor(['sleep', '1h30m']), { tool: 'folia_sleep_timer', args: { hours: 1, minutes: 30 } });
    assert.deepEqual(planFor(['sleep', '--cancel']), { tool: 'folia_sleep_timer', args: { cancel: true } });
    assert.deepEqual(planFor(['sleep']), { tool: 'folia_sleep_timer', args: { status: true } });
});

test('maps queue subcommands', () => {
    assert.deepEqual(planFor(['queue']), { tool: 'folia_queue', args: {} });
    assert.deepEqual(planFor(['queue', 'list', '--limit', '20']), { tool: 'folia_queue', args: { limit: 20 } });
    assert.deepEqual(planFor(['queue', 'play', '3']), { tool: 'folia_queue_play', args: { index: 3 } });
    assert.deepEqual(planFor(['queue', 'add', 'jay chou', '--next']), {
        tool: 'folia_queue_add',
        args: { query: 'jay chou', position: 'next' },
    });
    assert.deepEqual(planFor(['queue', 'remove', '2']), { tool: 'folia_queue_remove', args: { index: 2 } });
    assert.deepEqual(planFor(['queue', 'remove', '2', '5']), { tool: 'folia_queue_remove', args: { indices: [2, 5] } });
    assert.deepEqual(planFor(['queue', 'move', '1', '4']), { tool: 'folia_queue_move', args: { from: 1, to: 4 } });
    assert.deepEqual(planFor(['queue', 'move', '1', 'next']), { tool: 'folia_queue_move', args: { from: 1, toNext: true } });
    assert.deepEqual(planFor(['queue', 'move', '1', 'end']), { tool: 'folia_queue_move', args: { from: 1, toEnd: true } });
    assert.deepEqual(planFor(['queue', 'clear']), { tool: 'folia_queue_clear', args: {} });
    assert.throws(() => planFor(['queue', 'dance']), UsageError);
    assert.throws(() => planFor(['queue', 'remove']), UsageError);
});

test('maps lyrics, visualizer, video and theme commands', () => {
    assert.deepEqual(planFor(['lyrics']), { tool: 'folia_lyrics', args: {} });
    assert.deepEqual(planFor(['lyrics', '--lines']), { tool: 'folia_lyrics', args: { includeLines: true } });
    assert.deepEqual(planFor(['lyrics', 'offset', '120']), { tool: 'folia_lyric_offset', args: { scope: 'song', ms: 120 } });
    assert.deepEqual(planFor(['lyrics', 'offset', '--delta', '-50', '--global']), {
        tool: 'folia_lyric_offset',
        args: { scope: 'global', deltaMs: -50 },
    });
    assert.deepEqual(planFor(['lyrics', 'seek', '7']), { tool: 'folia_lyric_seek', args: { lineIndex: 7 } });

    assert.deepEqual(planFor(['visual', 'list']), { tool: 'folia_visualizer_list', args: {} });
    assert.deepEqual(planFor(['visual', 'set', 'fume']), { tool: 'folia_visualizer_set', args: { mode: 'fume' } });
    assert.deepEqual(planFor(['visual', 'bg', 'latent']), { tool: 'folia_background_set', args: { mode: 'latent' } });
    assert.deepEqual(planFor(['visual', 'tune', 'monet', '{"backgroundLayout":"full-overlay"}']), {
        tool: 'folia_visual_tuning',
        args: { target: 'monet', patch: { backgroundLayout: 'full-overlay' } },
    });
    assert.deepEqual(planFor(['visual', 'video', 'on']), { tool: 'folia_video_layer', args: { enabled: true } });
    assert.deepEqual(planFor(['smartbeat', 'off']), { tool: 'folia_smart_beat', args: { enabled: false } });

    assert.deepEqual(planFor(['theme']), { tool: 'folia_appearance', args: {} });
    assert.deepEqual(planFor(['theme', 'day']), { tool: 'folia_appearance', args: { daylight: true } });
    assert.deepEqual(planFor(['theme', 'ai']), { tool: 'folia_appearance', args: { generateAITheme: true } });
});

test('maps settings, navigation, palette, library and window commands', () => {
    assert.deepEqual(planFor(['settings']), { tool: 'folia_settings_read', args: {} });
    assert.deepEqual(planFor(['settings', 'audio', 'volume']), {
        tool: 'folia_settings_read',
        args: { store: 'audio', key: 'volume' },
    });
    assert.deepEqual(planFor(['settings', 'set', 'audio.volume', '35']), {
        tool: 'folia_settings_write',
        args: { key: 'audio.volume', value: 35 },
    });
    assert.deepEqual(planFor(['settings', 'set', 'theme.daylight', 'true']), {
        tool: 'folia_settings_write',
        args: { key: 'theme.daylight', value: true },
    });
    assert.deepEqual(planFor(['settings', 'open', 'appearance']), {
        tool: 'folia_settings_open',
        args: { subview: 'appearance' },
    });

    assert.deepEqual(planFor(['nav', 'player']), { tool: 'folia_navigate', args: { view: 'player' } });
    assert.deepEqual(planFor(['panel', 'queue']), { tool: 'folia_panel', args: { tab: 'queue' } });
    assert.deepEqual(planFor(['panel', '--close']), { tool: 'folia_panel', args: { open: false } });
    assert.throws(() => planFor(['palette', 'open']), UsageError);
    assert.deepEqual(planFor(['palette', 'list', '--all']), {
        tool: 'folia_palette_list',
        args: { includeUnavailable: true },
    });
    assert.deepEqual(planFor(['palette', 'run', 'playback-next']), {
        tool: 'folia_palette_run',
        args: { id: 'playback-next' },
    });
    assert.deepEqual(planFor(['palette', 'run', 'playback-volume', '35']), {
        tool: 'folia_palette_run',
        args: { id: 'playback-volume', input: '35' },
    });

    assert.deepEqual(planFor(['library']), { tool: 'folia_library', args: { action: 'list' } });
    assert.deepEqual(planFor(['library', 'search', 'jay']), {
        tool: 'folia_library',
        args: { action: 'search', query: 'jay' },
    });
    assert.deepEqual(planFor(['library', 'play', 'local-1']), {
        tool: 'folia_library',
        args: { action: 'play', id: 'local-1' },
    });
    assert.deepEqual(planFor(['providers']), { tool: 'folia_providers', args: {} });

    assert.deepEqual(planFor(['window']), { tool: 'folia_window', args: { action: 'status' } });
    assert.deepEqual(planFor(['window', 'on-top', 'on']), { tool: 'folia_window', args: { action: 'alwaysOnTop', value: true } });
    assert.deepEqual(planFor(['window', 'click-through']), { tool: 'folia_window', args: { action: 'clickThrough' } });
    assert.deepEqual(planFor(['window', 'maximize']), { tool: 'folia_window', args: { action: 'maximize' } });
});

test('maps events, screenshot, call and quit escape hatches', () => {
    assert.deepEqual(planFor(['events', '--since', '4']), { tool: 'folia_events', args: { since: 4 } });
    assert.deepEqual(planFor(['events', '--watch']), { special: 'events-watch', args: {} });
    assert.deepEqual(planFor(['screenshot', '--out', 'shot.png']).args, { save: true, path: path.resolve('shot.png') });
    assert.deepEqual(planFor(['screenshot', '--no-save']), { tool: 'folia_screenshot', args: { save: false } });

    assert.deepEqual(planFor(['call', 'folia_volume', '{"level":30}']), {
        tool: 'folia_volume',
        args: { level: 30 },
    });
    assert.deepEqual(planFor(['call', 'folia_volume', '-']), { special: 'call-stdin', tool: 'folia_volume' });
    assert.throws(() => planFor(['call', 'folia_nope', '{}']), UsageError);
    assert.throws(() => planFor(['call', 'folia_volume', '{oops}']), UsageError);

    assert.deepEqual(planFor(['quit', '--yes']), { tool: 'folia_quit', args: { confirm: true } });
    assert.throws(() => planFor(['quit']), UsageError);

    assert.deepEqual(planFor(['doctor']), { special: 'doctor' });
    assert.deepEqual(planFor(['mcp']), { special: 'mcp' });
    assert.throws(() => planFor(['frobnicate']), UsageError);
});

// ---------------------------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------------------------

test('formats search results, queue and events as readable tables', () => {
    const search = formatSearchResults({
        query: 'jay',
        provider: 'qishui',
        results: [
            { index: 0, title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: 269000, providerId: 'qishui' },
            { index: 1, title: '七里香', artist: '周杰伦', album: '七里香', durationMs: 299000, providerId: 'qishui' },
        ],
    });
    assert.match(search, /results: 2/);
    assert.match(search, /TITLE/);
    assert.match(search, /晴天/);
    assert.match(search, /4:29/);

    const queue = formatQueue({
        total: 2,
        currentQueueIndex: 1,
        items: [
            { index: 0, song: { title: 'First', artist: 'A', durationMs: 1000 } },
            { index: 1, song: { title: 'Second', artist: 'B', durationMs: 2000 } },
        ],
    });
    assert.match(queue, /queue: 2 song\(s\)/);
    assert.match(queue, />\s+1/);
    assert.match(queue, /Second/);

    const events = formatEventLines({
        cursor: 3,
        events: [{ seq: 2, ts: 1700000000000, type: 'playback.songChanged', data: { title: 'x' } }],
    });
    assert.match(events, /cursor 3/);
    assert.match(events, /#2 .*playback\.songChanged/);

    assert.match(renderTable(['A', 'B'], [['1', '2']]), /A\s+B/);
    assert.equal(stringWidth('晴天'), 4);
    assert.equal(stringWidth('ab'), 2);
});

test('formats status, state, volume and screenshots', () => {
    const status = formatStatus({
        app: STUB_STATE.app,
        playback: STUB_STATE.playback,
        volume: STUB_STATE.volume,
        view: STUB_STATE.view,
    });
    assert.match(status, /Folia 0\.7\.21-test/);
    assert.match(status, /Stub Song/);
    assert.match(status, /65%/);

    const state = formatStateSnapshot(STUB_STATE);
    assert.match(state, /playback: playing/);
    assert.match(state, /Stub Song — Stub Artist/);
    assert.match(state, /volume: 65%/);
    assert.match(state, /visualizer fume/);
    assert.match(state, /lyrics: lrc/);
    assert.match(state, /providers: qishui \(ok\)/);

    assert.match(formatVolume({ level: 0.35, muted: false }), /35%/);
    assert.match(formatVolume({ percent: 30, muted: true }), /30% \(muted\)/);
    assert.match(formatScreenshot({ path: '/tmp/a.png', width: 10, height: 20 }), /saved \/tmp\/a\.png \(10x20\)/);
    assert.match(formatToolResult('folia_volume', { level: 0.5, muted: false }), /50%/);
    assert.match(formatToolResult('folia_unknown', { hello: 'world' }), /"hello": "world"/);
});

test('errors carry an actionable hint', () => {
    const envelope = describeEnvelopeError({
        ok: false,
        tool: 'folia_volume',
        error: { code: 'unauthorized', message: 'bad token' },
    });
    assert.match(envelope, /unauthorized/);
    assert.match(envelope, /hint: /);
    assert.match(envelope, /token/);

    const transport = describeTransportError({
        code: 'connection_failed',
        message: 'cannot reach the server',
        hint: 'start the app with FOLIA_CONTROL=1',
    });
    assert.match(transport, /connection failed \(connection_failed\)/);
    assert.match(transport, /FOLIA_CONTROL=1/);
});

// ---------------------------------------------------------------------------------------------
// HTTP transport against the stub server
// ---------------------------------------------------------------------------------------------

test('HTTP transport speaks /health /tools /state /events /invoke with a bearer token', async () => {
    const stub = await startStubServer();
    const transport = createHttpTransport({ url: stub.url, token: stub.token, timeoutMs: 5000 });
    try {
        const health = await transport.health();
        assert.equal(health.ok, true);
        assert.equal(health.version, '0.7.21-test');

        const tools = await transport.tools();
        assert.equal(tools.length, CONTROL_TOOLS.length);

        const envelope = await transport.invoke('folia_status', {});
        assert.equal(envelope.ok, true);
        assert.equal(envelope.data.playback.song.title, 'Stub Song');

        const state = await transport.state({ includeQueue: true });
        assert.equal(state.playback.song.title, 'Stub Song');

        const events = await transport.events({ since: 0 });
        assert.equal(events.events.length, 1);
        assert.equal(events.cursor, 3);

        assert.ok(stub.requests.some(request => request.authorization === `Bearer ${stub.token}`));
        assert.ok(stub.requests.some(request => request.path === '/health'));

        const unauthorized = createHttpTransport({ url: stub.url, token: 'wrong', timeoutMs: 5000 });
        await assert.rejects(
            unauthorized.invoke('folia_status', {}),
            error => error instanceof TransportError && error.code === 'unauthorized',
        );

        await transport.close();
        await assert.rejects(
            transport.invoke('folia_status', {}),
            error => error instanceof TransportError && error.code === 'connection_closed',
        );
    } finally {
        await stub.close();
    }
});

test('HTTP transport reports a connection failure with a hint', async () => {
    const port = await getClosedPort();
    const transport = createHttpTransport({
        url: `http://127.0.0.1:${port}`,
        token: TEST_TOKEN,
        timeoutMs: 2000,
    });
    await assert.rejects(transport.health(), error => (
        error instanceof TransportError
        && error.code === 'connection_failed'
        && /FOLIA_CONTROL=1/.test(error.hint)
    ));
});

// ---------------------------------------------------------------------------------------------
// CDP target selection
// ---------------------------------------------------------------------------------------------

test('pickCdpTarget filters devtools/worker targets and honors --target', () => {
    const targets = [
        { type: 'page', url: 'devtools://devtools/bundled/inspector.html', webSocketDebuggerUrl: 'ws://devtools' },
        { type: 'page', url: 'http://localhost:3000/', webSocketDebuggerUrl: 'ws://app' },
        { type: 'worker', url: 'http://localhost:3000/worker.js', webSocketDebuggerUrl: 'ws://worker' },
        { type: 'page', url: 'file:///Applications/Folia/index.html', webSocketDebuggerUrl: 'ws://file' },
    ];
    assert.equal(pickCdpTarget(targets).webSocketDebuggerUrl, 'ws://app');
    assert.equal(pickCdpTarget(targets, 'file:').webSocketDebuggerUrl, 'ws://file');
    assert.equal(pickCdpTarget([targets[0]]), null);
    assert.equal(pickCdpTarget([], null), null);
    assert.equal(pickCdpTarget(targets, 'no-such-page'), null);
});

// ---------------------------------------------------------------------------------------------
// MCP handler (in-process, fake transport)
// ---------------------------------------------------------------------------------------------

function fakeTransport(overrides = {}) {
    const state = { calls: [] };
    return {
        kind: 'fake',
        state,
        async invoke(name, args) {
            state.calls.push({ name, args });
            if (overrides[name]) {
                return overrides[name](name, args);
            }
            return { ok: true, tool: name, data: { echo: { name, args } }, ts: Date.now() };
        },
        async list() {
            return CONTROL_TOOLS;
        },
        async state() {
            return STUB_STATE;
        },
        async events() {
            return { cursor: 3, events: [] };
        },
        async health() {
            return { ok: true };
        },
        async close() {},
    };
}

test('MCP initialize/tools/list exposes the whole catalog and adds annotations', async () => {
    const handler = createMcpHandler({ transport: fakeTransport() });
    const init = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'folia-control');
    assert.equal(init.result.serverInfo.version, '1.0.0');

    const list = await handler.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(list.result.tools.length, CONTROL_TOOLS.length);
    const statusTool = list.result.tools.find(tool => tool.name === 'folia_status');
    assert.equal(statusTool.annotations.readOnlyHint, true);
    assert.equal(statusTool.annotations.destructiveHint, false);
    const clearTool = list.result.tools.find(tool => tool.name === 'folia_queue_clear');
    assert.equal(clearTool.annotations.destructiveHint, true);
    assert.equal(exposedTools().length, CONTROL_TOOLS.length);
});

test('MCP tools/call converts envelopes, screenshots and errors', async () => {
    const transport = fakeTransport({
        folia_screenshot: () => ({
            ok: true,
            tool: 'folia_screenshot',
            data: { base64: 'iVBORw0KGgo=', mimeType: 'image/png', width: 10, height: 10 },
        }),
        folia_play_search: () => ({
            ok: false,
            tool: 'folia_play_search',
            error: { code: 'no_song', message: 'no song is playing' },
        }),
    });
    const handler = createMcpHandler({ transport });

    const ok = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'folia_status', arguments: { includeQueue: true } },
    });
    assert.equal(ok.result.isError, false);
    assert.match(ok.result.content[0].text, /"name": "folia_status"/);

    const image = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'folia_screenshot', arguments: {} },
    });
    assert.equal(image.result.isError, false);
    assert.equal(image.result.content[0].type, 'image');
    assert.equal(image.result.content[0].data, 'iVBORw0KGgo=');
    assert.equal(image.result.content[1].type, 'text');
    assert.match(image.result.content[1].text, /"width":10/);

    const failure = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'folia_play_search', arguments: { query: 'x' } },
    });
    assert.equal(failure.result.isError, true);
    assert.match(failure.result.content[0].text, /no_song: no song is playing/);

    const unknown = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'folia_nope', arguments: {} },
    });
    assert.equal(unknown.error.code, -32602);

    assert.equal(envelopeToToolResult(null).isError, true);
});

test('MCP protocol errors: unknown method, ping, notifications, resources and transport failure', async () => {
    const transport = fakeTransport();
    const handler = createMcpHandler({ transport });

    assert.deepEqual(await handler.handleMessage({ jsonrpc: '2.0', id: 1, method: 'ping' }), {
        jsonrpc: '2.0',
        id: 1,
        result: {},
    });
    assert.equal(await handler.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

    const unknownMethod = await handler.handleMessage({ jsonrpc: '2.0', id: 2, method: 'unknown/method' });
    assert.equal(unknownMethod.error.code, -32601);

    const resources = await handler.handleMessage({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
    assert.equal(resources.result.resources[0].uri, 'folia://state');

    const read = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: { uri: 'folia://state' },
    });
    assert.deepEqual(JSON.parse(read.result.contents[0].text), STUB_STATE);

    const readUnknown = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 5,
        method: 'resources/read',
        params: { uri: 'folia://nope' },
    });
    assert.equal(readUnknown.error.code, -32602);

    const failingTransport = {
        ...fakeTransport(),
        async invoke() {
            throw new TransportError({
                code: 'connection_failed',
                message: 'cannot reach the Folia control server',
                hint: 'start the app with FOLIA_CONTROL=1',
            });
        },
    };
    const failingHandler = createMcpHandler({ transport: failingTransport });
    const failedCall = await failingHandler.handleMessage({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'folia_status', arguments: {} },
    });
    assert.equal(failedCall.error.code, -32603);
    assert.equal(failedCall.error.data.hint, 'start the app with FOLIA_CONTROL=1');
});

test('runStdioMcpServer processes one JSON-RPC message per line and survives bad input', async () => {
    class Collector extends Writable {
        constructor() {
            super();
            this.chunks = [];
        }

        _write(chunk, encoding, callback) {
            this.chunks.push(chunk.toString());
            callback();
        }
    }

    const input = Readable.from([
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n',
        'not json\n',
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
    ]);
    const output = new Collector();
    const transport = fakeTransport();
    await runStdioMcpServer({ transport, input, output });
    const responses = parseJsonLines(output.chunks.join(''));
    assert.equal(responses.length, 3);
    assert.equal(responses[0].id, 1);
    assert.equal(responses[1].error.code, -32700);
    assert.equal(responses[2].result.tools.length, CONTROL_TOOLS.length - 1);
});

// ---------------------------------------------------------------------------------------------
// Spawned processes: real CLI and real MCP stdio handshake against the stub server
// ---------------------------------------------------------------------------------------------

test('node control/cli.mjs --help exits 0 with the command table', async () => {
    const result = await runNode(CLI, ['--help']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /status\s+What is playing now/);
    assert.match(result.stdout, /queue move <from> <to\|next\|end>/);
    assert.match(result.stdout, /folia mcp/);
});

test('CLI status works over the stub HTTP server (human and --json)', async () => {
    const stub = await startStubServer();
    try {
        const json = await runNode(CLI, [
            'status', '--json', '--url', stub.url, '--token', stub.token, '--transport', 'http',
        ]);
        assert.equal(json.code, 0, json.stderr);
        const data = JSON.parse(json.stdout);
        assert.equal(data.app.version, '0.7.21-test');
        assert.equal(data.playback.song.title, 'Stub Song');

        const human = await runNode(CLI, [
            'status', '--url', stub.url, '--token', stub.token, '--transport', 'http',
        ]);
        assert.equal(human.code, 0, human.stderr);
        assert.match(human.stdout, /Stub Song/);
        assert.match(human.stdout, /65%/);

        const volume = await runNode(CLI, [
            'volume', '30', '--url', stub.url, '--token', stub.token, '--transport', 'http',
        ]);
        assert.equal(volume.code, 0, volume.stderr);
        assert.match(volume.stdout, /30%/);
    } finally {
        await stub.close();
    }
});

test('CLI tools/call/events and the auto transport work over the stub server', async () => {
    const stub = await startStubServer();
    try {
        // Default --transport auto probes /health over HTTP and stays there.
        const auto = await runNode(CLI, [
            'status', '--json', '--url', stub.url, '--token', stub.token,
        ]);
        assert.equal(auto.code, 0, auto.stderr);
        assert.equal(JSON.parse(auto.stdout).playback.song.title, 'Stub Song');

        const tools = await runNode(CLI, [
            'tools', '--json', '--url', stub.url, '--token', stub.token, '--transport', 'http',
        ]);
        assert.equal(tools.code, 0, tools.stderr);
        const toolList = JSON.parse(tools.stdout).tools;
        assert.equal(toolList.length, CONTROL_TOOLS.length);

        const call = await runNode(CLI, [
            'call', 'folia_status', '{}', '--url', stub.url, '--token', stub.token, '--transport', 'http',
        ]);
        assert.equal(call.code, 0, call.stderr);
        assert.match(call.stdout, /Stub Song/);

        const events = await runNode(CLI, [
            'events', '--since', '0', '--url', stub.url, '--token', stub.token, '--transport', 'http',
        ]);
        assert.equal(events.code, 0, events.stderr);
        assert.match(events.stdout, /cursor 3/);
        assert.match(events.stdout, /playback\.songChanged/);
    } finally {
        await stub.close();
    }
});

test('CLI maps failures to exit codes 1 and 2 with actionable stderr', async () => {
    const stub = await startStubServer();
    try {
        const controlFailure = await runNode(CLI, [
            'play', 'missing song', '--url', stub.url, '--token', stub.token, '--transport', 'http',
        ]);
        assert.equal(controlFailure.code, 1);
        assert.match(controlFailure.stderr, /no_song/);
        assert.match(controlFailure.stderr, /hint:/);

        const unauthorized = await runNode(CLI, [
            'status', '--url', stub.url, '--token', 'wrong-token', '--transport', 'http',
        ]);
        assert.equal(unauthorized.code, 2);
        assert.match(unauthorized.stderr, /unauthorized/);
        assert.doesNotMatch(unauthorized.stderr, /wrong-token/);

        const port = await getClosedPort();
        const refused = await runNode(CLI, [
            'status', '--url', `http://127.0.0.1:${port}`, '--transport', 'http', '--timeout', '2000',
        ]);
        assert.equal(refused.code, 2);
        assert.match(refused.stderr, /connection failed/);
        assert.match(refused.stderr, /FOLIA_CONTROL=1/);

    } finally {
        await stub.close();
    }
});

test('CLI doctor passes against the stub server and reports health/tools/catalog', async () => {
    const stub = await startStubServer();
    try {
        const result = await runNode(CLI, [
            'doctor', '--url', stub.url, '--token', stub.token, '--transport', 'http',
        ]);
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, /result: PASS/);
        assert.match(result.stdout, /health\s+ok/);
        assert.match(result.stdout, /tools\s+ok/);
        assert.match(result.stdout, /catalog\s+ok/);
        assert.doesNotMatch(result.stdout, new RegExp(stub.token));
    } finally {
        await stub.close();
    }
});

test('MCP stdio handshake works end to end through node control/mcp.mjs', async () => {
    const stub = await startStubServer();
    try {
        const input = [
            '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}',
            '{"jsonrpc":"2.0","method":"notifications/initialized"}',
            '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
            '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"folia_status","arguments":{}}}',
            '{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"folia://state"}}',
        ].join('\n');
        const result = await runNode(
            MCP,
            ['--url', stub.url, '--token', stub.token, '--transport', 'http'],
            { input: `${input}\n` },
        );
        assert.equal(result.code, 0, result.stderr);
        const responses = parseJsonLines(result.stdout);
        const byId = new Map(responses.map(response => [response.id, response]));
        assert.equal(byId.size, 4);
        assert.equal(byId.get(1).result.protocolVersion, '2025-06-18');
        assert.equal(byId.get(1).result.serverInfo.name, 'folia-control');
        assert.equal(byId.get(2).result.tools.length, CONTROL_TOOLS.length - 1);
        const status = JSON.parse(byId.get(3).result.content[0].text);
        assert.equal(status.playback.song.title, 'Stub Song');
        const state = JSON.parse(byId.get(4).result.contents[0].text);
        assert.equal(state.volume.percent, 65);
    } finally {
        await stub.close();
    }
});

test('MCP stdio server accepts --token-file and never echoes the token', async () => {
    const stub = await startStubServer();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-control-test-'));
    const tokenFile = path.join(directory, 'control-token');
    fs.writeFileSync(tokenFile, `${stub.token}\n`);
    try {
        const result = await runNode(
            MCP,
            ['--url', stub.url, '--token-file', tokenFile, '--transport', 'http'],
            { input: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"folia_status","arguments":{}}}\n' },
        );
        assert.equal(result.code, 0, result.stderr);
        const [response] = parseJsonLines(result.stdout);
        assert.equal(response.result.isError, false);
        assert.match(response.result.content[0].text, /Stub Song/);
        assert.doesNotMatch(result.stdout, new RegExp(stub.token));
        assert.doesNotMatch(result.stderr, new RegExp(stub.token));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
        await stub.close();
    }
});

test('rejects online IDs without a provider before config or transport work', async () => {
    assert.throws(() => planFor(['play', '--id', 'song-9']), error => error instanceof UsageError && /--provider/.test(error.message));
    assert.throws(() => planFor(['play', '--id', 'song-9', '--provider', '   ']), UsageError);
    assert.throws(() => planFor(['play', '--id', '', '--provider', 'qishui']), UsageError);
    const result = await runNode(CLI, ['play', '--id', 'song-9', '--url', 'http://127.0.0.1:1', '--token-file', '/missing-folia-token']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /play --id requires --provider/);
    assert.doesNotMatch(result.stderr, /ENOENT|connection_failed/);
    assert.deepEqual(planFor(['library', 'play', 'local-9']), { tool: 'folia_library', args: { action: 'play', id: 'local-9' } });
});

test('help names the required provider and local playback route', async () => {
    const result = await runNode(CLI, ['--help']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /play --provider <provider> --id <id>/);
    assert.match(result.stdout, /--provider is required/);
    assert.match(result.stdout, /library play <id>/);
});

test('search version is explicitly unknown and is never guessed from names', () => {
    const data = { items: [
        { title: 'Song (Original)', artist: 'Original Artist', providerId: 'qishui' },
        { title: 'Song (Cover)', artist: 'Cover Artist', providerId: 'qishui' },
    ] };
    const rendered = formatSearchResults(data);
    assert.match(rendered, /VERSION/);
    assert.equal(rendered.split('\n').filter(line => /unknown\s*$/.test(line)).length, 2);
    assert.match(rendered, /not supplied by the provider/);
    assert.deepEqual(JSON.parse(formatToolResult('folia_search', data, { json: true })), data);
});
