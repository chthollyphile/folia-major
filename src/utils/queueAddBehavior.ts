import type { QueueAddBehavior, SongResult } from '../types';
import { getPlaybackSongKey } from './appPlaybackGuards';
import { queueIndexOf } from './playbackNeighbors';

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

    const anchorIndex = queueIndexOf(queueWithoutTargets, currentSong);

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

/**
 * The queue to play `song` in, for "play it in the queue" (the scratchpad's rows, a search result's
 * play): a song already in the queue is played where it stands, nothing moves; any other is put
 * where the user's "add to queue" setting puts songs (after the current one, or at the end), as
 * every other add does, and played there. A queue of nothing but the current song is that song.
 */
export const queueForPlayingNow = ({
    queue,
    song,
    currentSong,
    behavior,
}: { queue: SongResult[]; song: SongResult; currentSong: SongResult | null; behavior: QueueAddBehavior }): SongResult[] => {
    if (queueIndexOf(queue, song) !== -1) return queue;
    const baseQueue = queue.length > 0 ? queue : (currentSong ? [currentSong] : []);
    const { nextQueue } = applyQueueAddBehavior({ queue: baseQueue, songs: [song], currentSong, behavior });
    return queueIndexOf(nextQueue, song) === -1 ? [...nextQueue, song] : nextQueue;
};
