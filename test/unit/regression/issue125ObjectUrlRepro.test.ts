import { describe, expect, it } from 'vitest';
import { createLocalGridViewCollection, resolveLocalGridViewCoverSource } from '../../../src/components/app/home/gridViewCollectionAdapters';
import type { LocalLibraryGroup, LocalSong } from '../../../src/types';

// test/unit/regression/issue125ObjectUrlRepro.test.ts
// Captures the bad cover payload shape behind issue #125.

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

describe('issue #125 object URL repro', () => {
    it('shows the native failure when createObjectURL receives a plain object', () => {
        expect(() => URL.createObjectURL({ size: 20, type: 'image/png' } as unknown as Blob)).toThrow(TypeError);
    });

    it('simulates All Songs with a non-Blob embeddedCover payload', () => {
        const localSongs = [
            buildLocalSong({
                id: 'bad-cover-song',
                addedAt: 2,
                embeddedCover: { size: 20, type: 'image/png' } as unknown as Blob,
                useOnlineCover: true,
                onlineMetadata: {
                    source: 'qq',
                    title: 'bad-cover-song',
                    artists: [],
                    coverUrl: 'https://example.com/fallback.jpg',
                    matchMode: 'manual',
                    matchedAt: 1,
                },
            }),
            buildLocalSong({ id: 'plain-song', addedAt: 1 }),
        ];
        const allSongsGroup: LocalLibraryGroup = {
            id: 'folder-__all-songs__',
            name: 'All Songs',
            type: 'folder',
            songs: localSongs,
            trackCount: localSongs.length,
            isVirtual: true,
        };

        const descriptor = createLocalGridViewCollection(allSongsGroup);

        expect(resolveLocalGridViewCoverSource(descriptor, localSongs)).toBe('https://example.com/fallback.jpg');
    });
});
