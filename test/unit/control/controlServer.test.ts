import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { startControlServer } = require('../../../electron/controlServer.cjs');

// test/unit/control/controlServer.test.ts
// Exercises the loopback control server with a fake BrowserWindow: routing, token auth, bridge
// forwarding through executeJavaScript, the two main-process tools and the MCP /mcp endpoint.

type ControlServerHandle = {
    url: string;
    port: number;
    token: string;
    stop: () => Promise<void>;
};

const ORIGINAL_ENV = {
    port: process.env.FOLIA_CONTROL_PORT,
    token: process.env.FOLIA_CONTROL_TOKEN,
};

const FAKE_TOOLS = [
    {
        name: 'folia_state',
        title: 'Folia state snapshot',
        group: 'system',
        executor: 'bridge',
        summary: 'State snapshot.',
        description: 'Returns the state snapshot.',
        readOnly: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'folia_volume',
        title: 'Volume and mute',
        group: 'playback',
        executor: 'bridge',
        summary: 'Get/set the volume.',
        description: 'Get or set the playback volume.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'folia_screenshot',
        title: 'Screenshot the app',
        group: 'window',
        executor: 'main',
        summary: 'Capture the main window.',
        description: 'Captures the main window as PNG.',
        readOnly: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'folia_quit',
        title: 'Quit Folia',
        group: 'window',
        executor: 'main',
        summary: 'Quit the app.',
        description: 'Quits Folia; requires confirm=true.',
        destructive: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
];

const FAKE_STATE = {
    app: { version: '0.7.21-test', platform: 'darwin', isElectron: true, controlVersion: 1 },
    playback: { state: 'paused', queueLength: 0 },
};

function createFakeWindow() {
    const executeJavaScript = vi.fn(async (code: string) => {
        if (code.includes('bridge.list()')) {
            return FAKE_TOOLS;
        }
        if (code.includes('bridge.state(')) {
            return FAKE_STATE;
        }
        if (code.includes('bridge.events(')) {
            return { cursor: 7, events: [] };
        }
        if (code.includes('bridge.invoke(')) {
            if (code.includes('folia_volume')) {
                return { ok: true, tool: 'folia_volume', data: { level: 35, muted: false }, durationMs: 1, ts: 1 };
            }
            return { ok: true, tool: 'some_tool', data: null, durationMs: 1, ts: 1 };
        }
        throw new Error(`Unexpected renderer call: ${code}`);
    });
    const capturePage = vi.fn(async () => ({
        getSize: () => ({ width: 320, height: 180 }),
        toPNG: () => Buffer.from('fake-png-bytes'),
    }));
    return {
        isDestroyed: () => false,
        webContents: { executeJavaScript, capturePage, isDestroyed: () => false },
    };
}

function createFakeApp(userDataDir: string) {
    return {
        getPath: (name: string) => (name === 'userData' ? userDataDir : userDataDir),
        getVersion: () => '0.7.21-test',
        quit: vi.fn(),
    };
}

function setEnv(name: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

describe('electron/controlServer', () => {
    let dataDir: string;
    let fakeWindow: ReturnType<typeof createFakeWindow>;
    let bridgeWindow: ReturnType<typeof createFakeWindow> | null;
    let app: ReturnType<typeof createFakeApp>;
    let server: ControlServerHandle;

    type RequestOptions = {
        method?: string;
        token?: string | null;
        body?: unknown;
        rawBody?: string;
    };

    const request = async (pathname: string, options: RequestOptions = {}) => {
        const headers: Record<string, string> = {};
        if (options.token) {
            headers.Authorization = `Bearer ${options.token}`;
        }
        let body: string | undefined;
        if (options.rawBody !== undefined) {
            body = options.rawBody;
        } else if (options.body !== undefined) {
            body = JSON.stringify(options.body);
            headers['Content-Type'] = 'application/json';
        }
        const response = await fetch(`${server.url}${pathname}`, {
            method: options.method ?? 'GET',
            headers,
            body,
        });
        const text = await response.text();
        return { status: response.status, headers: response.headers, text, json: text ? JSON.parse(text) : null };
    };

    const callMcp = async (method: string, params?: unknown, id: number | string = 1) => {
        return request('/mcp', {
            method: 'POST',
            token: server.token,
            body: { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) },
        });
    };

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-control-'));
        setEnv('FOLIA_CONTROL_PORT', '0');
        setEnv('FOLIA_CONTROL_TOKEN', 'test-control-token');
        fakeWindow = createFakeWindow();
        bridgeWindow = fakeWindow;
        app = createFakeApp(dataDir);
        server = await startControlServer({ app, getWindow: () => bridgeWindow, dataDir });
    });

    afterEach(async () => {
        await server?.stop();
        setEnv('FOLIA_CONTROL_PORT', ORIGINAL_ENV.port);
        setEnv('FOLIA_CONTROL_TOKEN', ORIGINAL_ENV.token);
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    describe('health and routing', () => {
        it('answers /health without a token', async () => {
            const { status, json } = await request('/health');
            expect(status).toBe(200);
            expect(json).toMatchObject({
                ok: true,
                app: 'folia',
                version: '0.7.21-test',
                controlApiVersion: 1,
                pid: process.pid,
                port: server.port,
            });
        });

        it('answers /health even when the window is gone', async () => {
            bridgeWindow = null;
            const { status, json } = await request('/health');
            expect(status).toBe(200);
            expect(json.ok).toBe(true);
        });

        it('rejects protected routes without a token', async () => {
            const { status, json } = await request('/tools');
            expect(status).toBe(401);
            expect(json.ok).toBe(false);
            expect(json.error.code).toBe('unauthorized');
        });

        it('accepts X-Folia-Token and ?token= like the Bearer header', async () => {
            const viaHeader = await fetch(`${server.url}/tools`, { headers: { 'X-Folia-Token': server.token } });
            expect(viaHeader.status).toBe(200);
            const viaQuery = await fetch(`${server.url}/tools?token=${server.token}`);
            expect(viaQuery.status).toBe(200);
            const wrongToken = await request('/tools', { token: 'not-the-token' });
            expect(wrongToken.status).toBe(401);
        });

        it('serves the catalog returned by the bridge', async () => {
            const { status, json } = await request('/tools', { token: server.token });
            expect(status).toBe(200);
            expect(json.ok).toBe(true);
            expect(json.tools.map((tool: { name: string }) => tool.name)).toContain('folia_state');
            const lastCode = fakeWindow.webContents.executeJavaScript.mock.calls.at(-1)?.[0] ?? '';
            expect(lastCode).toContain('bridge.list()');
        });

        it('returns 404 for unknown routes and 405 for wrong methods', async () => {
            expect((await request('/nope', { token: server.token })).status).toBe(404);
            const getInvoke = await request('/invoke', { token: server.token });
            expect(getInvoke.status).toBe(405);
            expect(getInvoke.headers.get('allow')).toBe('POST');
            const getMcp = await request('/mcp', { token: server.token });
            expect(getMcp.status).toBe(405);
            expect(getMcp.headers.get('allow')).toBe('POST');
        });

        it('forwards /state and /events to the bridge', async () => {
            const state = await request('/state?includeQueue=1', { token: server.token });
            expect(state.status).toBe(200);
            expect(state.json.ok).toBe(true);
            expect(state.json.data).toMatchObject({ app: { controlVersion: 1 } });

            const events = await request('/events?since=2&limit=5&waitMs=0', { token: server.token });
            expect(events.status).toBe(200);
            expect(events.json.data).toEqual({ cursor: 7, events: [] });
        });

        it('returns 503 for bridge routes while the window is gone', async () => {
            bridgeWindow = null;
            const state = await request('/state', { token: server.token });
            expect(state.status).toBe(503);
            expect(state.json.error.code).toBe('not_ready');
        });

        it('rejects invalid JSON and oversized bodies', async () => {
            const invalid = await request('/invoke', { method: 'POST', token: server.token, rawBody: '{not json' });
            expect(invalid.status).toBe(400);
            expect(invalid.json.error.code).toBe('bad_request');

            const oversized = await request('/invoke', {
                method: 'POST',
                token: server.token,
                rawBody: 'x'.repeat(1024 * 1024 + 1),
            });
            expect(oversized.status).toBe(413);
            expect(oversized.json.error.code).toBe('bad_request');
        });
    });

    describe('POST /invoke', () => {
        it('forwards a bridge tool and returns its envelope', async () => {
            const { status, json } = await request('/invoke', {
                method: 'POST',
                token: server.token,
                body: { name: 'folia_volume', args: { level: 35 } },
            });
            expect(status).toBe(200);
            expect(json).toMatchObject({ ok: true, tool: 'folia_volume', data: { level: 35, muted: false } });
            const code = fakeWindow.webContents.executeJavaScript.mock.calls.at(-1)?.[0] ?? '';
            expect(code).toContain('folia_volume');
            expect(code).toContain('"level":35');
        });

        it('reports an unknown tool inside the envelope', async () => {
            const { status, json } = await request('/invoke', {
                method: 'POST',
                token: server.token,
                body: { name: 'folia_not_a_tool', args: {} },
            });
            expect(status).toBe(200);
            expect(json.ok).toBe(false);
            expect(json.error.code).toBe('unknown_tool');
        });

        it('runs folia_screenshot in the main process and writes the png', async () => {
            const { status, json } = await request('/invoke', {
                method: 'POST',
                token: server.token,
                body: { name: 'folia_screenshot', args: {} },
            });
            expect(status).toBe(200);
            expect(json.ok).toBe(true);
            expect(json.data).toMatchObject({ mimeType: 'image/png', width: 320, height: 180 });
            expect(json.data.base64).toBe(Buffer.from('fake-png-bytes').toString('base64'));
            expect(fs.existsSync(json.data.path)).toBe(true);
            // Main-process tool: never forwarded to the renderer.
            expect(fakeWindow.webContents.executeJavaScript).not.toHaveBeenCalled();
        });

        it('requires confirm=true before quitting and responds before app.quit()', async () => {
            const rejected = await request('/invoke', {
                method: 'POST',
                token: server.token,
                body: { name: 'folia_quit', args: {} },
            });
            expect(rejected.json.ok).toBe(false);
            expect(rejected.json.error.code).toBe('bad_request');
            expect(app.quit).not.toHaveBeenCalled();

            const accepted = await request('/invoke', {
                method: 'POST',
                token: server.token,
                body: { name: 'folia_quit', args: { confirm: true } },
            });
            expect(accepted.json).toMatchObject({ ok: true, tool: 'folia_quit', data: { quitting: true } });
            await new Promise((resolve) => setTimeout(resolve, 150));
            expect(app.quit).toHaveBeenCalledTimes(1);
        });
    });

    describe('POST /mcp', () => {
        it('initializes with the shared protocol version and server info', async () => {
            const { status, json } = await callMcp('initialize', {
                protocolVersion: '2025-06-18',
                capabilities: {},
                clientInfo: { name: 'vitest', version: '0' },
            });
            expect(status).toBe(200);
            expect(json.jsonrpc).toBe('2.0');
            expect(json.result.protocolVersion).toBe('2025-06-18');
            expect(json.result.serverInfo).toEqual({ name: 'folia-control', version: '1.0.0' });
            expect(json.result.capabilities.tools).toBeDefined();
        });

        it('acknowledges notifications with 202 and no body', async () => {
            const response = await fetch(`${server.url}/mcp`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
            });
            expect(response.status).toBe(202);
            expect(await response.text()).toBe('');
        });

        it('lists tools with MCP annotations', async () => {
            const { status, json } = await callMcp('tools/list');
            expect(status).toBe(200);
            const state = json.result.tools.find((tool: { name: string }) => tool.name === 'folia_state');
            expect(state.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
            expect(state.inputSchema.type).toBe('object');
            const quit = json.result.tools.find((tool: { name: string }) => tool.name === 'folia_quit');
            expect(quit.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
        });

        it('turns a bridge envelope into text content', async () => {
            const { json } = await callMcp('tools/call', { name: 'folia_volume', arguments: { level: 35 } });
            expect(json.result.isError).toBe(false);
            expect(json.result.content[0].type).toBe('text');
            expect(JSON.parse(json.result.content[0].text)).toEqual({ level: 35, muted: false });
        });

        it('returns an image content block for folia_screenshot', async () => {
            const { json } = await callMcp('tools/call', { name: 'folia_screenshot' });
            expect(json.result.isError).toBe(false);
            expect(json.result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
            expect(json.result.content[1].type).toBe('text');
        });

        it('reports execution failures as isError content', async () => {
            const { json } = await callMcp('tools/call', { name: 'folia_quit', arguments: {} });
            expect(json.result.isError).toBe(true);
            expect(json.result.content[0].text).toContain('bad_request');
        });

        it('serves the folia://state resource', async () => {
            const list = await callMcp('resources/list');
            expect(list.json.result.resources.map((resource: { uri: string }) => resource.uri)).toContain('folia://state');

            const read = await callMcp('resources/read', { uri: 'folia://state' });
            expect(read.json.result.contents[0].mimeType).toBe('application/json');
            expect(JSON.parse(read.json.result.contents[0].text)).toMatchObject({ app: { controlVersion: 1 } });
        });

        it('returns JSON-RPC errors for unknown methods and invalid params', async () => {
            const unknownMethod = await callMcp('does/not/exist');
            expect(unknownMethod.json.error.code).toBe(-32601);

            const unknownTool = await callMcp('tools/call', { name: 'not_a_tool' });
            expect(unknownTool.json.error.code).toBe(-32602);

            const missingName = await callMcp('tools/call', {});
            expect(missingName.json.error.code).toBe(-32602);

            const unknownResource = await callMcp('resources/read', { uri: 'folia://nope' });
            expect(unknownResource.json.error.code).toBe(-32602);
        });
    });

    describe('token and discovery files', () => {
        it('generates a 32-byte hex token in control-token (0600) and writes control-server.json', async () => {
            await server.stop();
            delete process.env.FOLIA_CONTROL_TOKEN;

            const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-control-token-'));
            try {
                const second: ControlServerHandle = await startControlServer({
                    app: createFakeApp(tokenDir),
                    getWindow: () => createFakeWindow(),
                    dataDir: tokenDir,
                });

                const tokenFile = path.join(tokenDir, 'control-token');
                const storedToken = fs.readFileSync(tokenFile, 'utf8').trim();
                expect(storedToken).toBe(second.token);
                expect(storedToken).toMatch(/^[0-9a-f]{64}$/);
                expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600);

                const serverInfoPath = path.join(tokenDir, 'control-server.json');
                const serverInfo = JSON.parse(fs.readFileSync(serverInfoPath, 'utf8'));
                expect(serverInfo).toMatchObject({
                    port: second.port,
                    token: second.token,
                    pid: process.pid,
                    url: second.url,
                });
                expect(fs.statSync(serverInfoPath).mode & 0o777).toBe(0o600);

                await second.stop();
            } finally {
                fs.rmSync(tokenDir, { recursive: true, force: true });
            }
        });
    });
});
