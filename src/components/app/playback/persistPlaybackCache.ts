import { saveToCache } from '../../../services/db';
import type { SongResult, UnifiedSong } from '../../../types';
import { isStagePlaybackSong } from '../../../utils/appPlaybackGuards';

// src/components/app/playback/persistPlaybackCache.ts

const sanitizePlaybackSong = (song: SongResult): SongResult => {
    const unified = song as UnifiedSong & { localData?: { id?: string } };
    const localSongId = unified.localRef?.songId || unified.localData?.id;
    if (!localSongId) return song;
    const { localData: _legacyLocalData, ...snapshot } = unified;
    return { ...snapshot, isLocal: true, localRef: { songId: localSongId } } as UnifiedSong;
};

// Persists local playback as a lightweight songId reference while excluding Stage snapshots.
export const persistPlaybackCache = async (song: SongResult | null, queue: SongResult[]) => {
    if (!song || isStagePlaybackSong(song)) {
        return;
    }

    const sanitizedSong = sanitizePlaybackSong(song);
    const sanitizedQueue = queue
        .filter(queuedSong => !isStagePlaybackSong(queuedSong))
        .map(sanitizePlaybackSong);
    await Promise.all([
        saveToCache('last_song', sanitizedSong),
        saveToCache('last_queue', sanitizedQueue),
    ]);
};
