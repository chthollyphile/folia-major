const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const {
    CONTROL_API_VERSION,
    CONTROL_ERROR_CODES,
    CONTROL_MCP_PROTOCOL_VERSION,
    CONTROL_SERVER_NAME,
    CONTROL_SERVER_VERSION,
    CONTROL_TOOLS,
    DEFAULT_CONTROL_PORT,
    getControlTool,
} = require('../shared/controlCatalog.mjs');

// electron/controlServer.cjs
// The local control plane of the desktop app (control/PROTOCOL.md §3/§4): a loopback-only HTTP
// server that authenticates a bearer token, forwards bridge tools to the renderer through
// `webContents.executeJavaScript`, runs the two main-process tools itself (screenshot/quit) and
// serves the same catalog as an MCP JSON-RPC endpoint on POST /mcp.
//
// Nothing here requires Electron: `app` and `getWindow` arrive as arguments, so the whole file
// also runs (and is unit tested) under plain Node.

const TOKEN_FILE_NAME = 'control-token';
const SERVER_INFO_FILE_NAME = 'control-server.json';
const SCREENSHOT_DIR_NAME = 'control-screenshots';
const MAX_BODY_BYTES = 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 30_000;
const QUIT_DELAY_MS = 100;
const PORT_ATTEMPT_COUNT = 10;
const PUBLIC_PATHS = new Set(['/', '/health']);
const MCP_RESOURCES = Object.freeze([
    {
        uri: 'folia://state',
        name: 'Folia state snapshot',
        description: 'The same snapshot GET /state returns: playback, queue, volume, visualizer, theme, providers.',
        mimeType: 'application/json',
    },
    {
        uri: 'folia://tools',
        name: 'Folia control tools',
        description: 'The control catalog (name, schema, executor and danger flags) as reported by the app bridge.',
        mimeType: 'application/json',
    },
]);

class ControlHttpError extends Error {
    constructor(statusCode, code, message, details) {
        super(message);
        this.name = 'ControlHttpError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}

class McpRpcError extends Error {
    constructor(code, message, data) {
        super(message);
        this.name = 'McpRpcError';
        this.code = code;
        this.data = data;
    }
}

const now = () => Date.now();

const errorText = (error) => (error instanceof Error ? error.message : String(error));

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const log = (message) => console.log(`[Control] ${message}`);

function writeFilePrivate(filePath, contents) {
    fs.writeFileSync(filePath, contents, { mode: 0o600 });
    // The mode option is masked by the process umask; chmod once more so the file is never
    // group/world readable regardless of the user's umask.
    fs.chmodSync(filePath, 0o600);
}

function resolvePort() {
    const configured = Number.parseInt(process.env.FOLIA_CONTROL_PORT || '', 10);
    if (!Number.isFinite(configured) || configured < 0 || configured > 65_535) {
        return DEFAULT_CONTROL_PORT;
    }
    return configured;
}

// Reads FOLIA_CONTROL_TOKEN, then <dataDir>/control-token; generates and persists a 32-byte hex
// token (mode 0600) when neither exists.
function resolveToken(dataDir) {
    const tokenFile = path.join(dataDir, TOKEN_FILE_NAME);
    const fromEnv = (process.env.FOLIA_CONTROL_TOKEN || '').trim();
    if (fromEnv) {
        return { token: fromEnv, tokenFile };
    }

    try {
        const stored = fs.readFileSync(tokenFile, 'utf8').trim();
        if (stored) {
            fs.chmodSync(tokenFile, 0o600);
            return { token: stored, tokenFile };
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn('[Control] Failed to read the control token file; generating a new token', error);
        }
    }

    const token = crypto.randomBytes(32).toString('hex');
    try {
        writeFilePrivate(tokenFile, token);
    } catch (error) {
        console.warn('[Control] Failed to write the control token file; the token is in control-server.json only', error);
    }
    return { token, tokenFile };
}

function writeServerInfoFile(dataDir, info) {
    const filePath = path.join(dataDir, SERVER_INFO_FILE_NAME);
    try {
        writeFilePrivate(filePath, `${JSON.stringify(info, null, 4)}\n`);
        return filePath;
    } catch (error) {
        console.warn('[Control] Failed to write control-server.json; local tools cannot auto-discover the server', error);
        return filePath;
    }
}

function listenOnce(server, port) {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            server.off('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
    });
}

// Tries the preferred port, then +1..+9. Port 0 means "any free port" and is attempted once.
async function listenOnAvailablePort(server, preferredPort) {
    const attempts = preferredPort === 0 ? 1 : PORT_ATTEMPT_COUNT;
    let lastError = null;
    for (let offset = 0; offset < attempts; offset += 1) {
        const candidate = preferredPort === 0 ? 0 : preferredPort + offset;
        try {
            await listenOnce(server, candidate);
            return server.address().port;
        } catch (error) {
            lastError = error;
            if (error?.code !== 'EADDRINUSE') {
                throw error;
            }
            if (offset < attempts - 1) {
                console.warn(`[Control] Port ${candidate} is in use; trying ${candidate + 1}.`);
            }
        }
    }
    throw lastError;
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
    if (res.headersSent || res.writableEnded) {
        return;
    }
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders,
    });
    res.end(body);
}

function sendEmpty(res, statusCode, extraHeaders = {}) {
    if (res.headersSent || res.writableEnded) {
        return;
    }
    res.writeHead(statusCode, { 'Cache-Control': 'no-store', ...extraHeaders });
    res.end();
}

function sendAuthError(res) {
    sendJson(res, 401, {
        ok: false,
        error: { code: 'unauthorized', message: 'Missing or invalid Folia control token.' },
    }, { 'WWW-Authenticate': 'Bearer' });
}

// Reads the body as UTF-8 text and stops buffering past MAX_BODY_BYTES; the rest is drained so
// the client still gets the 413 instead of a socket reset.
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let tooLarge = false;
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                tooLarge = true;
                chunks.length = 0;
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (tooLarge) {
                reject(new ControlHttpError(413, 'bad_request', 'Request body exceeds the 1 MB control API limit.'));
                return;
            }
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', (error) => reject(error));
    });
}

function parseJsonBody(raw, what) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        throw new ControlHttpError(400, 'bad_request', `Empty ${what} body.`);
    }
    try {
        return JSON.parse(raw);
    } catch {
        throw new ControlHttpError(400, 'bad_request', `Invalid JSON in the ${what} body.`);
    }
}

function safeTokenEqual(expected, actual) {
    if (typeof actual !== 'string' || actual.length !== expected.length) {
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function extractToken(req, requestUrl) {
    const authorization = req.headers.authorization;
    if (typeof authorization === 'string') {
        const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
        if (match) {
            return match[1].trim();
        }
    }
    const headerToken = req.headers['x-folia-token'];
    if (typeof headerToken === 'string' && headerToken.trim()) {
        return headerToken.trim();
    }
    const queryToken = requestUrl.searchParams.get('token');
    return queryToken ? queryToken.trim() : '';
}

function makeSuccessEnvelope(tool, data, startedAt) {
    return { ok: true, tool, data, durationMs: now() - startedAt, ts: now() };
}

function makeErrorEnvelope(tool, code, message, details, startedAt = now()) {
    return {
        ok: false,
        tool,
        error: { code, message, ...(details ? { details } : {}) },
        durationMs: now() - startedAt,
        ts: now(),
    };
}

function getBridgeWindow(ctx) {
    let win = null;
    try {
        win = ctx.getWindow?.() ?? null;
    } catch (error) {
        console.warn('[Control] getWindow() failed', error);
        return null;
    }
    if (!win || win.isDestroyed?.()) {
        return null;
    }
    const webContents = win.webContents;
    if (!webContents || webContents.isDestroyed?.()) {
        return null;
    }
    return win;
}

function requireBridgeWindow(ctx) {
    const win = getBridgeWindow(ctx);
    if (!win) {
        throw new ControlHttpError(503, 'not_ready', CONTROL_ERROR_CODES.not_ready);
    }
    return win;
}

function executeWithTimeout(webContents, expression, timeoutMs) {
    let timer = null;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new ControlHttpError(504, 'timeout', `The renderer did not answer within ${timeoutMs} ms.`));
        }, timeoutMs);
    });
    return Promise.race([webContents.executeJavaScript(expression, true), timeout]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

function mapRendererError(error) {
    if (error instanceof ControlHttpError) {
        return error;
    }
    const message = errorText(error);
    if (/bridge not installed|Render frame was disposed|Object has been destroyed|Script failed to execute/i.test(message)) {
        return new ControlHttpError(503, 'not_ready', CONTROL_ERROR_CODES.not_ready);
    }
    return new ControlHttpError(500, 'internal', message);
}

// Runs one expression against window.__FOLIA_CONTROL__ and maps transport failures to HTTP codes.
async function runInRenderer(ctx, statements) {
    const win = requireBridgeWindow(ctx);
    const expression = `(async () => {
    const bridge = window.__FOLIA_CONTROL__;
    if (!bridge || bridge.version !== 1) throw new Error('bridge not installed');
    ${statements}
})()`;
    try {
        return await executeWithTimeout(win.webContents, expression, BRIDGE_TIMEOUT_MS);
    } catch (error) {
        throw mapRendererError(error);
    }
}

const rendererList = (ctx) => runInRenderer(ctx, 'return await bridge.list();');
const rendererState = (ctx, args) => runInRenderer(ctx, `return await bridge.state(${JSON.stringify(args)});`);
const rendererEvents = (ctx, args) => runInRenderer(ctx, `return await bridge.events(${JSON.stringify(args)});`);
const rendererInvoke = (ctx, name, args) => runInRenderer(
    ctx,
    `return await bridge.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)});`,
);

// The bridge owns availability; when the renderer is not up yet the static catalog still lets
// tools/list work (a fresh MCP client connects long before a user might interact).
async function listControlTools(ctx) {
    try {
        const tools = await rendererList(ctx);
        if (Array.isArray(tools) && tools.length > 0) {
            return tools;
        }
    } catch (error) {
        if (!(error instanceof ControlHttpError) || error.code !== 'not_ready') {
            throw error;
        }
        if (!ctx.catalogFallbackLogged) {
            ctx.catalogFallbackLogged = true;
            console.warn('[Control] Renderer bridge not ready; serving the static catalog for tools/list.');
        }
    }
    return CONTROL_TOOLS;
}

function toMcpTool(tool) {
    return {
        name: tool.name,
        title: tool.title,
        description: tool.description || tool.summary || '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        annotations: {
            readOnlyHint: Boolean(tool.readOnly),
            destructiveHint: Boolean(tool.destructive),
        },
    };
}

function toMcpToolResult(name, envelope) {
    if (name === 'folia_screenshot' && envelope.ok) {
        const data = envelope.data || {};
        const content = [];
        if (typeof data.base64 === 'string' && data.base64) {
            content.push({ type: 'image', data: data.base64, mimeType: data.mimeType || 'image/png' });
        }
        content.push({
            type: 'text',
            text: JSON.stringify({ width: data.width, height: data.height, path: data.path }),
        });
        return { content, isError: false };
    }

    if (!envelope.ok) {
        const code = envelope.error?.code || 'internal';
        const message = envelope.error?.message || 'Unknown control error.';
        return { content: [{ type: 'text', text: `${code}: ${message}` }], isError: true };
    }

    return {
        content: [{ type: 'text', text: JSON.stringify(envelope.data ?? null, null, 2) }],
        isError: false,
    };
}

async function captureScreenshot(ctx, args, startedAt) {
    const win = getBridgeWindow(ctx);
    if (!win) {
        throw new ControlHttpError(503, 'not_ready', CONTROL_ERROR_CODES.not_ready);
    }

    const image = await win.webContents.capturePage();
    const size = image.getSize();
    const buffer = image.toPNG();
    const data = {
        base64: buffer.toString('base64'),
        mimeType: 'image/png',
        width: size.width,
        height: size.height,
    };

    const explicitPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : null;
    const shouldSave = explicitPath !== null || args.save !== false;
    if (shouldSave) {
        const filePath = explicitPath
            ? path.resolve(ctx.dataDir, explicitPath)
            : path.join(ctx.dataDir, SCREENSHOT_DIR_NAME, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, buffer);
        data.path = filePath;
    }

    return makeSuccessEnvelope('folia_screenshot', data, startedAt);
}

// Responds first, then quits, so the HTTP/MCP client always receives { quitting: true }.
function requestQuit(ctx, args, startedAt) {
    if (args.confirm !== true) {
        return makeErrorEnvelope('folia_quit', 'bad_request', 'folia_quit requires "confirm": true.', undefined, startedAt);
    }
    setTimeout(() => {
        try {
            ctx.app.quit();
        } catch (error) {
            console.warn('[Control] Failed to quit the app', error);
        }
    }, QUIT_DELAY_MS);
    return makeSuccessEnvelope('folia_quit', { quitting: true }, startedAt);
}

async function executeMainTool(ctx, tool, args, startedAt) {
    switch (tool.name) {
        case 'folia_screenshot':
            return captureScreenshot(ctx, args, startedAt);
        case 'folia_quit':
            return requestQuit(ctx, args, startedAt);
        default:
            return makeErrorEnvelope(tool.name, 'unknown_tool', CONTROL_ERROR_CODES.unknown_tool, undefined, startedAt);
    }
}

// Executes any catalog tool: main tools locally, everything else through the renderer bridge.
// Tool failures stay inside the unified envelope; only "renderer not ready" becomes HTTP 503.
async function executeTool(ctx, name, args) {
    const startedAt = now();
    if (typeof name !== 'string' || !name) {
        return makeErrorEnvelope(null, 'bad_request', 'A tool name is required.', undefined, startedAt);
    }
    const tool = getControlTool(name);
    if (!tool) {
        return makeErrorEnvelope(name, 'unknown_tool', CONTROL_ERROR_CODES.unknown_tool, undefined, startedAt);
    }

    if (tool.executor === 'main') {
        return executeMainTool(ctx, tool, isPlainObject(args) ? args : {}, startedAt);
    }

    try {
        const result = await rendererInvoke(ctx, name, isPlainObject(args) ? args : {});
        if (isPlainObject(result) && typeof result.ok === 'boolean') {
            return result;
        }
        return makeSuccessEnvelope(name, result ?? null, startedAt);
    } catch (error) {
        if (error instanceof ControlHttpError) {
            if (error.code === 'not_ready') {
                throw error;
            }
            return makeErrorEnvelope(name, error.code, error.message, error.details, startedAt);
        }
        return makeErrorEnvelope(name, 'internal', errorText(error), undefined, startedAt);
    }
}

function parseStateArgs(requestUrl) {
    const args = {};
    if (requestUrl.searchParams.has('includeQueue')) {
        args.includeQueue = ['1', 'true'].includes(requestUrl.searchParams.get('includeQueue'));
    }
    if (requestUrl.searchParams.has('includeLyrics')) {
        args.includeLyrics = ['1', 'true'].includes(requestUrl.searchParams.get('includeLyrics'));
    }
    if (requestUrl.searchParams.has('includeProviders')) {
        args.includeProviders = ['1', 'true'].includes(requestUrl.searchParams.get('includeProviders'));
    }
    return args;
}

function parseIntegerParam(requestUrl, name, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
    if (!requestUrl.searchParams.has(name)) {
        return fallback;
    }
    const raw = requestUrl.searchParams.get(name);
    const value = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(value) || value < min || value > max) {
        throw new ControlHttpError(400, 'bad_request', `Invalid "${name}" query parameter: ${raw}`);
    }
    return value;
}

function parseEventsArgs(requestUrl) {
    const args = {};
    const since = parseIntegerParam(requestUrl, 'since', { min: 0 });
    const limit = parseIntegerParam(requestUrl, 'limit', { min: 1, max: 200 });
    const waitMs = parseIntegerParam(requestUrl, 'waitMs', { min: 0, max: 10_000 });
    if (since !== undefined) args.since = since;
    if (limit !== undefined) args.limit = limit;
    if (waitMs !== undefined) args.waitMs = waitMs;
    return args;
}

const USAGE_TEXT = [
    'Folia control server',
    '',
    'GET  /health                          liveness (no token)',
    'GET  /tools                           control catalog (token)',
    'GET  /state?includeQueue=1            state snapshot (token)',
    'GET  /events?since=N&limit=N&waitMs=N event stream page (token)',
    'POST /invoke                          {"name":"folia_volume","args":{...}} (token)',
    'POST /mcp                             MCP JSON-RPC 2.0 (token)',
    '',
    'Auth: Authorization: Bearer <token>, X-Folia-Token: <token> or ?token=<token>.',
    'The token lives in <userData>/control-token; connection info in <userData>/control-server.json.',
].join('\n');

async function handleRoot(_req, res) {
    const body = `${USAGE_TEXT}\n`;
    res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
}

async function handleHealth(_req, res, ctx) {
    let version = null;
    try {
        version = ctx.app.getVersion?.() ?? null;
    } catch (error) {
        console.warn('[Control] app.getVersion() failed', error);
    }
    sendJson(res, 200, {
        ok: true,
        app: 'folia',
        version,
        controlApiVersion: CONTROL_API_VERSION,
        pid: process.pid,
        port: ctx.port,
    });
}

async function handleTools(_req, res, ctx) {
    const tools = await listControlTools(ctx);
    sendJson(res, 200, { ok: true, tools });
}

async function handleState(req, res, ctx, requestUrl) {
    const data = await rendererState(ctx, parseStateArgs(requestUrl));
    sendJson(res, 200, { ok: true, data: data ?? null });
}

async function handleEvents(req, res, ctx, requestUrl) {
    const data = await rendererEvents(ctx, parseEventsArgs(requestUrl));
    sendJson(res, 200, { ok: true, data: data ?? null });
}

async function handleInvoke(req, res, ctx) {
    const body = parseJsonBody(await readRequestBody(req), 'invoke');
    if (!isPlainObject(body)) {
        throw new ControlHttpError(400, 'bad_request', 'The /invoke body must be a JSON object.');
    }
    const name = body.name;
    if (typeof name !== 'string' || !name) {
        throw new ControlHttpError(400, 'bad_request', 'The /invoke body needs a "name" string.');
    }
    const args = body.args ?? {};
    if (!isPlainObject(args)) {
        throw new ControlHttpError(400, 'bad_request', 'The /invoke "args" field must be an object.');
    }
    const envelope = await executeTool(ctx, name, args);
    sendJson(res, 200, envelope);
}

function mcpErrorResponse(id, code, message, data) {
    return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code, message, ...(data === undefined ? {} : { data }) },
    };
}

async function callMcpTool(ctx, params) {
    if (!isPlainObject(params)) {
        throw new McpRpcError(-32602, 'Invalid params: tools/call expects an object.');
    }
    const name = params.name;
    if (typeof name !== 'string' || !name) {
        throw new McpRpcError(-32602, 'Invalid params: "name" is required.');
    }
    const args = params.arguments ?? {};
    if (!isPlainObject(args)) {
        throw new McpRpcError(-32602, 'Invalid params: "arguments" must be an object.');
    }
    if (!getControlTool(name)) {
        throw new McpRpcError(-32602, `Unknown tool: ${name}`);
    }

    let envelope;
    try {
        envelope = await executeTool(ctx, name, args);
    } catch (error) {
        // Only not_ready/timeout reach here; MCP reports execution failures as isError content.
        if (error instanceof ControlHttpError) {
            envelope = makeErrorEnvelope(name, error.code, error.message);
        } else {
            throw error;
        }
    }
    return toMcpToolResult(name, envelope);
}

async function readMcpResource(ctx, params) {
    if (!isPlainObject(params) || typeof params.uri !== 'string' || !params.uri) {
        throw new McpRpcError(-32602, 'Invalid params: resources/read expects a "uri" string.');
    }
    if (params.uri === 'folia://state') {
        const data = await rendererState(ctx, {});
        return {
            contents: [{
                uri: params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(data ?? null, null, 2),
            }],
        };
    }
    if (params.uri === 'folia://tools') {
        const tools = await listControlTools(ctx);
        return {
            contents: [{
                uri: params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(tools, null, 2),
            }],
        };
    }
    throw new McpRpcError(-32602, `Unknown resource: ${params.uri}`);
}

async function dispatchMcpMethod(ctx, method, params) {
    switch (method) {
        case 'initialize':
            return {
                protocolVersion: CONTROL_MCP_PROTOCOL_VERSION,
                capabilities: {
                    tools: { listChanged: false },
                    resources: { subscribe: false, listChanged: false },
                },
                serverInfo: { name: CONTROL_SERVER_NAME, version: CONTROL_SERVER_VERSION },
            };
        case 'ping':
            return {};
        case 'tools/list': {
            const tools = await listControlTools(ctx);
            return { tools: tools.map(toMcpTool) };
        }
        case 'tools/call':
            return callMcpTool(ctx, params);
        case 'resources/list':
            return { resources: MCP_RESOURCES.map((resource) => ({ ...resource })) };
        case 'resources/read':
            return readMcpResource(ctx, params);
        case 'logging/setLevel':
            return {};
        default:
            throw new McpRpcError(-32601, `Method not found: ${method}`);
    }
}

async function handleMcp(req, res, ctx) {
    const raw = await readRequestBody(req);
    let payload;
    try {
        payload = parseJsonBody(raw, 'MCP');
    } catch (error) {
        if (error instanceof ControlHttpError) {
            sendJson(res, 400, mcpErrorResponse(null, -32700, 'Parse error: invalid JSON body.'));
            return;
        }
        throw error;
    }
    if (!isPlainObject(payload)) {
        sendJson(res, 400, mcpErrorResponse(null, -32600, 'Invalid Request: a single JSON-RPC object is expected.'));
        return;
    }

    const id = payload.id ?? null;
    const method = payload.method;
    if (typeof method !== 'string' || !method) {
        sendJson(res, 400, mcpErrorResponse(id, -32600, 'Invalid Request: "method" is required.'));
        return;
    }
    // MCP notifications (notifications/initialized included) are acknowledged without a body.
    if (method.startsWith('notifications/')) {
        sendEmpty(res, 202);
        return;
    }

    try {
        const result = await dispatchMcpMethod(ctx, method, payload.params);
        sendJson(res, 200, { jsonrpc: '2.0', id, result });
    } catch (error) {
        if (error instanceof McpRpcError) {
            sendJson(res, 200, mcpErrorResponse(id, error.code, error.message, error.data));
            return;
        }
        if (error instanceof ControlHttpError) {
            sendJson(res, 200, mcpErrorResponse(id, -32000, error.message, { code: error.code }));
            return;
        }
        console.warn('[Control] Unhandled MCP request failure', error);
        sendJson(res, 200, mcpErrorResponse(id, -32603, 'Internal error.'));
    }
}

const ROUTES = {
    '/': { GET: handleRoot },
    '/health': { GET: handleHealth },
    '/tools': { GET: handleTools },
    '/state': { GET: handleState },
    '/events': { GET: handleEvents },
    '/invoke': { POST: handleInvoke },
    '/mcp': { POST: handleMcp },
};

function normalizePathname(pathname) {
    if (pathname.length > 1 && pathname.endsWith('/')) {
        return pathname.replace(/\/+$/, '');
    }
    return pathname;
}

async function routeRequest(req, res, ctx) {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${ctx.port}`);
    const pathname = normalizePathname(requestUrl.pathname);
    const route = ROUTES[pathname];
    if (!route) {
        sendJson(res, 404, {
            ok: false,
            error: { code: 'bad_request', message: `Unknown control route: ${pathname}` },
        });
        return;
    }

    const method = (req.method || 'GET').toUpperCase();
    const handler = route[method];
    if (!handler) {
        const allow = Object.keys(route).join(', ');
        sendJson(res, 405, {
            ok: false,
            error: { code: 'bad_request', message: `Method ${method} is not allowed on ${pathname}.` },
        }, { Allow: allow });
        return;
    }

    if (!PUBLIC_PATHS.has(pathname) && !safeTokenEqual(ctx.token, extractToken(req, requestUrl))) {
        sendAuthError(res);
        return;
    }

    await handler(req, res, ctx, requestUrl);
}

async function startControlServer(options = {}) {
    const { app, getWindow, dataDir } = options;
    if (!app || typeof app.getPath !== 'function') {
        throw new TypeError('startControlServer requires the Electron app object.');
    }
    if (typeof getWindow !== 'function') {
        throw new TypeError('startControlServer requires a getWindow() callback.');
    }

    const resolvedDataDir = dataDir || app.getPath('userData');
    if (!resolvedDataDir) {
        throw new Error('startControlServer could not resolve a data directory.');
    }
    fs.mkdirSync(resolvedDataDir, { recursive: true, mode: 0o700 });

    const { token, tokenFile } = resolveToken(resolvedDataDir);
    const ctx = {
        app,
        getWindow,
        dataDir: resolvedDataDir,
        token,
        port: 0,
        catalogFallbackLogged: false,
    };

    const server = http.createServer((req, res) => {
        Promise.resolve(routeRequest(req, res, ctx)).catch((error) => {
            if (error instanceof ControlHttpError) {
                sendJson(res, error.statusCode, {
                    ok: false,
                    error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
                });
                return;
            }
            console.warn('[Control] Unhandled request failure', error);
            sendJson(res, 500, {
                ok: false,
                error: { code: 'internal', message: CONTROL_ERROR_CODES.internal },
            });
        });
    });
    const preferredPort = resolvePort();
    let port;
    try {
        port = await listenOnAvailablePort(server, preferredPort);
    } catch (error) {
        console.warn(`[Control] Failed to start the control server on ports ${preferredPort}-${preferredPort + PORT_ATTEMPT_COUNT - 1}`, error);
        try {
            server.close();
        } catch {
            // The server never got a socket; nothing to close.
        }
        return null;
    }

    // Only after binding: during the port retry loop a listen error is expected and handled there.
    server.on('error', (error) => {
        console.warn('[Control] Server error', error);
    });

    ctx.port = port;
    const url = `http://127.0.0.1:${port}`;
    writeServerInfoFile(resolvedDataDir, {
        port,
        token,
        pid: process.pid,
        startedAt: now(),
        url,
    });
    log(`server ready url=${url} token-file=${tokenFile}`);

    let stopping = null;
    const stop = () => {
        if (stopping) {
            return stopping;
        }
        if (!server.listening) {
            stopping = Promise.resolve();
            return stopping;
        }
        stopping = new Promise((resolve) => {
            server.close(() => {
                log('server stopped');
                resolve();
            });
        });
        return stopping;
    };

    return { url, port, token, stop };
}

module.exports = { startControlServer };

// ---------------------------------------------------------------------------------------------
// Lifecycle for the settings page: a persisted switch, the running instance, its status, and the
// token. main.cjs owns the process-wide instance; these helpers keep the IPC handlers thin.
// ---------------------------------------------------------------------------------------------

const ENABLED_SETTING_KEY = 'CONTROL_SERVER_ENABLED';

/** The stored switch, or the environment default when nothing has been chosen yet. */
function isControlServerEnabled(store) {
    const stored = store?.get?.(ENABLED_SETTING_KEY);
    if (typeof stored === 'boolean') {
        return stored;
    }
    // Nothing stored yet: the environment decides, exactly as before this switch existed.
    return process.env.FOLIA_CONTROL === '1'
        || (process.env.ELECTRON_DEV === 'true' && process.env.FOLIA_CONTROL !== '0');
}

function readStoredToken(dataDir) {
    try {
        const stored = fs.readFileSync(path.join(dataDir, TOKEN_FILE_NAME), 'utf8').trim();
        return stored || null;
    } catch {
        return null;
    }
}

/** What the settings page shows: whether it is on, where it listens, and the token to copy. */
function buildControlStatus(dataDir, instance) {
    const running = Boolean(instance);
    return {
        enabled: running,
        running,
        url: instance?.url ?? null,
        port: instance?.port ?? null,
        token: instance?.token ?? readStoredToken(dataDir),
        tokenFile: path.join(dataDir, TOKEN_FILE_NAME),
        dataDir,
        controlCliPath: path.join(process.resourcesPath ?? '', 'control', 'cli.mjs'),
        controlMcpPath: path.join(process.resourcesPath ?? '', 'control', 'mcp.mjs'),
        error: null,
    };
}

/** Replaces the token file with a fresh 32-byte hex token and returns it. */
function regenerateControlToken(dataDir) {
    const token = crypto.randomBytes(32).toString('hex');
    writeFilePrivate(path.join(dataDir, TOKEN_FILE_NAME), token);
    return token;
}

module.exports = {
    startControlServer,
    isControlServerEnabled,
    buildControlStatus,
    regenerateControlToken,
    ENABLED_SETTING_KEY,
};
