import type { SongResult } from '@/types';
import { replacePlayQueue, selectIsShowingTail, usePlaybackStore } from '@/stores/usePlaybackStore';
import { noteWholeQueueWrite } from '@/services/wholeQueueWrites';
import { isStagePlaybackSong, samePlaybackKeySequence } from '@/utils/appPlaybackGuards';
import type { FoliumQueueReplaceRefusal, FoliumQueueReplaceResult } from '../../folium/contract';
import { resolveFoliumSongRef } from '../../folium/dto';
import { findFoliumQueueCurrentIndex, resolveFoliumQueueKind } from '../hostQueue';
import { holdFoliumQueueUndo, promptFoliumQueueReplaced, resetFoliumQueueUndoForTest, setFoliumQueueUndoWriter } from './queueReplaceUndo';
import { dropFoliumQueueWriter, readFoliumQueueVersion, recordFoliumQueueReplace } from './queueVersion';

// src/mods/runtime/queue/hostQueueReplace.ts
// Folium 1.7: folium.playback.replaceQueue on the host side. The checks and the one store write run in
// one synchronous block, so nothing else writes the queue in between; the save to the last-session cache
// and the prefetch around the new queue follow it, coalesced, since a mod mirroring a long queue may
// replace it every second.

/** The least time between two replacements by one mod that write the store. */
export const QUEUE_REPLACE_MIN_INTERVAL_MS = 1000;
/** The least time between two saves (and prefetch refreshes) of a replaced queue. */
export const QUEUE_WRITE_INTERVAL_MS = 2000;

/** How the App saves the queue and refetches around it (persistLastPlaybackCache, refreshPrefetchAfterQueueEdit). */
export interface FoliumQueueWriter {
    persist: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    refreshPrefetch: (song: SongResult | null, previous: readonly SongResult[], next: SongResult[]) => void;
}

let writer: FoliumQueueWriter | null = null;
/** When each mod last wrote the store with a replacement. */
const lastReplaceAt = new Map<string, number>();
let lastWriteAt: number | null = null;
/** The queue the last save saw: the "before" of the prefetch refresh a later save in the same window makes. */
let lastWrittenQueue: readonly SongResult[] | null = null;
let trailingWrite: ReturnType<typeof setTimeout> | null = null;

/* Saves the queue as the store holds it now, and refetches around it against `previous`. */
const writeQueueNow = (previous: readonly SongResult[]) => {
    if (trailingWrite !== null) {
        clearTimeout(trailingWrite);
        trailingWrite = null;
    }
    const state = usePlaybackStore.getState();
    lastWriteAt = Date.now();
    lastWrittenQueue = state.playQueue;
    // The Stage keeps the main queue elsewhere, and its songs are not saved: nothing to do there.
    if (!writer || resolveFoliumQueueKind(state) === 'stage') return;
    writer.persist(state.currentSong, state.playQueue).catch((error) => {
        console.warn('[FoliumQueue] Could not save the replaced queue', error);
    });
    writer.refreshPrefetch(state.currentSong, previous, state.playQueue);
};

/*
 * After a replacement: leading and trailing edge. Two seconds or more since the last save, it saves at
 * once; otherwise once, two seconds after the last save, with the queue of that moment. Ten replacements
 * in a row are two or three saves.
 */
const scheduleQueueWrite = (previousQueue: readonly SongResult[]) => {
    if (trailingWrite !== null) return;
    const now = Date.now();
    if (lastWriteAt === null || now - lastWriteAt >= QUEUE_WRITE_INTERVAL_MS) {
        writeQueueNow(previousQueue);
        return;
    }
    trailingWrite = setTimeout(() => {
        trailingWrite = null;
        writeQueueNow(lastWrittenQueue ?? previousQueue);
    }, lastWriteAt + QUEUE_WRITE_INTERVAL_MS - now);
};

// A save still waiting is made when the page goes away, as paramStore.ts does. IndexedDB does not promise
// to finish while the page unloads: at worst the next launch finds the queue of the save before.
const writeBeforeLeaving = () => {
    if (trailingWrite !== null) writeQueueNow(lastWrittenQueue ?? []);
};
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('pagehide', writeBeforeLeaving);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') writeBeforeLeaving();
    });
}

/** The App's writer (useFoliumHostActions), or null when it unmounts. The undo saves through it too. */
export const registerFoliumQueueWriter = (next: FoliumQueueWriter | null) => {
    writer = next;
    setFoliumQueueUndoWriter(next ? writeQueueNow : null);
};

const refused = (
    reason: FoliumQueueReplaceRefusal,
    version: string,
    index: number | null = null,
    retryAfterMs: number | null = null,
): FoliumQueueReplaceResult => Object.freeze({ status: 'refused', reason, version, index, retryAfterMs });

/**
 * Replaces the store's queue with the songs behind `refs` (song refs, checked by the service), if it is
 * still at `expectedVersion`. Refusals in the contract's order: stage, transition, stale-version, the
 * songs from the first (stale-ref, not-queueable), rate-limited. The songs go in as the ref pool holds
 * them, in order: no filtering of unavailable songs, no queue-add setting, duplicates kept. Personal FM
 * ends. Nothing about what plays changes.
 */
export const replaceFoliumQueue = (modId: string, refs: readonly string[], expectedVersion: string): FoliumQueueReplaceResult => {
    const state = usePlaybackStore.getState();
    const kind = resolveFoliumQueueKind(state);
    const version = readFoliumQueueVersion(state.playQueue, kind);
    // The Stage holds the main queue in its own snapshot, which this does not touch.
    if (kind === 'stage') return refused('stage', version);
    // Mid-blend the queue has moved on to the arriving song while the picture still shows the outgoing
    // one: a mirror built from what the mod saw would be a song off.
    if (selectIsShowingTail(state)) return refused('transition', version);
    if (expectedVersion !== version) return refused('stale-version', version);

    const next: SongResult[] = [];
    for (let index = 0; index < refs.length; index += 1) {
        const song = resolveFoliumSongRef(refs[index]);
        if (!song) return refused('stale-ref', version, index);
        if (isStagePlaybackSong(song)) return refused('not-queueable', version, index);
        next.push(song);
    }

    const previousQueue = state.playQueue;
    // Already as asked: nothing is written, told or counted.
    if (!state.isFmMode && samePlaybackKeySequence(previousQueue, next)) {
        return Object.freeze({ status: 'replaced', version, length: previousQueue.length, currentIndex: findFoliumQueueCurrentIndex(state) });
    }

    const now = Date.now();
    const last = lastReplaceAt.get(modId);
    if (last !== undefined && now - last < QUEUE_REPLACE_MIN_INTERVAL_MS) {
        return refused('rate-limited', version, null, Math.ceil(QUEUE_REPLACE_MIN_INTERVAL_MS - (now - last)));
    }

    // In this order: the store write below runs the undo snapshot's subscription and schedules the
    // event, and both must already find the new version.
    const nextVersion = recordFoliumQueueReplace(next, 'queue', modId);
    const prompt = holdFoliumQueueUndo(state, version, nextVersion, modId);
    noteWholeQueueWrite();
    replacePlayQueue(next, false);
    // Behind the event the write scheduled: a replacement nobody heard is nobody's later.
    queueMicrotask(dropFoliumQueueWriter);

    lastReplaceAt.set(modId, now);
    scheduleQueueWrite(previousQueue);
    if (prompt) promptFoliumQueueReplaced(modId);
    console.info(`[FoliumQueue] ${modId} replaced the queue: ${previousQueue.length} → ${next.length} songs${state.isFmMode ? ', Personal FM off' : ''}`);

    return Object.freeze({
        status: 'replaced',
        version: nextVersion,
        length: next.length,
        currentIndex: findFoliumQueueCurrentIndex(usePlaybackStore.getState()),
    });
};

export const resetFoliumQueueReplaceForTest = () => {
    lastReplaceAt.clear();
    if (trailingWrite !== null) clearTimeout(trailingWrite);
    trailingWrite = null;
    lastWriteAt = null;
    lastWrittenQueue = null;
    resetFoliumQueueUndoForTest();
};
