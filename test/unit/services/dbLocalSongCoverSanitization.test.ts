import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import { getLocalSongs, saveLocalSongs } from '../../../src/services/db';
import type { LocalSong } from '../../../src/types';

// test/unit/services/dbLocalSongCoverSanitization.test.ts
// Verifies real Dexie persistence never keeps non-Blob local cover payloads.

const buildLocalSong = (patch: Partial<LocalSong> & Pick<LocalSong, 'id'>): LocalSong => {
    const { id, ...songPatch } = patch;
    return {
        id,
        fileName: `${id}.mp3`,
        filePath: `/music/${id}.mp3`,
        title: id,
        titleOrigin: 'import',
        importedMetadata: { title: id, titleSource: 'filename', artistNames: [] },
        duration: 180000,
        fileSize: 1024,
        mimeType: 'audio/mpeg',
        addedAt: 1,
        ...songPatch,
    };
};

describe('db local song cover sanitization', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
    });

    afterEach(async () => {
        await appDatabase.delete();
    });

    it('does not persist non-Blob embedded covers', async () => {
        await saveLocalSongs([
            buildLocalSong({
                id: 'bad-cover-song',
                embeddedCover: { size: 20, type: 'image/png' } as unknown as Blob,
            }),
        ]);

        expect((await appDatabase.local_music.get('bad-cover-song'))?.embeddedCover).toBeUndefined();
    });

    it('sanitizes non-Blob embedded covers when reading local songs and writes them back', async () => {
        await appDatabase.local_music.put(buildLocalSong({
            id: 'bad-cover-song',
            embeddedCover: { size: 20, type: 'image/png' } as unknown as Blob,
        }));

        const songs = await getLocalSongs();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(songs[0]?.embeddedCover).toBeUndefined();
        expect((await appDatabase.local_music.get('bad-cover-song'))?.embeddedCover).toBeUndefined();
    });
});
