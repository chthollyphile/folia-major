import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/obsBrowserSourceHttp.test.ts
// Exercise the actual HTTP handler without starting Electron or reading user settings.

const { createObsBrowserSourceHttpHandler } = require('../../../electron/obsBrowserSourceHttp.cjs') as {
    createObsBrowserSourceHttpHandler: (options: Record<string, unknown>) => (
        req: http.IncomingMessage, res: http.ServerResponse,
    ) => Promise<void>;
};

const activeServers: http.Server[] = [];

afterEach(async () => {
    await Promise.all(activeServers.splice(0).map(server => new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close(error => error ? reject(error) : resolve());
    })));
});

const startServer = async ({ enabled = true, token = 'private-obs-token', dev = false }: {
    enabled?: boolean;
    token?: string | null;
    dev?: boolean;
} = {}) => {
    let port = 0;
    const clients = new Set<http.ServerResponse>();
    const matchesToken = vi.fn((url: URL) => Boolean(token) && url.searchParams.get('token') === token);
    const broadcastStatus = vi.fn();
    const serveStaticFile = vi.fn(async (_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>OBS source</html>');
    });
    const handler = createObsBrowserSourceHttpHandler({
        getConfiguredObsBrowserSourcePort: () => port,
        isObsBrowserSourceEnabled: () => enabled,
        obsBrowserSourceClients: clients,
        matchesObsBrowserSourceToken: matchesToken,
        sendObsBrowserSourceBootstrapEvents: (res: http.ServerResponse) => {
            res.write('event: config\ndata: {"song":{"name":"Test song"}}\n\n');
        },
        broadcastObsBrowserSourceStatus: broadcastStatus,
        isElectronDevRuntime: () => dev,
        serveObsStaticFile: serveStaticFile,
    });
    const server = http.createServer((req, res) => {
        void handler(req, res).catch(error => res.destroy(error));
    });
    activeServers.push(server);
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing OBS test port.');
    port = address.port;
    return { baseUrl: `http://127.0.0.1:${port}`, port, clients, matchesToken, broadcastStatus, serveStaticFile };
};

describe('OBS browser source HTTP boundary', () => {
    it.each([
        { enabled: true, token: 'private-obs-token' },
        { enabled: false, token: 'retained-disabled-token' },
        { enabled: true, token: null },
    ])('only publishes health fields with enabled=$enabled and token=$token', async options => {
        const api = await startServer(options);
        const response = await fetch(`${api.baseUrl}/obs/health`, {
            headers: { Origin: 'https://untrusted.example' },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(await response.json()).toEqual({ enabled: options.enabled, port: api.port, clientCount: 0 });
        expect(api.matchesToken).not.toHaveBeenCalled();
        expect(api.serveStaticFile).not.toHaveBeenCalled();
    });

    it('does not reflect credential-shaped query parameters in public health', async () => {
        const api = await startServer();
        const response = await fetch(`${api.baseUrl}/obs/health?token=private-obs-token&url=secret&includeToken=true`);
        expect(await response.json()).toEqual({ enabled: true, port: api.port, clientCount: 0 });
    });

    it.each(['/obs', '/obs/events'])('rejects missing and incorrect tokens on %s', async pathname => {
        const api = await startServer();
        for (const query of ['', '?token=wrong', '?token=', '?token=wrong&token=private-obs-token']) {
            const response = await fetch(`${api.baseUrl}${pathname}${query}`);
            expect(response.status).toBe(401);
            expect(await response.json()).toEqual({ error: 'Unauthorized.' });
        }
        expect(api.clients.size).toBe(0);
        expect(api.serveStaticFile).not.toHaveBeenCalled();
    });

    it('health cannot supply a credential that unlocks the event stream', async () => {
        const api = await startServer();
        const health = await fetch(`${api.baseUrl}/obs/health`).then(response => response.json());
        const response = await fetch(`${api.baseUrl}/obs/events?token=${encodeURIComponent(String(health.token ?? ''))}`);
        expect(response.status).toBe(401);
        await response.body?.cancel();
    });

    it('serves the packaged source page with a valid token', async () => {
        const api = await startServer();
        const response = await fetch(`${api.baseUrl}/obs?obs=1&token=private-obs-token`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('OBS source');
        expect(api.serveStaticFile).toHaveBeenCalledOnce();
    });

    it('preserves the authenticated development redirect and encoded token', async () => {
        const token = 'private /+& token';
        const api = await startServer({ dev: true, token });
        const response = await fetch(`${api.baseUrl}/obs?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
        expect(response.status).toBe(302);
        const target = new URL(response.headers.get('location')!);
        expect(target.origin).toBe('http://localhost:3000');
        expect(target.searchParams.get('token')).toBe(token);
        expect(target.searchParams.get('obs')).toBe('1');
        expect(target.searchParams.get('obsPort')).toBe(String(api.port));
        expect(api.serveStaticFile).not.toHaveBeenCalled();
        await response.body?.cancel();
    });

    it('streams to an authenticated client and reports its connection without exposing credentials', async () => {
        const api = await startServer();
        const response = await fetch(`${api.baseUrl}/obs/events?token=private-obs-token`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
        const reader = response.body!.getReader();
        try {
            const { value } = await reader.read();
            expect(new TextDecoder().decode(value)).toContain('event: config');
            const health = await fetch(`${api.baseUrl}/obs/health`).then(result => result.json());
            expect(health).toEqual({ enabled: true, port: api.port, clientCount: 1 });
            expect(api.broadcastStatus).toHaveBeenCalledOnce();
        } finally {
            await reader.cancel();
        }
        await vi.waitFor(() => expect(api.clients.size).toBe(0));
        expect(api.broadcastStatus).toHaveBeenCalledTimes(2);
    });

    it('keeps protected routes unavailable when the source is disabled', async () => {
        const api = await startServer({ enabled: false });
        for (const pathname of ['/obs', '/obs/events']) {
            const response = await fetch(`${api.baseUrl}${pathname}?token=private-obs-token`);
            expect(response.status).toBe(503);
            expect(await response.json()).toEqual({ error: 'OBS browser source is disabled.' });
        }
        expect(api.serveStaticFile).not.toHaveBeenCalled();
    });
});
