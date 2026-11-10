// electron/modSystem/netFetch.cjs
// `folium.net.fetch`: a web request a mod's client asks for, made in the main
// process, with its limits on method, time and body size. Cut out of
// modSystem.cjs.

'use strict';

const { permissionGuarding } = require('./manifest.cjs');

const NET_FETCH_PERMISSION = permissionGuarding('folium.net.fetch');

// folium.net.fetch limits: a mod fetches small JSON/text, not downloads.
const NET_FETCH_LIMITS = {
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 60000,
    maxBodyBytes: 5 * 1024 * 1024,
    methods: new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']),
};

/*
 * `requireLoadedMod(modId)` is the loader's: it gives the running mod of that id
 * or throws. `serializeError` turns a failure into the text the mod gets back.
 */
const createNetFetch = ({ requireLoadedMod, serializeError }) => {
    /*
     * folium.net.fetch: the request runs here, in Node, so it is not subject to
     * the renderer's CORS rules — which is why it sits behind `net.fetch`.
     * http(s) only, bounded time and body size, text bodies only.
     */
    const invokeModNetFetch = async (modId, url, init) => {
        const runtime = requireLoadedMod(modId);
        if (!runtime.manifest.permissions.includes(NET_FETCH_PERMISSION)) {
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
        if (!NET_FETCH_LIMITS.methods.has(method)) {
            return { ok: false, error: `net-unsupported-method:${method}` };
        }
        const timeoutMs = Math.min(
            NET_FETCH_LIMITS.maxTimeoutMs,
            Math.max(1000, Number(options.timeoutMs) || NET_FETCH_LIMITS.defaultTimeoutMs),
        );
        const headers = {};
        if (options.headers && typeof options.headers === 'object') {
            Object.entries(options.headers).forEach(([key, value]) => {
                if (typeof value === 'string') headers[key] = value;
            });
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(target, {
                method,
                headers,
                body: method === 'GET' || method === 'HEAD' || typeof options.body !== 'string' ? undefined : options.body,
                signal: controller.signal,
                redirect: 'follow',
            });
            const declaredLength = Number(response.headers.get('content-length'));
            if (Number.isFinite(declaredLength) && declaredLength > NET_FETCH_LIMITS.maxBodyBytes) {
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
                    if (received > NET_FETCH_LIMITS.maxBodyBytes) {
                        await reader.cancel().catch(() => {});
                        return { ok: false, error: 'net-body-too-large' };
                    }
                    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
                }
            }
            const buffer = Buffer.concat(chunks, received);
            const responseHeaders = {};
            response.headers.forEach((value, key) => { responseHeaders[key] = value; });
            return {
                ok: true,
                result: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders,
                    body: buffer.toString('utf8'),
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

module.exports = { createNetFetch, NET_FETCH_LIMITS };
