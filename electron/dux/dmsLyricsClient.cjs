'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// electron/dux/dmsLyricsClient.cjs
// Asks Dux Shell's own lyric engine for a track over its user-session Unix socket (the same
// `lyrics.get` method its QML media page calls). One request per connection: the reply is a single
// JSON line after the capabilities greeting, and Dux already caches the provider results on disk.

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_REPLY_BYTES = 4 * 1024 * 1024;
const SOCKET_PATTERN = /^(dms|danklinux)(?:-.*)?\.sock$/;

const discoverSockets = (runtimeDir, fsImpl = fs) => {
    let names;
    try {
        names = fsImpl.readdirSync(runtimeDir);
    } catch {
        return [];
    }
    return names
        .filter(name => SOCKET_PATTERN.test(name))
        .map(name => {
            const fullPath = path.join(runtimeDir, name);
            let mtime = 0;
            try {
                mtime = fsImpl.statSync(fullPath).mtimeMs;
            } catch {
                mtime = 0;
            }
            return { fullPath, name, mtime };
        })
        .sort((left, right) => {
            if (left.name === 'dms.sock') return -1;
            if (right.name === 'dms.sock') return 1;
            return right.mtime - left.mtime;
        })
        .map(entry => entry.fullPath);
};

const requestLyrics = (socketPath, request, {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    netImpl = net,
    signal = null,
} = {}) => new Promise((resolve, reject) => {
    let socket = null;
    let settled = false;
    let buffer = '';
    let greeted = false;
    let onAbort = null;

    const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (onAbort && signal) signal.removeEventListener('abort', onAbort);
        if (socket) {
            socket.destroy();
            socket = null;
        }
        if (error) reject(error);
        else resolve(value);
    };

    if (signal?.aborted) {
        finish(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        return;
    }
    if (signal) {
        onAbort = () => finish(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
        socket = netImpl.connect({ path: socketPath });
    } catch (error) {
        finish(error);
        return;
    }
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => finish(new Error('Dux lyrics request timed out')));
    socket.on('error', error => finish(error));
    socket.on('close', () => {
        // Dux can close after the greeting but before the reply (engine restart, dropped
        // connection). Settle here too: destroying the socket also cancels its inactivity timer.
        if (!settled) finish(new Error(greeted ? 'Dux closed the lyrics socket before replying' : 'Dux closed the lyrics socket before its greeting'));
    });
    socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > MAX_REPLY_BYTES) {
            finish(new Error('Dux lyrics reply is too large'));
            return;
        }
        for (;;) {
            const newline = buffer.indexOf('\n');
            if (newline < 0) return;
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (!greeted) {
                greeted = true;
                // Dux greets with its capabilities; the request goes right after it.
                socket.write(`${JSON.stringify(request)}\n`);
                continue;
            }
            try {
                finish(null, JSON.parse(line));
            } catch (error) {
                finish(new Error(`Dux sent an unreadable lyrics reply: ${error instanceof Error ? error.message : error}`));
            }
            return;
        }
    });
});

const createDmsLyricsClient = ({
    runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fsImpl = fs,
    netImpl = net,
    log = console,
} = {}) => {
    let nextId = 1;
    let socketPath = null;

    /**
     * `track` is { title, artist, album, durationSec, providers? }. Resolves to Dux's `result`
     * object (found/found:false/synced/plain) or null when Dux is not running.
     */
    const lookup = async (track = {}, { signal = null } = {}) => {
        const params = {
            title: typeof track.title === 'string' ? track.title : '',
            artist: typeof track.artist === 'string' ? track.artist : '',
            album: typeof track.album === 'string' ? track.album : '',
            allowNetwork: true,
        };
        const duration = Number(track.durationSec);
        if (Number.isFinite(duration) && duration > 0) params.duration = Math.round(duration);
        if (Array.isArray(track.providers) && track.providers.length > 0) {
            params.providers = track.providers.filter(provider => typeof provider === 'string' && provider);
        }
        if (!params.title || !params.artist || signal?.aborted) return null;

        const discovered = discoverSockets(runtimeDir, fsImpl);
        const candidates = socketPath
            ? [socketPath, ...discovered.filter(candidate => candidate !== socketPath)]
            : discovered;
        if (candidates.length === 0) return null;
        let lastError = null;
        for (const target of candidates) {
            try {
                if (signal?.aborted) return null;
                const reply = await requestLyrics(target, { id: nextId++, method: 'lyrics.get', params }, {
                    timeoutMs,
                    netImpl,
                    signal,
                });
                if (!reply) continue;
                if (reply.error) {
                    log.warn('[Dux] lyric engine rejected the request', reply.error);
                    return null;
                }
                socketPath = target;
                return reply.result ?? null;
            } catch (error) {
                if (signal?.aborted) return null;
                // A stale path (Dux restarted) or a stale socket file: try the next candidate.
                lastError = error;
                if (socketPath === target) socketPath = null;
            }
        }
        log.warn('[Dux] could not read lyrics from Dux', lastError);
        return null;
    };

    return { lookup };
};

module.exports = {
    createDmsLyricsClient,
    discoverSockets,
    requestLyrics,
};
