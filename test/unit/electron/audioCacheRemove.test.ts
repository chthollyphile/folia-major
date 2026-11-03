import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// test/unit/electron/audioCacheRemove.test.ts
// Playback reads a song's cached file, finds it is a clip, and asks for it to go. The end-of-song
// writer may have put the song's whole file there in the meantime: only a file of the size that was
// read is deleted.

const require = createRequire(import.meta.url);
const { removeAudioCacheFileOfSize } = require('../../../electron/audioCacheRemove.cjs');

describe('removeAudioCacheFileOfSize', () => {
    let directory: string;
    let dataPath: string;
    let metaPath: string;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), 'folia-audio-cache-'));
        dataPath = path.join(directory, 'song.bin');
        metaPath = path.join(directory, 'song.json');
        await writeFile(dataPath, Buffer.alloc(5));
        await writeFile(metaPath, '{}');
    });
    afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

    it('deletes the file and its metadata while it is the size that was read', async () => {
        await expect(removeAudioCacheFileOfSize(dataPath, metaPath, 5)).resolves.toBe(true);
        expect(await readdir(directory)).toEqual([]);
    });

    it('leaves a file of another size: one written since the read', async () => {
        await expect(removeAudioCacheFileOfSize(dataPath, metaPath, 4)).resolves.toBe(false);
        expect((await readdir(directory)).sort()).toEqual(['song.bin', 'song.json']);
    });

    it('answers false where there is no file', async () => {
        await rm(dataPath);
        await expect(removeAudioCacheFileOfSize(dataPath, metaPath, 5)).resolves.toBe(false);
    });

    // On Windows a file held open answers EBUSY or EPERM; here the data path cannot be removed
    // because it is a folder with something in it. The copy stays, so must its metadata, and the
    // caller hears of it rather than of a deletion.
    it('rejects where the file cannot be deleted, and leaves its metadata', async () => {
        await rm(dataPath);
        await mkdir(dataPath);
        await writeFile(path.join(dataPath, 'held'), 'x');
        const { size } = await stat(dataPath);

        await expect(removeAudioCacheFileOfSize(dataPath, metaPath, size)).rejects.toThrow();
        expect((await readdir(directory)).sort()).toEqual(['song.bin', 'song.json']);
    });
});
