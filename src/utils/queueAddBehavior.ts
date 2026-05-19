import type { QueueAddBehavior } from '../types';

// src/utils/queueAddBehavior.ts

type QueueEntry = {
    id: number;
};

type ApplyQueueAddBehaviorParams<T extends QueueEntry> = {
    queue: T[];
    songs: T[];
    currentSong: T | null;
    behavior: QueueAddBehavior;
};

// Applies the user's preferred insertion strategy while deduplicating against the current queue.
export const applyQueueAddBehavior = <T extends QueueEntry>({
    queue,
    songs,
    currentSong,
    behavior,
}: ApplyQueueAddBehaviorParams<T>) => {
    const knownIds = new Set(queue.map(song => song.id));
    const addedSongs: T[] = [];

    for (const song of songs) {
        if (knownIds.has(song.id)) {
            continue;
        }

        knownIds.add(song.id);
        addedSongs.push(song);
    }

    if (addedSongs.length === 0) {
        return {
            nextQueue: queue,
            addedSongs,
        };
    }

    if (behavior === 'append') {
        return {
            nextQueue: [...queue, ...addedSongs],
            addedSongs,
        };
    }

    const anchorIndex = currentSong
        ? queue.findIndex(song => song.id === currentSong.id)
        : -1;

    if (anchorIndex === -1) {
        return {
            nextQueue: [...addedSongs, ...queue],
            addedSongs,
        };
    }

    return {
        nextQueue: [
            ...queue.slice(0, anchorIndex + 1),
            ...addedSongs,
            ...queue.slice(anchorIndex + 1),
        ],
        addedSongs,
    };
};
