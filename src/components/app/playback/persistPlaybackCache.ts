import { saveToCache } from '../../../services/db';
import type { SongResult } from '../../../types';
import { isStagePlaybackSong } from '../../../utils/appPlaybackGuards';

// src/components/app/playback/persistPlaybackCache.ts

// Persists the last playable main-context song and queue while excluding Stage snapshots.
export const persistPlaybackCache = async (song: SongResult | null, queue: SongResult[]) => {
    if (!song || isStagePlaybackSong(song)) {
        return;
    }

    const sanitizedQueue = queue.filter(queuedSong => !isStagePlaybackSong(queuedSong));
    await Promise.all([
        saveToCache('last_song', song),
        saveToCache('last_queue', sanitizedQueue),
    ]);
};
