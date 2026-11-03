import { create } from 'zustand';
import { Undo2 } from 'lucide-react';
import i18n from '@/i18n/config';
import type { SongResult } from '@/types';
import { replacePlayQueue, selectDisplaySong, usePlaybackStore } from '@/stores/usePlaybackStore';
import { setStatusMessage } from '@/stores/useStatusMessageStore';
import { noteWholeQueueWrite, setYieldedQueueListener } from '@/services/wholeQueueWrites';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { foliumModName } from '../clientLoader';
import { resolveFoliumQueueKind } from '../hostQueue';
import { dropFoliumQueueWriter, readFoliumQueueVersion } from './queueVersion';

// src/mods/runtime/queue/queueReplaceUndo.ts
// Folium 1.7: the one-step undo of a mod's replaceQueue, and the notice that says which mod replaced the
// queue. The undo puts back the user's queue (and Personal FM) from before the first of a run of
// replacements, and only until anything else changes the queue; it lives in memory only.

type PlaybackStoreState = ReturnType<typeof usePlaybackStore.getState>;

// A notice for another mod's replacement waits this long after the last one: two mods replacing the queue
// in turn every second would otherwise push every other message off the toast.
const PROMPT_AGAIN_AFTER_MS = 30_000;
const PROMPT_DURATION_MS = 10_000;
const RESULT_DURATION_MS = 2500;

interface QueueUndoSnapshot {
    /** The store's queue from before the replacements: the array itself, not a copy. */
    queue: SongResult[];
    isFmMode: boolean;
    /** The displayed song then: FM comes back only while it is still the one shown. */
    displayedKey: string | null;
    /** The version the last replacement left; any other version means the queue changed since. */
    afterVersion: string;
    modId: string;
    /** When the notice was last shown for this snapshot. */
    promptedAt: number;
}

/** Which mod replaced the queue while it can be undone, else null: for the command palette's undo command. */
export const useFoliumQueueUndoStore = create<{ modId: string | null }>(() => ({ modId: null }));

let snapshot: QueueUndoSnapshot | null = null;
let stopWatching: (() => void) | null = null;
/** Saves the queue an undo put back at once (hostQueueReplace.ts hands it in, which imports this file). */
let writeUndoneQueue: ((previous: readonly SongResult[]) => void) | null = null;

const versionOf = (state: PlaybackStoreState) => readFoliumQueueVersion(state.playQueue, resolveFoliumQueueKind(state));

const displayedKeyOf = (state: PlaybackStoreState) => {
    const song = selectDisplaySong(state);
    return song ? getPlaybackSongKey(song) : null;
};

const dropSnapshot = () => {
    snapshot = null;
    stopWatching?.();
    stopWatching = null;
    useFoliumQueueUndoStore.setState({ modId: null });
};

// While a snapshot is held: a change of the queue array or its kind that leaves another version (the user,
// the host, the FM top-up, entering the Stage) lets it go. A play landing in it swaps one entry for an
// equal copy and keeps the version, and the snapshot.
const watch = () => {
    stopWatching ??= usePlaybackStore.subscribe((state, previous) => {
        if (!snapshot) return;
        if (state.playQueue === previous.playQueue && resolveFoliumQueueKind(state) === resolveFoliumQueueKind(previous)) return;
        if (versionOf(state) !== snapshot.afterVersion) dropSnapshot();
    });
};

// A restore under way when the queue was replaced (the last session's at launch, a rebuilt window's
// handoff) leaves the queue it brought back unwritten, and the replacement stands over it. That queue is
// the user's, not the one the store held when the replacement came (empty at launch): the undo puts it
// back, with the FM the restore would have set and the song it made current.
setYieldedQueueListener((yielded) => {
    if (!snapshot) return;
    snapshot = {
        ...snapshot,
        queue: yielded.queue,
        isFmMode: yielded.isFmMode ?? snapshot.isFmMode,
        displayedKey: yielded.song ? getPlaybackSongKey(yielded.song) : null,
    };
});

/** hostQueueReplace.ts: how an undo saves the queue it put back and fetches around it, or null. */
export const setFoliumQueueUndoWriter = (write: ((previous: readonly SongResult[]) => void) | null) => {
    writeUndoneQueue = write;
};

/**
 * What an undo puts back, kept just before replaceQueue writes the store (so that the subscription that
 * runs inside the write already finds `afterVersion`). A snapshot only replacements changed since keeps
 * the queue and FM from before the first of them and takes the new version and mod; otherwise a new one
 * of the state now. Answers whether the replacement is to be told (promptFoliumQueueReplaced).
 */
export const holdFoliumQueueUndo = (state: PlaybackStoreState, versionBefore: string, afterVersion: string, modId: string): boolean => {
    const now = Date.now();
    if (snapshot && snapshot.afterVersion === versionBefore) {
        // The same mod again is not told again; another mod is, once the last notice is old enough.
        const prompt = snapshot.modId !== modId && now - snapshot.promptedAt >= PROMPT_AGAIN_AFTER_MS;
        snapshot = { ...snapshot, afterVersion, modId, promptedAt: prompt ? now : snapshot.promptedAt };
        useFoliumQueueUndoStore.setState({ modId });
        return prompt;
    }
    snapshot = {
        queue: state.playQueue,
        isFmMode: state.isFmMode,
        displayedKey: displayedKeyOf(state),
        afterVersion,
        modId,
        promptedAt: now,
    };
    watch();
    useFoliumQueueUndoStore.setState({ modId });
    return true;
};

/** The notice: which mod replaced the queue, with the undo button. One toast among others: it may be pushed aside. */
export const promptFoliumQueueReplaced = (modId: string) => {
    setStatusMessage({
        type: 'info',
        text: i18n.t('mods.queueReplaced', { name: foliumModName(modId) }),
        actionLabel: i18n.t('mods.queueReplaceUndo'),
        actionIcon: Undo2,
        onAction: () => { undoFoliumQueueReplace(); },
        nonce: Date.now(),
        durationMs: PROMPT_DURATION_MS,
    });
};

/**
 * Puts back the queue (and FM, while the song shown is still the one shown then) from before the
 * replacements, in one store write. A user's action: not rate-limited, fine during a blend; the version
 * changes and no mod hears it as its own. False, and says so, when there is nothing to undo any more.
 */
export const undoFoliumQueueReplace = (): boolean => {
    const state = usePlaybackStore.getState();
    const held = snapshot;
    if (!held || versionOf(state) !== held.afterVersion) {
        dropSnapshot();
        setStatusMessage({ type: 'info', text: i18n.t('mods.queueReplaceUndoGone'), nonce: Date.now(), durationMs: RESULT_DURATION_MS });
        return false;
    }
    dropSnapshot();
    const replaced = state.playQueue;
    // Both the song shown and the host's own: mid-blend the picture still holds the outgoing song while the
    // host is on the arriving one, which the FM batch does not hold either.
    const currentKey = state.currentSong ? getPlaybackSongKey(state.currentSong) : null;
    const isFmMode = held.isFmMode && displayedKeyOf(state) === held.displayedKey && currentKey === held.displayedKey;
    dropFoliumQueueWriter();
    noteWholeQueueWrite();
    replacePlayQueue(held.queue, isFmMode);
    // Saved now, in place of a save of the replacement still waiting.
    writeUndoneQueue?.(replaced);
    setStatusMessage({ type: 'success', text: i18n.t('mods.queueReplaceUndone'), nonce: Date.now(), durationMs: RESULT_DURATION_MS });
    console.info(`[FoliumQueue] Undid the replacement by ${held.modId}: ${replaced.length} → ${held.queue.length} songs${isFmMode ? ', Personal FM back on' : ''}`);
    return true;
};

export const resetFoliumQueueUndoForTest = () => {
    dropSnapshot();
};
