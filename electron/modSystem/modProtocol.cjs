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
 * Serves one picked file, honouring a single `Range: bytes=a-b` request (what
 * <video> seeking sends). Streams from disk instead of buffering the whole file.
 */
const servePickedFile = (request, filePath) => {
    const stat = fs.statSync(filePath);
    const contentType = MEDIA_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const baseHeaders = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
        let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
        let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
        end = Math.min(end, stat.size - 1);
        if (start > end || start >= stat.size) {
            return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` } });
        }
        start = Math.max(0, start);
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

const SCHEME = 'folia-mod';
const SERVABLE_EXTENSIONS = new Set(['.js', '.mjs']);
const CONTENT_TYPES = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
};

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
 */
const attachModProtocolHandler = (protocol, resolveModDirectory, resolvePickedFile = () => null) => {
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
            if (segments.some((segment) => segment === null || segment === '..' || segment.includes('\\') || path.isAbsolute(segment))) {
                return new Response('Invalid path', { status: 400 });
            }
            const relativePath = segments.join('/');
            const extension = path.extname(relativePath).toLowerCase();
            if (!relativePath || !SERVABLE_EXTENSIONS.has(extension)) {
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
                },
            });
        } catch (error) {
            return new Response(`Mod protocol error: ${String(error && error.message)}`, { status: 500 });
        }
    });
};

module.exports = { PICKED_FILES_HOST, SCHEME, MOD_PROTOCOL_PRIVILEGED_SCHEME, attachModProtocolHandler };