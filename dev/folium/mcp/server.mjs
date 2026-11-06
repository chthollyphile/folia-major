#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Transform } from 'node:stream';
import { createFoliaServer } from './service.mjs';
import { startHttpServer } from './http.mjs';

// Host-neutral launcher: tools are shared by independent stdio and HTTP transports.
try {
    const args = process.argv.slice(2);
    let close;
    if (args[0] === '--http') {
        if (args.length > 2) throw new Error('Usage: server.mjs [--http [port]]');
        const port = args[1] === undefined ? 43197 : Number(args[1]);
        const http = await startHttpServer({ port, token: process.env.FOLIUM_MCP_TOKEN });
        console.error(`[FoliumMCP] Listening on ${http.url}`);
        close = () => http.close();
    } else {
        if (args.length) throw new Error('Usage: server.mjs [--http [port]]');
        let bytes = 0;
        const input = new Transform({ transform(chunk, encoding, callback) {
            for (const byte of chunk) {
                if (byte === 10) bytes = 0;
                else if (++bytes > 2 * 1024 * 1024) { callback(new Error('MCP request exceeds 2 MiB')); return; }
            }
            callback(null, chunk);
        } });
        const server = createFoliaServer();
        input.on('error', error => { console.error('[FoliumMCP] Invalid or oversized input.', error); process.exit(1); });
        process.stdin.pipe(input);
        await server.connect(new StdioServerTransport(input, process.stdout));
        close = () => server.close();
        process.stdin.once('end', () => { void close(); });
    }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => {
        void close().finally(() => process.exit(0));
    });
} catch (error) {
    console.error('[FoliumMCP] Startup failed.', error);
    process.exitCode = 1;
}
