// electron/modSystem/modProtocol.cjs
// The folia-mod:// privileged protocol: a strictly read-only, whitelisted
// file server. Two kinds of URL:
//   - folia-mod://<modId>/<path>: browser-side ESM of a validated, loaded mod
//     (client entries and their imports); only .js/.mjs are served;
//   - folia-mod://_files/<token>/<name>: a file the user picked through
//     folium.ui.pickFile this session, served with Range support so media
//     elements can seek. Tokens are unguessable and die with the session.
// It never executes anything in Node.

'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const PICKED_FILES_HOST = '_files';
const MEDIA_CONTENT_TYPES = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
};

/*
 * One `Range: bytes=a-b` header against a file of `size` bytes: { start, end } (inclusive), 'unsatisfiable',
 * or null for no (usable) range, which serves the whole file. Only a single range is read; it is what
 * <audio> and <video> seeking send.
 */
const parseRangeHeader = (header, size) => {
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
    if (!range || (!range[1] && !range[2])) return null;
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return 'unsatisfiable';
    start = Math.max(0, start);
    return { start, end };
};

/*
 * Serves one file from disk, honouring a single `Range: bytes=a-b` request (what
 * <video> seeking sends). Streams from disk instead of buffering the whole file.
 */
const serveFileWithRange = (request, filePath, contentType = null) => {
    const stat = fs.statSync(filePath);
    const baseHeaders = {
        'Content-Type': contentType ?? MEDIA_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
    };
    const range = parseRangeHeader(request.headers.get('range'), stat.size);
    if (range === 'unsatisfiable') {
        return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` } });
    }
    if (range) {
        const { start, end } = range;
        const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
        return new Response(stream, {
            status: 206,
            headers: {
                ...baseHeaders,
                'Content-Length': String(end - start + 1),
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            },
        });
    }
    const stream = Readable.toWeb(fs.createReadStream(filePath));
    return new Response(stream, { status: 200, headers: { ...baseHeaders, 'Content-Length': String(stat.size) } });
};

// A picked file: the same reader, with the type taken from its name.
const servePickedFile = (request, filePath) => serveFileWithRange(request, filePath);

/*
 * Folium 2.0 (plan §5.5): folia-mod://<mod id>/_media/<name>/<rest> goes to the handler a source mod's main
 * entry registered with `api.media.serve(name, handler)`. The handler gets { url, path, query, headers,
 * range } (`range` is the raw Range header; parseRangeHeader reads it) and answers one of:
 *   - { file, contentType? }: a file on disk, served here with Range support;
 *   - a web Response, passed through as it is;
 *   - { status?, headers?, body }: body a string, Buffer, Uint8Array, web ReadableStream or Node stream;
 *   - null / undefined: 404.
 * A throw or a rejection answers 502.
 */
const MEDIA_ROUTE = '_media';

const toResponseBody = (body) => {
    if (body === undefined || body === null) return null;
    if (typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer) return body;
    if (typeof body.getReader === 'function') return body;
    if (typeof body.pipe === 'function') return Readable.toWeb(body);
    throw new TypeError('media handler answered a body of an unknown kind');
};

const serveModMedia = async (request, url, segments, resolveMediaHandler, modId) => {
    const [name, ...rest] = segments;
    const handler = name ? resolveMediaHandler(modId, name) : null;
    if (!handler) {
        return new Response('Unknown media', { status: 404 });
    }
    const headers = {};
    request.headers.forEach((value, key) => { headers[key] = value; });
    let answer;
    try {
        answer = await handler({
            url: request.url,
            path: rest.join('/'),
            query: Object.fromEntries(url.searchParams.entries()),
            headers,
            range: request.headers.get('range'),
        });
        if (answer === null || answer === undefined) {
            return new Response('Not found', { status: 404 });
        }
        if (answer instanceof Response) {
            return answer;
        }
        if (typeof answer.file === 'string') {
            return serveFileWithRange(request, answer.file, answer.contentType ?? null);
        }
        return new Response(toResponseBody(answer.body), {
            status: Number.isInteger(answer.status) ? answer.status : 200,
            headers: { 'Cache-Control': 'no-store', ...(answer.headers ?? {}) },
        });
    } catch (error) {
        return new Response(`Media handler failed: ${String(error && error.message)}`, { status: 502 });
    }
};

const SCHEME = 'folia-mod';
const SERVABLE_EXTENSIONS = new Set(['.js', '.mjs']);
const CONTENT_TYPES = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    // Folium 2.0 (plan §4.6): a `folium: 2` mod's own icons, images and language tables.
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.json': 'application/json; charset=utf-8',
};
// Only a `folium: 2` mod's files are served with these; a `folium: 1` mod keeps the scripts-only rule of 1.9.
const FOLIUM_2_STATIC_EXTENSIONS = new Set(['.svg', '.png', '.webp', '.json']);

/*
 * Scheme privileges for folia-mod, exported as data instead of a registration
 * call. registerSchemesAsPrivileged overwrites the fetch/secure/cors scheme
 * switches on every call, so main.cjs must register every custom scheme in one
 * single call; a second call would silently strip the first scheme's
 * privileges.
 */
const MOD_PROTOCOL_PRIVILEGED_SCHEME = {
    scheme: SCHEME,
    privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
    },
};

const decodePathSegment = (segment) => {
    try {
        return decodeURIComponent(segment);
    } catch {
        return null;
    }
};

/*
 * Attaches the request handler. resolveModDirectory(modId) must return the
 * absolute directory of a validated mod or null. Every request is confined to
 * that directory: traversal segments and absolute paths are rejected.
 * resolvePickedFile(token) returns the absolute path of a picked file or null.
 * Folium 2.0: resolveModFolium(modId) says the mod's `folium` (2 opens the static extensions), and
 * resolveMediaHandler(modId, name) gives the handler of a `_media` route or null.
 */
const attachModProtocolHandler = (
    protocol,
    resolveModDirectory,
    resolvePickedFile = () => null,
    { resolveModFolium = () => 1, resolveMediaHandler = () => null } = {},
) => {
    protocol.handle(SCHEME, (request) => {
        try {
            const url = new URL(request.url);
            if (request.method !== 'GET' || url.host === '') {
                return new Response('Bad request', { status: 400 });
            }
            if (url.host === PICKED_FILES_HOST) {
                const token = decodePathSegment(url.pathname.split('/').filter(Boolean)[0] ?? '');
                const filePath = token ? resolvePickedFile(token) : null;
                return filePath ? servePickedFile(request, filePath) : new Response('Unknown file', { status: 404 });
            }
            const modId = decodePathSegment(url.host);
            const modDirectory = modId ? resolveModDirectory(modId) : null;
            if (!modDirectory) {
                return new Response('Unknown mod', { status: 404 });
            }

            const segments = url.pathname.split('/').filter(Boolean).map(decodePathSegment);
            // A segment is one path step after decoding: `%2F` inside it (`a%2F..%2Fx`) would smuggle `..` past this
            // check into the `_media` handler's path, which has no folder of its own to stay inside of.
            if (segments.some((segment) => segment === null || segment === '..' || segment === '.' || segment.includes('/')
                || segment.includes('\\') || path.isAbsolute(segment))) {
                return new Response('Invalid path', { status: 400 });
            }
            if (segments[0] === MEDIA_ROUTE) {
                return serveModMedia(request, url, segments.slice(1), resolveMediaHandler, modId);
            }
            const relativePath = segments.join('/');
            const extension = path.extname(relativePath).toLowerCase();
            const servable = SERVABLE_EXTENSIONS.has(extension)
                || (FOLIUM_2_STATIC_EXTENSIONS.has(extension) && resolveModFolium(modId) === 2);
            if (!relativePath || !servable) {
                return new Response('Forbidden file type', { status: 403 });
            }

            const absolutePath = path.join(modDirectory, relativePath);
            if (!absolutePath.startsWith(modDirectory + path.sep)) {
                return new Response('Forbidden', { status: 403 });
            }

            const data = fs.readFileSync(absolutePath);
            return new Response(data, {
                status: 200,
                headers: {
                    'Content-Type': CONTENT_TYPES[extension],
                    // Contributions are dev-local files; never let the browser
                    // or proxies cache a stale mod version across reloads.
                    'Cache-Control': 'no-store',
                    // The type above is the only reading of the file: an image never runs as a script.
                    'X-Content-Type-Options': 'nosniff',
                },
            });
        } catch (error) {
            return new Response(`Mod protocol error: ${String(error && error.message)}`, { status: 500 });
        }
    });
};

module.exports = {
    PICKED_FILES_HOST,
    MEDIA_ROUTE,
    SCHEME,
    MOD_PROTOCOL_PRIVILEGED_SCHEME,
    attachModProtocolHandler,
    parseRangeHeader,
};