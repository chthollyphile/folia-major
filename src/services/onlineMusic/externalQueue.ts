import type { SongResult, StageLoopMode } from '../../types';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { nextQueueIndex, queueIndexOf } from '../../utils/playbackNeighbors';

// Select only contiguous, distinct successors belonging to the current external provider.
export function externalQueueSuccessors(song: SongResult, queue: SongResult[], mode: StageLoopMode, isFm: boolean, isPlayable: (song: SongResult) => boolean = () => true): SongResult[] {
    if (mode === 'one' || isFm || song.sourceRef?.kind !== 'online') return [];
    let index = queueIndexOf(queue, song);
    if (index < 0) return [];
    const seen = new Set([getPlaybackSongKey(song)]);
    const result: SongResult[] = [];
    for (let count = 0; count < queue.length && result.length < 2; count++) {
        index = nextQueueIndex(queue.length, index, mode);
        const next = queue[index];
        if (!next || next.sourceRef?.kind !== 'online' || next.sourceRef.providerId !== song.sourceRef.providerId
            || seen.has(getPlaybackSongKey(next))) break;
        if (!isPlayable(next)) continue;
        result.push(next);
        seen.add(getPlaybackSongKey(next));
    }
    return result;
}
