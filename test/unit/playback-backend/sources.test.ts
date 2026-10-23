import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The renderer may release only copies minted by its host, never an arbitrary local path.
const require = createRequire(import.meta.url);
const { createPlaybackSourceStore } = require('../../../electron/playbackBackends/sources.cjs');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('staged playback sources', () => {
    it('keeps original bytes, refuses path deletion and releases idempotently', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'folia-playback-'));
        roots.push(root);
        const store = createPlaybackSourceStore(root);
        const source = await store.stage(new Uint8Array([1, 2, 255]).buffer);
        expect(await readFile(source.filePath)).toEqual(Buffer.from([1, 2, 255]));
        await store.release(source.filePath);
        await store.release('../outside');
        expect((await stat(source.filePath)).isFile()).toBe(true);
        await store.release(source.id);
        await store.release(source.id);
        await expect(stat(source.filePath)).rejects.toThrow();
    });
    it('rejects non-binary/empty sources and cleans all owned files', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'folia-playback-'));
        roots.push(root);
        const store = createPlaybackSourceStore(root);
        await expect(store.stage('path')).rejects.toThrow('size');
        await expect(store.stage(new ArrayBuffer(0))).rejects.toThrow('size');
        const one = await store.stage(new ArrayBuffer(4));
        const two = await store.stage(new ArrayBuffer(4));
        await store.dispose();
        await expect(stat(one.filePath)).rejects.toThrow();
        await expect(stat(two.filePath)).rejects.toThrow();
    });
});
