import type { SongResult } from '../../../../types';
import type { CollectionResourceSnapshot } from '../../../core/shared/resource.contract';

// Keep the raw displayed/matched scope intact; the playback port filters and reports skipped rows.

export const resolveGridPlaybackScope = (
    displayTracks: SongResult[],
    matchIndexes: readonly number[] | null,
): SongResult[] => matchIndexes === null ? displayTracks : matchIndexes.map(index => displayTracks[index]);

// Read the resource at dispatch time: a held render or palette callback may predate refresh/account invalidation.
export const runGridPlaybackScope = (
    collectionType: string | undefined,
    getSnapshot: () => Pick<CollectionResourceSnapshot, 'librarySongs'> | null | undefined,
    tracks: SongResult[],
    playback: (tracks: SongResult[]) => void,
): void => {
    if (collectionType === 'library_songs' && getSnapshot()?.librarySongs?.complete !== true) return;
    playback(tracks);
};
