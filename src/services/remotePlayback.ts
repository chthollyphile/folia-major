import type { SongResult } from '../types';
import type { RemotePlaybackCommand, RemotePlaybackSnapshot, RemotePlaybackStartOptions } from '../types/remotePlayback';
import { omni } from './onlineMusic/omni';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../utils/appPlaybackGuards';

// src/services/remotePlayback.ts

let owner: SongResult | null = null;
let generation = 0;
let commands = Promise.resolve();
let anchor: (RemotePlaybackSnapshot & { at: number; displayFloor: number }) | null = null;
let queuedNext: SongResult | null = null;
const clockListeners = new Set<() => void>();
const MAX_EXTRAPOLATION_SEC = 1.5;

const setAnchor = (next: typeof anchor) => {
    anchor = next;
    clockListeners.forEach(listener => listener());
};

const sameBackend = (left: SongResult, right: SongResult) => {
    const a = getPlaybackSourceRef(left);
    const b = getPlaybackSourceRef(right);
    return a.kind === 'online' && b.kind === 'online' && a.providerId === b.providerId;
};

export const isRemotePlaybackActive = () => owner !== null;
export const getQueuedRemoteNext = () => queuedNext;
export const getRemotePlaybackOwner = () => owner;
export const getRemotePlaybackTime = () => anchor
    ? Math.min(anchor.duration, Math.max(anchor.displayFloor,
        anchor.position + (anchor.playing ? Math.min(MAX_EXTRAPOLATION_SEC, (performance.now() - anchor.at) / 1000) : 0))) : 0;
export const getRemotePlaybackDuration = () => anchor?.duration ?? 0;
// Hold small backward corrections until the raw backend clock catches up, so a late poll cannot
// reverse a lyric transition. Keep the raw position as the anchor to avoid accumulating drift.
export const updateRemotePlaybackClock = (snapshot: RemotePlaybackSnapshot) => {
    const displayed = getRemotePlaybackTime();
    const backwardCorrection = displayed - snapshot.position;
    const preserveDisplay = anchor?.mediaId === snapshot.mediaId
        && backwardCorrection > 0 && backwardCorrection <= MAX_EXTRAPOLATION_SEC;
    setAnchor({ ...snapshot, at: performance.now(), displayFloor: preserveDisplay ? displayed : snapshot.position });
};
// Fires after every clock anchor change (poll, seek, pause) so platform surfaces can republish position.
export const subscribeRemotePlaybackClock = (listener: () => void) => {
    clockListeners.add(listener);
    return () => { clockListeners.delete(listener); };
};

// Serialize commands so a late start cannot restart a backend after a source switch.
const enqueue = (run: () => Promise<void>) => {
    const result = commands.then(run);
    commands = result.catch(() => {});
    return result;
};

// Transfer ownership before queuing work so rapid selections can invalidate old starts.
export async function startRemotePlayback(song: SongResult, options: RemotePlaybackStartOptions = {}): Promise<boolean> {
    const request = ++generation;
    const previous = owner;
    owner = song;
    setAnchor(null);
    // The backend may already be playing this song from the item lined up behind the last one.
    const continueIfCurrent = Boolean(queuedNext && getPlaybackSongKey(queuedNext) === getPlaybackSongKey(song));
    queuedNext = null;
    await enqueue(async () => {
        // Pausing only matters across backends; the same backend replaces or continues its own queue.
        if (previous && !sameBackend(previous, song)) await omni.remotePlaybackCommand(previous, 'pause');
        if (request !== generation) return;
        await omni.startRemotePlayback(song, { ...options, continueIfCurrent });
    });
    return request === generation;
}

// Lines the next song up on the current backend so the handover happens without a gap.
export async function queueRemotePlaybackNext(next: SongResult): Promise<boolean> {
    const song = owner;
    const request = generation;
    if (!song || !omni.usesRemotePlayback(next) || !sameBackend(song, next)) return false;
    await enqueue(async () => {
        if (request !== generation) return;
        await omni.queueRemotePlaybackNext(song, next);
        queuedNext = next;
    });
    return queuedNext === next;
}

export async function stopRemotePlayback(): Promise<void> {
    const previous = owner;
    ++generation;
    owner = null;
    queuedNext = null;
    setAnchor(null);
    if (previous) await enqueue(() => omni.remotePlaybackCommand(previous, 'pause'));
}

export async function commandRemotePlayback(command: RemotePlaybackCommand, value?: number): Promise<void> {
    const song = owner;
    const request = generation;
    if (!song) return;
    await enqueue(async () => {
        if (request !== generation) return;
        await omni.remotePlaybackCommand(song, command, value);
        if (request !== generation || !anchor) return;
        const position = command === 'seek' ? value! : getRemotePlaybackTime();
        setAnchor({ ...anchor, position, displayFloor: position, at: performance.now(), playing: command === 'pause' ? false : command === 'play' ? true : anchor.playing });
    });
}

export const ownsRemotePlayback = (song: SongResult | null) => Boolean(song && owner && getPlaybackSongKey(song) === getPlaybackSongKey(owner));
