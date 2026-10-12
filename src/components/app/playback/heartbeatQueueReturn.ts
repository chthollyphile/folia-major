import type { SongResult } from '../../../types';
import { useHeartbeatModeStore, type HeartbeatQueueSnapshot } from '../../../stores/useHeartbeatModeStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { getPlaybackSongKey, isSamePlaybackSong } from '../../../utils/appPlaybackGuards';
import { persistPlaybackCache } from './persistPlaybackCache';

// src/components/app/playback/heartbeatQueueReturn.ts
// Explicit exit restores the ordinary queue. Passive cancellation leaves its caller's queue alone.

const sameQueue = (left: SongResult[], right: SongResult[]) => left.length === right.length
    && left.every((song, index) => isSamePlaybackSong(song, right[index]));

/** Place the audible track immediately before the old cursor without adding a duplicate source ID. */
export function buildHeartbeatReturnQueue(snapshot: HeartbeatQueueSnapshot, current: SongResult | null): SongResult[] {
    if (!current || (snapshot.currentSong && isSamePlaybackSong(current, snapshot.currentSong))) return [...snapshot.queue];
    const queue = snapshot.queue.filter(song => !isSamePlaybackSong(song, current));
    const cursor = snapshot.currentSong ? queue.findIndex(song => isSamePlaybackSong(song, snapshot.currentSong!)) : -1;
    queue.splice(Math.max(0, cursor), 0, current);
    return queue;
}

export function exitHeartbeatMode(): void {
    const state = useHeartbeatModeStore.getState();
    if (!state.session && !state.loading) return;
    const snapshot = state.originalPlayback;
    state.stop(); // Invalidate recommendations and pending audio loads before writing the restored queue.
    if (!snapshot) return; // A start that has not committed any queue only needs cancellation.
    const { currentSong } = usePlaybackStore.getState();
    const queue = buildHeartbeatReturnQueue(snapshot, currentSong);
    const alreadyAtCursor = currentSong && snapshot.currentSong && isSamePlaybackSong(currentSong, snapshot.currentSong);
    useHeartbeatModeStore.setState({ pendingReturn: currentSong && !alreadyAtCursor ? {
        songKey: getPlaybackSongKey(currentSong), queue, originalQueue: snapshot.queue, originalCurrentSong: snapshot.currentSong,
    } : null });
    usePlaybackStore.getState().setPlayQueue(queue);
    void persistPlaybackCache(currentSong, queue).catch(() => undefined);
}

/** The next ordinary play drops the temporary row and restores the exact original ordering. */
export function prepareHeartbeatReturnQueue(song: SongResult, queue: SongResult[]): SongResult[] {
    const pending = useHeartbeatModeStore.getState().pendingReturn;
    if (!pending || getPlaybackSongKey(song) === pending.songKey) return queue;
    return sameQueue(queue, pending.queue) && pending.originalQueue.some(item => isSamePlaybackSong(item, song))
        ? [...pending.originalQueue] : queue;
}

/** No ordinary queue existed: let the departing song end once, then leave an empty stopped queue. */
export function finishEmptyHeartbeatReturn(): void {
    const pending = useHeartbeatModeStore.getState().pendingReturn;
    if (!pending || pending.originalQueue.length > 0) return;
    const playback = usePlaybackStore.getState();
    if (!playback.currentSong || getPlaybackSongKey(playback.currentSong) !== pending.songKey) return;
    useHeartbeatModeStore.setState({ pendingReturn: null });
    playback.setPlayQueue([]);
    void persistPlaybackCache(playback.currentSong, []).catch(() => undefined);
}
