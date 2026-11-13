// electron/modSystem/netFetch.cjs
// `folium.net.fetch`: a web request a mod's client asks for, made in the main
// process, with its limits on method, time and body size. Cut out of
// modSystem.cjs.
//
// Folium 2.0 (plan §5.2): the limits are per class, from foliumShared.json. An ordinary mod keeps every
// one of them (the `net.fetch` permission, Node's fetch, text only, 5 MB, 15 s up to 60 s). A source mod
// needs no permission and goes through Electron `net` (`sourceFetch`, the app's network stack: system
// proxy, certificates), with no cap on the answer and a time limit it sets itself; `responseType:
// 'base64'` answers the body as base64 for binary data, and `session` names a partition (one its row or
// claims name, or one of its own, as api.net.session).

'use strict';

const { permissionGuarding } = require('./manifest.cjs');
const { limits } = require('./foliumShared.json');

const NET_FETCH_PERMISSION = permissionGuarding('folium.net.fetch');

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

// folium.net.fetch limits of an ordinary mod: a mod fetches small JSON/text, not downloads.
const NET_FETCH_LIMITS = {
    defaultTimeoutMs: limits.standard.netFetch.defaultTimeoutMs,
    maxTimeoutMs: limits.standard.netFetch.maxTimeoutMs,
    maxBodyBytes: limits.standard.netFetch.maxBodyBytes,
    methods: METHODS,
};

// A source mod's: no cap on the answer, no ceiling on the time limit it asks for.
const SOURCE_NET_FETCH_LIMITS = {
    defaultTimeoutMs: limits.source.netFetch.defaultTimeoutMs,
    maxTimeoutMs: limits.source.netFetch.maxTimeoutMs,
    maxBodyBytes: limits.source.netFetch.maxBodyBytes,
    methods: METHODS,
};

/*
 * `requireLoadedMod(modId)` is the loader's: it gives the running mod of that id
 * or throws. `serializeError` turns a failure into the text the mod gets back.
 * `sourceFetch` is Electron's `net.fetch` (a source mod's requests); `nodeFetch` the global fetch.
 * `hasSourceExemptions(runtime)` says whether a source mod keeps its exemptions (Folium 2.0 S3: one whose client
 * registered none of its sources loses them); without it, every source mod does.
 */
const createNetFetch = ({
    requireLoadedMod,
    serializeError,
    sourceFetch = null,
    nodeFetch = (...args) => fetch(...args),
    hasSourceExemptions = (runtime) => Boolean(runtime.source),
}) => {
    /*
     * folium.net.fetch: the request runs here, in Node, so it is not subject to
     * the renderer's CORS rules — which is why it sits behind `net.fetch`.
     * http(s) only, bounded time and body size, text bodies only (a source mod: see the top of this file).
     */
    const invokeModNetFetch = async (modId, url, init) => {
        const runtime = requireLoadedMod(modId);
        const isSource = hasSourceExemptions(runtime);
        const rules = isSource ? SOURCE_NET_FETCH_LIMITS : NET_FETCH_LIMITS;
        if (!isSource && !runtime.manifest.permissions.includes(NET_FETCH_PERMISSION)) {
            return { ok: false, error: `permission-denied:${NET_FETCH_PERMISSION}` };
        }
        let target;
        try {
            target = new URL(String(url));
        } catch {
            return { ok: false, error: 'net-invalid-url' };
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            return { ok: false, error: 'net-unsupported-protocol' };
        }
        const options = init && typeof init === 'object' ? init : {};
        const method = String(options.method ?? 'GET').toUpperCase();
        if (!rules.methods.has(method)) {
            return { ok: false, error: `net-unsupported-method:${method}` };
        }
        const askedMs = Math.max(1000, Number(options.timeoutMs) || rules.defaultTimeoutMs);
        const timeoutMs = rules.maxTimeoutMs === null ? askedMs : Math.min(rules.maxTimeoutMs, askedMs);
        const maxBodyBytes = rules.maxBodyBytes;
        const headers = {};
        if (options.headers && typeof options.headers === 'object') {
            Object.entries(options.headers).forEach(([key, value]) => {
                if (typeof value === 'string') headers[key] = value;
            });
        }
        const send = isSource && sourceFetch
            ? (target, request) => sourceFetch(target, request, { runtime, session: typeof options.session === 'string' ? options.session : undefined })
            : nodeFetch;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await send(target.href, {
                method,
                headers,
                body: method === 'GET' || method === 'HEAD' || typeof options.body !== 'string' ? undefined : options.body,
                signal: controller.signal,
                redirect: 'follow',
            });
            const declaredLength = Number(response.headers.get('content-length'));
            if (maxBodyBytes !== null && Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
                controller.abort();
                return { ok: false, error: 'net-body-too-large' };
            }
            // Content-Length is optional (chunked, compressed), so the limit is
            // enforced while reading: the body is never buffered past it.
            const chunks = [];
            let received = 0;
            if (response.body) {
                const reader = response.body.getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    received += value.byteLength;
                    if (maxBodyBytes !== null && received > maxBodyBytes) {
                        await reader.cancel().catch(() => {});
                        return { ok: false, error: 'net-body-too-large' };
                    }
                    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
                }
            }
            const buffer = Buffer.concat(chunks, received);
            const responseHeaders = {};
            response.headers.forEach((value, key) => { responseHeaders[key] = value; });
            const binary = isSource && options.responseType === 'base64';
            return {
                ok: true,
                result: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders,
                    body: binary ? '' : buffer.toString('utf8'),
                    ...(binary ? { bodyBase64: buffer.toString('base64') } : {}),
                },
            };
        } catch (error) {
            return { ok: false, error: controller.signal.aborted ? 'net-timeout' : serializeError(error) };
        } finally {
            clearTimeout(timer);
        }
    };

    return { invokeModNetFetch };
};

module.exports = { createNetFetch, NET_FETCH_LIMITS, SOURCE_NET_FETCH_LIMITS };
