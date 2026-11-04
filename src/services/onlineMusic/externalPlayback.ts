import type { ProviderExternalPlaybackStatus } from '../../types/onlineMusic';
import type { SongResult } from '../../types';
import { PlayerState } from '../../types';
import { usePlaybackStore, setAudioSrc, setDuration, setPlaybackRoute, setPlayerState } from '../../stores/usePlaybackStore';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { createExternalClock } from './externalClock';
import { setExternalRouteMedia } from '../hifi/hifiMediaShim';
import { leaveHifiRoute } from '../hifi/hifiRouteGuard';
import { MediaShim } from '../mediaShim';
import { omni } from './omni';
import { externalQueueSuccessors } from './externalQueue';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';

// src/services/onlineMusic/externalPlayback.ts
// The playback route for a provider whose audio plays in a player of its own outside this app
// (the companion's MusicKit page). The app never gets a URL: it tells that player
// what to play and how to move, and follows the player's position through an extrapolated clock,
// the same way the app follows mpv (`hifiClock`). The page is asked at a fixed rate; the clock
// runs between answers so lyrics and the progress bar do not step.
//
// This file knows no platform: what to ask is Omni's `externalPlayback` capability, and the
// player's own answers come back as `ProviderExternalPlaybackStatus`.

/** How often the player is asked for its state while a track is loaded. */
const STATUS_INTERVAL_MS = 500;
/** After a failed answer, a slower retry keeps a signed-out player from being asked twice a second. */
const STATUS_RETRY_INTERVAL_MS = 2000;
/** How far a position answer may be extrapolated, as `hifiClock` does. */
const MAX_SAMPLE_AGE_SEC = 1;
/** A player that stopped this close to the length has finished the track. */
const END_TOLERANCE_SEC = 0.75;

export type ExternalPlaybackEvent =
    | { type: 'status' }
    | { type: 'ended' }
    | { type: 'failure'; error: unknown }
    | { type: 'foreign-track' };

type ExternalSession = {
    song: SongResult;
    songKey: string;
    attempt: number;
    clock: ReturnType<typeof createExternalClock>;
    durationSec: number | null;
    /** The app has shown this song: only then may the player drive the transport and the shim. */
    announced: boolean;
    playing: boolean;
    /** The player accepted a start/resume and is still buffering: shown as loading, not paused. */
    starting: boolean;
    /** The position of the last playing answer, to tell real progress from an optimistic flag. */
    sampledPosition: number | null;
    /** Two playing answers apart showed the position moving: background work may start. */
    prefetchReady: boolean;
    live: boolean;
    ended: boolean;
    /** Set when the player moved to a track this app did not ask for. */
    foreign: boolean;
    preparedQueueKey: string;
    positionRevision: number;
    seekPending: boolean;
    seeking: boolean;
};

export const externalMediaShim = new MediaShim('external:');

let session: ExternalSession | null = null;
let attemptCounter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let pollRunning = false;
let installed = false;
let ownWriteDepth = 0;
let failureNoted = false;
const listeners = new Set<(event: ExternalPlaybackEvent) => void>();

const emit = (event: ExternalPlaybackEvent) => {
    for (const listener of listeners) {
        try {
            listener(event);
        } catch (error) {
            console.warn('[ExternalPlayback] a listener threw', error);
        }
    }
};

/** Whether the current playback route is the external player. */
export const isExternalRoute = () => usePlaybackStore.getState().playbackRoute === 'external';

/**
 * Whether the player is sounding the song on screen: the route is the external one and the app
 * has shown the track and announced it. Before that the old song is still on screen, so observers
 * and the lyric clock must keep using what they used before.
 */
export const isExternalPlaybackSounding = () => isExternalRoute() && session?.announced === true;

/** Background reads wait for actual player progress, not an optimistic playing flag. */
export const isExternalPlaybackReadyForPrefetch = (song: SongResult) => isExternalRoute()
    && session?.songKey === getPlaybackSongKey(song) && session.announced
    && session.prefetchReady && !session.seeking && !session.seekPending;

/** The extrapolated position of the external player's track, in seconds. */
export const getExternalPosition = () => session?.clock.read() ?? 0;

/** Whether the external player is paused (also true while a track loads). */
export const isExternalPaused = () => session ? !session.playing : false;

/** The song the external player was told to play, or null. */
export const getExternalSong = () => session?.song ?? null;

/** Notified on every change the UI has to react to (state, end of track, a failed answer). */
export const subscribeExternalPlayback = (listener: (event: ExternalPlaybackEvent) => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const withoutRouteGuard = (write: () => void) => {
    ownWriteDepth += 1;
    try {
        write();
    } finally {
        ownWriteDepth -= 1;
    }
};

const stopTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
};

const schedulePoll = (delayMs: number) => {
    stopTimer();
    if (!session) return;
    timer = setTimeout(() => {
        timer = null;
        void poll();
    }, delayMs);
};

const validDurationSec = (ms: number): number | null => (
    Number.isFinite(ms) && ms > 0 ? ms / 1000 : null
);

// Queue edits and repeat-mode changes invalidate the prepared tail before the next transition.
const refreshPreparedQueue = () => {
    const current = session;
    if (!current || !isExternalPlaybackReadyForPrefetch(current.song)) return;
    const state = usePlaybackStore.getState();
    const next = externalQueueSuccessors(current.song, state.playQueue, useAudioSettingsStore.getState().loopMode, state.isFmMode, omni.canPlaySong);
    const key = JSON.stringify(next.map(getPlaybackSongKey));
    if (current.preparedQueueKey === key) return;
    current.preparedQueueKey = key;
    void omni.prepareExternalPlaybackQueue(current.song, next).catch(error => {
        // A newer song dropped this queued preparation: nothing went wrong.
        if (session !== current) return;
        if (current.preparedQueueKey === key) current.preparedQueueKey = '';
        console.warn('[ExternalPlayback] Could not prepare the next songs', error);
    });
};

const syncClock = (positionSec: number, paused: boolean, sampledAtMs: number, holdBackward: boolean) => {
    if (!session) return;
    paused ||= session.live;
    const ageSec = paused ? 0 : Math.min(Math.max(0, (performance.now() - sampledAtMs) / 1000), MAX_SAMPLE_AGE_SEC);
    session.clock.sync({ positionSec: positionSec + ageSec, samplePositionSec: positionSec, paused, nowMs: performance.now(), holdBackward });
};

const markPlaying = (positionSec: number, preserveClock = false) => {
    if (!session) return;
    session.playing = true;
    session.ended = false;
    if (!preserveClock) syncClock(positionSec, false, performance.now(), true);
    externalMediaShim.markPlaying();
    if (usePlaybackStore.getState().playerState !== PlayerState.PLAYING) setPlayerState(PlayerState.PLAYING);
    emit({ type: 'status' });
};

const markPaused = (positionSec: number) => {
    if (!session) return;
    session.playing = false;
    session.starting = false;
    session.prefetchReady = false;
    session.sampledPosition = null;
    syncClock(positionSec, true, performance.now(), true);
    externalMediaShim.markPaused();
    const playback = usePlaybackStore.getState();
    // The song is on screen and the player is stopped: paused, never still "loading" or idle.
    if (playback.playerState !== PlayerState.PAUSED) setPlayerState(PlayerState.PAUSED);
    emit({ type: 'status' });
};

const markEnded = (positionSec: number) => {
    if (!session || session.ended) return;
    session.ended = true;
    session.playing = false;
    syncClock(positionSec, true, performance.now(), false);
    externalMediaShim.markEnded();
    setPlayerState(PlayerState.PAUSED);
    emit({ type: 'ended' });
    emit({ type: 'status' });
};

const applyStatus = (status: ProviderExternalPlaybackStatus, sampledAtMs: number) => {
    if (!session) return;
    const current = session;
    const positionSec = status.positionMs / 1000;
    // A late completion belonging to the previous song cannot fill or finish the new session.
    if (!current.announced && !status.mediaId) return;
    if (status.mediaId && !omni.isExternalPlaybackStatusForSong(current.song, status)) {
        if (!current.announced) return;
        // The player is on a track this app did not ask for (someone used its own window). Stop it
        // rather than let a song Folia knows nothing about keep sounding under Folia's controls.
        if (!current.foreign) {
            current.foreign = true;
            console.warn('[ExternalPlayback] the player has another track; it is paused');
            void omni.pauseExternalPlayback(current.song).catch(() => {});
            markPaused(positionSec);
            emit({ type: 'foreign-track' });
        }
        return;
    }
    current.live = status.live === true;
    if (status.isPlaying && status.mediaId && !status.seeking) {
        if (current.live || (current.sampledPosition !== null && positionSec > current.sampledPosition + 0.05)) current.prefetchReady = true;
        current.sampledPosition = positionSec;
    } else {
        current.prefetchReady = false;
        current.sampledPosition = null;
    }
    const durationSec = current.live ? null : validDurationSec(status.durationMs);
    if (durationSec !== null && durationSec !== current.durationSec) {
        current.durationSec = durationSec;
        current.clock.setDuration(durationSec);
        if (current.announced) {
            externalMediaShim.setDuration(durationSec);
            if (usePlaybackStore.getState().duration !== durationSec) setDuration(durationSec);
        }
    }
    const atEnd = durationSec !== null && positionSec >= durationSec - END_TOLERANCE_SEC;
    // Before the app has shown the song, the player's answers only fill in the session: the
    // transport, the shim and the media observers belong to the song on screen until then.
    if (!current.announced) {
        current.clock.sync({ positionSec, paused: current.live || !status.isPlaying, holdBackward: false });
        current.playing = status.isPlaying;
        current.seeking = status.seeking === true;
        if (status.ended || (status.isPlaying === false && atEnd)) current.ended = true;
        return;
    }
    // An accepted start that is still buffering is loading, not a pause of the listener's.
    current.starting = status.starting === true && !status.isPlaying;
    if (current.starting) {
        current.playing = false;
        syncClock(current.clock.read(), true, sampledAtMs, true);
        if (!usePlaybackStore.getState().isLoadingToPlay) usePlaybackStore.getState().startLoadingToPlay();
        emit({ type: 'status' });
        return;
    }
    // The player has no track: it is between starts, or the start it was asked for did not take.
    // That is a pause to wait through, never another song of the listener's.
    if (!status.mediaId) {
        if (status.seeking && !current.seeking) {
            current.seeking = true;
            externalMediaShim.markSeeked();
        }
        current.foreign = false;
        markPaused(current.clock.read());
        return;
    }
    current.foreign = false;
    if (status.seeking || current.seeking) {
        current.clock.sync({ positionSec, paused: current.live || !status.isPlaying, holdBackward: false });
        if ((status.seeking === true) !== current.seeking) externalMediaShim.markSeeked();
    }
    current.seeking = status.seeking === true;
    if (status.ended || (current.playing && !status.isPlaying && atEnd)) {
        markEnded(durationSec ?? positionSec);
        return;
    }
    if (status.isPlaying) {
        if (current.ended) current.ended = false;
        if (!current.playing) {
            markPlaying(positionSec);
        } else {
            syncClock(positionSec, false, sampledAtMs, true);
            emit({ type: 'status' });
        }
        // Only a player-confirmed start/resume may release deferred preparation.
        refreshPreparedQueue();
        return;
    }
    markPaused(positionSec);
};

async function poll(): Promise<void> {
    const current = session;
    if (!current || pollRunning || !isExternalRoute()) return;
    if (current.seekPending) { schedulePoll(STATUS_INTERVAL_MS); return; }
    const positionRevision = current.positionRevision;
    pollRunning = true;
    const startedAt = performance.now();
    let delay = STATUS_INTERVAL_MS;
    try {
        const status = await omni.getExternalPlaybackStatus(current.song);
        if (session !== current || !isExternalRoute() || current.positionRevision !== positionRevision) return;
        // The answer names a position the page read about half a round trip ago.
        applyStatus(status, (startedAt + performance.now()) / 2);
        failureNoted = false;
    } catch (error) {
        if (session !== current || !isExternalRoute() || current.positionRevision !== positionRevision) return;
        delay = STATUS_RETRY_INTERVAL_MS;
        if (!failureNoted) {
            failureNoted = true;
            console.warn('[ExternalPlayback] the player could not be asked for its position', error);
            emit({ type: 'failure', error });
        }
        // The position cannot be trusted while the answer does not come: hold the clock where it is.
        // A start that was still buffering has failed too: show it paused rather than loading forever.
        if (current.playing || current.starting) markPaused(current.clock.read());
    } finally {
        pollRunning = false;
        if (session === current && isExternalRoute()) schedulePoll(delay);
    }
}

/** Starts a track in the external player and puts the app on that route. */
export async function beginExternalPlayback(song: SongResult, startSec = 0): Promise<void> {
    if (isExternalRoute()) {
        // Already on the route: replacing the track is one call, and the old clock must not speak
        // for the new song while it does.
    } else if (usePlaybackStore.getState().playbackRoute === 'hifi') {
        // mpv must give the song up before the other player starts, or both sound at once.
        leaveHifiRoute('external player');
    }
    const attempt = ++attemptCounter;
    const songKey = getPlaybackSongKey(song);
    const durationSec = validDurationSec(song.durationMs) ?? null;
    const clock = createExternalClock();
    clock.setDuration(durationSec);
    clock.sync({ positionSec: Math.max(0, startSec), paused: true });
    session = {
        song, songKey, attempt, clock, durationSec,
        announced: false, playing: false, starting: false, sampledPosition: Math.max(0, startSec), prefetchReady: false, live: false, ended: false, foreign: false, preparedQueueKey: '', positionRevision: 0, seekPending: false, seeking: false,
    };
    failureNoted = false;
    externalMediaShim.beginTrack(songKey);
    withoutRouteGuard(() => {
        setAudioSrc(null);
        setPlaybackRoute('external');
    });
    emit({ type: 'status' });
    try {
        await omni.playSongExternally(song, Math.max(0, startSec));
    } catch (error) {
        if (session?.attempt === attempt) {
            stopExternalPlayback('the player refused the song');
            // Nothing is sounding there: the next song's play decides its own route.
            withoutRouteGuard(() => setPlaybackRoute('web'));
        }
        throw error;
    }
    if (session?.attempt !== attempt || !isExternalRoute()) return;
    // Seed the incoming clock before announcement instead of showing a paused/loading frame for 500 ms.
    const sampledAt = performance.now();
    const positionRevision = session.positionRevision;
    try {
        const status = await omni.getExternalPlaybackStatus(song);
        if (session?.attempt === attempt && session.positionRevision === positionRevision && !session.seekPending && isExternalRoute()) applyStatus(status, sampledAt);
    } catch (error) {
        console.warn('[ExternalPlayback] Initial player status unavailable', error);
    }
    if (session?.attempt === attempt && isExternalRoute()) schedulePoll(STATUS_INTERVAL_MS);
}

/**
 * The app has put the song on screen: from now on the player drives the transport, the shim and
 * the media observers. Called by the play path that began this track.
 */
export function announceExternalPlayback(): void {
    const current = session;
    if (!current || current.announced) return;
    current.announced = true;
    refreshPreparedQueue();
    externalMediaShim.setDuration(current.durationSec ?? 0);
    const displayedDuration = current.live ? 0 : current.durationSec;
    if (displayedDuration !== null && usePlaybackStore.getState().duration !== displayedDuration) {
        setDuration(displayedDuration);
    }
    if (current.ended) {
        // A completed sample before announcement still has to notify the queue exactly once.
        current.ended = false;
        markEnded(current.clock.read());
        return;
    }
    // Only an answer from the player itself says it is playing. Without one the transport stays in
    // its loading state, which the next answer (half a second at most) turns into playing or paused.
    if (current.playing) markPlaying(current.clock.read(), true);
    else emit({ type: 'status' });
}

/** Leaves the external route and stops its player. The route itself is the caller's to set. */
export function stopExternalPlayback(reason: string): void {
    const current = session;
    stopTimer();
    session = null;
    externalMediaShim.reset();
    if (!current) return;
    emit({ type: 'status' });
    console.info('[ExternalPlayback] left the external player', { reason, songKey: current.songKey });
    void omni.pauseExternalPlayback(current.song).catch(error => {
        console.warn('[ExternalPlayback] the player could not be paused as the route is left', error);
    });
}

/**
 * Gives the song up because another one is starting: the player stops and the route goes back to
 * the app's own engine. The new song's play then decides its own route.
 */
export function yieldExternalPlayback(reason: string): void {
    if (!isExternalRoute()) return;
    stopExternalPlayback(reason);
    setPlaybackRoute('web');
}

/** Pauses the external player. False when no external song is loaded. */
export const pauseExternalPlayback = (): boolean => {
    const current = session;
    if (!current) return false;
    markPaused(current.clock.read());
    void omni.pauseExternalPlayback(current.song).catch(error => {
        console.warn('[ExternalPlayback] pause failed', error);
        emit({ type: 'failure', error });
    });
    return true;
};

/** Resumes the external player. False when no external song is loaded. */
export const resumeExternalPlayback = (): boolean => {
    const current = session;
    if (!current) return false;
    markPlaying(current.clock.read());
    void omni.resumeExternalPlayback(current.song).catch(error => {
        console.warn('[ExternalPlayback] resume failed', error);
        markPaused(current.clock.read());
        emit({ type: 'failure', error });
    });
    return true;
};

/** Moves the external player; `resume` starts a paused track after the move, as the bar's seek does. False when no external song is loaded. */
export const seekExternalPlayback = (timeSec: number, { resume = false }: { resume?: boolean } = {}): boolean => {
    const current = session;
    if (!current) return false;
    if (current.live || !Number.isFinite(timeSec)) return true;
    const target = Math.max(0, current.durationSec === null ? timeSec : Math.min(timeSec, current.durationSec));
    current.ended = false;
    const revision = ++current.positionRevision;
    current.seekPending = true;
    current.prefetchReady = false;
    current.sampledPosition = null;
    current.clock.sync({ positionSec: target, paused: !current.playing, holdBackward: false });
    externalMediaShim.markSeeked();
    void omni.seekExternalPlayback(current.song, target).catch(error => {
        if (session !== current || current.positionRevision !== revision) return;
        console.warn('[ExternalPlayback] seek failed', error);
        emit({ type: 'failure', error });
    }).finally(() => {
        if (session === current && current.positionRevision === revision) current.seekPending = false;
    });
    if (resume && !current.playing) resumeExternalPlayback();
    return true;
};

/** Mounts the clock, the shim and the route guard once; repeated calls do nothing. */
export const installExternalPlayback = (): void => {
    if (installed) return;
    installed = true;
    externalMediaShim.setClockReader(() => getExternalPosition());
    useAudioSettingsStore.subscribe((state, previous) => {
        if (state.loopMode !== previous.loopMode) refreshPreparedQueue();
    });
    usePlaybackStore.subscribe((state, previous) => {
        if (ownWriteDepth > 0) return;
        // Any other engine taking the song (a web source, mpv, the stage) makes the player yield.
        if (previous.playbackRoute === 'external' && state.playbackRoute !== 'external') {
            stopExternalPlayback('another engine took the song');
            return;
        }
        if (state.playbackRoute === 'external' && state.audioSrc !== null) {
            stopExternalPlayback('a web source took the song');
            withoutRouteGuard(() => setPlaybackRoute('web'));
            return;
        }
        if (state.playbackRoute === 'external' && state.activePlaybackContext === 'stage') {
            stopExternalPlayback('the stage took the song');
            withoutRouteGuard(() => setPlaybackRoute('web'));
        }
        if (state.playQueue !== previous.playQueue || state.isFmMode !== previous.isFmMode) refreshPreparedQueue();
    });
};

// The observation layer asks this route for its shim; registering it at load keeps that answer
// ready before React mounts anything.
setExternalRouteMedia(() => isExternalPlaybackSounding() ? externalMediaShim : null);
