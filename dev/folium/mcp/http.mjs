import { createServer } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createFoliaServer } from './service.mjs';

// Opt-in loopback service; each authenticated client owns its cancellation and request namespace.
export async function startHttpServer({ port = 43197, token }) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid HTTP port.');
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Set FOLIUM_MCP_TOKEN to 32–256 random URL-safe characters before starting HTTP.');
    const expected = Buffer.from(`Bearer ${token}`);
    const sessions = new Map();
    let active = 0;
    const release = async session => { sessions.delete(session.transport.sessionId); await session.server.close(); };
    const reaper = setInterval(() => {
        for (const session of sessions.values()) if (!session.active && Date.now() - session.used > 300000) void release(session);
    }, 30000);
    reaper.unref();
    let authority;
    const http = createServer(async (req, res) => {
        const reject = (status, message) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }));
        };
        // Native local clients only: no permissive CORS, forwarded host, or browser origins.
        if (req.headers.host !== authority || req.headers.origin !== undefined) { reject(403, 'Only native loopback clients are allowed.'); return; }
        const received = Buffer.from(req.headers.authorization ?? '');
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) { reject(401, 'Bearer authentication required.'); return; }
        if (req.url !== '/mcp') { reject(404, 'Use /mcp.'); return; }
        if (!['POST', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'POST, DELETE'); reject(405, 'No standalone notification stream.'); return; }
        if (active >= 32) { reject(503, 'Too many active requests.'); return; }
        active++;
        let session;
        res.once('close', () => {
            active--;
            if (session) { session.active--; session.used = Date.now(); if (!res.writableFinished) void release(session); }
        });
        try {
            let size = 0;
            const chunks = [];
            for await (const chunk of req.iterator({ destroyOnReturn: false })) {
                size += chunk.length;
                if (size > 2 * 1024 * 1024) { reject(413, 'Request exceeds 2 MiB.'); req.resume(); return; }
                chunks.push(chunk);
            }
            let body;
            try { body = req.method === 'DELETE' ? undefined : JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { reject(400, 'Invalid JSON.'); return; }
            const id = req.headers['mcp-session-id'];
            if (typeof id === 'string') {
                session = sessions.get(id);
                if (!session) { reject(404, 'Session expired; initialize again.'); return; }
            } else {
                if (req.method !== 'POST' || !isInitializeRequest(body)) { reject(400, 'Initialize a client session first.'); return; }
                if (sessions.size >= 32) { reject(503, 'Too many sessions.'); return; }
                const server = createFoliaServer();
                const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true,
                    onsessioninitialized: id => sessions.set(id, session), onsessionclosed: id => sessions.delete(id) });
                session = { server, transport, active: 0, used: Date.now() };
                await server.connect(transport);
            }
            session.active++;
            await session.transport.handleRequest(req, res, body);
            if (req.method === 'DELETE' || !session.transport.sessionId) await release(session);
        } catch {
            if (!res.headersSent) reject(500, 'MCP request failed.');
            else res.end();
        }
    });
    http.requestTimeout = 15000;
    http.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, '127.0.0.1', resolve);
    });
    authority = `127.0.0.1:${http.address().port}`;
    return { url: `http://${authority}/mcp`, close: async () => {
        clearInterval(reaper);
        await Promise.allSettled([...sessions.values()].map(release));
        http.closeAllConnections();
        await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    } };
}
