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
/**
 * How near the line the song stood on before a move a read has to be to be that line rather than
 * where the player went: a read is taken a moment late, and a line that stood still is read from
 * either side of the second it stood on.
 */
const STALE_READ_TOLERANCE_SEC = 1;
/**
 * How long a playing song goes on giving up reads that still name the line it stood on before a move.
 * A player that never loads the spot the bar was dropped on must not hold the bar off its own line
 * for good, so past this the player's own word stands.
 */
const STALE_READ_PLAYING_LIMIT_MS = 5000;
/**
 * How far apart the spot the bar was dropped on and the line the song stood on have to be for a read
 * to be told from the other. Nearer than this a read could be either, so none of them is given up.
 */
const SEEK_TARGET_APART_SEC = 2;

export type ExternalPlaybackEvent =
    | { type: 'status' }
    // `skipped`: the player was moved off the song by its own controls, not by its end.
    // `heard`: the player confirmed playing this very song at some point, so the end is that song's
    // own end. A song whose start never landed can report an end without ever having sounded.
    | { type: 'ended'; skipped?: 'next' | 'previous'; heard?: boolean }
    | { type: 'failure'; error: unknown }
    | { type: 'foreign-track' }
    // A player whose listener changes what it plays from its own window moved on to a track Folia
    // did not ask for: that track is taken over by the bridge, and this session ends with it.
    | { type: 'track-changed'; status: ProviderExternalPlaybackStatus }
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
    /**
     * What the player is known to hold of its own repeat of the track: true and false for the values
     * it answered with, null for one nobody knows - never asked, or asked and not answered. A value
     * only becomes known from the player's own account of it, so a write that timed out, failed or
     * was answered with the other value is asked again on the next trigger rather than being taken
     * as the value it asked for.
     */
    trackRepeat: boolean | null;
    /**
     * This session has written the player's repeat at least once: what the player holds may be a
     * value of Folia's even where the answer never came, so turning it off is a real ask rather
     * than one made for a value the start itself left as the listener had it.
     */
    trackRepeatAsked: boolean;
    /**
     * A write of that repeat is on its way: what the player holds is unknown until it answers, so a
     * trigger that lands meanwhile waits for that answer rather than asking twice for one setting.
     */
    trackRepeatPending: boolean;


    /** The player now belongs to the window replacing this one: answers are no longer acted on. */
    /** How many moves the listener has asked for: an ask that names the timeline before one of
     * them, or that lands while one is on its way, is dropped rather than followed. */
    seekCount: number;
    /** An answer naming the spot a move landed on has been followed: the move is done with. */
    seekLanded: boolean;
    /**
     * The spot a move landed on, in seconds, with the moment it landed: the player is asked every
     * tenth of a second until an answer names it, so the wait is not the ordinary half second.
     * Null while no move is being looked for.
     */
    seekFollowAtSec: number | null;
    seekFollowLandedMs: number;
    /**
     * The last answer said the player turned its own song round. The turn is one jump in the song
     * whoever reads it, so the observers are told once however many answers name it.
     */
    replaying: boolean;
    handedOver: boolean;
    preparedQueueKey: string;
    /**
     * How many moves the listener has asked for: an ask for the position that was already on its way
     * when one of them was made names the timeline before it, so its answer is dropped rather than
     * followed. Counted rather than stamped before the ask: the move lands while that ask is out, and a
     * stamp taken before it would drop the ask that follows too, which is the answer that says where
     * the player is after the move. One counter serves both asks, the poll's and the start's seed: every
     * move replaces the same timeline.
     */
    positionRevision: number;
    seekPending: boolean;
    /**
     * Where the player stood before the first move that is still in flight, in seconds: a move asked
     * for on top of one the player has not taken yet is sent from that same spot, so a refusal of it
     * takes the bar back there rather than to the target the move it replaced was sent from. Null
     * while no move is in flight.
     */
    seekBeforeSec: number | null;
    seeking: boolean;
    /**
     * A move landed and no answer has reported the player's position since: the next playing answer
     * says where the player is now, not where a tick that arrived late says it was, so it is followed
     * even where it is a little behind the spot the listener dropped the bar on.
     */
    afterSeek: boolean;
    /**
     * Where that move was sent, in seconds, with the moment it landed, and the line the song stood
     * on before it: the answers that follow name that line until the player has loaded the spot. Null
     * while no move has just landed.
     */
    seekSettledAtSec: number | null;
    /**
     * The line the song stood on before that move, in seconds: a read naming it is not where the song
     * is now. Sent from the player's own last word where it gave one, since that is the line it is on.
     */
    seekSettledFromSec: number | null;
    /** When that move landed: how late the reads it gives up are is said in the log against it. */
    seekSettledLandedMs: number;
    /** When that move was asked for: the old line runs on from the moment the song left that spot. */
    seekSettledAskedMs: number;
    /** The last reading this line was given: said in the log, never what the next read is told from. */
    staleReadAtSec: number | null;
    /**
     * The moment the line the song stood on started running on from where it stood: the move was asked
     * for, or the song was set going again after the bar was dropped on it stopped. Null while the song
     * is not sounding, so a stopped one stands on that spot with no line of its own running.
     */
    staleReadRunningSinceMs: number | null;
    /** A read of the old line was given up for this move: the bar was running ahead of the player. */
    staleReadGivenUp: boolean;
    /** How far the bar ran ahead of the spot the player landed on, in seconds: held until it catches up. */
    landingHoldSec: number | null;
    /**
     * Until when, in performance.now() terms, a lead the bar ran up over the spot the player lands on is
     * played out at the slower speed rather than stood still on: the move's own limit from the moment it
     * landed. Past it a lead is held as any other one is.
     */
    moveHeldUntilMs: number;
    /**
     * The moment the song was last sounding while a read of the line was given up: how long a playing
     * song goes on holding the line is counted from it, so a stopped song has no such time running.
     */
    staleReadPlayingSinceMs: number | null;
    /** The line this move's own log line has been written: one per move, not one per read given up. */
    staleReadNoted: boolean;
    /** The player's own last word on where its song stands, in seconds: the line it is on before a move. */
    lastPlayerPositionSec: number | null;
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

/**
 * Whether the song on screen is in repeat one as the app's own settings read it: repeat one is on
 * and nothing else decides where the song goes next. Personal FM is that other thing: it always goes
 * on to the station's next song, so a repeat one picked before it does not hold the song, and a
 * player that would repeat it by itself would never let the station move on.
 */
const isRepeatOneSong = (): boolean => (
    useAudioSettingsStore.getState().loopMode === 'one' && !usePlaybackStore.getState().isFmMode
);

/**
 * Repeat one, carried out by the player's own repeat of the track where it has one: the player then
 * sounds the song again by itself, so no start is asked for at its end and nothing of the songs that
 * follow is written into its queue. Only a song of Folia's that sounds now asks for it: a player that
 * was merely taken over is the listener's, and leaving this way of playing puts back what was found.
 * A player that declared no repeat of its own is not asked, and repeat one stays the app's replay.
 *
 * What the player holds is only ever its own answer: a write moves the record to what the answer
 * says it holds now - the track for an on, anything but the track for an off - and a write that
 * failed or was never answered leaves it unknown, so the next trigger asks again instead of leaving
 * a song repeating where nothing repeats it, or stepping past a repeat that is still on.
 *
 * `askOff` marks the two triggers that say how the song is to end from now on - a change of the loop
 * mode and the way in or out of personal FM - as opposed to a song being shown. Those ask for an off
 * whatever the record says, because a repeat the listener turned on in the player's own window is
 * one nothing here knows of, and a record of the app's own last write would read the off as done. A
 * player that repeats nothing writes nothing, so the ask costs a read where it changes nothing.
 */
const syncExternalTrackRepeat = (current: ExternalSession, { askOff = false }: { askOff?: boolean } = {}) => {
    if (!current.traits.loopsTrackNatively || takeoverPending) return;
    const wanted = isRepeatOneSong();
    const askedOff = askOff && !wanted;
    if (!askedOff) {
        if (current.trackRepeat === wanted) return;
        // Only a repeat the app knows the player holds is turned off: where it never asked for one,
        // the start itself left the app's repeat as the listener had it, and an off here would put
        // back a value a play of Folia's is relying on.
        if (!wanted && current.trackRepeat !== true && !current.trackRepeatAsked) return;
    }
    // A write already on its way owns the player: this trigger is dropped rather than queued behind
    // it, and the caller that answered re-asks for the mode it reads. Nothing else ever clears the
    // pending mark - there is no timer here, and no retry of its own - so a write that is never
    // answered holds this off until the transport's own 1500ms client_repeat timeout settles it.
    if (session !== current || current.trackRepeatPending) return;
    current.trackRepeat = null;
    current.trackRepeatAsked = true;
    current.trackRepeatPending = true;
    void omni.setExternalTrackRepeat(current.song, wanted).then((answer) => {
        // A song asked for in the meantime owns the player: its record is not this answer's.
        if (session !== current) return;
        current.trackRepeatPending = false;
        // What the player says it holds: the track for an on, anything else for an off. An answer
        // naming no value says nothing, and one the write was refused leaves what the player holds -
        // which is what the next trigger asks about.
        const now = typeof answer?.now === 'number' ? answer.now : null;
        current.trackRepeat = now === null ? null : now === 2;
        // A mode picked while this write was on its way asked for the other value, and its own
        // trigger was dropped as one waiting for this write: the setting is asked for again now that
        // the player has answered, for what the mode reads, so it is never left repeating a song
        // where Folia no longer repeats it. What this write asked for is the comparison, not what
        // the player holds: a write nobody answered leaves the mode the only thing to go by. This
        // re-ask keeps its `askOff`, and an off it asks for is sent only because the write above set
        // `trackRepeatAsked` - without that mark the guard in the ask would read the off as already
        // done and skip it.
        if (isRepeatOneSong() !== wanted) syncExternalTrackRepeat(current, { askOff });
    }).catch((error: unknown) => {
        // The song keeps playing, and the app's own replay of repeat one still covers it. What the
        // player holds is unknown, so the next trigger asks again.
        if (session === current) {
            current.trackRepeatPending = false;
            current.trackRepeat = null;
            // A mode picked while this write was on its way is asked for here the way it is after an
            // answer: no failure is repeated for a mode that has not moved on, so a player that
            // refuses every write is asked once per change of the mode rather than in a loop. The
            // off this re-ask sends relies on `trackRepeatAsked`, which the write above set before
            // it failed, to get past the guard that reads a never-asked player's off as done.
            if (isRepeatOneSong() !== wanted) syncExternalTrackRepeat(current, { askOff });
        }
        console.warn('[ExternalPlayback] repeat one could not be handed to the player\'s own repeat', error);
    });
};

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
    // its own queue is taken back where it can be emptied. Personal FM goes on to nothing of this
    // queue either, so it takes back the same way: the player would otherwise sound a song of the
    // list Folia is not stepping to when this one ends instead of the station's next.
    const loopMode = useAudioSettingsStore.getState().loopMode;
    const retract = isRepeatOneSong() || state.isFmMode;
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

/**
 * How far this session's clock may run while a move is in flight, in seconds: what the way of
 * playing declared (`seekLimitMs`), and the second `hifiClock` gives every player where it declared
 * nothing.
 */
const seekExtrapolationSec = (current: ExternalSession): number => {
    const limitMs = current.traits.seekLimitMs;
    return typeof limitMs === 'number' && Number.isFinite(limitMs) && limitMs > 0 ? limitMs / 1000 : MAX_SAMPLE_AGE_SEC;
};

/**
 * How far the bar ran ahead of the spot the player lands on, in seconds, where this read is that spot:
 * while the answers named the old line the bar went on from the drop, and the player loaded the drop
 * behind it. Null where the read is not that spot, or where no read of the old line came before it.
 *
 * Read before the answer is judged: judging forgets a move it is done with, and the answer that says
 * the player landed is exactly that one.
 */
const landingHoldFor = (current: ExternalSession, positionSec: number): number | null => {
    const targetSec = current.seekSettledAtSec;
    if (targetSec === null || !current.staleReadGivenUp) return null;
    const sinceAskedSec = Math.max(0, performance.now() - current.seekSettledAskedMs) / 1000;
    const isLandedSpot = positionSec >= targetSec - STALE_READ_TOLERANCE_SEC
        && positionSec <= targetSec + sinceAskedSec + STALE_READ_TOLERANCE_SEC;
    if (!isLandedSpot) return null;
    const aheadSec = current.clock.read() - positionSec;
    return aheadSec > 0 ? aheadSec : null;
};

/** Forgets the move just landed: what a read names is no longer read against the line it stood on. */
const clearSettledMove = (current: ExternalSession) => {
    current.seekSettledAtSec = null;
    current.seekSettledFromSec = null;
    current.seekSettledLandedMs = 0;
    current.seekSettledAskedMs = 0;
    current.staleReadAtSec = null;
    current.staleReadRunningSinceMs = null;
    current.staleReadPlayingSinceMs = null;
    current.staleReadGivenUp = false;
    current.staleReadNoted = false;
};

/**
 * Whether this answer names the spot the move landed on while that move is being looked for: the
 * player has loaded it, and what it says from here is followed as any other answer is. Read before the
 * answer is judged, since the spot it names is the whole of what is asked of it, and judging the
 * answer that lands the move is what forgets the move. The spot is read against the moment the move
 * landed: the answer that names it comes from that moment on, and the drop is followed along as the
 * song sounds.
 */
const namesLandingSpot = (current: ExternalSession, positionSec: number): boolean => {
    const targetSec = current.seekFollowAtSec;
    if (targetSec === null || positionSec < targetSec - STALE_READ_TOLERANCE_SEC) return false;
    const sinceLandedSec = Math.max(0, performance.now() - current.seekFollowLandedMs) / 1000;
    return positionSec <= targetSec + sinceLandedSec + STALE_READ_TOLERANCE_SEC;
};

/**
 * Whether this answer still names the line the song stood on before a move the player has already
 * answered. A player takes a move at once and loads the spot a moment later, so the reads that follow
 * it are the old position wearing the new song's name: one of those is not where the song is now, and
 * following it takes the bar and the lyrics back there for a whole poll, which a listener sees as the
 * timeline flickering on every drop. The clock goes on from the spot the bar was dropped on instead,
 * and the player's own answer for it is read as it comes.
 *
 * What makes a read old is the line it names, not how many reads went by or how long ago the move
 * landed: a player that loads the spot a second and a half later goes on naming that line for that
 * long, and one that loads it at once names it for none of them. A playing song moves along its own
 * line, so a read names it only where it agrees with where the song would have taken that line; a
 * stopped one stands on it. A stopped song holds the line off for as long as the reads name it, while
 * a playing one is given the five seconds below from the moment it sounded again - a player
 * that never loads the drop must not hold the bar off its own line for good. A read naming any other
 * spot is where the player went, and stands at once.
 *
 * A stopped answer is read the same way. Dragging the bar and pausing right after it, or dropping it
 * on a song already stopped, leaves every read a stopped one, and the player answers the move the same
 * way it does a playing one: it names the spot the song stood on until it loads the new one. What such
 * a read says about the sound - the song is stopped - is the player's and stands.
 */
const isStaleMoveRead = (current: ExternalSession, positionSec: number): boolean => {
    const targetSec = current.seekSettledAtSec;
    const fromSec = current.seekSettledFromSec;
    if (targetSec === null || fromSec === null) return false;
    const nowMs = performance.now();
    // Nearer than this, no read can be told from the line the bar was dropped on: every one is the
    // player's own, and none of them is given up.
    if (Math.abs(targetSec - fromSec) < SEEK_TARGET_APART_SEC) {
        clearSettledMove(current);
        return false;
    }
    // How far the spot the bar was dropped on can have reached, and how far the line the song stood on
    // can have run: both are counted from the moment the move was asked for, which is when the song was
    // told to leave that line. Neither is taken from a read given up before: reading each one from the
    // last let the line follow the song until it met the drop, and the player's own answer for the drop
    // was then read as one more read of it.
    const sinceAskedSec = Math.max(0, nowMs - current.seekSettledAskedMs) / 1000;
    // How far the drop can have moved on: only a song that is sounding goes on from it, while a stopped
    // one stands where it was put. A window that grew while the song was stopped reached the line it
    // stood on before a short drag, once the wait to load the drop outgrew that drag, and the bar and
    // the lyrics fell back the whole way at once.
    const dropReachedSec = current.staleReadRunningSinceMs === null ? 0 : sinceAskedSec;
    // That spot has reached this far: a read inside it is the drop's own, even where the two lines are
    // near enough to be confused. Following the player is what shows the drop going on, and only as far
    // as the two are apart can they be told apart at all.
    if (positionSec >= targetSec - STALE_READ_TOLERANCE_SEC
        && positionSec <= targetSec + dropReachedSec + STALE_READ_TOLERANCE_SEC) {
        clearSettledMove(current);
        return false;
    }
    // The line the song stood on is read as the stretch it can be anywhere on: it stood still where it
    // was, as a player that held its spot through the move names it, or it ran on from there for as long
    // as the song sounded, as one that went on playing until it loaded the drop names it.
    const runningHighSec = fromSec + (current.staleReadRunningSinceMs === null ? 0 : sinceAskedSec);
    if (positionSec < fromSec - STALE_READ_TOLERANCE_SEC || positionSec > runningHighSec + STALE_READ_TOLERANCE_SEC) {
        clearSettledMove(current);
        return false;
    }
    // A song that has been sounding for longer than a move is given has said enough: past this the
    // answer stands rather than holding the bar off the player's own line for good. The five seconds
    // run from the move landing, or from the song being set going again after it was dropped on it
    // stopped, which is the moment it starts sounding; a stopped song has no such time at all.
    const heldSinceMs = current.staleReadPlayingSinceMs;
    if (heldSinceMs !== null && nowMs - heldSinceMs > STALE_READ_PLAYING_LIMIT_MS) {
        clearSettledMove(current);
        return false;
    }
    // One line per move, so the log says how often a player answered before it loaded the spot.
    if (!current.staleReadNoted) {
        current.staleReadNoted = true;
        console.debug('[ExternalPlayback] a read still named the spot before the move; it is not followed', {
            targetSec, fromSec, readSec: positionSec, afterMs: Math.round(nowMs - current.seekSettledLandedMs),
        });
    }
    current.staleReadAtSec = positionSec;
    current.staleReadGivenUp = true;
    return true;
};

const syncClock = (positionSec: number, paused: boolean, sampledAtMs: number, holdBackward: boolean, holdLimitSec?: number) => {
    if (!session) return;
    paused ||= session.live;
    const ageSec = paused ? 0 : Math.min(Math.max(0, (performance.now() - sampledAtMs) / 1000), MAX_SAMPLE_AGE_SEC);
    // While a move is in flight no answer will come for it (see `poll`, `seekExternalPlayback`): a
    // sync written then - a resume the move asked for, a pause it was given - runs on under the same
    // longer limit, or it would put the bar back to the second it stood still for.
    session.clock.sync({
        positionSec: positionSec + ageSec,
        samplePositionSec: positionSec,
        paused,
        nowMs: performance.now(),
        holdBackward,
        ...(holdLimitSec === undefined ? {} : { holdLimitSec }),
        ...(session.seekPending || session.seekSettledAtSec !== null ? { maxExtrapolationSec: seekExtrapolationSec(session) } : {}),
    });
};

/**
 * Writes where the bar was dropped on again, under the limit the move is given, so the clock goes on
 * from there for another stretch of the same length. A read this window gives up carries no position
 * of its own, and saying nothing at all leaves the clock to the limit of the last write it got: it
 * runs that out and then stands still under a song that is playing, for as long as the reads go on
 * naming the spot before the move. Nothing moves where the clock already stands, and a stopped song
 * is left stopped: the write says what the session already says about the sound.
 */
const holdSettledMoveSpot = () => {
    if (!session || session.seekSettledAtSec === null) return;
    // Inside the window a move is given, the spot this read names is written under the same limit with
    // the bar standing where it is: the clock then knows the lead and plays it out at the slower speed,
    // so a read that names the old line for the whole window leaves the bar and the lyrics moving. A
    // stopped song plays nothing out, and past the window the bar is held as it always was.
    const playsOut = session.playing && performance.now() <= session.moveHeldUntilMs;
    if (playsOut) {
        syncClock(session.clock.read(), false, performance.now(), true, seekExtrapolationSec(session));
        return;
    }
    syncClock(session.clock.read(), !session.playing, performance.now(), false);
};

const markPlaying = (positionSec: number, preserveClock = false) => {
    if (!session) return;
    // The song sounds again: the line it stood on before the move runs on from here, and the five
    // seconds a playing song is given to load the drop are counted from here as well.
    if (session.seekSettledAtSec !== null) {
        const nowMs = performance.now();
        session.staleReadRunningSinceMs ??= nowMs;
        session.staleReadPlayingSinceMs ??= nowMs;
    }
    session.playing = true;
    session.ended = false;
    // The song goes on, so the direction a read taken before it was shown gave to an end that is no
    // longer one belongs to that end alone: held here, it made the song's own end, minutes later,
    // step the queue the way the listener went before the song had even started.
    session.skipped = undefined;
    if (!preserveClock) syncClock(positionSec, false, performance.now(), true);
    externalMediaShim.markPlaying();
    if (usePlaybackStore.getState().playerState !== PlayerState.PLAYING) setPlayerState(PlayerState.PLAYING);
    emit({ type: 'status' });
};

/**
 * Writes a stopped song down. holdLimitSec is the longest stretch the bar may be held ahead of the
 * spot written here where it was already past it: a pause that is written down while a move of the
 * listener's is still being held leaves the bar ahead of the spot the player lands on, and zero says
 * that lead belongs to the wait for the spot and not to the pause - a stopped song shows where the
 * player stands, so the bar and the lyrics step back the lead once and stand there for the whole
 * pause. Left out, the route's own limit applies, which is what every pause that is not a drop's own
 * keeps: the clock has run on past the player's word since it was last heard, and the bar stands
 * where it is rather than stepping back a fraction of a second on every answer.
 */
const markPaused = (positionSec: number, holdLimitSec?: number) => {
    if (!session) return;
    // A stopped song stands where it is: the line it stood on stops running, and so does the time it is
    // given to load the drop, until it sounds again.
    session.staleReadRunningSinceMs = null;
    session.staleReadPlayingSinceMs = null;
    session.playing = false;
    session.starting = false;
    session.prefetchReady = false;
    session.sampledPosition = null;
    // This answer is where the player stands after the move: the next playing one is read as progress.
    session.afterSeek = false;
    syncClock(positionSec, true, performance.now(), true, holdLimitSec);
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
    const previousSample = current.sampledPosition;
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
    // A player that can only say which song it holds by its names - the coarse channel, which names
    // no track - reports the one it moved to that way: it is another song all the same, and is taken
    // over as the ones a player names by id are.
    const namedOther = status.shownTrack !== undefined;
    if ((status.mediaId || namedOther) && !omni.isExternalPlaybackStatusForSong(current.song, status)) {
        if (!current.announced) return;
        if (!current.foreign) {
            current.foreign = true;
            // A player whose listener changes what it plays from its own window is followed: the
            // track it moved on to is looked up and taken over by the bridge, and this session ends
            // with the take-over. A player that declared nothing has the track stopped instead: a
            // song Folia knows nothing about must not keep sounding under Folia's controls.
            if (current.traits.followsPlayerChanges) {
                console.info('[ExternalPlayback] the player has another track; it is taken over');
                emit({ type: 'track-changed', status });
                return;
            }
            console.warn('[ExternalPlayback] the player has another track; it is paused');
            void omni.pauseExternalPlayback(current.song).catch(() => {});
            markPaused(positionSec);
            emit({ type: 'foreign-track' });
        }
        return;
    }
    current.live = status.live === true;
    // The player's own word on where the song stands: the line a move is made from is this one, not
    // the clock, which has been running on past it since that answer (see isStaleMoveRead).
    if (Number.isFinite(positionSec)) current.lastPlayerPositionSec = positionSec;
    // A move the player answered, whose spot it has not loaded yet: the reads taken before it does
    // are where the song stood, and reading the song's progress off one of them reads a jump across
    // the song rather than the song sounding on. A stopped answer is one of them as much as a playing
    // one: what a move does to the spot the player reports does not depend on it sounding the song.
    // The player's own turn of the song is never one of them: it says where the song now stands, and a
    // turn that follows a drop closely names no old line.
    // A read that says the player is seeking is let through untouched, as the player's own window and
    // not this one: the answer reports a move still running, and the spot it names is read by the
    // seeking branch below. A player that answers a drop with seeking state it never clears - Apple
    // Music answers a drag with state 6 and holds it - keeps naming the spot before the drop, and that
    // read is followed here the way it always was. Holding it would need the seeking answer itself to
    // be judged against the drop, which is what this window is for; that is left as it stands so the
    // seeking answers of every player read the same.
    // Taken before the read is judged: judging forgets a move it is done with, and the answer that says
    // the player landed is exactly that one.
    const landedHoldSec = landingHoldFor(current, positionSec);
    // Whether a move of the listener's is still settled here: the reads it gives are held off the spot
    // the song stood on until one names the spot it landed on (see isStaleMoveRead). Taken before the
    // read is judged, since judging the answer that lands the move is what forgets it.
    const settledMove = current.seekSettledAtSec !== null;
    // Asked before the read is judged: judging is what forgets a move the answer has landed, so the
    // answer that names the spot the move landed on is the one this has to be read from.
    const namesTheLandingSpot = namesLandingSpot(current, positionSec);
    const staleMoveRead = status.replayed !== true && status.mediaId !== ''
        && status.seeking !== true && isStaleMoveRead(current, positionSec);
    // The move is done with once an answer names the spot it landed on. Told before that answer is
    // followed, since following it forgets the move.
    const answeredForTheSpot = !staleMoveRead && namesTheLandingSpot;
    if (answeredForTheSpot) current.seekLanded = true;

    // A read that still names the spot before the move applies everything it says about the player -
    // it is stopped, or it has started - and nothing it says about where the song stands: that is the
    // spot the bar was dropped on, which the clock already runs on from. What it gets instead of a
    // position is another stretch of the limit the move is given, so the bar goes on moving rather than
    // running that limit out and standing still for the rest of the window.
    if (staleMoveRead) holdSettledMoveSpot();
    // While the answers named the old line the bar ran on from the drop, so it is ahead of the spot the
    // player lands on. That spot has now been loaded: the bar stands where it is until the player has
    // caught up, rather than falling back the wait it took, which a listener sees as the timeline
    // jumping backwards a poll after the drop had already landed. A move whose answers never named the
    // old line is followed as it always was: the player was already there when it answered.
    if (!staleMoveRead && landedHoldSec !== null) current.landingHoldSec = landedHoldSec;
    if (current.landingHoldSec !== null && current.clock.read() - positionSec > current.landingHoldSec) current.landingHoldSec = null;
    const settledSpotSec = staleMoveRead ? current.seekSettledAtSec ?? positionSec : positionSec;
    if (status.isPlaying && status.mediaId && !status.seeking) {
        if (current.afterSeek || staleMoveRead) {
            // The answer right after a move may still name the position from before it: what it shows
            // is a jump across the song, not the song sounding on, so it counts as nothing and the
            // progress is told from an answer that came after it.
            current.prefetchReady = false;
            current.sampledPosition = null;
        } else {
            if (current.live || (current.sampledPosition !== null && positionSec > current.sampledPosition + 0.05)) current.prefetchReady = true;
            current.sampledPosition = positionSec;
        }
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
    const atEnd = durationSec !== null && settledSpotSec >= durationSec - END_TOLERANCE_SEC;
    // Before the app has shown the song, the player's answers only fill in the session: the
    // transport, the shim and the media observers belong to the song on screen until then.
    if (!current.announced) {
        current.clock.sync({ positionSec, paused: current.live || !status.isPlaying, holdBackward: false });
        current.playing = status.isPlaying;
        current.seeking = status.seeking === true;
        if (status.ended || (status.isPlaying === false && atEnd)) current.ended = true;
        // The direction of that end is taken here as well: the player moves past a song by its own
        // controls while the app is still starting it as readily as after it is on screen, and the end
        // this read becomes is reported from the announcement. Left to the branch below, the direction
        // of every such skip was lost and the queue stepped the way the listener did not ask for.
        if (status.ended && status.skipped) current.skipped = status.skipped;
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
    // Repeat one the player carries out itself: the same song came round again, so this is a move
    // back to its start, said the way a seek is - the media observers report the position again and
    // the song is never ended or stepped past. Its lyrics follow the clock, which starts over here.
    // The player's own turn is never a read of a move it has not loaded: it is the answer itself, and
    // it lands a moment after a drop as readily as anywhere else - where repeat one follows a bar
    // dragged forward, the two fall inside the same window. A read of an unloaded move names no turn
    // of its own (see isStaleMoveRead), so it never reaches here as one.
    if (status.replayed === true) {
        current.ended = false;
        current.clock.sync({ positionSec, paused: false, holdBackward: false });
        externalMediaShim.markSeeked();
    }
    if (status.seeking || current.seeking) {
        current.clock.sync({ positionSec, paused: current.live || !status.isPlaying, holdBackward: false });
        if ((status.seeking === true) !== current.seeking) externalMediaShim.markSeeked();
    }
    current.seeking = status.seeking === true;
    // An end read before the player loaded the spot the bar was dropped on is the line the song
    // stood on reaching its own end, not this song's: it is the move's end, said about the spot the
    // song is no longer on. The bar was just dropped somewhere else, so the song is not over; the
    // read still says the player is stopped, which stands.
    const staleEnd = staleMoveRead && status.ended;
    // The direction the player's own controls went is read here and nowhere else: an end given up above
    // is the line the song was on reaching its own, and its skip belongs to a move the song never made.
    // Carried to the next answer, it made the song's real end step the queue that way.
    if (status.ended && status.skipped && !staleEnd) current.skipped = status.skipped;
    if ((status.ended && !staleEnd) || (current.playing && !status.isPlaying && atEnd)) {
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
            // The play the answer says is taken, and so is the spot the bar was dropped on: a read that
            // still names where the song stood is not the spot the song starts from here.
            markPlaying(settledSpotSec);
        } else if (staleMoveRead) {
            // The spot the bar was dropped on stands: the clock keeps running from there rather than
            // being pulled back to where the song stood before the drop. Nothing is written and no
            // status is emitted, so a listener sees one timeline going forward and no step at all.
            current.afterSeek = false;
        } else {
            // The first answer after a move is where the player is now: a position a little behind the
            // spot the bar was dropped on is its own (it loads the song from around there), and holding
            // the bar at that spot would freeze it and the lyrics until the player caught up.
            // Inside the window the move is given, a lead the bar holds because its answers went on
            // naming the old line is played out at the slower speed rather than stood still on. An
            // answer the player gives for the spot itself, with none of those before it, steps the bar
            // back onto the player once, as it always did.
            const moveWindowOpen = !answeredForTheSpot && performance.now() <= current.moveHeldUntilMs;
            const holdLimitSec = current.landingHoldSec ?? (moveWindowOpen ? seekExtrapolationSec(current) : (current.afterSeek ? 0 : undefined));
            const holdBackward = !current.afterSeek || current.landingHoldSec !== null || moveWindowOpen;
            current.afterSeek = false;
            syncClock(positionSec, false, sampledAtMs, holdBackward, holdLimitSec);
            emit({ type: 'status' });
        }
        // Only a player-confirmed start/resume may release deferred preparation.
        refreshPreparedQueue();
        return;
    }
    // The stop is the player's and stands; the spot is the one the bar was dropped on where the answer
    // still names where the song stood. A pause that wrote that spot would put the bar and the lyrics
    // back on the old line for a whole poll, the same step back a playing answer is kept from.
    // The answer that loads the spot is written down as it comes, the stretch the bar ran ahead of it
    // included: a stopped song shows where the player stands, and a bar held ahead of that spot stands
    // ahead of it for as long as the song stays stopped. The lead a move of the listener's left the bar
    // on is not one the pause keeps: the song was stopped while the player was still loading the spot,
    // and a stopped song stands where the player put it rather than where the bar ran on to. That lead
    // could be any length up to the limit a move is given, and held here it stood for as long as the
    // song stayed stopped.
    markPaused(settledSpotSec, settledMove ? 0 : undefined);
};

async function poll(): Promise<void> {
    const current = session;
    if (!current || current.handedOver || pollRunning || !isExternalRoute()) return;
    if (current.seekPending) { schedulePoll(STATUS_INTERVAL_MS); return; }
    const positionRevision = current.positionRevision;
    pollRunning = true;
    const startedAt = performance.now();
    const revisionAtAsk = current.positionRevision;

    let delay = STATUS_INTERVAL_MS;
    try {
        const status = await omni.getExternalPlaybackStatus(current.song);
        // A move the listener made while this ask was on its way owns the timeline now: the answer names
        // where the song stood before it, and following it would put the bar back there. Asking is not
        // held for a move that is still in flight, so that the ask the move sends is the one that says
        // where the song was left.
        if (session !== current || !isExternalRoute() || current.positionRevision !== revisionAtAsk) return;

        // The answer names a position the page read about half a round trip ago.
        applyStatus(status, (startedAt + performance.now()) / 2);
        failureNoted = false;
        pollFailures = 0;
        // A repeat write that failed (or was skipped while handed over) is sent again.
        if (appliedRepeatOne === null) syncExternalRepeatOne();
    } catch (error) {
        // Handed over meanwhile, or a move of the listener's owns the timeline: a failed answer says
        // nothing this window acts on either.
        if (session !== current || current.handedOver || !isExternalRoute() || current.positionRevision !== revisionAtAsk) return;

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

/**
 * The mute switch, as the listener pressed it in Folia. Muted is a level of 0 for a player that has no
 * mute of its own here, and unmuting hands back the level the app is left at. It is a press rather than
 * the app following its own level, so a player that was only taken over is told about it.
 */
export function setExternalPlaybackMuted(): void {
    setExternalPlaybackVolume(settingsVolume(), 'user');
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
export function startExternalPlayback(song: SongResult, startSec = 0, { userAction = true, replaceQueue = false, singleLoop }: { userAction?: boolean; replaceQueue?: boolean; singleLoop?: boolean } = {}): ExternalPlaybackStart {
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
    // out. Every other player keeps the app's own waiting and cadence. Read once here and held for
    // the session: what the session follows is the way of playing it was started with, even where
    // that way changes under a song that is already sounding.
    const traits = omni.externalPlaybackTraits(song);
    // Repeat one, handed to the player's own repeat of the track: the start asks for it in the same
    // call that plays the song, so the setting is never turned off and on again around a start of
    // Folia's own. A player with no repeat of its own is started as every start is.
    const loopOne = singleLoop ?? isRepeatOneSong();
    const startsLooping = loopOne && traits.loopsTrackNatively;
    session = {
        song, songKey, attempt, clock, durationSec, traits,
        announced: false, playing: false, starting: false, sampledPosition: Math.max(0, startSec), prefetchReady: false, live: false, ended: false, foreign: false,
        // What the player holds of its repeat is unknown here even where this start asked for one of
        // its own: an ask is not an answer, and a player may refuse it. The record stays unknown and
        // the first sync after the song is shown asks the player what it holds. Where the start did
        // carry the ask, that sync asks for the same value again and the player, already repeating
        // the track, writes nothing.
        degraded: false, trackRepeat: null, trackRepeatAsked: false, trackRepeatPending: false, handedOver: false, preparedQueueKey: '', positionRevision: 0, seekPending: false, seekBeforeSec: null, seeking: false, afterSeek: false, seekSettledAtSec: null, seekSettledFromSec: null, seekSettledLandedMs: 0, seekSettledAskedMs: 0, staleReadAtSec: null, staleReadRunningSinceMs: null, staleReadPlayingSinceMs: null, staleReadGivenUp: false, landingHoldSec: null, moveHeldUntilMs: 0, staleReadNoted: false, lastPlayerPositionSec: null, seekCount: 0, seekFollowAtSec: null, seekFollowLandedMs: 0, seekLanded: false, replaying: false,

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
    // Its single repeat too, for the same reasons; sent again below once it has the song.
    appliedRepeatOne = null;
    syncExternalRepeatOne();
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
                ...(startsLooping ? { singleLoop: true } : {}),
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
        appliedRepeatOne = null;
        syncExternalRepeatOne();
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
 * A player taken over: the session the take-over is. A session says which one it is by the number
 * its start was given, so a caller that asked for a song of its own while the take-over ran can tell
 * the player it took from the one sounding now, and give up only its own.
 */
export type ExternalTakeOver = {
    /** Which session of this route the take-over is (`ExternalSession.attempt`). */
    readonly attempt: number;
};

/**
 * Takes over a track the player is already sounding (a window rebuild hands the song over; the
 * player outlives the window). The player is asked once: with `song` loaded, the route becomes the
 * external one, the clock and the polling attach to it and it is announced as it stands, playing or
 * paused. With another track or none, nothing is taken and the caller shows the song as it would
 * after a restart: paused. Never starts the player.
 */
export async function adoptExternalPlayback(song: SongResult): Promise<ExternalTakeOver | null> {
    installExternalPlayback();
    if (!omni.canPlayExternally(song)) return null;
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
        // The traits are read as the take-over starts and held for the session, as a start holds them:
        // what is followed is the way of playing this song was picked up from.
        degraded: false, traits: omni.externalPlaybackTraits(song), trackRepeat: null, trackRepeatAsked: false, trackRepeatPending: false, handedOver: false, preparedQueueKey: '', positionRevision: 0, seekPending: false, seekBeforeSec: null, seeking: false, afterSeek: false, seekSettledAtSec: null, seekSettledFromSec: null, seekSettledLandedMs: 0, seekSettledAskedMs: 0, staleReadAtSec: null, staleReadRunningSinceMs: null, staleReadPlayingSinceMs: null, staleReadGivenUp: false, landingHoldSec: null, moveHeldUntilMs: 0, staleReadNoted: false, lastPlayerPositionSec: null, seekCount: 0, seekFollowAtSec: null, seekFollowLandedMs: 0, seekLanded: false, replaying: false,

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
    if (session?.attempt !== attempt) return null;
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
        return null;
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
    if (session?.attempt !== attempt || !isExternalRoute()) return { attempt };
    // Announcing shows a playing player; a paused one is said here rather than on the next answer.
    if (!session.playing && !session.ended) markPaused(session.clock.read());
    if (handOverOnAdoption) {
        // The window replacing this one has the snapshot and takes the player; shown here as it sounds,
        // not followed, and taken back with the reclaim if that window never came.
        handOverOnAdoption = false;
        session.handedOver = true;
        console.info('[ExternalPlayback] took the player over already handed on to the next window', { songKey });
        return { attempt };
    }
    schedulePoll(STATUS_INTERVAL_MS);
    console.info('[ExternalPlayback] took the running player over', { songKey, playing: status.isPlaying });
    return { attempt };
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
 * A track the player moved on to by itself could not be taken over (its platform has no such track
 * any more, the lookup failed): the player is stopped rather than left sounding a song Folia knows
 * nothing about, as a player that declared nothing is stopped the moment it moves on. This route is
 * left with it, the way a stop leaves it, so nothing holds the player for the rest of the run: a
 * reader that watches a player the listener keeps using (a way of playing that follows its own
 * window) sees what they start there afterwards instead of a session that would skip it.
 */
export const stopForeignExternalPlayback = (): void => {
    const current = session;
    if (!current || !current.foreign) return;
    console.warn('[ExternalPlayback] the track the player moved on to could not be taken over; it is paused');
    // Shown paused, and said once as it always was: the player moved on, and this song is not it.
    markPaused(current.clock.read());
    emit({ type: 'foreign-track' });
    stopExternalPlayback('the track the player moved on to could not be taken over');
    // The app's own engine has the song again: the route is not the player's any more.
    withoutRouteGuard(() => setPlaybackRoute('web'));
};

/**
 * The app has put the song on screen: from now on the player drives the transport, the shim and
 * the media observers. Called by the play path that began this track.
 */
export function announceExternalPlayback(): void {
    const current = session;
    if (!current || current.announced) return;
    current.announced = true;
    refreshPreparedQueue();
    syncExternalTrackRepeat(current);
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
 *
 * `takeover` names the session a take-over made: only that session is given up. A song started here
 * while the take-over was on its way has a session of its own by then, and it is left sounding - it
 * is the song the listener asked for, not the one the take-over was about.
 */
export function yieldExternalPlayback(reason: string, takeover?: ExternalTakeOver): void {
    if (!isExternalRoute()) return;
    if (takeover && session?.attempt !== takeover.attempt) {
        console.info('[ExternalPlayback] the player is not the one taken over any more; nothing is given up', { reason, attempt: takeover.attempt });
        return;
    }
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
    // Where the player stood before the move: a move it refuses leaves it there, and the bar goes back
    // to this the moment the refusal is known rather than to whatever a later answer happens to say.
    // A move asked for while another is still in flight keeps the spot that one was sent from: the
    // player takes the two as one, it has still not left that spot, and a refusal of the one asked
    // for last must not put the bar on the target the one before it was only sent to.
    const beforeSec = current.seekBeforeSec ?? current.clock.read();
    current.seekBeforeSec = beforeSec;
    current.seekPending = true;
    current.prefetchReady = false;
    current.sampledPosition = null;
    // No status ask answers while the move is in flight (see `poll`), so this position is the only
    // one the bar and the lyrics have until the player takes it: it runs on for as long as the app's
    // call for that move may go unanswered, instead of the second a tick-er's clock is given.
    current.clock.sync({
        positionSec: target, paused: !current.playing, holdBackward: false, maxExtrapolationSec: seekExtrapolationSec(current),
    });
    externalMediaShim.markSeeked();
    const askedAt = performance.now();
    let refused = false;
    void omni.seekExternalPlayback(current.song, target).catch(error => {
        if (session !== current || current.positionRevision !== revision) return;
        refused = true;
        console.warn('[ExternalPlayback] seek failed', error);
        // The player never left the spot it stood on, so the bar returns to it at once: waiting for the
        // next answer would leave it running on from a target the player never went to, and jumping back
        // when that answer came. It runs on from there as the song is playing now - a press that came
        // with the move is the listener's - and under the second every sync that is not a move in flight
        // is given, that limit having belonged to a move the player never took. No ask is held for it
        // either: the poll asked for below is the player's own word on where it is.
        current.clock.sync({ positionSec: beforeSec, paused: !current.playing, holdBackward: false });
        emit({ type: 'failure', error });
        emit({ type: 'status' });
    }).finally(() => {
        if (session === current && current.positionRevision === revision) {
            current.seekPending = false;
            // The move is settled, taken or refused: the next one is sent from wherever the player is
            // then, which the answer this poll asks for says.
            current.seekBeforeSec = null;
            // The player has the move: the ask held for it is let go now rather than on its own half
            // second, and the answer that follows says where the player is after it. A move that was
            // refused is not one the player took, so nothing is read as the answer right after it.
            current.afterSeek = !refused;
            // What that answer is read against: the spot the move was sent to and the line the song
            // stood on before it, from now on. A player answers a move long before it has loaded the
            // spot, so the reads that follow name where the song stood, and none of them is where it
            // is (see isStaleMoveRead).
            // Where the song stood before the drop is the player's own last word rather than the bar:
            // the clock has been running on past that word between answers, and the spot it has reached
            // is not one the player ever reported.
            const stoodAtSec = current.lastPlayerPositionSec ?? beforeSec;
            const landedAt = performance.now();
            current.seekSettledAtSec = refused ? null : target;
            current.seekSettledFromSec = refused ? null : stoodAtSec;
            current.seekSettledLandedMs = refused ? 0 : landedAt;
            current.seekSettledAskedMs = refused ? 0 : askedAt;
            // The line the song stood on runs on from the moment the move was asked for, which is when
            // the song went on from it. The five seconds it is held for are counted from the answer that
            // took the move, so a call that took a while is no time the song was on that line, and a song
            // stopped at the drop is given neither until it sounds again (see isStaleMoveRead).
            current.staleReadAtSec = refused ? null : stoodAtSec;
            current.staleReadRunningSinceMs = refused || !current.playing ? null : askedAt;
            current.staleReadPlayingSinceMs = refused || !current.playing ? null : landedAt;
            current.staleReadGivenUp = false;
            current.landingHoldSec = null;
            // The answers that follow a move may name the line the song stood on for as long as the move
            // is given: a lead the bar runs up over the spot the player lands on is played out at the
            // slower speed inside that window rather than stood still on.
            current.moveHeldUntilMs = refused ? 0 : landedAt + seekExtrapolationSec(current) * 1000;
            current.staleReadNoted = false;
            if (isExternalRoute()) schedulePoll(0);
        }
        // How long the move itself took, which is what says whether the clock had room to run on.
        console.info('[ExternalPlayback] seek returned', { ms: Math.round(performance.now() - askedAt) });
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
            // How the song is to end moved: the off is asked for whatever the record says, since the
            // repeat it has to clear may be one the listener turned on in the player's own window.
            if (session) syncExternalTrackRepeat(session, { askOff: true });
        }
        // Muting is only ever a press in this window: nothing of the app's own turns it on or off,
        // so it goes to the player like the slider does, even while the player is only taken over.
        // The level the app follows by itself stays held back there.
        if (state.isMuted !== previous.isMuted) setExternalPlaybackMuted();
        else if (state.volume !== previous.volume) setExternalPlaybackVolume();
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
        // Personal FM decides where the song goes next as much as the mode does: its answers follow
        // the station and the player's own repeat of the track, both of which is what the song's
        // end is read by.
        if (state.playQueue !== previous.playQueue || state.isFmMode !== previous.isFmMode) {
            refreshPreparedQueue();
            // Going in or out of personal FM is the other moment that says how the song ends, so it
            // asks for the off the same way a change of the mode does.
            if (state.isFmMode !== previous.isFmMode && session) syncExternalTrackRepeat(session, { askOff: true });
        }
        if (state.isFmMode !== previous.isFmMode) syncExternalRepeatOne();
    });
};

// The observation layer asks this route for its shim; registering it at load keeps that answer
// ready before React mounts anything.
setExternalRouteMedia(() => isExternalPlaybackSounding() ? externalMediaShim : null);
