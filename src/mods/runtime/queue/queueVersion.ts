import type { SongResult } from '@/types';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import type { FoliumQueueSnapshot } from '../../folium/contract';

// src/mods/runtime/queue/queueVersion.ts
// Folium 1.7: the play queue's version (FoliumQueueSnapshot.version, playback.queueChanged's `version`) and
// whose replaceQueue an event reports (`byThisMod`). The version follows the songs, not the array: the host
// writes an equal copy of an entry back each time a song starts, which must not look like a change to a
// mod mirroring the queue. It is worked out only when something reads it, so nothing runs without a mod.
// The queue's kind is handed in by the caller: this file does not import hostQueue.ts, which imports it.

type QueueKind = FoliumQueueSnapshot['kind'];

/** Drawn once per load: versions of another session never come out equal by chance. */
const SESSION = Math.random().toString(36).slice(2, 8);
// Never reset, so a version handed out before a reset is never handed out again.
let minted = 0;

interface SeenQueue {
    /** The array last read, so the same array answers without looking at its songs. */
    queue: readonly SongResult[];
    keys: readonly string[];
    kind: QueueKind;
    version: string;
}

let seen: SeenQueue | null = null;
/** The version a replaceQueue just wrote, and its mod: for the one event that write schedules. */
let pendingWriter: { version: string; modId: string } | null = null;

const mint = () => {
    minted += 1;
    return `${SESSION}.${minted}`;
};

const sameKeys = (first: readonly string[], second: readonly string[]) => (
    first.length === second.length && first.every((key, index) => key === second[index])
);

/*
 * The version of `queue` in `kind`. The same array in the same kind answers at once; another array with
 * the same songs (by playback key) in the same order keeps the version, and only the array is remembered;
 * anything else is a new version. Moving the displayed song changes neither, so it keeps the version.
 */
export const readFoliumQueueVersion = (queue: readonly SongResult[], kind: QueueKind): string => {
    if (seen && seen.queue === queue && seen.kind === kind) return seen.version;
    const keys = queue.map(getPlaybackSongKey);
    if (seen && seen.kind === kind && sameKeys(seen.keys, keys)) {
        seen = { ...seen, queue };
        return seen.version;
    }
    seen = { queue, keys, kind, version: mint() };
    return seen.version;
};

/**
 * A replaceQueue of `modId` is about to write `queue` in `kind`: answers its new version, and marks the
 * event that write schedules as that mod's. Called before the store write, so the subscribers that run
 * inside it already read this version.
 */
export const recordFoliumQueueReplace = (queue: readonly SongResult[], kind: QueueKind, modId: string): string => {
    const version = mint();
    seen = { queue, keys: queue.map(getPlaybackSongKey), kind, version };
    pendingWriter = { version, modId };
    return version;
};

/**
 * For playback.queueChanged: the version now and the mod whose replacement it reports, which is null
 * when something else changed the songs since in the same task. The mark is used up either way.
 */
export const takeFoliumQueueChange = (queue: readonly SongResult[], kind: QueueKind): { version: string; writer: string | null } => {
    const version = readFoliumQueueVersion(queue, kind);
    const writer = pendingWriter && pendingWriter.version === version ? pendingWriter.modId : null;
    pendingWriter = null;
    return { version, writer };
};

/**
 * Forgets the mark. A replacement queues this a microtask after its write, behind the event the write
 * scheduled: when nobody listened then, no later event can report the replacement as a mod's own.
 */
export const dropFoliumQueueWriter = () => {
    pendingWriter = null;
};

export const resetFoliumQueueVersionForTest = () => {
    seen = null;
    pendingWriter = null;
};
