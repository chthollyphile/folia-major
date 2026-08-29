import { describe, expect, it } from 'vitest';
import type { LocalSong } from '@/types';
import { formatLocalAlbumTrackLabel, sortLocalAlbumSongs, sortLocalFolderSongs } from '@/utils/localSongSorting';

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

    it('sorts folder songs by modified date in either direction', () => {
        const songs = [
            createSong('older.mp3', { fileLastModified: 100 }),
            createSong('newer.mp3', { fileLastModified: 300 }),
            createSong('middle.mp3', { fileLastModified: 200 }),
        ];

        expect(sortLocalFolderSongs(songs, 'fileLastModified').map(song => song.fileName)).toEqual([
            'older.mp3',
            'middle.mp3',
            'newer.mp3',
        ]);
        expect(sortLocalFolderSongs(songs, 'fileLastModified', 'desc').map(song => song.fileName)).toEqual([
            'newer.mp3',
            'middle.mp3',
            'older.mp3',
        ]);
    });

    it('sorts folder songs by album track number, discs first', () => {
        const songs = [
            createSong('c.mp3', { discNumber: 2, trackNumber: 1 }),
            createSong('b.mp3', { discNumber: 1, trackNumber: 10 }),
            createSong('a.mp3', { discNumber: 1, trackNumber: 2 }),
        ];

        expect(sortLocalFolderSongs(songs, 'albumTrack').map(song => song.fileName)).toEqual([
            'a.mp3',
            'b.mp3',
            'c.mp3',
        ]);
    });

    // 没有专辑号的统一放最后面，降序也一样：缺一个号码不是「号码很小」，它在这个序里根本没有位置。
    it('keeps unnumbered tracks last in both directions', () => {
        const songs = [
            createSong('no-number-b.mp3'),
            createSong('two.mp3', { trackNumber: 2 }),
            createSong('no-number-a.mp3'),
            createSong('one.mp3', { trackNumber: 1 }),
        ];

        expect(sortLocalFolderSongs(songs, 'albumTrack').map(song => song.fileName)).toEqual([
            'one.mp3',
            'two.mp3',
            'no-number-a.mp3',
            'no-number-b.mp3',
        ]);
        expect(sortLocalFolderSongs(songs, 'albumTrack', 'desc').map(song => song.fileName)).toEqual([
            'two.mp3',
            'one.mp3',
            'no-number-b.mp3',
            'no-number-a.mp3',
        ]);
    });

    // 号码相同（多张碟各自从 1 开始而 discNumber 缺失，或者标签本身重复）时按文件名兜底，
    // 保证排序稳定而不是看输入顺序。
    it('falls back to the file name when two tracks claim the same number', () => {
        const songs = [
            createSong('b.mp3', { trackNumber: 1 }),
            createSong('a.mp3', { trackNumber: 1 }),
        ];

        expect(sortLocalFolderSongs(songs, 'albumTrack').map(song => song.fileName)).toEqual([
            'a.mp3',
            'b.mp3',
        ]);
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

describe('formatLocalAlbumTrackLabel', () => {
    it('names the track number on its own for a single-disc album', () => {
        expect(formatLocalAlbumTrackLabel(createSong('a.mp3', { trackNumber: 7 }))).toBe('7');
        // discNumber 1 是绝大多数专辑的值，每行都挂个「1-」只是噪音
        expect(formatLocalAlbumTrackLabel(createSong('a.mp3', { trackNumber: 7, discNumber: 1 }))).toBe('7');
    });

    it('names the disc once there is more than one', () => {
        expect(formatLocalAlbumTrackLabel(createSong('a.mp3', { trackNumber: 3, discNumber: 2 }))).toBe('2-3');
    });

    it('is null when the file carries no number', () => {
        expect(formatLocalAlbumTrackLabel(createSong('a.mp3'))).toBeNull();
        // 只有碟号没有音轨号，说不出这首是第几首
        expect(formatLocalAlbumTrackLabel(createSong('a.mp3', { discNumber: 2 }))).toBeNull();
    });
});
