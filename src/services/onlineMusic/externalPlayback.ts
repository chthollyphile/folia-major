import type { ExternalPlaybackTraits, ProviderExternalPlaybackStatus } from '../../types/onlineMusic';
import type { SongResult } from '../../types';
import { PlayerState } from '../../types';
import { usePlaybackStore, setAudioSrc, setDuration, setPlaybackRoute, setPlayerState } from '../../stores/usePlaybackStore';
import { getOnlineProviderIdForSong, getPlaybackSongKey } from '../../utils/appPlaybackGuards';
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
/** A player that keeps not answering is asked this rarely at most: it is not coming back by itself. */
const STATUS_RETRY_MAX_INTERVAL_MS = 10000;
/** How far a position answer may be extrapolated, as `hifiClock` does. */
const MAX_SAMPLE_AGE_SEC = 1;
/** A player that stopped this close to the length has finished the track. */
const END_TOLERANCE_SEC = 0.75;
/**
 * A window that handed its player over is destroyed once its replacement shows, a second or two
 * later. Still here after this long, it was not replaced (the main process refused or gave up the
 * rebuild): it follows the player again.
 */
const HANDOVER_RECLAIM_MS = 10_000;
/**
 * How many songs that follow are offered to the player. Each player writes as many of them as it
 * keeps room for, so this is the longest tail any of them is asked for: the rest are dropped.
 */
const PREPARED_TAIL = 3;
/** What a player that declared nothing is offered: the two successors this route always prepared. */
const PREPARED_SONGS = 2;
/**
 * How long a start may hold the prepared queue back. Its own play normally lands in a second or two;
 * a page that stopped answering must not leave the queue unprepared for the rest of the run, so past
 * this the write is let through (the start itself is left alone: it is not stopped, and its attempt
 * still decides what is acted on).
 */
const PREPARED_QUEUE_START_LIMIT_MS = 15_000;

export type ExternalPlaybackEvent =
    | { type: 'status' }
    // `skipped`: the player was moved off the song by its own controls, not by its end.
    // `heard`: the player confirmed playing this very song at some point, so the end is that song's
    // own end. A song whose start never landed can report an end without ever having sounded.
    | { type: 'ended'; skipped?: 'next' | 'previous'; heard?: boolean }
    | { type: 'failure'; error: unknown }
    | { type: 'foreign-track' }
    // The player fell back to a coarser channel (or came back to its precise one): said once an episode.
    | { type: 'degraded'; active: boolean }

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
    /** The direction the player's own controls moved it off the song in, carried to the end event. */
    skipped?: 'next' | 'previous';
    /** Set when the player moved to a track this app did not ask for. */
    foreign: boolean;
    /** The last answer came from the player's fallback channel. */
    degraded: boolean;
    /** What the song's provider declared about its player (`omni.externalPlaybackTraits`). */
    traits: ExternalPlaybackTraits;
    /** The player now belongs to the window replacing this one: answers are no longer acted on. */
    handedOver: boolean;
    preparedQueueKey: string;
    positionRevision: number;
    seekPending: boolean;
    seeking: boolean;
};

export const externalMediaShim = new MediaShim('external:');

let session: ExternalSession | null = null;
let attemptCounter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Takes a handed-over player back when the window was not replaced (`HANDOVER_RECLAIM_MS`). */
let reclaimTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * This window was asked to hand over while it was still restoring the snapshot it was handed: the
 * take-over that restore ends with lands handed over (`handOverExternalPlaybackDuringRestore`).
 */
let handOverOnAdoption = false;
let pollRunning = false;
let installed = false;
let ownWriteDepth = 0;
let failureNoted = false;
/** How many answers in a row did not come: each one pushes the next ask further out. */
let pollFailures = 0;
/** The level the player last confirmed, or null when unknown (a new start, a failed write). */
let appliedVolume: number | null = null;
/** The level of the write in flight, or null when none is: at most one is sent at a time. */
let sendingVolume: number | null = null;
/** A level asked for while a write was in flight (a slider drag); sent when that write returns. */
let wantedVolume: number | null = null;
/** Who asked for that level: a level the listener asked for is still theirs when it is sent. */
let wantedSource: ExternalVolumeSource = 'sync';
let volumeFailureNoted = false;
/** Bumped by every start: a write sent before it cannot vouch for the level after it. */
let volumeEpoch = 0;
/**
 * The start whose play the player is still taking, or null when none is: the prepared queue waits for
 * it (see `refreshPreparedQueue`).
 */
let startPendingAttempt: number | null = null;
/** When that start was asked for: how long it may hold the queue is `PREPARED_QUEUE_START_LIMIT_MS`. */
let startPendingSince = 0;
/** The over-long start already said so: one line per stuck start, not one per write it let through. */
let startPendingOverdueNoted = false;
/** Numbers the starts, so one run's summary lines are told apart by the number they carry. */
let startCounter = 0;
/** The coarser channel is told once in a run of Folia, not once per episode. */
let degradedNotified = false;
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

/**
 * Whether the player is only taken over: Folia was reopened onto a player already sounding a song
 * of its own, and the listener has not picked a song here since. The player holds what it held of
 * the listener's - the queue behind that song, the level it sounds at - and none of that was
 * written by this run, so nothing of it is changed until the listener plays a song of their own.
 */
let takeoverPending = false;

/**
 * Whether nothing of the player's own state is Folia's to change yet: it was only taken over
 * (`adoptExternalPlayback`), and no song has been started here since. Read by the queue write and
 * the level, the two things a followed player is not changed through.
 */
export const isExternalTakeoverPending = () => takeoverPending;

/** A song this app starts: from here the player's queue and level are Folia's again. */
const endTakeover = () => {
    takeoverPending = false;
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
    && session?.songKey === getPlaybackSongKey(song) && session.announced && !session.handedOver
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

/**
 * How long to wait before asking the player again after `failures` answers in a row did not come: a
 * player that stopped answering (it was closed, its page is gone) is asked ever more rarely, and one
 * answer puts the ordinary rate back.
 */
export const statusRetryDelayMs = (failures: number): number => (
    Math.min(STATUS_RETRY_INTERVAL_MS * 2 ** Math.max(0, failures - 1), STATUS_RETRY_MAX_INTERVAL_MS)
);

/**
 * How long to wait before asking this player again after an ask did not come. A player that declared
 * its answers cost it something (`backsOffStatusPolls`) is asked ever more rarely; every other player
 * keeps the app's own retry rate, as a player of its kind always did.
 */
const retryDelayFor = (current: ExternalSession, failures: number): number => (
    current.traits.backsOffStatusPolls ? statusRetryDelayMs(failures) : STATUS_RETRY_INTERVAL_MS
);

const schedulePoll = (delayMs: number) => {
    stopTimer();
    if (!session) return;
    timer = setTimeout(() => {
        timer = null;
        void poll();
    }, delayMs);
};

/**
 * The player answered one of the app's own commands (a press of the listener, the volume it sent):
 * it is there, so the next status ask is the ordinary rate again rather than the one a run of failed
 * asks pushed it out to. A listener who just pressed play must not wait up to ten seconds to hear
 * what became of it.
 */
const notePlayerAnswered = (current: ExternalSession) => {
    // Only a player whose asks are spaced out reads anything into a command it answered: everywhere
    // else the cadence is the app's own, and a command says nothing about when to ask next.
    if (!current.traits.backsOffStatusPolls) return;
    pollFailures = 0;
    // A poll already on its way arms the next ask itself; a second timer here would only replace it.
    if (!pollRunning) schedulePoll(STATUS_INTERVAL_MS);
};

const validDurationSec = (ms: number): number | null => (
    Number.isFinite(ms) && ms > 0 ? ms / 1000 : null
);

// Queue edits and repeat-mode changes invalidate the prepared tail before the next transition.
const refreshPreparedQueue = () => {
    const current = session;
    if (!current || !isExternalPlaybackReadyForPrefetch(current.song)) return;
    // The player was only taken over: what it holds behind its song was the listener's before this
    // run, and this run has not been told to hold that queue. Nothing is written into it, and
    // nothing is taken back from it, until a song of Folia's is started here.
    if (takeoverPending) return;
    // The player's page is loading the song it was just given (its play runs and polls inside that
    // page): a queue write sent now would compete with that load for the same page. The poll that
    // follows the start writes the tail instead. A player whose start answers is therefore asked
    // nothing until that start landed, as it never was; a player whose start is an instruction holds
    // the write only for as long as its page may still be loading the song.
    if (startPendingAttempt !== null && current.traits.startsWithoutWaiting
        && performance.now() - startPendingSince < PREPARED_QUEUE_START_LIMIT_MS) return;
    if (startPendingAttempt !== null && current.traits.startsWithoutWaiting && !startPendingOverdueNoted) {
        startPendingOverdueNoted = true;
        console.warn(`[ExternalPlayback] the start has not landed in ${PREPARED_QUEUE_START_LIMIT_MS / 1000}s: the prepared queue is written again`, { attempt: startPendingAttempt });
    }
    const state = usePlaybackStore.getState();
    // Repeat one: the player goes on to nothing after this song, and what an earlier write left in
    // its own queue is taken back where it can be emptied.
    const loopMode = useAudioSettingsStore.getState().loopMode;
    const retract = loopMode === 'one';
    // A player that reads its own queue ahead (only the one whose start is an instruction, the app
    // steered by its own program) is offered the three songs it may hold room for; every other player
    // is offered the two this route has always prepared, and drops what it has no room for.
    const most = current.traits.startsWithoutWaiting ? PREPARED_TAIL : PREPARED_SONGS;
    const next = externalQueueSuccessors(current.song, state.playQueue, loopMode, state.isFmMode, omni.canPlaySong, most);
    // The mode is part of the key: repeat one and the end of a queue both hand the player nothing, and
    // the second one has nothing to take back.
    const key = JSON.stringify([next.map(getPlaybackSongKey), retract]);
    if (current.preparedQueueKey === key) return;
    current.preparedQueueKey = key;
    // Only repeat one asks for a take-back: every other call is the plain one, with no options to read.
    const preparation = omni.prepareExternalPlaybackQueue(current.song, next, retract ? { retract: true } : undefined);
    void preparation.catch((error: unknown) => {
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
    // Read before `playing` is cleared: it is true only once the player itself said it was sounding
    // this song, so an end without it is not that song's end (see `ExternalPlaybackEvent`).
    const heard = session.playing;
    session.playing = false;
    syncClock(positionSec, true, performance.now(), false);
    externalMediaShim.markEnded();
    setPlayerState(PlayerState.PAUSED);
    const skipped = session.skipped;
    session.skipped = undefined;
    emit(skipped ? { type: 'ended', skipped, heard } : { type: 'ended', heard });
    emit({ type: 'status' });
};

const applyStatus = (status: ProviderExternalPlaybackStatus, sampledAtMs: number) => {
    if (!session || session.handedOver) return;
    const current = session;
    const positionSec = status.positionMs / 1000;
    // A late completion belonging to the previous song cannot fill or finish the new session.
    if (!current.announced && !status.mediaId) return;
    // Told before the song is on screen too: the fallback is about the player rather than the track.
    const degraded = status.degraded === true;
    if (degraded !== current.degraded) {
        current.degraded = degraded;
        // Said once in a run of Folia: a player that drops to its coarse channel and back all
        // evening must not say so all evening.
        if (degraded && !degradedNotified) {
            degradedNotified = true;
            emit({ type: 'degraded', active: true });
        }
    }
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
    if (status.ended && status.skipped) current.skipped = status.skipped;
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
    if (!current || current.handedOver || pollRunning || !isExternalRoute()) return;
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
        pollFailures = 0;
    } catch (error) {
        // Handed over meanwhile: a failed answer says nothing this window acts on either.
        if (session !== current || current.handedOver || !isExternalRoute() || current.positionRevision !== positionRevision) return;
        pollFailures += 1;
        delay = retryDelayFor(current, pollFailures);
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
        if (session === current && !current.handedOver && isExternalRoute()) schedulePoll(delay);
    }
}

/** The app's own volume as a linear level for the external player: muted is 0. */
const settingsVolume = () => {
    const { volume, isMuted } = useAudioSettingsStore.getState();
    return isMuted ? 0 : Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
};

/**
 * Who asks for the level: the app following its own stored volume, or the listener moving the
 * slider or pressing a volume key here. A player that was only taken over keeps the listener's own
 * level, so the first is held back until a song of Folia's is started; the second is the listener
 * asking for it in Folia, and is passed on.
 */
export type ExternalVolumeSource = 'sync' | 'user';

/**
 * Hands the player its output level. Its audio never passes through the app's gain node, so the
 * volume slider and mute reach it only this way. Writes are coalesced: a drag sends one at a time
 * and the newest level when the last one returns. `level` defaults to the stored volume.
 */
export function setExternalPlaybackVolume(level = settingsVolume(), source: ExternalVolumeSource = 'sync'): void {
    const current = session;
    if (!current || !isExternalRoute()) return;
    // The player was only taken over: the level it sounds at is the listener's own, set in the
    // player's window, and a take-over does not put Folia's over it. A start of Folia's own does,
    // and so does the listener moving the level here: that is their own action, taken in Folia.
    if (takeoverPending && source === 'sync') return;
    if (sendingVolume !== null) {
        wantedVolume = level;
        wantedSource = source;
        return;
    }
    wantedVolume = null;
    if (appliedVolume === level) return;
    sendingVolume = level;
    const epoch = volumeEpoch;
    void omni.setExternalPlaybackVolume(current.song, level).then(() => {
        if (epoch !== volumeEpoch) return;
        appliedVolume = level;
        volumeFailureNoted = false;
        if (session === current) notePlayerAnswered(current);
    }, error => {
        appliedVolume = null;
        if (!volumeFailureNoted) {
            volumeFailureNoted = true;
            console.warn('[ExternalPlayback] the player volume could not be set', error);
        }
    }).finally(() => {
        sendingVolume = null;
        // Only a level asked for meanwhile is sent: a failed write is not repeated on its own.
        const next = wantedVolume;
        const nextSource = wantedSource;
        wantedVolume = null;
        wantedSource = 'sync';
        if (next !== null) setExternalPlaybackVolume(next, nextSource);
    });
}

/** A slider drag or a volume key: the level the listener is moving to, heard from the external player. */
export function previewExternalPlaybackVolume(volume: number): void {
    if (!isExternalRoute()) return;
    setExternalPlaybackVolume(useAudioSettingsStore.getState().isMuted ? 0 : Math.min(1, Math.max(0, volume)), 'user');
}

/**
 * Whether two songs play in the same external player. Each provider steers a player of its own, so
 * a song of another provider never replaces the track sounding in this one.
 */
const playsInSamePlayer = (a: SongResult, b: SongResult) => getOnlineProviderIdForSong(a) === getOnlineProviderIdForSong(b);

/**
 * Where a start spent its time, in milliseconds, as the summary line reports it. The parts the caller
 * knows (what the interface showed) are written here by the caller, against `askedAt`.
 */
export type ExternalStartTimings = {
    /** From the ask to the session and the route being ready. */
    prepareMs: number;
    /**
     * The player taking the song, as the one call the provider makes: the page probe it needs first
     * (`client_probe`) and the play itself (`client_play`). Timed as one because the probe is the
     * provider's to make, inside its own start.
     */
    playMs: number | null;
    /** The one status read after the start, which the clock is seeded with. */
    statusMs: number | null;
    /** Until the song's lyrics were known. */
    lyricsMs: number | null;
    /** Until the song was on screen. */
    visibleMs: number | null;
    /** Until the cover was known. */
    coverMs: number | null;
};

/** A start already under way: the session and the route are ready, the player is loading the song. */
export type ExternalPlaybackStart = {
    /** Which start this is: every one bumps it, so an older one knows it was overtaken. */
    attempt: number;
    /** `performance.now()` the start was asked at: the origin every timing is measured from. */
    askedAt: number;
    /**
     * The player taking the song. Resolves once it has it, or once a newer start took the song over;
     * rejects where the player would not play it, after the route has been given back.
     */
    started: Promise<void>;
    /** The status read after the start, waited for only by a caller that shows nothing until then. */
    seeded: Promise<void>;
    /**
     * Resolves once the song may be shown: at once where the player's start is an instruction
     * (`startsWithoutWaiting`, an answer that says nothing dependable about the player), and once the
     * player has the song and the clock is seeded everywhere else - a player whose start answers is
     * shown only after it answered, as it always was. It never rejects: `started` carries the failure.
     */
    waited: Promise<void>;
    /** Where the start spent its time, filled in as it goes. */
    timings: ExternalStartTimings;
};

/**
 * One line for every start: the times that make a switch feel slow, read back afterwards. The number
 * counts the starts of the run, so a start is found in the log by it; a part that never landed (the
 * start failed before it, or the song was replaced) is a dash.
 */
const writeStartSummary = (seq: number, askedAt: number, timings: ExternalStartTimings, failed: boolean): void => {
    const ms = (value: number | null) => (value === null ? '-' : `${Math.round(value)}ms`);
    const total = Math.round(performance.now() - askedAt);
    console.info(`[Playback] external start ${total}ms #${seq} visible ${ms(timings.visibleMs)} prepare ${ms(timings.prepareMs)} play ${ms(timings.playMs)} status ${ms(timings.statusMs)} lyrics ${ms(timings.lyricsMs)} cover ${ms(timings.coverMs)}${failed ? ' failed' : ''}`);
};

/**
 * Starts a track in the external player and puts the app on that route. `userAction` is false only
 * for an advance Folia made by itself: that one may not wake or restart the player.
 *
 * This returns as soon as the session and the route are ready: the player takes 0.6-2.5s to load the
 * song (longer while a free account is shown an advertisement), and the caller has the song's name,
 * lyrics and cover to show without it (see `ExternalPlaybackStart`).
 */
export function startExternalPlayback(song: SongResult, startSec = 0, { userAction = true, replaceQueue = false }: { userAction?: boolean; replaceQueue?: boolean } = {}): ExternalPlaybackStart {
    const askedAt = performance.now();
    // A song this app starts: the player's queue and level are Folia's from here, even where it was
    // only taken over a moment ago.
    endTakeover();
    if (isExternalRoute()) {
        // Already on the route: within the same player replacing the track is one call, and the old
        // clock must not speak for the new song while it does. A song of another provider starts in
        // another player, which leaves the old one sounding: that one is stopped first.
        if (session && !playsInSamePlayer(session.song, song)) stopExternalPlayback('another player takes the song');
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
    // What this song's provider declared: a start that is no answer at all, asks that space themselves
    // out. Every other player keeps the app's own waiting and cadence.
    const traits = omni.externalPlaybackTraits(song);
    session = {
        song, songKey, attempt, clock, durationSec, traits,
        announced: false, playing: false, starting: false, sampledPosition: Math.max(0, startSec), prefetchReady: false, live: false, ended: false, foreign: false,
        degraded: false, handedOver: false, preparedQueueKey: '', positionRevision: 0, seekPending: false, seeking: false,
    };
    failureNoted = false;
    pollFailures = 0;
    externalMediaShim.beginTrack(songKey);
    withoutRouteGuard(() => {
        setAudioSrc(null);
        setPlaybackRoute('external');
    });
    emit({ type: 'status' });
    // The player's page may have been replaced since the last song: set its level again before it
    // sounds. Playback commands reach the page in order, so this lands before the start.
    volumeEpoch += 1;
    appliedVolume = null;
    volumeFailureNoted = false;
    setExternalPlaybackVolume();
    startPendingAttempt = attempt;
    startPendingSince = askedAt;
    startPendingOverdueNoted = false;
    const seq = ++startCounter;
    const timings: ExternalStartTimings = {
        prepareMs: performance.now() - askedAt, playMs: null, statusMs: null, lyricsMs: null, visibleMs: null, coverMs: null,
    };
    const playAskedAt = performance.now();
    let failed = false;
    // The one status read after the start, held here so the waiting form below lets it land.
    let seed: Promise<void> = Promise.resolve();
    const started = (async () => {
        try {
            await omni.playSongExternally(song, Math.max(0, startSec), {
                userAction,
                ...(replaceQueue ? { replaceQueue: true } : {}),
            });
        } catch (error) {
            timings.playMs = performance.now() - playAskedAt;
            failed = true;
            if (session?.attempt === attempt) {
                stopExternalPlayback('the player refused the song');
                // Nothing is sounding there: the next song's play decides its own route.
                withoutRouteGuard(() => setPlaybackRoute('web'));
            }
            throw error;
        }
        timings.playMs = performance.now() - playAskedAt;
        if (session?.attempt !== attempt || !isExternalRoute()) {
            // Overtaken while the player was starting it. A newer song in the same player replaces it
            // there; otherwise the stop sent when it was overtaken may have reached the player before
            // this start did, and the track would sound with nobody following it: it is stopped again.
            if (!session || !playsInSamePlayer(session.song, song)) {
                void omni.pauseExternalPlayback(song).catch(error => {
                    console.warn('[ExternalPlayback] an overtaken start could not be stopped', error);
                });
            }
            return;
        }
        // The level sent ahead may have landed on a page the companion then replaced (it moves to the
        // account's storefront between requests): once the player has the song, send the level again.
        volumeEpoch += 1;
        appliedVolume = null;
        setExternalPlaybackVolume();
        // The incoming clock is seeded from what the player has, without waiting for the answer: the
        // poll that follows asks the same question half a second later, so waiting here only holds
        // whoever asked for the start.
        const seededAt = performance.now();
        const positionRevision = session.positionRevision;
        seed = omni.getExternalPlaybackStatus(song).then(status => {
            timings.statusMs = performance.now() - seededAt;
            if (session?.attempt === attempt && session.positionRevision === positionRevision && !session.seekPending && isExternalRoute()) applyStatus(status, seededAt);
        }, error => {
            timings.statusMs = performance.now() - seededAt;
            console.warn('[ExternalPlayback] Initial player status unavailable', error);
        });
        schedulePoll(STATUS_INTERVAL_MS);
    })();
    // The queue may be written again once this start lands, whether it took the song or not.
    started.finally(() => {
        if (startPendingAttempt === attempt) startPendingAttempt = null;
    }).catch(() => undefined);
    const seeded = started.then(() => seed, () => undefined);
    // Written once the whole start is over, so the one line carries every part of it.
    void seeded.then(() => writeStartSummary(seq, askedAt, timings, failed));
    // A player whose start answers is shown only after it answered, which is the wait this has always
    // taken; one whose start is an instruction is shown at once. A start that fails hands the play
    // path nowhere to go either way, so the failure stays `started`'s to report.
    const waited = traits.startsWithoutWaiting ? Promise.resolve() : seeded;
    return { attempt, askedAt, started, seeded, waited, timings };
}

/**
 * The waiting form of a start, for a caller that shows nothing until the player has the song: it
 * resolves once the player has it and the clock is seeded, and rejects where the player would not
 * play it. The play path of the app does not wait for a start (see `startExternalPlayback`).
 */
export async function beginExternalPlayback(song: SongResult, startSec = 0, options: { userAction?: boolean; replaceQueue?: boolean } = {}): Promise<void> {
    const start = startExternalPlayback(song, startSec, options);
    await start.started;
    await start.seeded;
}

/**
 * Takes over a track the player is already sounding (a window rebuild hands the song over; the
 * player outlives the window). The player is asked once: with `song` loaded, the route becomes the
 * external one, the clock and the polling attach to it and it is announced as it stands, playing or
 * paused. With another track or none, nothing is taken and the caller shows the song as it would
 * after a restart: paused. Never starts the player.
 */
export async function adoptExternalPlayback(song: SongResult): Promise<boolean> {
    installExternalPlayback();
    if (!omni.canPlayExternally(song)) return false;
    stopTimer();
    // The player is followed as it stands: what it holds behind this song and the level it sounds
    // at are the listener's, not this run's, until a song is started here (`takeoverPending`).
    takeoverPending = true;
    const attempt = ++attemptCounter;
    const songKey = getPlaybackSongKey(song);
    const durationSec = validDurationSec(song.durationMs) ?? null;
    const clock = createExternalClock();
    clock.setDuration(durationSec);
    clock.sync({ positionSec: 0, paused: true });
    session = {
        song, songKey, attempt, clock, durationSec,
        announced: false, playing: false, starting: false, sampledPosition: null, prefetchReady: false, live: false, ended: false, foreign: false,
        degraded: false, traits: omni.externalPlaybackTraits(song), handedOver: false, preparedQueueKey: '', positionRevision: 0, seekPending: false, seeking: false,
    };
    failureNoted = false;
    externalMediaShim.beginTrack(songKey);
    withoutRouteGuard(() => {
        setAudioSrc(null);
        setPlaybackRoute('external');
    });
    const sampledAt = performance.now();
    let status: ProviderExternalPlaybackStatus | null = null;
    try {
        status = await omni.getExternalPlaybackStatus(song);
    } catch (error) {
        console.warn('[ExternalPlayback] the player could not be asked what it has', error);
    }
    if (session?.attempt !== attempt) return false;
    if (!status?.mediaId || !omni.isExternalPlaybackStatusForSong(song, status)) {
        // Not the song: the route goes back to the app's engine. What the player has (another track
        // the old window's queue moved it to, or nothing) is nobody's now; the caller stops it.
        session = null;
        // Nothing was taken over, so nothing of the player's is being followed.
        takeoverPending = false;
        externalMediaShim.reset();
        withoutRouteGuard(() => setPlaybackRoute('web'));
        emit({ type: 'status' });
        console.info('[ExternalPlayback] the player has no track to take over', { songKey, hasTrack: Boolean(status?.mediaId) });
        return false;
    }
    omni.adoptExternalPlayback(song);
    // The level it sounds at was set by the window that is gone; said again so it is known here.
    volumeEpoch += 1;
    appliedVolume = null;
    volumeFailureNoted = false;
    setExternalPlaybackVolume();
    applyStatus(status, sampledAt);
    announceExternalPlayback();
    if (session?.attempt !== attempt || !isExternalRoute()) return true;
    // Announcing shows a playing player; a paused one is said here rather than on the next answer.
    if (!session.playing && !session.ended) markPaused(session.clock.read());
    if (handOverOnAdoption) {
        // The window replacing this one has the snapshot and takes the player; shown here as it sounds,
        // not followed, and taken back with the reclaim if that window never came.
        handOverOnAdoption = false;
        session.handedOver = true;
        console.info('[ExternalPlayback] took the player over already handed on to the next window', { songKey });
        return true;
    }
    schedulePoll(STATUS_INTERVAL_MS);
    console.info('[ExternalPlayback] took the running player over', { songKey, playing: status.isPlaying });
    return true;
}

const stopReclaimTimer = () => {
    if (reclaimTimer !== null) clearTimeout(reclaimTimer);
    reclaimTimer = null;
};

const startReclaimTimer = () => {
    stopReclaimTimer();
    reclaimTimer = setTimeout(() => {
        reclaimTimer = null;
        reclaimExternalPlayback('the window was not replaced');
    }, HANDOVER_RECLAIM_MS);
};

/**
 * This window is about to be replaced and has handed its playback over (the snapshot is taken):
 * the player sounds on for the next window to adopt. Polling stops and the answers already in
 * flight are not acted on, so a track ending or changing meanwhile moves nothing here. The player
 * itself is not touched. A window still here `HANDOVER_RECLAIM_MS` later takes it back.
 */
export function handOverExternalPlayback(): void {
    const current = session;
    if (!current) return;
    stopTimer();
    current.handedOver = true;
    startReclaimTimer();
    console.info('[ExternalPlayback] handed the player over to the next window', { songKey: current.songKey });
}

/**
 * This window is replaced before it finished restoring the snapshot it was handed, and passes that
 * snapshot on as it came: the player goes on to the next window with it. A take-over already done is
 * handed over now; one still on its way, or not begun yet, lands handed over. Either way this window
 * takes the player back `HANDOVER_RECLAIM_MS` later if it was not replaced.
 */
export function handOverExternalPlaybackDuringRestore(): void {
    if (session?.announced) {
        handOverExternalPlayback();
        return;
    }
    handOverOnAdoption = true;
    startReclaimTimer();
    console.info('[ExternalPlayback] handing the player on before taking it over: the window is replaced while it restores');
}

/**
 * The rebuild the playback was handed over for did not happen (refused, given up): the player is
 * this window's again, and it is followed from its next answer on, an end or another track included.
 */
export function reclaimExternalPlayback(reason: string): void {
    stopReclaimTimer();
    handOverOnAdoption = false;
    const current = session;
    if (!current?.handedOver) return;
    current.handedOver = false;
    console.info('[ExternalPlayback] took the player back: the window was not replaced', { reason, songKey: current.songKey });
    if (isExternalRoute()) schedulePoll(0);
}

/**
 * A handed-over song this window did not take over (another song was asked for first, its restore
 * failed, or the player had something else): the player is nobody's, so it is stopped. Nothing
 * happens while an external session of the same player is live here: the player is that session's
 * then. A session in another provider's player leaves this one nobody's all the same.
 */
export function releaseUnclaimedExternalTrack(song: SongResult, reason: string): void {
    if (!omni.canPlayExternally(song)) return;
    if (isExternalRoute() && session && playsInSamePlayer(session.song, song)) return;
    console.info('[ExternalPlayback] stopping the player nobody took over', { reason, songKey: getPlaybackSongKey(song) });
    void omni.pauseExternalPlayback(song).catch(error => {
        console.warn('[ExternalPlayback] the player nobody took over could not be paused', error);
    });
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
    // No page of a session that is gone is loading anything for this app.
    startPendingAttempt = null;
    // What was only taken over is nobody's from here: the next song starts from nothing.
    takeoverPending = false;
    stopTimer();
    stopReclaimTimer();
    handOverOnAdoption = false;
    session = null;
    externalMediaShim.reset();
    if (!current) return;
    emit({ type: 'status' });
    console.info('[ExternalPlayback] left the external player', { reason, songKey: current.songKey });
    // Stopped even when handed over: nothing of a window's teardown comes here, only a listener's
    // stop or another song in this window, and a window that was not replaced after all would
    // otherwise leave the player sounding with nobody to stop it.
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
    void omni.pauseExternalPlayback(current.song).then(() => {
        // The player took the command: it is there.
        if (session === current) notePlayerAnswered(current);
    }, error => {
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
    void omni.resumeExternalPlayback(current.song).then(() => {
        // The press reached the player.
        if (session === current) notePlayerAnswered(current);
    }, error => {
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
        if (state.volume !== previous.volume || state.isMuted !== previous.isMuted) setExternalPlaybackVolume();
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
