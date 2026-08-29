import type { LocalSong } from '../types';

// Shared ordering rules for local-library views and their playback queues.
export type LocalSongFolderSortField = 'fileName' | 'fileLastModified' | 'albumTrack';
export type LocalSongFolderSortDirection = 'asc' | 'desc';

const naturalCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

const compareText = (left: string, right: string): number => naturalCollator.compare(left, right);

const getSongName = (song: LocalSong): string => song.title?.trim() || song.fileName;

export const compareLocalSongsByFileName = (left: LocalSong, right: LocalSong): number =>
    compareText(left.fileName, right.fileName)
    || compareText(left.filePath, right.filePath);

const compareLocalSongsByLastModified = (left: LocalSong, right: LocalSong): number =>
    (left.fileLastModified ?? 0) - (right.fileLastModified ?? 0)
    || compareLocalSongsByFileName(left, right);

const compareTrackPosition = (left: LocalSong, right: LocalSong): number =>
    (left.discNumber ?? 1) - (right.discNumber ?? 1)
    || (left.trackNumber ?? 0) - (right.trackNumber ?? 0);

const compareLocalSongsByAlbumTrack = (
    left: LocalSong,
    right: LocalSong,
    direction: LocalSongFolderSortDirection,
): number => {
    const leftNumbered = typeof left.trackNumber === 'number';
    const rightNumbered = typeof right.trackNumber === 'number';
    if (leftNumbered !== rightNumbered) {
        return leftNumbered ? -1 : 1;
    }

    const result = leftNumbered
        ? compareTrackPosition(left, right) || compareLocalSongsByFileName(left, right)
        : compareLocalSongsByFileName(left, right);

    return direction === 'desc' ? -result : result;
};

export const compareLocalFolderSongs = (
    left: LocalSong,
    right: LocalSong,
    field: LocalSongFolderSortField = 'fileName',
    direction: LocalSongFolderSortDirection = 'asc',
): number => {
    if (field === 'albumTrack') {
        return compareLocalSongsByAlbumTrack(left, right, direction);
    }

    const result = field === 'fileLastModified'
        ? compareLocalSongsByLastModified(left, right)
        : compareLocalSongsByFileName(left, right);

    return direction === 'desc' ? -result : result;
};

export const compareLocalAlbumSongs = (left: LocalSong, right: LocalSong): number => {
    const leftHasTrackNumber = typeof left.trackNumber === 'number';
    const rightHasTrackNumber = typeof right.trackNumber === 'number';

    if (leftHasTrackNumber !== rightHasTrackNumber) {
        return leftHasTrackNumber ? -1 : 1;
    }

    if (leftHasTrackNumber && rightHasTrackNumber) {
        const positionDifference = compareTrackPosition(left, right);
        if (positionDifference !== 0) {
            return positionDifference;
        }
    }

    return compareText(getSongName(left), getSongName(right))
        || compareLocalSongsByFileName(left, right);
};

export const sortLocalFolderSongs = (
    songs: LocalSong[],
    field: LocalSongFolderSortField = 'fileName',
    direction: LocalSongFolderSortDirection = 'asc',
): LocalSong[] => [...songs].sort((left, right) => compareLocalFolderSongs(left, right, field, direction));

export const sortLocalAlbumSongs = (songs: LocalSong[]): LocalSong[] =>
    [...songs].sort(compareLocalAlbumSongs);

/**
 * The album number as the track list shows it, or null when the file carries none.
 *
 * The disc is only named when there is more than one, so an ordinary single-disc album reads as a
 * plain track number instead of "1-" on every row.
 */
export const formatLocalAlbumTrackLabel = (song: LocalSong): string | null => {
    if (typeof song.trackNumber !== 'number') return null;
    const disc = song.discNumber;
    return typeof disc === 'number' && disc > 1
        ? `${disc}-${song.trackNumber}`
        : String(song.trackNumber);
};
