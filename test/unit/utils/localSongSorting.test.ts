import { describe, expect, it } from 'vitest';
import type { LocalSong } from '@/types';
import { sortLocalAlbumSongs, sortLocalFolderSongs } from '@/utils/localSongSorting';

// Verifies local folder and album ordering without coupling tests to React views.
const createSong = (fileName: string, patch: Partial<LocalSong> = {}): LocalSong => ({
    id: fileName,
    fileName,
    filePath: `Music/${fileName}`,
    title: fileName.replace(/\.[^.]+$/, ''),
    titleOrigin: 'import',
    importedMetadata: { title: fileName.replace(/\.[^.]+$/, ''), titleSource: 'filename', artistNames: [] },
    duration: 0,
    fileSize: 0,
    mimeType: 'audio/mpeg',
    addedAt: 0,
    ...patch,
});

describe('localSongSorting', () => {
    it('sorts folder songs by file name using natural numeric order', () => {
        const songs = [
            createSong('Track 10.mp3'),
            createSong('Track 2.mp3'),
            createSong('Track 1.mp3'),
        ];

        expect(sortLocalFolderSongs(songs).map(song => song.fileName)).toEqual([
            'Track 1.mp3',
            'Track 2.mp3',
            'Track 10.mp3',
        ]);
        expect(songs[0].fileName).toBe('Track 10.mp3');
    });

    it('sorts album songs by disc and track number before title', () => {
        const songs = [
            createSong('z.mp3', { title: 'Finale', discNumber: 2, trackNumber: 1 }),
            createSong('b.mp3', { title: 'Second', discNumber: 1, trackNumber: 2 }),
            createSong('a.mp3', { title: 'First', discNumber: 1, trackNumber: 1 }),
        ];

        expect(sortLocalAlbumSongs(songs).map(song => song.title)).toEqual([
            'First',
            'Second',
            'Finale',
        ]);
    });

    it('places numbered tracks first and naturally sorts unnumbered tracks by title', () => {
        const songs = [
            createSong('bonus-10.mp3', { title: 'Bonus 10' }),
            createSong('main.mp3', { title: 'Main', trackNumber: 1 }),
            createSong('bonus-2.mp3', { title: 'Bonus 2' }),
        ];

        expect(sortLocalAlbumSongs(songs).map(song => song.title)).toEqual([
            'Main',
            'Bonus 2',
            'Bonus 10',
        ]);
    });
});
