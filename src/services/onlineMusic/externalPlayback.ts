import type { ProviderExternalPlaybackStatus } from '../../types/onlineMusic';
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
/** How far a position answer may be extrapolated, as `hifiClock` does. */
const MAX_SAMPLE_AGE_SEC = 1;
/** A player that stopped this close to the length has finished the track. */
const END_TOLERANCE_SEC = 0.75;
/**
 * Under the player's own single repeat, a playing answer this close to the start after one this
 * close to the end is the track going round again (answers are half a second apart; Soloist's own
 * end reading allows 2.5 s), not a seek of the listener's: those are sent from here and fenced off.
 */
const REPEAT_WRAP_SLACK_SEC = 3;
/**
 * A window that handed its player over is destroyed once its replacement shows, a second or two
 * later. Still here after this long, it was not replaced (the main process refused or gave up the
 * rebuild): it follows the player again.
 */
const HANDOVER_RECLAIM_MS = 10_000;

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
/** The level the player last confirmed, or null when unknown (a new start, a failed write). */
let appliedVolume: number | null = null;
/** The level of the write in flight, or null when none is: at most one is sent at a time. */
let sendingVolume: number | null = null;
/** A level asked for while a write was in flight (a slider drag); sent when that write returns. */
let wantedVolume: number | null = null;
let volumeFailureNoted = false;
/** Bumped by every start: a write sent before it cannot vouch for the level after it. */
let volumeEpoch = 0;
/** The single repeat last sent to the player, or null when unknown (a new start, a failed write). */
let appliedRepeatOne: boolean | null = null;
/** A failed repeat write is tried again on each answer; it is said once until one succeeds. */
let repeatFailureNoted = false;
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

/** Single loop, outside Personal FM (which never repeats a song): the track plays again rather than the queue moving on. */
const loopsCurrentTrack = () => (
    useAudioSettingsStore.getState().loopMode === 'one' && !usePlaybackStore.getState().isFmMode
);

// Single loop where the player did not go round by itself (it has no `setRepeatOne`, or the repeat
// did not take): the track that ended is started again from its start in the same player, as
// <audio loop> does on the web route; the queue is never told. Started anew rather than sought
// back: a player that finished a track may no longer hold it (Soloist goes on to a track of its
// own, MusicKit's queue is over). Answers sampled before the restart are dropped by the revision.
const replayEndedTrack = (current: ExternalSession) => {
    const revision = ++current.positionRevision;
    current.ended = false;
    // Still playing as far as the transport goes: a pause pressed while the restart lands is a
    // pause (both players take it after the start), not a resume of a player shown as playing.
    current.playing = true;
    current.seekPending = true;
    current.prefetchReady = false;
    current.sampledPosition = null;
    current.clock.sync({ positionSec: 0, paused: true, holdBackward: false });
    externalMediaShim.markSeeked();
    console.info('[ExternalPlayback] single loop: the track starts again', { songKey: current.songKey });
    void omni.playSongExternally(current.song, 0).then(() => {
        // A start may have put the player's own repeat back to off (MusicKit's does): sent again.
        if (session !== current) return;
        appliedRepeatOne = null;
        syncExternalRepeatOne();
    }, (error: unknown) => {
        if (session !== current || current.positionRevision !== revision) return;
        console.warn('[ExternalPlayback] the track could not be started again for single loop', error);
        // Left ended and paused at its end: the player may go on answering "ended", and that must
        // not start it again (and say so again) every half second. Play from the listener restarts it.
        markPaused(current.durationSec ?? 0);
        current.ended = true;
        emit({ type: 'failure', error });
    }).finally(() => {
        if (session === current && current.positionRevision === revision) current.seekPending = false;
    });
};

/**
 * Hands the player its own single repeat when it has one (`setRepeatOne`), as the hifi route sets
 * mpv's loop-file: the player then goes round by itself with no gap. Sent on every start and on
 * every change of the loop mode or of Personal FM; a player without it is left to `replayEndedTrack`.
 */
function syncExternalRepeatOne(): void {
    const current = session;
    if (!current || current.handedOver || !isExternalRoute()) return;
    const wanted = loopsCurrentTrack();
    if (appliedRepeatOne === wanted) return;
    appliedRepeatOne = wanted;
    void omni.setExternalPlaybackRepeatOne(current.song, wanted).then(() => {
        repeatFailureNoted = false;
    }, (error: unknown) => {
        // Unknown again: the next answer from the player sends it again (see poll).
        if (appliedRepeatOne === wanted) appliedRepeatOne = null;
        if (!repeatFailureNoted) {
            repeatFailureNoted = true;
            console.warn('[ExternalPlayback] the player single repeat could not be set', error);
        }
    });
}

const markEnded = (positionSec: number) => {
    if (!session || session.ended) return;
    if (loopsCurrentTrack()) {
        replayEndedTrack(session);
        return;
    }
    session.ended = true;
    session.playing = false;
    syncClock(positionSec, true, performance.now(), false);
    externalMediaShim.markEnded();
    setPlayerState(PlayerState.PAUSED);
    emit({ type: 'ended' });
    emit({ type: 'status' });
};

const applyStatus = (status: ProviderExternalPlaybackStatus, sampledAtMs: number) => {
    if (!session || session.handedOver) return;
    const current = session;
    const positionSec = status.positionMs / 1000;
    const previousSample = current.sampledPosition;
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
    // The player was told to repeat the track and stops for a moment at its start right after it
    // was heard near the end: MusicKit goes round so (playing, then stopped with no item for one
    // answer, then playing from the start: seen 2026-11-11). That is the track going round, not a
    // pause of the listener's; a stop that lasts is a pause on the next answer (no sample then).
    const durationKnown = current.durationSec;
    if (!status.isPlaying && !status.ended && appliedRepeatOne === true && loopsCurrentTrack() && current.playing
        && durationKnown !== null && previousSample !== null && previousSample >= durationKnown - REPEAT_WRAP_SLACK_SEC
        && positionSec < REPEAT_WRAP_SLACK_SEC) {
        console.info('[ExternalPlayback] single loop: the player is going round', { songKey: current.songKey });
        syncClock(positionSec, false, sampledAtMs, false);
        externalMediaShim.markSeeked();
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
        // The player's own single repeat went round: from near the end to near the start. Soloist
        // buffers as it goes round, so the answer before may have been a buffering one (shown as
        // loading, `playing` false): then the clock, held where it was, says where it came from.
        const cameFromSec = current.playing ? previousSample : current.clock.read();
        const wentRound = loopsCurrentTrack() && durationSec !== null && cameFromSec !== null
            && cameFromSec >= durationSec - REPEAT_WRAP_SLACK_SEC && positionSec < REPEAT_WRAP_SLACK_SEC;
        if (wentRound) {
            // The clock goes back with it, and the observers hear a seek, as <audio loop> fires one
            // when it goes round.
            console.info('[ExternalPlayback] single loop: the player went round', { songKey: current.songKey });
            if (current.playing) syncClock(positionSec, false, sampledAtMs, false);
            else markPlaying(positionSec);
            externalMediaShim.markSeeked();
            emit({ type: 'status' });
        } else if (!current.playing) {
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
        // A repeat write that failed (or was skipped while handed over) is sent again.
        if (appliedRepeatOne === null) syncExternalRepeatOne();
    } catch (error) {
        // Handed over meanwhile: a failed answer says nothing this window acts on either.
        if (session !== current || current.handedOver || !isExternalRoute() || current.positionRevision !== positionRevision) return;
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
        if (session === current && !current.handedOver && isExternalRoute()) schedulePoll(delay);
    }
}

/** The app's own volume as a linear level for the external player: muted is 0. */
const settingsVolume = () => {
    const { volume, isMuted } = useAudioSettingsStore.getState();
    return isMuted ? 0 : Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
};

/**
 * Hands the player its output level. Its audio never passes through the app's gain node, so the
 * volume slider and mute reach it only this way. Writes are coalesced: a drag sends one at a time
 * and the newest level when the last one returns. `level` defaults to the stored volume.
 */
export function setExternalPlaybackVolume(level = settingsVolume()): void {
    const current = session;
    if (!current || !isExternalRoute()) return;
    if (sendingVolume !== null) {
        wantedVolume = level;
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
        wantedVolume = null;
        if (next !== null) setExternalPlaybackVolume(next);
    });
}

/** A slider drag: the level being dragged to, heard from the external player when it is the route. */
export function previewExternalPlaybackVolume(volume: number): void {
    if (!isExternalRoute()) return;
    setExternalPlaybackVolume(useAudioSettingsStore.getState().isMuted ? 0 : Math.min(1, Math.max(0, volume)));
}

/**
 * Whether two songs play in the same external player. Each provider steers a player of its own, so
 * a song of another provider never replaces the track sounding in this one.
 */
const playsInSamePlayer = (a: SongResult, b: SongResult) => getOnlineProviderIdForSong(a) === getOnlineProviderIdForSong(b);

/** Starts a track in the external player and puts the app on that route. */
export async function beginExternalPlayback(song: SongResult, startSec = 0): Promise<void> {
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
    session = {
        song, songKey, attempt, clock, durationSec,
        announced: false, playing: false, starting: false, sampledPosition: Math.max(0, startSec), prefetchReady: false, live: false, ended: false, foreign: false, handedOver: false, preparedQueueKey: '', positionRevision: 0, seekPending: false, seeking: false,
    };
    failureNoted = false;
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
    // Its single repeat too, for the same reasons; sent again below once it has the song.
    appliedRepeatOne = null;
    syncExternalRepeatOne();
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
    appliedRepeatOne = null;
    syncExternalRepeatOne();
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
    const attempt = ++attemptCounter;
    const songKey = getPlaybackSongKey(song);
    const durationSec = validDurationSec(song.durationMs) ?? null;
    const clock = createExternalClock();
    clock.setDuration(durationSec);
    clock.sync({ positionSec: 0, paused: true });
    session = {
        song, songKey, attempt, clock, durationSec,
        announced: false, playing: false, starting: false, sampledPosition: null, prefetchReady: false, live: false, ended: false, foreign: false, handedOver: false, preparedQueueKey: '', positionRevision: 0, seekPending: false, seeking: false,
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
    appliedRepeatOne = null;
    syncExternalRepeatOne();
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
    // The loop mode may have changed while it was handed over: its repeat is said again.
    appliedRepeatOne = null;
    syncExternalRepeatOne();
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
    // Its own repeat is not left on behind Folia (Soloist is a Connect device other apps may play to).
    if (appliedRepeatOne === true) {
        void omni.setExternalPlaybackRepeatOne(current.song, false).catch((error: unknown) => {
            console.warn('[ExternalPlayback] the player single repeat could not be turned off as the route is left', error);
        });
    }
    appliedRepeatOne = null;
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
        if (state.loopMode !== previous.loopMode) {
            refreshPreparedQueue();
            syncExternalRepeatOne();
        }
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
        if (state.isFmMode !== previous.isFmMode) syncExternalRepeatOne();
    });
};

// The observation layer asks this route for its shim; registering it at load keeps that answer
// ready before React mounts anything.
setExternalRouteMedia(() => isExternalPlaybackSounding() ? externalMediaShim : null);
