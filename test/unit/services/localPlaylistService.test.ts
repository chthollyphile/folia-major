import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalPlaylists } from '@/services/localPlaylistService';
import { getFromCache, getLocalSongs, saveToCache } from '@/services/db';
import type { LocalPlaylist, LocalSong } from '@/types';

// test/unit/services/localPlaylistService.test.ts
// Covers local playlist cache repair for repeated folder imports.

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(),
    getLocalSongs: vi.fn(),
    saveToCache: vi.fn(),
}));

const createSong = (patch: Partial<LocalSong> & Pick<LocalSong, 'id' | 'filePath' | 'folderName'>): LocalSong => {
    const { id, filePath, folderName, ...songPatch } = patch;
    return {
        id,
        fileName: songPatch.fileName || filePath.split('/').pop() || 'song.mp3',
        filePath,
        title: songPatch.title || (songPatch.fileName || filePath.split('/').pop() || 'song.mp3').replace(/\.[^.]+$/, ''),
        titleOrigin: songPatch.titleOrigin || 'import',
        importedMetadata: songPatch.importedMetadata || {
            title: songPatch.title || (songPatch.fileName || filePath.split('/').pop() || 'song.mp3').replace(/\.[^.]+$/, ''),
            titleSource: 'filename',
            artistNames: [],
        },
        duration: songPatch.duration ?? 0,
        fileSize: songPatch.fileSize ?? 1234,
        fileLastModified: songPatch.fileLastModified ?? 1000,
        mimeType: songPatch.mimeType || 'audio/mpeg',
        addedAt: songPatch.addedAt ?? 100,
        folderName,
        ...songPatch,
    };
};

describe('localPlaylistService', () => {
    beforeEach(() => {
        vi.mocked(getFromCache).mockReset();
        vi.mocked(getLocalSongs).mockReset();
        vi.mocked(saveToCache).mockReset();
    });

    it('keeps same child folder and file names from different roots distinct', async () => {
        const alphaSong = createSong({
            id: 'alpha',
            filePath: 'RootA/Disc 1/Track 01.mp3',
            folderName: 'RootA/Disc 1',
        });
        const betaSong = createSong({
            id: 'beta',
            filePath: 'RootB/Disc 1/Track 01.mp3',
            folderName: 'RootB/Disc 1',
        });
        const playlists: LocalPlaylist[] = [{
            id: 'playlist',
            name: 'Both roots',
            songIds: ['alpha', 'beta'],
            createdAt: 1,
            updatedAt: 1,
        }];

        vi.mocked(getFromCache).mockResolvedValue(playlists);
        vi.mocked(getLocalSongs).mockResolvedValue([alphaSong, betaSong]);

        const result = await getLocalPlaylists();

        expect(result.find(playlist => playlist.id === 'playlist')?.songIds).toEqual(['alpha', 'beta']);
        expect(saveToCache).toHaveBeenCalledWith('local_playlists', expect.arrayContaining([
            expect.objectContaining({ isFavorite: true }),
            expect.objectContaining({ id: 'playlist', songIds: ['alpha', 'beta'] }),
        ]));
    });

    it('repairs repeated imports from the same root family to the canonical song id', async () => {
        const originalSong = createSong({
            id: 'original',
            filePath: 'Library/Disc 1/Track 01.mp3',
            folderName: 'Library/Disc 1',
            addedAt: 100,
        });
        const duplicatedSong = createSong({
            id: 'duplicate',
            filePath: 'Library (2)/Disc 1/Track 01.mp3',
            folderName: 'Library (2)/Disc 1',
            addedAt: 200,
        });
        const playlists: LocalPlaylist[] = [{
            id: 'playlist',
            name: 'Repeated imports',
            songIds: ['duplicate', 'original', 'duplicate'],
            createdAt: 1,
            updatedAt: 1,
        }];

        vi.mocked(getFromCache).mockResolvedValue(playlists);
        vi.mocked(getLocalSongs).mockResolvedValue([originalSong, duplicatedSong]);

        const result = await getLocalPlaylists();

        expect(result.find(playlist => playlist.id === 'playlist')?.songIds).toEqual(['original']);
        expect(saveToCache).toHaveBeenCalledWith('local_playlists', expect.arrayContaining([
            expect.objectContaining({ id: 'playlist', songIds: ['original'] }),
        ]));
    });
});
