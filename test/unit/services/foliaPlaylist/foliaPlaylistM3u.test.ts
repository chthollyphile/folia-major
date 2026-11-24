import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong } from '@/types';
import type { FoliaPlaylist, FoliaPlaylistSummary } from '@/types/foliaPlaylist';
import { createFoliaPlaylistFromLocalSongs } from '@/services/foliaPlaylist/foliaPlaylistService';
import {
    importLocalPlaylistFile,
    matchM3uPathsToLocalSongs,
    normalizeM3uPath,
    parseM3uPlaylist,
    serializeFoliaPlaylistToM3u8,
} from '@/services/foliaPlaylist/foliaPlaylistM3u';

// test/unit/services/foliaPlaylist/foliaPlaylistM3u.test.ts
// Covers portable M3U parsing, path matching, import reporting, and relative-path export.

vi.mock('@/services/foliaPlaylist/foliaPlaylistService', () => ({
    createFoliaPlaylistFromLocalSongs: vi.fn(),
}));

const localEntries = (songIds: string[]): FoliaPlaylist['entries'] => songIds.map(id => ({
    key: `local:${id}`,
    song: { id, name: id, artists: [], album: { id: 0, name: '' }, durationMs: 0 },
    addedAt: 1,
}));

const createSong = (id: string, filePath: string, patch: Partial<LocalSong> = {}): LocalSong => ({
    id,
    fileName: filePath.split('/').pop() || 'song.mp3',
    filePath,
    duration: 215000,
    fileSize: 100,
    mimeType: 'audio/mpeg',
    addedAt: 1,
    title: patch.title || id,
    titleOrigin: 'import',
    importedMetadata: {
        title: patch.title || id,
        titleSource: 'filename',
        artistNames: ['Artist'],
    },
    folderName: filePath.split('/').slice(0, -1).join('/'),
    ...patch,
});

describe('foliaPlaylistM3u', () => {
    beforeEach(() => {
        vi.mocked(createFoliaPlaylistFromLocalSongs).mockReset();
    });

    it('parses playlist metadata while keeping only media paths', () => {
        expect(parseM3uPlaylist('\uFEFF#EXTM3U\r\n#PLAYLIST:精选\r\n#EXTINF:1,A - B\r\nAlbum\\Song.mp3\r\n')).toEqual({
            name: '精选',
            paths: ['Album\\Song.mp3'],
        });
    });

    it('normalizes Windows and file URL paths', () => {
        expect(normalizeM3uPath('D:\\Music\\Album\\Song.mp3')).toBe('Music/Album/Song.mp3');
        expect(normalizeM3uPath('file:///D:/Music/Album/Song%201.mp3')).toBe('Music/Album/Song 1.mp3');
        expect(normalizeM3uPath('https://example.com/song.mp3')).toBeNull();
    });

    it('matches root-relative and absolute suffix paths without guessing ambiguous tracks', () => {
        const songs = [
            createSong('one', 'Library/Album/Song.mp3'),
            createSong('two', 'Other/Album/Song.mp3'),
            createSong('three', 'Library/Album/Unique.mp3'),
        ];
        const result = matchM3uPathsToLocalSongs([
            'Library/Album/Song.mp3',
            'D:\\Music\\Library\\Album\\Unique.mp3',
            'Album/Song.mp3',
            'Missing.mp3',
        ], songs);

        expect(result.matchedSongIds).toEqual(['one', 'three']);
        expect(result.ambiguousPaths).toEqual(['Album/Song.mp3']);
        expect(result.unmatchedPaths).toEqual(['Missing.mp3']);
    });

    it('matches a filename-only entry only when it has one candidate', () => {
        const result = matchM3uPathsToLocalSongs([
            'Unique.mp3',
            'Song.mp3',
        ], [
            createSong('one', 'Library/Album/Song.mp3'),
            createSong('two', 'Other/Album/Song.mp3'),
            createSong('three', 'Library/Album/Unique.mp3'),
        ]);

        expect(result.matchedSongIds).toEqual(['three']);
        expect(result.ambiguousPaths).toEqual(['Song.mp3']);
    });

    it('imports matched tracks in playlist order and reports skipped paths', async () => {
        const songs = [
            createSong('one', 'Library/A.mp3'),
            createSong('two', 'Library/B.mp3'),
        ];
        const created: FoliaPlaylistSummary = {
            id: 'playlist',
            name: 'Road Trip',
            entryCount: 2,
            createdAt: 1,
            updatedAt: 1,
        };
        vi.mocked(createFoliaPlaylistFromLocalSongs).mockResolvedValue(created);

        const result = await importLocalPlaylistFile(
            new File(['#EXTM3U\n#PLAYLIST:Road Trip\nB.mp3\nMissing.mp3\nA.mp3\n'], 'fallback.m3u8'),
            songs,
        );

        expect(createFoliaPlaylistFromLocalSongs).toHaveBeenCalledWith('Road Trip', [songs[1], songs[0]]);
        expect(result.playlist).toBe(created);
        expect(result.unmatchedPaths).toEqual(['Missing.mp3']);
    });

    it('exports paths relative to a shared imported root', () => {
        const songs = [
            createSong('one', 'Library/Album/01.mp3', { title: 'First' }),
            createSong('two', 'Library/Album/02.mp3', { title: 'Second' }),
        ];
        const playlist: FoliaPlaylist = {
            id: 'playlist',
            name: '精选',
            entries: localEntries(['two', 'one']),
            createdAt: 1,
            updatedAt: 1,
        };

        const { content: output } = serializeFoliaPlaylistToM3u8(playlist, songs);

        expect(output).toContain('#PLAYLIST:精选\r\n');
        expect(output).toContain('#EXTINF:215,Artist - Second\r\nAlbum/02.mp3\r\n');
        expect(output.indexOf('Album/02.mp3')).toBeLessThan(output.indexOf('Album/01.mp3'));
        expect(output).not.toContain('Library/Album');
    });

    it('keeps imported root names when a playlist spans multiple roots', () => {
        const songs = [
            createSong('one', 'LibraryA/Album/01.mp3'),
            createSong('two', 'LibraryB/Album/02.mp3'),
        ];
        const playlist: FoliaPlaylist = {
            id: 'playlist',
            name: 'Mixed roots',
            entries: localEntries(['one', 'two']),
            createdAt: 1,
            updatedAt: 1,
        };

        const { content: output } = serializeFoliaPlaylistToM3u8(playlist, songs);

        expect(output).toContain('LibraryA/Album/01.mp3');
        expect(output).toContain('LibraryB/Album/02.mp3');
    });

    it('exports only the local songs and counts what it left out', () => {
        const songs = [createSong('one', 'Library/Album/01.mp3')];
        const playlist: FoliaPlaylist = {
            id: 'playlist',
            name: 'Mixed sources',
            entries: [
                ...localEntries(['one']),
                { key: 'online:netease:42', song: { id: 42, name: 'Online', artists: [], album: { id: 0, name: '' }, durationMs: 0 }, addedAt: 1 },
                ...localEntries(['gone']),
            ],
            createdAt: 1,
            updatedAt: 1,
        };

        const exported = serializeFoliaPlaylistToM3u8(playlist, songs);

        expect(exported.exportedCount).toBe(1);
        expect(exported.skippedCount).toBe(2);
        expect(exported.content).toContain('Album/01.mp3');
        expect(exported.content).not.toContain('Online');
    });
});
