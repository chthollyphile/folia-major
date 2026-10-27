#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// control/test/e2e.mjs
// End-to-end check of the Folia control API against a real Electron build: starts Vite (:3000),
// launches Electron on an isolated profile with the control server enabled, waits for
// <userData>/control-server.json, then drives the CLI and the MCP endpoints (HTTP + stdio) and
// prints a PASS/FAIL report. Every started process is cleaned up even when a check fails.
//
//   node control/test/e2e.mjs
//   FOLIA_E2E_SKIP_PLAYBACK=1 node control/test/e2e.mjs   # skip the account-dependent playback check
//   FOLIA_E2E_KEEP_USER_DATA=1 node control/test/e2e.mjs  # keep the isolated profile for debugging
//   FOLIA_E2E_SEARCH_QUERY="jay chou" node control/test/e2e.mjs

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromRepo = createRequire(path.join(REPO, 'package.json'));
const CLI = path.join(REPO, 'control/cli.mjs');
const MCP_STDIO = path.join(REPO, 'control/mcp.mjs');
const WORK_DIR = path.join(REPO, 'test-results', 'control-e2e');
const USER_DATA = process.env.FOLIA_E2E_USER_DATA || path.join(WORK_DIR, 'userdata');
const LOG_FILE = path.join(WORK_DIR, 'e2e.log');
const DEFAULT_PORT = 4567;
const DEV_ORIGIN = 'http://localhost:3000';
const SKIP_PLAYBACK = process.env.FOLIA_E2E_SKIP_PLAYBACK === '1';
const KEEP_USER_DATA = process.env.FOLIA_E2E_KEEP_USER_DATA === '1';
const SEARCH_QUERY = process.env.FOLIA_E2E_SEARCH_QUERY || '周杰伦';
const CONNECT_TIMEOUT_MS = 150_000;

const results = [];
let vite = null;
let electronApp = null;
let control = null;
let tokenFile = null;
let logStream = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const writeLog = (line) => {
    const text = `${line}\n`;
    if (logStream) logStream.write(text);
    if (process.env.FOLIA_E2E_VERBOSE === '1') process.stdout.write(text);
};

/** Last lines of the Electron main-process log, for startup-failure diagnostics. */
function logTail(lines = 30) {
    try {
        const content = fs.readFileSync(path.join(WORK_DIR, 'main.log'), 'utf8').trimEnd();
        if (!content) return '';
        return `--- electron main log (last ${lines} lines) ---\n${content.split('\n').slice(-lines).join('\n')}`;
    } catch {
        return '';
    }
}

// ---------------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------------

const isPortOpen = (port) => new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
});

/** Parse the first JSON value in a mixed stdout/stderr stream (CLI may add human text). */
function parseJsonLoose(text) {
    if (!text) return undefined;
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
    const starts = [];
    const objectStart = trimmed.indexOf('{');
    const arrayStart = trimmed.indexOf('[');
    if (objectStart >= 0) starts.push({ index: objectStart, close: '}' });
    if (arrayStart >= 0) starts.push({ index: arrayStart, close: ']' });
    starts.sort((a, b) => a.index - b.index);
    for (const start of starts) {
        for (let end = trimmed.length; end > start.index; end -= 1) {
            if (trimmed[end - 1] !== start.close) continue;
            try { return JSON.parse(trimmed.slice(start.index, end)); } catch { /* keep shrinking */ }
        }
    }
    return undefined;
}

/** Every array reachable in a JSON value, longest first. */
function collectArrays(value, out = []) {
    if (Array.isArray(value)) {
        out.push(value);
        value.forEach((item) => collectArrays(item, out));
    } else if (value && typeof value === 'object') {
        Object.values(value).forEach((item) => collectArrays(item, out));
    }
    return out;
}

/** First value for a key anywhere in a JSON value (depth-first). */
function findValueDeep(value, key) {
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findValueDeep(item, key);
            if (found !== undefined) return found;
        }
        return undefined;
    }
    if (!value || typeof value !== 'object') return undefined;
    if (key in value) return value[key];
    for (const item of Object.values(value)) {
        const found = findValueDeep(item, key);
        if (found !== undefined) return found;
    }
    return undefined;
}

/** Read the current volume as a 0-100 number from whatever shape the CLI printed. */
function extractVolume(value) {
    const direct = findValueDeep(value, 'percent');
    if (typeof direct === 'number') return direct;
    const level = findValueDeep(value, 'volume');
    if (typeof level === 'number') return level <= 1 && level > 0 ? Math.round(level * 100) : level;
    return undefined;
}

function extractSetting(value, key) {
    if (typeof value === 'number') return value;
    const direct = findValueDeep(value, key);
    if (direct !== undefined && typeof direct !== 'object') return direct;
    const wrapper = findValueDeep(value, 'value');
    if (wrapper !== undefined) return wrapper;
    return direct;
}

/** Run the CLI synchronously-ish; returns { code, stdout, stderr }. */
function runCli(args, { timeoutMs = 60_000 } = {}) {
    const fullArgs = [
        CLI,
        ...args,
        '--url', control.url,
        '--token-file', tokenFile,
    ];
    writeLog(`$ node control/cli.mjs ${args.join(' ')} --url ${control.url} --token-file <token>`);
    return new Promise((resolve) => {
        const child = spawn(process.execPath, fullArgs, {
            cwd: REPO,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            writeLog(`  exit=${code}`);
            if (stdout.trim()) writeLog(`  stdout: ${stdout.trim().slice(0, 4000)}`);
            if (stderr.trim()) writeLog(`  stderr: ${stderr.trim().slice(0, 4000)}`);
            resolve({ code, stdout, stderr });
        };
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            stderr += `\n[e2e] CLI timeout after ${timeoutMs}ms`;
            finish(-1);
        }, timeoutMs);
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (error) => {
            stderr += `\n[e2e] CLI spawn failed: ${error.message}`;
            finish(-1);
        });
        child.on('close', (code) => finish(code ?? -1));
    });
}

/** HTTP request against the control server. */
async function httpRequest(url, { method = 'GET', body, headers = {}, timeoutMs = 30_000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method,
            headers: {
                ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
                ...headers,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        const text = await response.text();
        let json;
        try { json = text ? JSON.parse(text) : undefined; } catch { /* not JSON */ }
        return { status: response.status, headers: response.headers, text, json };
    } finally {
        clearTimeout(timer);
    }
}

/** MCP JSON-RPC call over the embedded HTTP endpoint. */
function mcpHttp(method, params, id) {
    const payload = { jsonrpc: '2.0', method, ...(id === undefined ? {} : { id }), ...(params === undefined ? {} : { params }) };
    return httpRequest(`${control.url}/mcp`, {
        method: 'POST',
        body: payload,
        headers: { authorization: `Bearer ${control.token}` },
    });
}

const evaluateError = (result) => {
    if (result.code === 0) return null;
    const combined = `${result.stdout}\n${result.stderr}`;
    const errorCode = combined.match(/\b(bad_request|unknown_tool|unavailable|not_ready|no_song|no_results|search_failed|playback_failed|unsupported|disabled|timeout|internal|unauthorized)\b/);
    return { code: result.code, errorCode: errorCode ? errorCode[1] : null, combined };
};

// ---------------------------------------------------------------------------------------------
// Startup: Vite + Electron + control server discovery
// ---------------------------------------------------------------------------------------------

async function startVite() {
    if (await isPortOpen(3000)) {
        console.log('[e2e] vite: reusing the server already on :3000');
        return null;
    }
    const viteLog = path.join(WORK_DIR, 'vite.log');
    fs.writeFileSync(viteLog, '');
    console.log('[e2e] vite: starting on :3000 (log test-results/control-e2e/vite.log)');
    const child = spawn(process.execPath, [
        path.join(REPO, 'node_modules/vite/bin/vite.js'),
        '--port', '3000',
        '--strictPort',
    ], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const sink = (chunk) => fs.appendFileSync(viteLog, chunk);
    child.stdout.on('data', sink);
    child.stderr.on('data', sink);
    for (let i = 0; i < 240; i += 1) {
        if (await isPortOpen(3000)) {
            console.log(`[e2e] vite: ready (pid ${child.pid})`);
            return child;
        }
        if (child.exitCode !== null) break;
        await sleep(500);
    }
    child.kill();
    throw new Error(`Vite did not come up on :3000; see ${viteLog}`);
}

async function launchElectron() {
    let electronPath;
    try {
        electronPath = requireFromRepo('electron');
    } catch (error) {
        throw new Error(`Electron binary unavailable (run npm ci first): ${error instanceof Error ? error.message : error}`);
    }
    const { _electron } = requireFromRepo('playwright-core');
    fs.mkdirSync(WORK_DIR, { recursive: true });
    if (!KEEP_USER_DATA) fs.rmSync(USER_DATA, { recursive: true, force: true });
    fs.mkdirSync(USER_DATA, { recursive: true });

    const mainLog = path.join(WORK_DIR, 'main.log');
    fs.writeFileSync(mainLog, '');
    console.log(`[e2e] electron: launching (profile ${path.relative(REPO, USER_DATA)})`);
    const env = {
        ...process.env,
        ELECTRON_DEV: 'true',
        FOLIA_CONTROL: '1',
        FOLIA_CONTROL_PORT: String(DEFAULT_PORT),
    };
    // An agent/CI shell that itself runs inside Electron may export ELECTRON_RUN_AS_NODE=1;
    // inherited by the child it makes Electron behave like plain Node and Chromium switches fail.
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.FOLIA_CONTROL_ALLOW_EVAL;
    // The test window never loads untrusted content and some sandboxes deny the Chromium sandbox
    // syscalls ("sandbox initialization failed: Operation not permitted"); --no-sandbox keeps the
    // run possible there. --use-mock-keychain keeps Chromium's os_crypt off the shared macOS
    // Keychain, which can block behind a system prompt when another Folia instance is running.
    // Both switches only affect this isolated test instance.
    const app = await _electron.launch({
        executablePath: electronPath,
        args: ['--no-sandbox', '--use-mock-keychain', `--user-data-dir=${USER_DATA}`, REPO],
        cwd: REPO,
        env,
        timeout: 90_000,
    });
    app.process().stdout.on('data', (chunk) => fs.appendFileSync(mainLog, chunk));
    app.process().stderr.on('data', (chunk) => fs.appendFileSync(mainLog, `[stderr] ${chunk}`));
    console.log('[e2e] electron: launched');
    return app;
}

/** Wait for the control server to write its discovery file and answer /health. */
async function waitForControlServer(app) {
    const discoveryFile = path.join(USER_DATA, 'control-server.json');
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    let lastError = 'control-server.json not written yet';
    while (Date.now() < deadline) {
        if (app.process().exitCode !== null) {
            throw new Error(`Electron exited early (code ${app.process().exitCode}); see test-results/control-e2e/main.log`);
        }
        try {
            const info = JSON.parse(fs.readFileSync(discoveryFile, 'utf8'));
            if (info?.url && info?.token) {
                const health = await httpRequest(`${info.url}/health`, { timeoutMs: 3_000 });
                if (health.status === 200 && health.json?.ok) {
                    const file = path.join(USER_DATA, 'control-token');
                    const tokenPath = fs.existsSync(file) ? file : path.join(WORK_DIR, 'control-token');
                    if (!fs.existsSync(tokenPath)) {
                        fs.writeFileSync(tokenPath, info.token, { mode: 0o600 });
                    }
                    return { url: info.url, token: info.token, port: info.port, tokenFile: tokenPath };
                }
                lastError = `health returned ${health.status} for ${info.url}`;
            }
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await sleep(500);
    }
    throw new Error(`control server did not become ready in ${CONNECT_TIMEOUT_MS}ms (${lastError}); see test-results/control-e2e/main.log`);
}

/** The server can be up before the renderer bridge installs; poll folia_status until it answers. */
async function waitForBridge(timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    let last = 'bridge not ready';
    while (Date.now() < deadline) {
        try {
            const response = await httpRequest(`${control.url}/invoke`, {
                method: 'POST',
                body: { name: 'folia_status', args: {} },
                headers: { authorization: `Bearer ${control.token}` },
                timeoutMs: 5_000,
            });
            if (response.status === 200 && response.json?.ok) return;
            last = `status ${response.status} ${JSON.stringify(response.json?.error ?? response.json ?? {})}`;
        } catch (error) {
            last = error instanceof Error ? error.message : String(error);
        }
        await sleep(750);
    }
    throw new Error(`renderer bridge never became ready (${last})`);
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

async function check(name, fn) {
    process.stdout.write(`- ${name} ... `);
    try {
        const detail = await fn();
        results.push({ name, status: 'PASS', detail: detail || '' });
        console.log('PASS');
        if (detail) console.log(`    ${detail}`);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        results.push({ name, status: 'FAIL', detail });
        console.log('FAIL');
        console.log(`    ${detail}`);
    }
}

async function checkStatus() {
    const result = await runCli(['status', '--json']);
    if (result.code !== 0) throw new Error(`CLI status failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
    const data = parseJsonLoose(result.stdout);
    if (!data || typeof data !== 'object') throw new Error(`status did not print JSON: ${result.stdout.trim().slice(0, 300)}`);
    const view = typeof data.view === 'object' && data.view !== null ? data.view.view : data.view;
    const playback = data.nowPlaying?.state ?? 'idle';
    if (!data.app?.version) throw new Error(`status has no app.version: ${JSON.stringify(data).slice(0, 300)}`);
    return `view=${view}, playback=${playback}, version=${data.app.version}`;
}

async function checkPaletteList() {
    const result = await runCli(['palette', 'list', '--all', '--json']);
    if (result.code !== 0) throw new Error(`CLI palette list failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
    const data = parseJsonLoose(result.stdout);
    if (!data) throw new Error(`palette list did not print JSON: ${result.stdout.trim().slice(0, 300)}`);
    const arrays = collectArrays(data).sort((a, b) => b.length - a.length);
    const commands = arrays[0];
    if (!commands) throw new Error('palette list JSON has no array of commands');
    if (commands.length <= 100) throw new Error(`expected more than 100 palette commands, got ${commands.length}`);
    return `${commands.length} commands`;
}

async function checkSearch() {
    const result = await runCli(['search', SEARCH_QUERY, '--limit', '3', '--json'], { timeoutMs: 90_000 });
    if (result.code === 0) {
        const data = parseJsonLoose(result.stdout);
        if (!data) throw new Error(`search printed no JSON: ${result.stdout.trim().slice(0, 300)}`);
        const arrays = collectArrays(data).sort((a, b) => b.length - a.length);
        const items = arrays[0];
        return items ? `structured results (${items.length} items)` : 'structured result';
    }
    const failure = evaluateError(result);
    if (failure.errorCode) return `structured error (${failure.errorCode}) — control chain OK`;
    throw new Error(`search failed without a structured error (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
}

async function checkVolume() {
    const set = await runCli(['volume', '30', '--json']);
    if (set.code !== 0) throw new Error(`CLI volume 30 failed (exit ${set.code}): ${set.stderr.trim() || set.stdout.trim()}`);
    const read = await runCli(['volume', '--json']);
    if (read.code !== 0) throw new Error(`CLI volume read failed (exit ${read.code}): ${read.stderr.trim() || read.stdout.trim()}`);
    const data = parseJsonLoose(read.stdout);
    if (!data) throw new Error(`volume read printed no JSON: ${read.stdout.trim().slice(0, 300)}`);
    const level = extractVolume(data);
    if (level !== 30) throw new Error(`volume readback ${JSON.stringify(data)} did not report 30`);
    return `level=${level}`;
}

async function checkVisualizer() {
    const set = await runCli(['visual', 'set', 'fume', '--json']);
    if (set.code !== 0) throw new Error(`CLI visual set fume failed (exit ${set.code}): ${set.stderr.trim() || set.stdout.trim()}`);
    const state = await runCli(['state', '--json']);
    if (state.code !== 0) throw new Error(`CLI state failed (exit ${state.code}): ${state.stderr.trim() || state.stdout.trim()}`);
    const data = parseJsonLoose(state.stdout);
    if (!data) throw new Error(`state printed no JSON: ${state.stdout.trim().slice(0, 300)}`);
    const mode = findValueDeep(data, 'visualizer')?.mode ?? findValueDeep(data, 'mode');
    if (mode !== 'fume') throw new Error(`state readback reported visualizer.mode=${JSON.stringify(mode)}, expected "fume"`);
    return 'visualizer.mode=fume';
}

async function checkSettings() {
    const read = await runCli(['settings', '--json']);
    if (read.code !== 0) throw new Error(`CLI settings read failed (exit ${read.code}): ${read.stderr.trim() || read.stdout.trim()}`);
    if (!parseJsonLoose(read.stdout)) throw new Error(`settings read printed no JSON: ${read.stdout.trim().slice(0, 300)}`);

    const set = await runCli(['settings', 'set', 'audio.volume', '40', '--json']);
    if (set.code !== 0) throw new Error(`CLI settings set audio.volume 40 failed (exit ${set.code}): ${set.stderr.trim() || set.stdout.trim()}`);

    // folia_settings_write accepts audio.volume as either 0-100 or 0-1, while
    // folia_settings_read returns the raw store value (0-1). Accept both and compare percentages.
    const back = await runCli(['settings', 'audio', 'volume', '--json']);
    const combined = parseJsonLoose(back.stdout) ?? parseJsonLoose(back.stderr);
    const value = extractSetting(combined, 'volume');
    const percent = typeof value === 'number' ? (value <= 1 ? Math.round(value * 100) : Math.round(value)) : undefined;
    if (percent !== 40) {
        throw new Error(`settings readback did not represent 40% (exit ${back.code}, value ${JSON.stringify(value)}): ${back.stdout.trim().slice(0, 300)}`);
    }
    return `audio.volume=${percent}% (stored ${value})`;
}

async function checkScreenshot() {
    const outFile = path.join(WORK_DIR, `screenshot-${Date.now()}.png`);
    const result = await runCli(['screenshot', '--out', outFile, '--json'], { timeoutMs: 90_000 });
    if (result.code !== 0) throw new Error(`CLI screenshot failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
    if (!fs.existsSync(outFile)) throw new Error(`screenshot file was not written: ${outFile}`);
    const stat = fs.statSync(outFile);
    if (stat.size < 1_000) throw new Error(`screenshot file is suspiciously small: ${stat.size} bytes`);
    const header = fs.readFileSync(outFile).subarray(0, 8);
    const png = header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!png) throw new Error(`screenshot is not a PNG: ${outFile}`);
    return `${path.relative(REPO, outFile)} (${stat.size} bytes)`;
}

async function checkMcpHttp() {
    const init = await mcpHttp('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'folia-e2e', version: '0' },
    }, 1);
    if (init.status !== 200 || !init.json?.result) {
        throw new Error(`MCP initialize failed: HTTP ${init.status} ${init.text.slice(0, 300)}`);
    }
    if (init.json.result.serverInfo?.name !== 'folia-control') {
        throw new Error(`unexpected MCP serverInfo: ${JSON.stringify(init.json.result.serverInfo)}`);
    }

    const notified = await mcpHttp('notifications/initialized', undefined, undefined);
    if (![200, 202].includes(notified.status)) {
        throw new Error(`MCP notifications/initialized returned HTTP ${notified.status}`);
    }

    const list = await mcpHttp('tools/list', {}, 2);
    const tools = list.json?.result?.tools;
    if (!Array.isArray(tools)) throw new Error(`MCP tools/list returned no tools: ${list.text.slice(0, 300)}`);
    const catalog = (await import('../../shared/controlCatalog.mjs')).CONTROL_TOOLS;
    const catalogNames = new Set(catalog.map((tool) => tool.name));
    const unknown = tools.map((tool) => tool.name).filter((name) => !catalogNames.has(name));
    if (unknown.length) throw new Error(`MCP tools/list contains unknown tools: ${unknown.join(', ')}`);
    if (tools.length < catalog.length - 1) {
        throw new Error(`MCP tools/list only exposed ${tools.length}/${catalog.length} tools`);
    }
    for (const required of ['folia_status', 'folia_volume', 'folia_screenshot']) {
        if (!tools.some((tool) => tool.name === required)) throw new Error(`MCP tools/list is missing ${required}`);
    }

    const call = await mcpHttp('tools/call', { name: 'folia_status', arguments: {} }, 3);
    const content = call.json?.result?.content;
    if (call.json?.result?.isError === true) throw new Error(`MCP tools/call folia_status returned isError: ${call.text.slice(0, 300)}`);
    if (!Array.isArray(content) || content[0]?.type !== 'text' || !content[0].text) {
        throw new Error(`MCP tools/call returned unexpected content: ${call.text.slice(0, 300)}`);
    }
    return `initialize + tools/list (${tools.length} tools) + tools/call`;
}

async function checkMcpStdio() {
    if (!fs.existsSync(MCP_STDIO)) return { status: 'SKIP', detail: 'control/mcp.mjs not present yet' };
    const child = spawn(process.execPath, [MCP_STDIO, '--url', control.url, '--token-file', tokenFile], {
        cwd: REPO,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pending = new Map();
    let stderr = '';
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
        writeLog(`  mcp stdio <- ${line.slice(0, 2000)}`);
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.id !== undefined && pending.has(message.id)) {
            const resolve = pending.get(message.id);
            pending.delete(message.id);
            resolve(message);
        }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const request = (id, method, params) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`MCP stdio timeout on ${method}${stderr ? `; stderr: ${stderr.slice(-500)}` : ''}`));
        }, 30_000);
        pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
        const payload = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
        writeLog(`  mcp stdio -> ${payload.slice(0, 2000)}`);
        child.stdin.write(`${payload}\n`);
    });
    try {
        const init = await request(1, 'initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'folia-e2e', version: '0' },
        });
        if (!init.result) throw new Error(`MCP stdio initialize failed: ${JSON.stringify(init).slice(0, 300)}`);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        const list = await request(2, 'tools/list', {});
        if (!Array.isArray(list.result?.tools)) throw new Error(`MCP stdio tools/list failed: ${JSON.stringify(list).slice(0, 300)}`);
        const call = await request(3, 'tools/call', { name: 'folia_volume', arguments: { status: true } });
        if (call.result?.isError === true) throw new Error(`MCP stdio tools/call returned isError: ${JSON.stringify(call).slice(0, 300)}`);
        if (!Array.isArray(call.result?.content) || call.result.content.length === 0) {
            throw new Error(`MCP stdio tools/call returned no content: ${JSON.stringify(call).slice(0, 300)}`);
        }
        return `initialize + tools/list (${list.result.tools.length} tools) + tools/call`;
    } finally {
        child.stdin.end();
        child.kill('SIGKILL');
    }
}

async function checkPlayback() {
    if (SKIP_PLAYBACK) return { status: 'SKIP', detail: 'FOLIA_E2E_SKIP_PLAYBACK=1' };
    const result = await runCli(['play', SEARCH_QUERY, '--json'], { timeoutMs: 120_000 });
    if (result.code === 0) return 'playback started';
    const failure = evaluateError(result);
    if (failure.errorCode) return `structured error (${failure.errorCode}) — expected without an account`;
    throw new Error(`play failed without a structured error (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
}

// ---------------------------------------------------------------------------------------------
// Report + cleanup
// ---------------------------------------------------------------------------------------------

function printReport() {
    console.log('\n================ Control API e2e =================');
    for (const item of results) {
        console.log(`${item.status.padEnd(4)}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
    }
    const passed = results.filter((item) => item.status === 'PASS').length;
    const skipped = results.filter((item) => item.status === 'SKIP').length;
    const failed = results.filter((item) => item.status === 'FAIL').length;
    console.log('--------------------------------------------------');
    console.log(`PASS ${passed}  SKIP ${skipped}  FAIL ${failed}`);
    console.log(failed === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
    console.log(`logs: ${path.relative(REPO, LOG_FILE)}`);
    return failed === 0;
}

/** Close the current Electron app; kill it if Playwright's graceful close hangs. */
async function stopElectron() {
    // Playwright's close() waits for the app to quit through the main-process inspector, which can
    // hang when the window/quit path is slow (e.g. a tray app under a restricted sandbox). Try it
    // briefly, then end the child we started ourselves; the control server stops from will-quit.
    try {
        if (electronApp) {
            await Promise.race([
                electronApp.close().catch((error) => {
                    writeLog(`[e2e] electron close rejected: ${error instanceof Error ? error.message : error}`);
                }),
                sleep(10_000),
            ]);
        }
    } catch (error) {
        writeLog(`[e2e] electron close failed: ${error instanceof Error ? error.message : error}`);
    }
    try {
        const child = electronApp?.process();
        if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            await sleep(2_000);
            if (child.exitCode === null) child.kill('SIGKILL');
        }
    } catch { /* already gone */ }
    electronApp = null;
}

async function cleanup() {
    await stopElectron();
    try {
        if (vite && vite.exitCode === null) vite.kill('SIGTERM');
    } catch { /* already gone */ }
    try { await sleep(500); } catch { /* noop */ }
    if (!KEEP_USER_DATA) {
        try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    if (logStream) logStream.end();
}

async function main() {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });

    if (!fs.existsSync(CLI)) {
        console.error(`[e2e] missing ${path.relative(REPO, CLI)} — the CLI is not implemented yet`);
        process.exit(2);
    }

    console.log('================ Control API e2e ================');
    console.log(`[e2e] repo: ${REPO}`);
    console.log(`[e2e] isolated profile: ${path.relative(REPO, USER_DATA)}`);
    writeLog(`[e2e] started ${new Date().toISOString()}`);

    vite = await startVite();
    // A first launch can stall before the window exists (Keychain/TCC prompts, a Chromium
    // network-service restart, or another Electron app with the same mac bundle name). Retry
    // once instead of failing a whole run on a transient startup hiccup.
    let lastStartupError = null;
    for (let attempt = 1; attempt <= 2 && !control; attempt += 1) {
        try {
            electronApp = await launchElectron();
            control = await waitForControlServer(electronApp);
        } catch (error) {
            lastStartupError = error;
            console.error(`[e2e] startup attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
            console.error(logTail(20));
            await stopElectron();
            if (attempt < 2) {
                console.log('[e2e] retrying the Electron launch once');
                await sleep(2_000);
            }
        }
    }
    if (!control) {
        throw lastStartupError ?? new Error('control server never started');
    }
    tokenFile = control.tokenFile || path.join(USER_DATA, 'control-token');
    console.log(`[e2e] control server: ${control.url} (token file ${path.relative(REPO, tokenFile)})`);
    await waitForBridge();
    console.log('[e2e] renderer bridge ready');

    await check('status', checkStatus);
    await check('palette list (>100 commands)', checkPaletteList);
    await check('search (structured result or error)', checkSearch);
    await check('volume 30 write/readback', checkVolume);
    await check('visualizer set fume readback', checkVisualizer);
    await check('settings read / write audio.volume=40 readback', checkSettings);
    await check('screenshot to disk', checkScreenshot);
    await check('MCP over HTTP (initialize/tools/list/tools/call)', checkMcpHttp);

    await checkOptional('MCP over stdio (initialize/tools/list/tools/call)', checkMcpStdio);
    await checkOptional('playback (account dependent)', checkPlayback);

    const ok = printReport();
    await cleanup();
    process.exit(ok ? 0 : 1);
}

/** Like check(), but the check may return {status:'SKIP', detail} to skip itself. */
async function checkOptional(name, fn) {
    process.stdout.write(`- ${name} ... `);
    try {
        const outcome = await fn();
        if (outcome && outcome.status === 'SKIP') {
            results.push({ name, status: 'SKIP', detail: outcome.detail || '' });
            console.log('SKIP');
            if (outcome.detail) console.log(`    ${outcome.detail}`);
            return;
        }
        results.push({ name, status: 'PASS', detail: outcome || '' });
        console.log('PASS');
        if (outcome) console.log(`    ${outcome}`);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        results.push({ name, status: 'FAIL', detail });
        console.log('FAIL');
        console.log(`    ${detail}`);
    }
}

process.on('SIGINT', () => {
    console.error('\n[e2e] interrupted');
    cleanup().finally(() => process.exit(130));
});

main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[e2e] fatal: ${message}`);
    console.error(logTail(40));
    writeLog(`[e2e] fatal: ${message}`);
    results.push({ name: 'startup', status: 'FAIL', detail: message });
    printReport();
    await cleanup();
    process.exit(1);
});
