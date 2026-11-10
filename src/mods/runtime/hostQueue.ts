import type { SongResult } from '@/types';
import { usePlaybackStore, selectDisplaySong } from '@/stores/usePlaybackStore';
import { getPlaybackSongKey, isStagePlaybackSong } from '@/utils/appPlaybackGuards';
import type { FoliumQueueItem, FoliumQueueSnapshot } from '../folium/contract';
import { resolveFoliumSongRef, toFoliumSong } from '../folium/dto';
import { readFoliumQueueVersion } from './queue/queueVersion';

// src/mods/runtime/hostQueue.ts
// The play queue as folium.playback.getQueue / playQueueItem and the
// playback.queueChanged event see it, read straight from the playback store.
// The current position follows the host's queue panel: the first entry whose
// playback key matches the displayed song.

type PlaybackStoreState = ReturnType<typeof usePlaybackStore.getState>;

export type FoliumQueueKind = FoliumQueueSnapshot['kind'];

/** Stage wins over FM: during external Stage playback the store queue has nothing to do with what plays. */
export const resolveFoliumQueueKind = (state: PlaybackStoreState): FoliumQueueKind => {
    if (state.activePlaybackContext === 'stage' || isStagePlaybackSong(selectDisplaySong(state))) return 'stage';
    return state.isFmMode ? 'fm' : 'queue';
};

/** Index of the displayed song in the queue (first occurrence by playback key), or -1. */
export const findFoliumQueueCurrentIndex = (state: PlaybackStoreState): number => {
    const displayed = selectDisplaySong(state);
    if (!displayed) return -1;
    const key = getPlaybackSongKey(displayed);
    return state.playQueue.findIndex((song) => getPlaybackSongKey(song) === key);
};

/*
 * One page of the queue. Without an offset the page is centred on the
 * displayed song (clamped so it never runs past either end; from the top when
 * the song is not in the queue); a given offset is clamped to [0, length].
 * `limit` arrives already clamped to 1–500 by the service.
 */
export const buildFoliumQueueSnapshot = (
    state: PlaybackStoreState,
    offset: number | undefined,
    limit: number,
): FoliumQueueSnapshot => {
    const queue = state.playQueue;
    const length = queue.length;
    const currentIndex = findFoliumQueueCurrentIndex(state);
    const start = offset === undefined
        ? (currentIndex < 0 ? 0 : Math.min(Math.max(0, currentIndex - Math.floor(limit / 2)), Math.max(0, length - limit)))
        : Math.min(Math.max(0, offset), length);
    const items: FoliumQueueItem[] = queue.slice(start, start + limit).map((song, position) => Object.freeze({
        song: Object.freeze(toFoliumSong(song)!),
        index: start + position,
    }));
    const kind = resolveFoliumQueueKind(state);
    return Object.freeze({
        items: Object.freeze(items),
        length,
        currentIndex,
        kind,
        version: readFoliumQueueVersion(queue, kind),
    });
};

/*
 * What playQueueItem hands to the host's playSong. Playback and navigation
 * match a queue panel click, but the queue differs: the panel passes its
 * display copy of the queue (local songs re-labelled from the library), so
 * after a failed play its retry and skip replay that snapshot; this passes
 * the store's own array, so they follow the queue as it is when pressed.
 */
export interface FoliumQueuePlayRequest {
    song: SongResult;
    /** The store's own playQueue array: the queue controller recognises it by identity. */
    queue: SongResult[];
    /** Personal FM stays on, as with Stage API selections. */
    isFm: boolean;
}

/*
 * Resolves playQueueItem's target, or null when it must not act: Stage
 * playback, an index out of range, or an `expectedRef` that no longer names
 * the entry. The ref is checked by identity first; the host replaces queue
 * entries with equal copies when a song starts (replay gain, fresh metadata),
 * so a ref minted before that still matches by playback key. A ref that does
 * not resolve (expired, or not a string) never matches.
 */
export const resolveFoliumQueuePlayRequest = (
    state: PlaybackStoreState,
    index: number,
    expectedRef: unknown,
): FoliumQueuePlayRequest | null => {
    if (resolveFoliumQueueKind(state) === 'stage') return null;
    const queue = state.playQueue;
    if (index < 0 || index >= queue.length) return null;
    const song = queue[index];
    if (expectedRef !== undefined) {
        const expected = resolveFoliumSongRef(expectedRef);
        if (!expected) return null;
        if (expected !== song && getPlaybackSongKey(expected) !== getPlaybackSongKey(song)) return null;
    }
    return { song, queue, isFm: state.isFmMode };
};
