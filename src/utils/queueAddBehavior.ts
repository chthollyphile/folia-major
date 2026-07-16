import type { QueueAddBehavior, SongResult } from '../types';
import { getPlaybackSongKey } from './appPlaybackGuards';

// src/utils/queueAddBehavior.ts

type ApplyQueueAddBehaviorParams = {
    queue: SongResult[];
    songs: SongResult[];
    currentSong: SongResult | null;
    behavior: QueueAddBehavior;
};

// Applies the user's preferred insertion strategy and reorders songs that are already in the queue.
export const applyQueueAddBehavior = ({
    queue,
    songs,
    currentSong,
    behavior,
}: ApplyQueueAddBehaviorParams) => {
    const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    const seenTargetKeys = new Set<string>();
    const targetSongs: SongResult[] = [];

    for (const song of songs) {
        const songKey = getPlaybackSongKey(song);
        if (songKey === currentSongKey || seenTargetKeys.has(songKey)) {
            continue;
        }

        seenTargetKeys.add(songKey);
        targetSongs.push(song);
    }

    if (targetSongs.length === 0) {
        return {
            nextQueue: queue,
            affectedSongs: targetSongs,
            changed: false,
        };
    }

    const queueWithoutTargets = queue.filter(song => !seenTargetKeys.has(getPlaybackSongKey(song)));

    if (behavior === 'append') {
        const nextQueue = [...queueWithoutTargets, ...targetSongs];
        return {
            nextQueue,
            affectedSongs: targetSongs,
            changed: nextQueue.length !== queue.length || nextQueue.some((song, index) => (
                getPlaybackSongKey(song) !== (queue[index] ? getPlaybackSongKey(queue[index]) : null)
            )),
        };
    }

    const anchorIndex = currentSong
        ? queueWithoutTargets.findIndex(song => getPlaybackSongKey(song) === currentSongKey)
        : -1;

    if (anchorIndex === -1) {
        const nextQueue = [...targetSongs, ...queueWithoutTargets];
        return {
            nextQueue,
            affectedSongs: targetSongs,
            changed: nextQueue.length !== queue.length || nextQueue.some((song, index) => (
                getPlaybackSongKey(song) !== (queue[index] ? getPlaybackSongKey(queue[index]) : null)
            )),
        };
    }

    const nextQueue = [
        ...queueWithoutTargets.slice(0, anchorIndex + 1),
        ...targetSongs,
        ...queueWithoutTargets.slice(anchorIndex + 1),
    ];

    return {
        nextQueue,
        affectedSongs: targetSongs,
        changed: nextQueue.length !== queue.length || nextQueue.some((song, index) => (
            getPlaybackSongKey(song) !== (queue[index] ? getPlaybackSongKey(queue[index]) : null)
        )),
    };
};
