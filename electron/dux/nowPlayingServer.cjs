'use strict';

const crypto = require('node:crypto');
const http = require('node:http');

// electron/dux/nowPlayingServer.cjs
// The local endpoint Folia's Now Playing stage source already speaks: the now-playing-service
// WebSocket events on /api/ws/lyric, the precise-progress JSON on /api/query/progress, plus an
// /art/<token> route for the cover the bridge borrowed from MPRIS. Loopback only.

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_PATH = '/api/ws/lyric';
const PROGRESS_PATH = '/api/query/progress';
const ART_PREFIX = '/art/';
const ART_TOKEN = /^[0-9a-f]{32}$/;
const MAX_CLIENT_FRAME_BYTES = 64 * 1024;
const MAX_CLIENTS = 8;
const PING_INTERVAL_MS = 30000;

const computeAccept = key => crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');

/** One unmasked server-to-client text frame. */
const encodeTextFrame = (text) => {
    const payload = Buffer.from(text, 'utf8');
    const length = payload.length;
    let header;
    if (length < 126) {
        header = Buffer.from([0x81, length]);
    } else if (length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(length), 2);
    }
    return Buffer.concat([header, payload]);
};

const encodeControlFrame = (opcode, payload = Buffer.alloc(0)) => {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    return Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]);
};

/**
 * Frames from the browser are masked. This endpoint receives no application messages, so only
 * ping/close/pong have to be understood; anything else is ignored. Returns the parsed frames and
 * the unread tail.
 */
const parseFrames = (buffer) => {
    const frames = [];
    let offset = 0;
    while (offset + 2 <= buffer.length) {
        const first = buffer[offset];
        const second = buffer[offset + 1];
        const opcode = first & 0x0f;
        const masked = (second & 0x80) !== 0;
        let length = second & 0x7f;
        let headerLength = 2;
        if (length === 126) {
            if (offset + 4 > buffer.length) break;
            length = buffer.readUInt16BE(offset + 2);
            headerLength = 4;
        } else if (length === 127) {
            if (offset + 10 > buffer.length) break;
            const wide = buffer.readBigUInt64BE(offset + 2);
            if (wide > BigInt(MAX_CLIENT_FRAME_BYTES)) {
                return { frames, rest: Buffer.alloc(0), tooLarge: true };
            }
            length = Number(wide);
            headerLength = 10;
        }
        if (length > MAX_CLIENT_FRAME_BYTES) return { frames, rest: Buffer.alloc(0), tooLarge: true };
        const maskLength = masked ? 4 : 0;
        const total = headerLength + maskLength + length;
        if (offset + total > buffer.length) break;
        let payload = buffer.subarray(offset + headerLength + maskLength, offset + total);
        if (masked) {
            const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
            payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
        }
        frames.push({ opcode, payload });
        offset += total;
    }
    return { frames, rest: buffer.subarray(offset), tooLarge: false };
};

const createNowPlayingServer = ({
    port = 9863,
    host = '127.0.0.1',
    getProgressMs = () => 0,
    getArtwork = async () => null,
    getSnapshot = () => null,
    onClientCountChange = () => {},
    log = console,
    pingIntervalMs = PING_INTERVAL_MS,
} = {}) => {
    const clients = new Set();
    let server = null;
    let pingTimer = null;

    const send = (client, event, data) => {
        try {
            client.socket.write(encodeTextFrame(JSON.stringify({ event, data })));
        } catch (error) {
            log.warn('[Dux] could not write to a now-playing client', error);
            clients.delete(client);
            client.socket.destroy();
        }
    };

    const broadcast = (event, data) => {
        for (const client of clients) send(client, event, data);
    };

    const sendInitial = (client) => {
        const snapshot = getSnapshot();
        if (!snapshot) return;
        send(client, 'Track', snapshot.track ?? null);
        send(client, 'Lyric', snapshot.lyric ?? null);
        send(client, 'PlayerPauseState', {
            hasSong: Boolean(snapshot.track),
            isPaused: snapshot.paused !== false,
            seekbarCurrentPosition: Math.max(0, Number(snapshot.positionSec) || 0),
        });
        send(client, 'PlayerProgress', { progress: Math.max(0, Number(snapshot.progressMs) || 0) });
    };

    const closeClient = (client) => {
        clients.delete(client);
        client.socket.destroy();
        onClientCountChange(clients.size);
    };

    const attach = (socket, head) => {
        const client = { socket };
        clients.add(client);
        socket.setNoDelay(true);
        onClientCountChange(clients.size);
        sendInitial(client);
        socket.on('data', chunk => {
            if (!clients.has(client)) return;
            client.buffer = Buffer.concat([client.buffer ?? Buffer.alloc(0), chunk]);
            const { frames, rest, tooLarge } = parseFrames(client.buffer);
            client.buffer = rest;
            if (tooLarge) {
                closeClient(client);
                return;
            }
            for (const frame of frames) {
                if (frame.opcode === 0x8) {
                    socket.end(encodeControlFrame(0x8, frame.payload.subarray(0, 2)));
                    closeClient(client);
                    return;
                }
                if (frame.opcode === 0x9) {
                    socket.write(encodeControlFrame(0xa, frame.payload));
                }
            }
        });
        socket.on('error', () => closeClient(client));
        socket.on('close', () => {
            if (clients.delete(client)) onClientCountChange(clients.size);
        });
    };

    const handleRequest = async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method !== 'GET') {
            res.writeHead(405, { Allow: 'GET, OPTIONS' });
            res.end();
            return;
        }

        const url = new URL(req.url || '/', `http://${host}:${port}`);
        if (url.pathname === PROGRESS_PATH) {
            const body = JSON.stringify({ progress: Math.max(0, Math.round(Number(getProgressMs()) || 0)) });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
            res.end(body);
            return;
        }

        if (url.pathname.startsWith(ART_PREFIX)) {
            const token = url.pathname.slice(ART_PREFIX.length);
            const artwork = ART_TOKEN.test(token) ? await getArtwork(token) : null;
            if (!artwork) {
                res.writeHead(404);
                res.end();
                return;
            }
            res.writeHead(200, {
                'Content-Type': artwork.contentType,
                'Content-Length': artwork.bytes.length,
                'Cache-Control': 'public, max-age=3600',
            });
            res.end(artwork.bytes);
            return;
        }

        if (url.pathname === '/health') {
            const body = JSON.stringify({ ok: true, clients: clients.size });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(body);
            return;
        }

        res.writeHead(404);
        res.end();
    };

    const handleUpgrade = (req, socket, head) => {
        const url = new URL(req.url || '/', `http://${host}:${port}`);
        const key = req.headers['sec-websocket-key'];
        if (url.pathname !== WS_PATH || typeof key !== 'string' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
            socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
            return;
        }
        if (clients.size >= MAX_CLIENTS) {
            socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
            return;
        }
        const accept = computeAccept(key);
        socket.write([
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${accept}`,
            'Access-Control-Allow-Origin: *',
            '',
            '',
        ].join('\r\n'));
        if (head && head.length > 0) socket.unshift(head);
        attach(socket, head);
    };

    const start = () => new Promise((resolve, reject) => {
        if (server) {
            resolve({ port, host });
            return;
        }
        const next = http.createServer((req, res) => {
            handleRequest(req, res).catch(error => {
                log.warn('[Dux] now-playing request failed', error);
                if (!res.headersSent) res.writeHead(500);
                res.end();
            });
        });
        next.on('upgrade', handleUpgrade);
        next.on('error', error => {
            if (server === next) server = null;
            reject(error);
        });
        next.listen(port, host, () => {
            server = next;
            pingTimer = setInterval(() => {
                for (const client of clients) {
                    try {
                        client.socket.write(encodeControlFrame(0x9));
                    } catch {
                        closeClient(client);
                    }
                }
            }, pingIntervalMs);
            pingTimer?.unref?.();
            const actualPort = typeof next.address === 'function' && next.address() ? next.address().port : port;
            log.info('[Dux] now-playing endpoint listening', { url: `http://${host}:${actualPort}${WS_PATH}` });
            resolve({ port: actualPort, host });
        });
    });

    const stop = () => new Promise(resolve => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        for (const client of clients) client.socket.destroy();
        clients.clear();
        if (!server) {
            resolve();
            return;
        }
        const closing = server;
        server = null;
        closing.close(() => resolve());
    });

    return {
        start,
        stop,
        broadcast,
        clientCount: () => clients.size,
    };
};

module.exports = {
    ART_TOKEN,
    WS_GUID,
    WS_PATH,
    PROGRESS_PATH,
    computeAccept,
    createNowPlayingServer,
    encodeControlFrame,
    encodeTextFrame,
    parseFrames,
};
