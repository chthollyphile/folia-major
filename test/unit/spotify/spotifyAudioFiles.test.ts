import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// test/unit/spotify/spotifyAudioFiles.test.ts — the store of Spotify's encrypted files on disk.
// What it holds is deleted by the media cache's pruning and by "clear cache", so what is checked
// here is which files those reach, and that a file is never left half written under its name.

const require = createRequire(import.meta.url);
const { createSpotifyAudioFiles } = require('../../../electron/spotify/audioFiles.cjs');

const NAME = '4cOdK2wGLETKBW3PvgPWqT-320';
const chunks = async function* (...parts: number[][]) { for (const part of parts) yield Uint8Array.from(part); };

describe('Spotify audio files on disk', () => {
    let directory: string;
    let files: ReturnType<typeof createSpotifyAudioFiles>;
    beforeEach(() => {
        directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'folia-spotify-files-')), 'spotify');
        files = createSpotifyAudioFiles({ directory: () => directory });
    });
    afterEach(() => fs.rmSync(path.dirname(directory), { recursive: true, force: true }));

    it('writes a file whole, and reads back its length, its first bytes and any range', async () => {
        expect(await files.size(NAME)).toBeNull();
        await files.write(NAME, 6, chunks([1, 2, 3], [4, 5, 6]));
        expect(await files.size(NAME)).toBe(6);
        expect([...await files.head(NAME, 4)]).toEqual([1, 2, 3, 4]);
        const { body } = files.read(NAME, 2, 4);
        expect([...new Uint8Array(await new Response(body).arrayBuffer())]).toEqual([3, 4, 5]);
    });

    it('leaves nothing under the name, and no part, when fewer or more bytes arrive than the file has', async () => {
        await expect(files.write(NAME, 6, chunks([1, 2, 3]))).rejects.toThrow('3 bytes were written of a file of 6');
        await expect(files.write(NAME, 2, chunks([1, 2, 3]))).rejects.toThrow('more bytes arrived than the 2 of the file');
        await expect(files.write(NAME, 6, (async function* () { yield Uint8Array.from([1]); throw new Error('the line broke'); })())).rejects.toThrow('the line broke');
        expect(fs.readdirSync(directory)).toEqual([]);
    });

    it('removes the parts an earlier run left, before the first write and before the first count, and not the files it finished', async () => {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, '1111111111111111111111-160.part'), 'half');
        fs.writeFileSync(path.join(directory, '2222222222222222222222-160.bin'), 'whole');
        fs.writeFileSync(path.join(directory, 'download.part'), 'a part that is not the store\'s');
        await files.write(NAME, 1, chunks([9]));
        expect(fs.readdirSync(directory).sort()).toEqual(['2222222222222222222222-160.bin', `${NAME}.bin`, 'download.part']);

        const counted = createSpotifyAudioFiles({ directory: () => directory });
        fs.writeFileSync(path.join(directory, '3333333333333333333333-320.part'), 'half');
        expect((await counted.list()).length).toBe(2);
        expect(fs.existsSync(path.join(directory, '3333333333333333333333-320.part'))).toBe(false);
    });

    // The folder is inside one the listener chose, and may hold files of theirs.
    it('lists, removes and clears the store\'s own whole files, and no other file in the folder', async () => {
        await files.write(NAME, 3, chunks([1, 2, 3]));
        await files.write('2222222222222222222222-160', 1, chunks([1]));
        fs.writeFileSync(path.join(directory, 'note.txt'), 'not a file of the store');
        fs.writeFileSync(path.join(directory, 'album.bin'), 'not a file of the store either');
        fs.mkdirSync(path.join(directory, '4444444444444444444444-320.bin'));
        const listed = await files.list();
        expect(listed.map((file: { name: string; size: number }) => [file.name, file.size]).sort()).toEqual([['2222222222222222222222-160', 1], [NAME, 3]]);
        expect(listed.every((file: { usedAt: number }) => file.usedAt > 0)).toBe(true);

        // A name that is not one of the store's reaches no file.
        await files.remove('note.txt');
        await files.remove('album');
        await files.remove(`../spotify/${NAME}`);
        await files.remove(NAME);
        expect(fs.readdirSync(directory).sort()).toEqual(['2222222222222222222222-160.bin', '4444444444444444444444-320.bin', 'album.bin', 'note.txt']);

        await files.clear();
        expect(fs.readdirSync(directory).sort()).toEqual(['4444444444444444444444-320.bin', 'album.bin', 'note.txt']);
        expect(await files.list()).toEqual([]);
    });

    it('removes the folder too when clearing leaves it empty', async () => {
        await files.write(NAME, 3, chunks([1, 2, 3]));
        await files.clear();
        expect(fs.existsSync(directory)).toBe(false);
        expect(await files.list()).toEqual([]);
    });

    it('counts a file that is read as used now', async () => {
        await files.write(NAME, 3, chunks([1, 2, 3]));
        const long = new Date(Date.now() - 86_400_000);
        fs.utimesSync(path.join(directory, `${NAME}.bin`), long, long);
        const { body } = files.read(NAME, 0, 2);
        await new Response(body).arrayBuffer();
        await expect.poll(async () => (await files.list())[0].usedAt).toBeGreaterThan(Date.now() - 60_000);
    });
});
