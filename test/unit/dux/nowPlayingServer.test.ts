import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

// now-playing 端点的协议面：WebSocket 握手、帧、初始快照、进度 JSON 与封面代理。
// 这些是 Folia 现有 Now Playing 源真正读取的东西，测试直接按它的读法来。

const require = createRequire(import.meta.url);
const {
    computeAccept,
    createNowPlayingServer,
    encodeTextFrame,
    parseFrames,
} = require('../../../electron/dux/nowPlayingServer.cjs') as {
    computeAccept: (key: string) => string;
    createNowPlayingServer: (options: Record<string, unknown>) => {
        start: () => Promise<{ port: number; host: string }>;
        stop: () => Promise<void>;
        broadcast: (event: string, data: unknown) => void;
        clientCount: () => number;
    };
    encodeControlFrame: (opcode: number, payload?: Buffer) => Buffer;
    encodeTextFrame: (text: string) => Buffer;
    parseFrames: (buffer: Buffer) => { frames: Array<{ opcode: number; payload: Buffer }>; rest: Buffer; tooLarge: boolean };
};

const waitFor = async (check: () => boolean, timeoutMs = 3000) => {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > timeoutMs) throw new Error('timed out');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

const servers: Array<{ stop: () => Promise<void> }> = [];
afterEach(async () => {
    while (servers.length > 0) await servers.pop()!.stop();
});

describe('WebSocket framing', () => {
    it('accepts the RFC example handshake key', () => {
        expect(computeAccept('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    });

    it('encodes short, medium and large text frames', () => {
        expect(encodeTextFrame('hi').subarray(0, 2)).toEqual(Buffer.from([0x81, 2]));
        const medium = encodeTextFrame('x'.repeat(200));
        expect(medium.subarray(0, 4)).toEqual(Buffer.from([0x81, 126, 0, 200]));
        const large = encodeTextFrame('x'.repeat(70000));
        expect(large[0]).toBe(0x81);
        expect(large[1]).toBe(127);
    });

    it('unmasks a client ping', () => {
        const mask = Buffer.from([1, 2, 3, 4]);
        const payload = Buffer.from('ping');
        const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
        const frame = Buffer.concat([Buffer.from([0x89, 0x80 | payload.length]), mask, masked]);
        const parsed = parseFrames(frame);
        expect(parsed.frames).toHaveLength(1);
        expect(parsed.frames[0].opcode).toBe(0x9);
        expect(parsed.frames[0].payload.toString()).toBe('ping');
    });
});

describe('createNowPlayingServer', () => {
    it('serves the snapshot, progress and artwork to a real client', async () => {
        const snapshot = {
            track: { id: 'a', title: 'spiral', artist: 'LONGMAN', album: 'spiral - Single', cover: null, duration: 231 },
            lyric: null,
            paused: false,
            positionSec: 12,
            progressMs: 12000,
        };
        const artwork = { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' };
        const server = createNowPlayingServer({
            port: 0,
            getSnapshot: () => snapshot,
            getProgressMs: () => 12345,
            getArtwork: async (token: string) => (token === 'a'.repeat(32) ? artwork : null),
            onClientCountChange: () => {},
            log: { info: () => {}, warn: () => {} },
        });
        servers.push(server);
        const { port } = await server.start();

        const progress = await fetch(`http://127.0.0.1:${port}/api/query/progress`).then(response => response.json());
        expect(progress).toEqual({ progress: 12345 });

        const art = await fetch(`http://127.0.0.1:${port}/art/${'a'.repeat(32)}`);
        expect(art.status).toBe(200);
        expect(art.headers.get('content-type')).toBe('image/png');
        expect(Buffer.from(await art.arrayBuffer())).toEqual(artwork.bytes);

        const events: Array<{ event: string; data: unknown }> = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws/lyric`);
        ws.onmessage = event => events.push(JSON.parse(String(event.data)));
        await waitFor(() => events.length >= 4);
        expect(events[0]).toMatchObject({ event: 'Track', data: { title: 'spiral' } });
        expect(events[2]).toMatchObject({ event: 'PlayerPauseState', data: { hasSong: true, isPaused: false } });
        ws.close();
    });

    it('broadcasts a later lyric to connected clients', async () => {
        let snapshot: Record<string, unknown> | null = null;
        const server = createNowPlayingServer({
            port: 0,
            getSnapshot: () => snapshot,
            getProgressMs: () => 0,
            getArtwork: async () => null,
            log: { info: () => {}, warn: () => {} },
        });
        servers.push(server);
        const { port } = await server.start();
        const events: Array<{ event: string; data: unknown }> = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws/lyric`);
        ws.onmessage = event => events.push(JSON.parse(String(event.data)));
        await waitFor(() => server.clientCount() === 1);
        server.broadcast('Lyric', { source: 'dux', lrc: '[00:01.00]hi' });
        await waitFor(() => events.some(event => event.event === 'Lyric'));
        expect(events.find(event => event.event === 'Lyric')?.data).toMatchObject({ source: 'dux' });
        ws.close();
    });
});
