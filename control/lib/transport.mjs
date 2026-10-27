// control/lib/transport.mjs
// The two ways to reach a running Folia: the local HTTP control server (electron/controlServer.cjs)
// and the Chrome DevTools Protocol when the renderer was started with --remote-debugging-port.
// Both expose the same tiny interface: invoke/list/state/events/health/close.

/** A transport-level failure (connection, auth, CDP, timeout): exit code 2, with a hint. */
export class TransportError extends Error {
    constructor({ code, message, hint = '', status = 0, details = null, cause = null }) {
        super(message);
        this.name = 'TransportError';
        this.code = code;
        this.hint = hint;
        this.status = status;
        this.details = details;
        if (cause) {
            this.cause = cause;
        }
    }
}

const LOCAL_PAGE_PATTERN = /localhost:3000|127\.0\.0\.1|file:/;
const LOCAL_HOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/;
const STATE_RESOURCE_URI = 'folia://state';

function errorDetail(error) {
    const base = error?.message ?? String(error ?? 'unknown error');
    const code = error?.cause?.code ?? error?.code;
    if (code && !base.includes(String(code))) {
        return `${base} (${code})`;
    }
    return base;
}

function normalizeEnvelope(value, name) {
    if (value && typeof value === 'object' && typeof value.ok === 'boolean') {
        return value;
    }
    return {
        ok: false,
        tool: name,
        error: {
            code: 'protocol',
            message: `the bridge returned an unexpected value for ${name} (no control envelope)`,
        },
        ts: Date.now(),
    };
}

/**
 * Pick the page target to evaluate in.
 * Electron also exposes devtools pages; only a page whose URL looks like the app (or matches
 * --target) is usable. Returns null when nothing matches.
 */
export function pickCdpTarget(targets, target = null) {
    const pages = (Array.isArray(targets) ? targets : []).filter(page => (
        page
        && page.type === 'page'
        && typeof page.webSocketDebuggerUrl === 'string'
        && page.webSocketDebuggerUrl.length > 0
    ));
    if (target) {
        return pages.find(page => String(page.url ?? '').includes(target)) ?? null;
    }
    return pages.find(page => LOCAL_PAGE_PATTERN.test(String(page.url ?? '')))
        ?? pages.find(page => LOCAL_HOST_PATTERN.test(String(page.url ?? '')))
        ?? null;
}

function buildQuery(params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) {
            continue;
        }
        query.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
    const text = query.toString();
    return text ? `?${text}` : '';
}

/** HTTP transport: fetch against the Electron control server (PROTOCOL §3). */
export function createHttpTransport(config, { fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new TransportError({ code: 'unsupported', message: 'this Node.js has no global fetch (Node 18+ is required)' });
    }
    const baseUrl = String(config.url).replace(/\/+$/, '');
    const timeoutMs = config.timeoutMs ?? 30000;
    const token = config.token ?? null;
    const inflight = new Set();
    let closed = false;

    async function request(route, { method = 'GET', body, auth = true, timeout = timeoutMs, headers = {} } = {}) {
        if (closed) {
            throw new TransportError({ code: 'connection_closed', message: 'the transport was closed' });
        }
        const url = `${baseUrl}${route}`;
        const controller = new AbortController();
        inflight.add(controller);
        const timer = setTimeout(() => controller.abort('timeout'), timeout);

        const requestHeaders = { accept: 'application/json', ...headers };
        if (auth && token) {
            requestHeaders.authorization = `Bearer ${token}`;
        }
        if (body !== undefined) {
            requestHeaders['content-type'] = 'application/json';
        }

        let response;
        try {
            response = await fetchImpl(url, {
                method,
                headers: requestHeaders,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal,
            });
        } catch (cause) {
            if (controller.signal.reason === 'timeout') {
                throw new TransportError({
                    code: 'timeout',
                    message: `request to ${baseUrl}${route} timed out after ${timeout}ms`,
                    hint: 'raise --timeout (ms); events long-poll needs waitMs + network time',
                    cause,
                });
            }
            if (closed) {
                throw new TransportError({ code: 'connection_closed', message: 'the transport was closed', cause });
            }
            throw new TransportError({
                code: 'connection_failed',
                message: `cannot reach the Folia control server at ${baseUrl} (${errorDetail(cause)})`,
                hint: 'start the app with FOLIA_CONTROL=1 (dev: ELECTRON_DEV=true), or pass --url / --transport cdp',
                cause,
            });
        } finally {
            clearTimeout(timer);
            inflight.delete(controller);
        }

        const text = await response.text();
        let payload = null;
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch {
                payload = null;
            }
        }

        if (response.status === 401 || response.status === 403) {
            throw new TransportError({
                code: 'unauthorized',
                status: response.status,
                message: `the control server rejected the token (HTTP ${response.status})`,
                hint: 'pass --token <t> or --token-file <path>; the token lives in <userData>/control-token',
                details: payload,
            });
        }
        if (response.status === 404 || response.status === 405) {
            throw new TransportError({
                code: 'protocol',
                status: response.status,
                message: `unexpected response from ${route} (HTTP ${response.status}); the server build may not match this CLI`,
                hint: 'point --url at the Folia control server (default http://127.0.0.1:4567)',
                details: payload,
            });
        }
        return { status: response.status, payload };
    }

    async function invoke(name, args = {}) {
        const { status, payload } = await request('/invoke', {
            method: 'POST',
            body: { name, args: args ?? {} },
        });
        if (payload && typeof payload === 'object' && typeof payload.ok === 'boolean') {
            return payload;
        }
        if (payload && typeof payload === 'object' && payload.error) {
            return { ok: false, tool: name, error: payload.error, ts: Date.now() };
        }
        throw new TransportError({
            code: 'protocol',
            status,
            message: `invalid /invoke response (HTTP ${status}); expected a control envelope`,
            hint: 'the server build may not match this CLI',
        });
    }

    async function list() {
        const { payload } = await request('/tools');
        const tools = payload?.tools;
        if (!Array.isArray(tools)) {
            throw new TransportError({
                code: 'protocol',
                message: 'invalid /tools response; expected { ok: true, tools: [...] }',
            });
        }
        return tools;
    }

    function assertOkPayload(payload, route) {
        if (payload && payload.ok === false) {
            throw new TransportError({
                code: payload.error?.code ?? 'protocol',
                message: payload.error?.message ?? `the app could not answer ${route}`,
                details: payload.error?.details,
            });
        }
        return payload?.data ?? payload;
    }

    async function state(args = {}) {
        const { payload } = await request(`/state${buildQuery({
            includeQueue: args.includeQueue,
            includeLyrics: args.includeLyrics,
            includeProviders: args.includeProviders,
        })}`);
        return assertOkPayload(payload, '/state');
    }

    async function events(args = {}) {
        const { payload } = await request(`/events${buildQuery({
            since: args.since,
            limit: args.limit,
            waitMs: args.waitMs,
        })}`);
        return assertOkPayload(payload, '/events');
    }

    async function health() {
        const { payload } = await request('/health', { auth: false, timeout: Math.min(timeoutMs, 10000) });
        if (!payload || payload.ok !== true) {
            throw new TransportError({
                code: 'protocol',
                message: `unexpected /health response from ${baseUrl}`,
                hint: 'is --url pointing at the Folia control server?',
                details: payload,
            });
        }
        return payload;
    }

    async function close() {
        closed = true;
        for (const controller of inflight) {
            controller.abort('closed');
        }
        inflight.clear();
    }

    return {
        kind: 'http',
        baseUrl,
        invoke,
        list,
        tools: list,
        state,
        events,
        health,
        close,
        resourceUri: STATE_RESOURCE_URI,
    };
}

/**
 * CDP transport (PROTOCOL §5.1): discover the app page through GET /json/list, then evaluate
 * `window.__FOLIA_CONTROL__` calls over the built-in WebSocket (Node 22+).
 */
export function createCdpTransport(config, { fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket } = {}) {
    const cdpBase = String(config.cdpUrl ?? 'http://127.0.0.1:9222').replace(/\/+$/, '');
    const timeoutMs = config.timeoutMs ?? 30000;
    let socket = null;
    let connecting = null;
    let nextId = 1;
    const pending = new Map();

    async function findTarget() {
        let targets;
        try {
            const response = await fetchImpl(`${cdpBase}/json/list`, {
                signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            targets = await response.json();
        } catch (error) {
            throw new TransportError({
                code: 'cdp_unavailable',
                message: `cannot reach the CDP endpoint at ${cdpBase} (${errorDetail(error)})`,
                hint: 'start the app with --remote-debugging-port=9222, or pass --cdp <url>',
                cause: error,
            });
        }
        const target = pickCdpTarget(targets, config.target ?? null);
        if (!target) {
            const visible = (Array.isArray(targets) ? targets : [])
                .map(page => `${page.type ?? '?'}:${page.url ?? '?'}`)
                .join(', ') || '(no targets)';
            throw new TransportError({
                code: 'cdp_no_target',
                message: `no app page target found at ${cdpBase}`,
                hint: `pass --target <url-substring> to choose one (targets: ${visible})`,
            });
        }
        return target;
    }

    async function connect() {
        if (socket && socket.readyState === 1) {
            return socket;
        }
        if (connecting) {
            return connecting;
        }
        connecting = (async () => {
            const target = await findTarget();
            if (typeof WebSocketImpl !== 'function') {
                throw new TransportError({
                    code: 'unsupported',
                    message: 'this Node.js has no global WebSocket (Node 22+ is required)',
                });
            }
            const ws = new WebSocketImpl(target.webSocketDebuggerUrl);
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    try {
                        ws.close();
                    } catch {
                        // Already closed.
                    }
                    reject(new TransportError({
                        code: 'cdp_timeout',
                        message: `timed out connecting to ${target.webSocketDebuggerUrl}`,
                    }));
                }, timeoutMs);
                ws.addEventListener('open', () => {
                    clearTimeout(timer);
                    resolve();
                }, { once: true });
                ws.addEventListener('error', event => {
                    clearTimeout(timer);
                    reject(new TransportError({
                        code: 'cdp_unavailable',
                        message: `CDP websocket failed for ${target.url ?? target.webSocketDebuggerUrl} (${errorDetail(event)})`,
                        hint: 'the page may have closed; list targets with: curl "<cdp>/json/list"',
                    }));
                }, { once: true });
            });
            ws.addEventListener('message', event => {
                let message;
                try {
                    message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
                } catch {
                    return;
                }
                if (!message || typeof message.id !== 'number') {
                    return;
                }
                const entry = pending.get(message.id);
                if (!entry) {
                    return;
                }
                pending.delete(message.id);
                clearTimeout(entry.timer);
                if (message.error) {
                    entry.reject(new TransportError({
                        code: 'cdp_error',
                        message: message.error.message ?? `CDP error ${message.error.code ?? ''}`.trim(),
                        details: message.error,
                    }));
                } else {
                    entry.resolve(message.result);
                }
            });
            ws.addEventListener('close', () => {
                socket = null;
                connecting = null;
                for (const entry of pending.values()) {
                    clearTimeout(entry.timer);
                    entry.reject(new TransportError({ code: 'connection_closed', message: 'the CDP websocket closed' }));
                }
                pending.clear();
            });
            socket = ws;
            return ws;
        })();
        try {
            return await connecting;
        } finally {
            connecting = null;
        }
    }

    async function send(method, params = {}, { timeout = timeoutMs } = {}) {
        const ws = await connect();
        const id = nextId;
        nextId += 1;
        const promise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new TransportError({ code: 'timeout', message: `CDP ${method} timed out after ${timeout}ms` }));
            }, timeout);
            pending.set(id, { resolve, reject, timer });
        });
        try {
            ws.send(JSON.stringify({ id, method, params }));
        } catch (error) {
            clearTimeout(pending.get(id)?.timer);
            pending.delete(id);
            return Promise.reject(new TransportError({
                code: 'connection_closed',
                message: `cannot send CDP ${method}: ${error.message}`,
                cause: error,
            }));
        }
        return promise;
    }

    function bridgeExpression(body) {
        return `(async () => {
    const bridge = window.__FOLIA_CONTROL__;
    if (!bridge || bridge.version !== 1) throw new Error('bridge not installed');
    ${body}
})()`;
    }

    async function evaluate(expression) {
        const response = await send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (response?.exceptionDetails) {
            const description = response.exceptionDetails.exception?.description
                ?? response.exceptionDetails.text
                ?? 'evaluation failed';
            const message = String(description).split('\n')[0];
            if (message.includes('bridge not installed') || message.includes('__FOLIA_CONTROL__')) {
                throw new TransportError({
                    code: 'not_ready',
                    message: 'the Folia control bridge is not installed in the page',
                    hint: 'wait for the app to finish loading, or pass --target <url-substring> to choose the app page',
                });
            }
            throw new TransportError({
                code: 'cdp_eval_failed',
                message,
                details: response.exceptionDetails,
            });
        }
        return response?.result?.value;
    }

    async function screenshot() {
        try {
            const shot = await send('Page.captureScreenshot', { format: 'png' });
            return {
                ok: true,
                tool: 'folia_screenshot',
                data: { base64: shot?.data ?? '', mimeType: 'image/png' },
                ts: Date.now(),
            };
        } catch (error) {
            return {
                ok: false,
                tool: 'folia_screenshot',
                error: { code: 'unsupported', message: `CDP screenshot failed: ${error.message}` },
                ts: Date.now(),
            };
        }
    }

    async function invoke(name, args = {}) {
        if (name === 'folia_screenshot') {
            return screenshot();
        }
        if (name === 'folia_quit') {
            return {
                ok: false,
                tool: name,
                error: {
                    code: 'unsupported',
                    message: 'folia_quit needs the HTTP control server; CDP cannot quit the app',
                },
                ts: Date.now(),
            };
        }
        const value = await evaluate(bridgeExpression(
            `return await bridge.invoke(${JSON.stringify(name)}, ${JSON.stringify(args ?? {})});`,
        ));
        return normalizeEnvelope(value, name);
    }

    async function list() {
        const value = await evaluate(bridgeExpression('return await bridge.list();'));
        return Array.isArray(value) ? value : [];
    }

    async function state(args = {}) {
        return evaluate(bridgeExpression(`return bridge.state(${JSON.stringify(args ?? {})});`));
    }

    async function events(args = {}) {
        return evaluate(bridgeExpression(`return await bridge.events(${JSON.stringify(args ?? {})});`));
    }

    async function health() {
        return evaluate(bridgeExpression('return { ok: true, app: "folia", controlApiVersion: 1, bridge: bridge.version, ...bridge.info() };'));
    }

    async function close() {
        const ws = socket;
        socket = null;
        connecting = null;
        if (ws) {
            try {
                ws.close();
            } catch {
                // Already gone.
            }
        }
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(new TransportError({ code: 'connection_closed', message: 'transport closed' }));
        }
        pending.clear();
    }

    return {
        kind: 'cdp',
        cdpBase,
        invoke,
        list,
        tools: list,
        state,
        events,
        health,
        close,
        send,
        resourceUri: STATE_RESOURCE_URI,
    };
}

/**
 * Resolve the configured transport. `auto` probes /health over HTTP first and only falls back
 * to CDP when nothing is listening at all (an HTTP 401/404 is a real answer, not a missing app).
 */
export function createTransport(config, deps = {}) {
    if (config.transport === 'http') {
        return createHttpTransport(config, deps);
    }
    if (config.transport === 'cdp') {
        return createCdpTransport(config, deps);
    }

    let resolved = null;
    async function resolve() {
        if (resolved) {
            return resolved;
        }
        const http = createHttpTransport(config, deps);
        try {
            await http.health();
            resolved = http;
            return resolved;
        } catch (httpError) {
            if (httpError instanceof TransportError && httpError.code !== 'connection_failed' && httpError.code !== 'timeout') {
                throw httpError;
            }
            const cdp = createCdpTransport(config, deps);
            try {
                await cdp.health();
                resolved = cdp;
                return resolved;
            } catch (cdpError) {
                throw new TransportError({
                    code: 'connection_failed',
                    message: `Folia is not reachable over HTTP (${httpError.message}) or CDP (${cdpError.message})`,
                    hint: 'start the app with FOLIA_CONTROL=1 (dev: ELECTRON_DEV=true), or pass --url/--token-file, or use --transport cdp with --remote-debugging-port=9222',
                    details: { url: config.url, cdp: config.cdpUrl },
                });
            }
        }
    }

    return {
        kind: 'auto',
        get resolvedKind() {
            return resolved?.kind ?? null;
        },
        async invoke(...args) {
            return (await resolve()).invoke(...args);
        },
        async list(...args) {
            return (await resolve()).list(...args);
        },
        async tools(...args) {
            return (await resolve()).tools(...args);
        },
        async state(...args) {
            return (await resolve()).state(...args);
        },
        async events(...args) {
            return (await resolve()).events(...args);
        },
        async health(...args) {
            return (await resolve()).health(...args);
        },
        async close() {
            if (resolved) {
                await resolved.close();
            }
            resolved = null;
        },
    };
}
