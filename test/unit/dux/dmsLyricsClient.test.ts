import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Dux 的 lyrics.get 走的是用户会话里的 Unix socket：先一行 capabilities，再一行 JSON 请求，回一行 JSON。
// 这里用假 socket 钉住请求形状和回复读取，避免把 Dux 的内部实现细节带进 Folia。

const require = createRequire(import.meta.url);
const { createDmsLyricsClient, discoverSockets, requestLyrics } = require('../../../electron/dux/dmsLyricsClient.cjs') as {
    createDmsLyricsClient: (options: { runtimeDir: string; timeoutMs?: number; log?: unknown }) => {
        lookup: (track: { title: string; artist: string; album?: string; durationSec?: number }, options?: { signal?: AbortSignal }) => Promise<unknown>;
    };
    discoverSockets: (runtimeDir: string) => string[];
    requestLyrics: (socketPath: string, request: unknown, options?: { timeoutMs?: number; log?: unknown }) => Promise<unknown>;
};

let dir: string;
let servers: net.Server[] = [];

afterEach(async () => {
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    servers = [];
    if (dir) rmSync(dir, { recursive: true, force: true });
});

const listen = async (socketPath: string, handler: (socket: net.Socket) => void) => {
    const server = net.createServer(handler);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    return server;
};

describe.skipIf(process.platform === 'win32')('Dux lyrics IPC', () => {
    it('sends one lyrics.get after the capabilities line and reads the result', async () => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'folia-dux-'));
        const socketPath = path.join(dir, 'dms-4242.sock');
        let request: Record<string, unknown> | null = null;
        await listen(socketPath, socket => {
            socket.write('{"apiVersion":38,"capabilities":["lyrics"]}\n');
            let buffer = '';
            socket.on('data', chunk => {
                buffer += chunk.toString();
                const newline = buffer.indexOf('\n');
                if (newline < 0) return;
                request = JSON.parse(buffer.slice(0, newline));
                socket.write(`${JSON.stringify({ id: (request as { id: number }).id, result: { found: true, synced: [] } })}\n`);
                socket.end();
            });
        });

        const client = createDmsLyricsClient({ runtimeDir: dir, timeoutMs: 2000, log: { warn: () => {}, info: () => {} } });
        const result = await client.lookup({ title: 'spiral', artist: 'LONGMAN', album: 'spiral - Single', durationSec: 231 });
        expect(result).toEqual({ found: true, synced: [] });
        expect(request).toMatchObject({
            method: 'lyrics.get',
            params: {
                title: 'spiral',
                artist: 'LONGMAN',
                album: 'spiral - Single',
                duration: 231,
                allowNetwork: true,
            },
        });
        expect(typeof (request as unknown as { id: unknown }).id).toBe('number');
    });

    it('discovers dms.sock and dms-<pid>.sock and prefers the plain name', async () => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'folia-dux-'));
        const plain = path.join(dir, 'dms.sock');
        const pid = path.join(dir, 'dms-999.sock');
        await listen(plain, () => {});
        await listen(pid, () => {});
        expect(discoverSockets(dir)[0]).toBe(plain);
    });

    it('settles when Dux closes after the greeting but before the reply', async () => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'folia-dux-'));
        await listen(path.join(dir, 'dms-1.sock'), socket => {
            socket.write('{"apiVersion":38,"capabilities":["lyrics"]}\n');
            socket.once('data', () => socket.destroy());
        });
        const client = createDmsLyricsClient({ runtimeDir: dir, timeoutMs: 5000, log: { warn: () => {}, info: () => {} } });
        await expect(client.lookup({ title: 'a', artist: 'b' })).resolves.toBeNull();
    });

    it('aborts an in-flight request without waiting for the timeout', async () => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'folia-dux-'));
        await listen(path.join(dir, 'dms-1.sock'), socket => {
            socket.write('{"apiVersion":38,"capabilities":["lyrics"]}\n');
            socket.on('data', () => {});
        });
        const client = createDmsLyricsClient({ runtimeDir: dir, timeoutMs: 5000, log: { warn: () => {}, info: () => {} } });
        const controller = new AbortController();
        const pending = client.lookup({ title: 'a', artist: 'b' }, { signal: controller.signal });
        setTimeout(() => controller.abort(), 50);
        await expect(pending).resolves.toBeNull();
    });

    it('returns null when Dux is not running', async () => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'folia-dux-'));
        const client = createDmsLyricsClient({ runtimeDir: dir, timeoutMs: 100, log: { warn: () => {}, info: () => {} } });
        await expect(client.lookup({ title: 'a', artist: 'b' })).resolves.toBeNull();
    });
});
