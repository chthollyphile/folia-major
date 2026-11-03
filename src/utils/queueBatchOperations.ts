import type { SongResult } from '../types';
import { queueIndexOf } from './playbackNeighbors';
import type { QueueBatchAction } from '../components/command-palette/queueQuery';

// src/utils/queueBatchOperations.ts
// Applies one atomic queue transformation while preserving duplicate occurrences and relative order.

type ApplyQueueBatchOperationParams = {
    queue: SongResult[];
    targetIndices: number[];
    currentSong: SongResult | null;
    action: QueueBatchAction;
};

// The entry that is the very object playing, else the first entry of the same song (queueIndexOf).
// With one song queued twice as two objects this answers the later entry when that object is the
// one playing; queueIndexOf alone answers the earlier one, as the track handlers do.
const findCurrentQueueIndex = (queue: SongResult[], currentSong: SongResult | null) => {
    if (!currentSong) return -1;
    const exactIndex = queue.findIndex(song => song === currentSong);
    if (exactIndex >= 0) return exactIndex;
    return queueIndexOf(queue, currentSong);
};

export const applyQueueBatchOperation = ({
    queue,
    targetIndices,
    currentSong,
    action,
}: ApplyQueueBatchOperationParams) => {
    const currentIndex = findCurrentQueueIndex(queue, currentSong);
    const requestedIndices = new Set(targetIndices.filter(index => index >= 0 && index < queue.length));
    const skippedCurrentCount = currentIndex >= 0 && requestedIndices.delete(currentIndex) ? 1 : 0;
    const selectedEntries = queue
        .map((song, index) => ({ song, index }))
        .filter(entry => requestedIndices.has(entry.index));

    if (selectedEntries.length === 0) {
        return {
            nextQueue: queue,
            affectedCount: 0,
            skippedCurrentCount,
            changed: false,
        };
    }

    const remainingQueue = queue.filter((_, index) => !requestedIndices.has(index));
    let nextQueue: SongResult[];
    if (action === 'remove') {
        nextQueue = remainingQueue;
    } else if (action === 'end') {
        nextQueue = [...remainingQueue, ...selectedEntries.map(entry => entry.song)];
    } else {
        const currentSongEntry = currentIndex >= 0 ? queue[currentIndex] : null;
        const anchorIndex = currentSongEntry ? remainingQueue.indexOf(currentSongEntry) : -1;
        const insertIndex = anchorIndex >= 0 ? anchorIndex + 1 : 0;
        nextQueue = [
            ...remainingQueue.slice(0, insertIndex),
            ...selectedEntries.map(entry => entry.song),
            ...remainingQueue.slice(insertIndex),
        ];
    }

    return {
        nextQueue,
        affectedCount: selectedEntries.length,
        skippedCurrentCount,
        changed: nextQueue.length !== queue.length || nextQueue.some((song, index) => song !== queue[index]),
    };
};
