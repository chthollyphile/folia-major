import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// 封面代理只发真正的图片；播放器给的 URL 可能是 file://（KDE Connect）或 http(s)（浏览器）。

const require = createRequire(import.meta.url);
const { createArtworkStore, normalizeContentType, sniffImageType } = require('../../../electron/dux/artwork.cjs') as {
    createArtworkStore: (options?: { log?: unknown }) => {
        register: (artUrl: string, trackKey: string) => string | null;
        get: (token: string) => Promise<{ bytes: Buffer; contentType: string } | null>;
    };
    normalizeContentType: (value: unknown) => string | null;
    sniffImageType: (bytes: Buffer) => string | null;
};

let dir: string;
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('image sniffing', () => {
    it('recognizes common formats and rejects text', () => {
        expect(sniffImageType(PNG)).toBe('image/png');
        expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0]))).toBe('image/jpeg');
        expect(sniffImageType(Buffer.from('not an image'))).toBeNull();
        expect(normalizeContentType('Image/PNG; charset=binary')).toBe('image/png');
        expect(normalizeContentType('text/html')).toBeNull();
    });
});

describe('createArtworkStore', () => {
    it('reads a local file and returns the sniffed type', async () => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'folia-art-'));
        const file = path.join(dir, 'cover.png');
        writeFileSync(file, PNG);
        const store = createArtworkStore({ log: { info: () => {} } });
        const token = store.register(pathToFileURL(file).href, 'track-1');
        expect(token).toMatch(/^[0-9a-f]{32}$/);
        const artwork = await store.get(token!);
        expect(artwork?.contentType).toBe('image/png');
        expect(artwork?.bytes).toEqual(PNG);
    });

    it('refuses a file that is not an image and an unknown token', async () => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'folia-art-'));
        const file = path.join(dir, 'lyrics.txt');
        writeFileSync(file, 'plain text');
        const store = createArtworkStore({ log: { info: () => {} } });
        const token = store.register(pathToFileURL(file).href, 'track-1');
        await expect(store.get(token!)).resolves.toBeNull();
        await expect(store.get('b'.repeat(32))).resolves.toBeNull();
    });
});
