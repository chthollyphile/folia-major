import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createFoliaServer } from './service.mjs';

// Opt-in loopback service; isolated stateless requests prevent cross-client session interference.
export async function startHttpServer({ port = 43197, token }) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid HTTP port.');
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Set FOLIA_MCP_TOKEN to 32–256 random URL-safe characters before starting HTTP.');
    const expected = Buffer.from(`Bearer ${token}`);
    const active = new Set();
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
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); reject(405, 'This stateless endpoint has no notification stream or sessions.'); return; }
        if (active.size >= 32) { reject(503, 'Too many active requests.'); return; }
        const server = createFoliaServer();
        active.add(server);
        res.once('close', () => { active.delete(server); void server.close(); });
        try {
            let size = 0;
            const chunks = [];
            for await (const chunk of req.iterator({ destroyOnReturn: false })) {
                size += chunk.length;
                if (size > 2 * 1024 * 1024) { reject(413, 'Request exceeds 2 MiB.'); req.resume(); return; }
                chunks.push(chunk);
            }
            let body;
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { reject(400, 'Invalid JSON.'); return; }
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
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
        await Promise.allSettled([...active].map(server => server.close()));
        http.closeAllConnections();
        await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    } };
}
