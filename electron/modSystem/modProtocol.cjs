// electron/modSystem/modProtocol.cjs
// The folia-mod:// privileged protocol: a strictly read-only, whitelisted
// file server that lets the renderer dynamically import browser-side ESM
// contributions (mod visualizers) from installed mod directories. It never
// executes anything in Node and only serves .js/.mjs from mods the loader
// has discovered and validated.

'use strict';

const fs = require('fs');
const path = require('path');

const SCHEME = 'folia-mod';
const SERVABLE_EXTENSIONS = new Set(['.js', '.mjs']);
const CONTENT_TYPES = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
};

/*
 * Must run before app ready. Kept in its own module so main.cjs only adds a
 * single line next to its existing registerSchemesAsPrivileged call.
 */
const registerModProtocolSchemes = (protocol) => {
    protocol.registerSchemesAsPrivileged([{
        scheme: SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    }]);
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
 */
const attachModProtocolHandler = (protocol, resolveModDirectory) => {
    protocol.handle(SCHEME, (request) => {
        try {
            const url = new URL(request.url);
            if (request.method !== 'GET' || url.host === '') {
                return new Response('Bad request', { status: 400 });
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

module.exports = { SCHEME, registerModProtocolSchemes, attachModProtocolHandler };