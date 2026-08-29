import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { PlayerState } from '../../types';
import type { LyricData, SongResult, StageLoopMode } from '../../types';
import type { AudioQualityPreference } from '../../types/onlineMusic';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { getPrefetchedData } from '../prefetchService';
import { getTrackProfile, recordPlayedTail } from './profileService';
import { refreshModelAvailability } from './modelAvailability';
import { canSeparateStems, ensureStems, getStemsByKey, setWantedStems, stemWindowKey } from './stems';
import { connectAutomixDeck, type AutomixDeckChain } from './crossfadeGraph';
import {
    createAutomixSession,
    AUTOMIX_ARM_LEAD_SEC,
    type AutomixDeckId,
    type AutomixSession,
} from './automixSession';
import { AUTOMIX_MAX_OVERLAP_SEC } from './transitionPlanner';
import type { TransitionSettings } from './transitionStrategy';

// src/services/automix/useAutomixDecks.ts
// The React shell around the automix state machine: two audio elements, which one the app's
// audioRef currently names, and the source each one renders. All of the decision-making lives in
// automixSession; this file only gathers what the planner needs and owns the two pieces of state
// that have to drive a render.
//
// The decks are equal - neither is "the real one". A song change during a transition just moves
// which deck audioRef names, so playback is never handed between elements mid-stream. That
// handover is the thing a smaller "main deck plus a temporary transition deck" design cannot do
// without a sample-alignment click.

export type { AutomixDeckId };

/**
 * Whether a player state means "the listener stopped this", as opposed to the player merely
 * passing through a non-playing state.
 *
 * Deliberately not `!== PLAYING`: playSong drops the player to IDLE partway through every
 * ordinary track change, so treating that as a pause would cancel every blend a fraction of a
 * second after it armed - and the feature would look like it simply did not work.
 */
export const isPausedByListener = (state: PlayerState): boolean => state === PlayerState.PAUSED;

/**
 * How often both decks are measured.
 *
 * 25ms is the hop the onset detector works at, and it bounds how precisely a blend can be put on
 * a beat. A timer rather than requestAnimationFrame because this is a music player: rAF stops
 * being called the moment the window is hidden, which is most of the time it is being used.
 */
const ANALYSER_INTERVAL_MS = 25;

/**
 * How long a settled transition is given to actually be making a sound before it is treated as
 * stalled. Long enough for the audio bridge's own autoplay, which waits on the lyrics fetch.
 */
const STALL_GRACE_MS = 2_500;
/**
 * How long to keep watching after that, and how often.
 *
 * A single check was not enough. When the next track's URL is slow to resolve, the deck that is
 * about to hold it still has no source at all at the 2.5s mark - so the check found nothing to
 * start, gave up, and the app stayed silent for exactly the case the check existed for. It has to
 * keep looking until a source turns up.
 */
const STALL_RETRY_MS = 1_000;
const STALL_ATTEMPTS = 10;

/**
 * The track the queue would advance to, mirroring handleNextTrack's own index maths.
 *
 * Deliberately does not reproduce the FM-mode top-up: that fetch is asynchronous, and a track we
 * cannot name yet is a track we cannot measure, so automix simply stays out of the way.
 */
const resolveNextQueueSong = (
    queue: SongResult[],
    currentSong: SongResult,
    loopMode: StageLoopMode,
): SongResult | null => {
    if (queue.length < 2) return null;
    const currentKey = getPlaybackSongKey(currentSong);
    const index = queue.findIndex(song => getPlaybackSongKey(song) === currentKey);

    const next = index >= 0 && index < queue.length - 1
        ? queue[index + 1]
        : loopMode === 'all' ? queue[0] : null;

    // Wrapping onto ourselves is a repeat, not a transition.
    return next && getPlaybackSongKey(next) !== currentKey ? next : null;
};

export interface DeckSrcInput {
    deck: AutomixDeckId;
    activeDeck: AutomixDeckId;
    /** The source the app has committed to. Lags behind the deck roles while a blend is arming. */
    audioSrc: string | null;
    /** The outgoing track, pinned to the deck it started on; null outside a transition. */
    tailSrc: string | null;
    /** The next track, given to the idle deck to buffer before anything else moves. */
    warmSrc: string | null;
}

/**
 * Which source each deck renders. Pure, because getting it wrong is silent in both directions - a deck
 * blanked at the wrong moment loses everything it buffered, and a deck given a source another deck is
 * already sounding loads the same track twice over the top of itself.
 *
 * The invariant that makes the swap seamless: the outgoing deck's src string does not change when it
 * stops being active, so React never touches its src attribute and its playback is never interrupted.
 * `warmSrc` is that same invariant one step earlier - the idle deck is handed the next track's source
 * before anything else moves, and because that string is the one `playSong` will eventually put in
 * `audioSrc`, the handover changes nothing and the buffered bytes survive.
 *
 * The cases are ordered by how committed the app is to each source, and the fallthrough at the end is
 * load-bearing: while armed, `audioSrc` still names the track the OTHER deck is finishing, so the active
 * deck has to keep rendering what it was warmed with. Returning nothing there would blank the src of the
 * deck that is about to play.
 */
export const resolveDeckSrc = ({
    deck, activeDeck, audioSrc, tailSrc, warmSrc,
}: DeckSrcInput): string | undefined => {
    // Never hand a deck something another deck is already sounding.
    const warm = warmSrc && warmSrc !== tailSrc && warmSrc !== audioSrc ? warmSrc : undefined;
    // The track being faded out, pinned to the deck it started on.
    if (deck !== activeDeck) return tailSrc ?? warm;
    // The track the app has actually moved to.
    if (audioSrc && audioSrc !== tailSrc) return audioSrc;
    // Left: `audioSrc` names the track the OTHER deck is holding, so it cannot be used here, and
    // the warm source is what this deck is playing. If there is no warm source the app's own is
    // still better than nothing - two decks briefly on one URL is a duplicated load, while an
    // active deck with no `src` at all is an `error` event, and that one reaches the listener as
    // "playback error, skipping in 4s". Never return undefined for the deck being listened to.
    return warm ?? audioSrc ?? undefined;
};

/** The now-playing picture, frozen for as long as a transition is running. */
export interface TransitionDisplay {
    song: SongResult | null;
    lyrics: LyricData | null;
    /** Held with the song: the cover cache is repointed at the arriving track during the blend. */
    coverUrl: string | null;
    /** Held for the same reason, or the progress bar reads the old position against a new length. */
    duration: number;
}

type UseAutomixDecksParams = {
    audioRef: MutableRefObject<HTMLAudioElement | null>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    audioSrc: string | null;
    currentSong: SongResult | null;
    /**
     * Playback key of the track the app has committed to, updated synchronously by playSong.
     *
     * Separate from `currentSong` on purpose. See handleActiveDeckPlaying: the state and the ref
     * disagree for exactly as long as it takes React to commit, and the deck can start playing
     * inside that window.
     */
    currentSongKeyRef: MutableRefObject<string | number | null>;
    lyrics: LyricData | null;
    /** Only ever read to freeze the picture across a transition - see `transitionDisplay`. */
    coverUrl: string | null;
    duration: number;
    playQueue: SongResult[];
    loopMode: StageLoopMode;
    audioQuality: AudioQualityPreference;
    playerState: PlayerState;
    /** False when blending is switched off, or while another subsystem owns playback. */
    isEnabled: boolean;
    /** Which strategy plans each song change, and the crossfade mode's length setting. */
    transition: TransitionSettings;
    /** Runs the queue's normal advance, exactly as the end of a track would. */
    onAdvanceTrack: () => void;
    /**
     * A deck finished playing a whole track out - the blended equivalent of an `ended` event, which a
     * faded track never fires. Given the track pinned to that deck and the deck's own source, so the
     * media cache is written for the song that just left rather than the one arriving. See the settle
     * branch in `onTailSrcChange`.
     */
    onDeckPlayedOut?: (song: SongResult, audioSrc: string | null) => void;
    /**
     * Reads a local track's raw bytes from its own file, for separating a next-up local song whose
     * head has no prefetch URL and never enters the online media cache. Null for online tracks or an
     * unreachable local file. Resolved by App, which owns the local library.
     */
    getLocalStemBytes?: (song: SongResult) => Promise<ArrayBuffer | null>;
};

export function useAutomixDecks({
    audioRef,
    audioContextRef,
    audioSrc,
    currentSong,
    currentSongKeyRef,
    lyrics,
    coverUrl,
    duration,
    playQueue,
    loopMode,
    audioQuality,
    playerState,
    isEnabled,
    transition,
    onAdvanceTrack,
    onDeckPlayedOut,
    getLocalStemBytes,
}: UseAutomixDecksParams) {
    const [activeDeck, setActiveDeck] = useState<AutomixDeckId>('A');
    const [tailSrc, setTailSrc] = useState<string | null>(null);
    /**
     * What the app should still be SHOWING, while internally it has already moved on.
     *
     * A transition starts by advancing the queue, because that is what loads and starts the next track -
     * so from the arm onwards `currentSong`, the lyrics and the progress bar all belong to the arriving
     * track, seconds before anybody hears it arrive. The listener is still hearing the old song and
     * reading the new one's title.
     *
     * Held rather than deferred. Moving the advance itself is the obvious fix and does not work: for
     * anything already in the media cache `playSong` mints a fresh blob URL, so `warmSrc` is null for
     * those tracks and the advance is the ONLY thing that ever gives the incoming deck a source. Deferring
     * it would leave that deck silent for the whole blend. What is safe to defer is the picture, which is
     * this.
     */
    const [transitionDisplay, setTransitionDisplay] = useState<TransitionDisplay | null>(null);
    /**
     * The next track's source, handed to the idle deck so it can buffer before it is needed.
     *
     * This is the half of a transition that takes real time, and separating it from the advance is
     * what lets the advance happen late. While this is set the app has not moved on in any other
     * sense: the queue, the now-playing song and the progress bar all still belong to the track
     * that is playing.
     */
    const [warmSrc, setWarmSrc] = useState<string | null>(null);
    // State rather than a ref on purpose: lifting the hold has to re-run the audio bridge's
    // autoplay effect, and only a render does that.
    const [autoplayHeld, setAutoplayHeld] = useState(false);

    const elementsRef = useRef<Record<AutomixDeckId, HTMLAudioElement | null>>({ A: null, B: null });
    const chainsRef = useRef<Partial<Record<AutomixDeckId, AutomixDeckChain>>>({});
    /**
     * Which song each deck is holding, so a deck that has finished can say what it just played.
     *
     * `currentSong` alone cannot answer that: by the time the outgoing deck ends, the app has been
     * on the next track for the length of the blend. Written per deck as each becomes active, which
     * leaves the outgoing deck still naming the track it is finishing.
     */
    const deckSongRef = useRef<Record<AutomixDeckId, SongResult | null>>({ A: null, B: null });
    useEffect(() => {
        deckSongRef.current[activeDeck] = currentSong;
    }, [activeDeck, currentSong]);

    /**
     * Asks the main process once, at startup, which weights are on disk.
     *
     * Without this nobody ever asks. `modelsPresent()` starts at all-false by design - it is shown to the
     * listener, and a page promising stem separation over an empty directory is the worse wrong answer -
     * and the only refresh in the app was the settings model section mounting. So a launch that never
     * opened that page ran the whole session believing it had no weights: no beat grid, no stems, the
     * badge saying compatible mode, on a machine where both files were sitting right there. Asked from
     * here because this hook is mounted for the life of the app and is the thing whose behaviour the
     * answer changes.
     */
    useEffect(() => {
        void refreshModelAvailability().then((present) => {
            console.log(
                `[Automix] models on disk at startup: beat_this ${present.beat_this ? 'yes' : 'no'},`
                + ` htdemucs ${present.htdemucs ? 'yes' : 'no'}`,
            );
        });
    }, []);

    /**
     * Files away what a deck just heard, if what it heard was a whole track.
     *
     * Called from both ends a deck's track can reach, and the two are not interchangeable: `ended`
     * only fires where the media really ran out, which for a blended track it never does - the
     * fade finishes a fraction early and the deck is stopped there. So the settle path below is
     * the one that carries almost every track, and `ended` covers the song changes that were never
     * blended at all.
     */
    const harvestDeck = useCallback((deck: AutomixDeckId) => {
        const element = elementsRef.current[deck];
        const song = deckSongRef.current[deck];
        const history = chainsRef.current[deck]?.analyser.levelHistory();
        if (!element || !song || !history) return;
        recordPlayedTail(song, history.db, history.hopSec, element.duration);
    }, []);
    // The session's ports are built once, before this exists, and must not close over a stale copy.
    const harvestRef = useRef(harvestDeck);
    harvestRef.current = harvestDeck;
    const advanceRef = useRef(onAdvanceTrack);
    advanceRef.current = onAdvanceTrack;
    // Same reason as the two above: the session's ports close over this once, so it is read through a
    // ref that stays current instead of a value captured at construction.
    const playedOutRef = useRef(onDeckPlayedOut);
    playedOutRef.current = onDeckPlayedOut;
    const localBytesRef = useRef(getLocalStemBytes);
    localBytesRef.current = getLocalStemBytes;
    /** Whether the picture is currently held. See `getDisplayElement`. */
    const displayHeldRef = useRef(false);
    /** The pair the picture is made of, kept current so the capture above can be synchronous. */
    const displayRef = useRef<TransitionDisplay>({ song: currentSong, lyrics, coverUrl, duration });
    displayRef.current = { song: currentSong, lyrics, coverUrl, duration };
    // Set when a pause interrupts an armed transition, consumed by the audio bridge's autoplay.
    const suppressAutoplayRef = useRef(false);
    const playerStateRef = useRef(playerState);
    playerStateRef.current = playerState;

    /**
     * Last resort against a transition that ends in silence.
     *
     * The audio bridge starts playback off the *source* changing, and a transition changes which
     * element that source lands on. Any path that gets the two out of step leaves a deck holding
     * the next track with nothing left in flight to press play on it, and the listener just hears
     * the music stop. Checked once, well after the bridge has had its own chance, and never
     * against a pause the listener asked for.
     */
    /** The one stall-check timer that can be pending - `check` reschedules itself, so it is always at
     *  most one. Held so the unmount cleanup can cancel it rather than leave it to fire into a torn-down
     *  session. */
    const stallTimerRef = useRef<number | null>(null);
    const scheduleStallCheck = useCallback(() => {
        let attempts = 0;
        const check = () => {
            attempts += 1;
            // A pause the listener asked for is not a stall, and resuming it would be worse than
            // any silence this guards against.
            if (playerStateRef.current === PlayerState.PAUSED) return;
            // A transition armed since this check was scheduled. An armed incoming deck is loaded
            // and deliberately silent, so starting it here would fire the blend against a deck the
            // session was not ready to hear - the very failure this check exists to rescue.
            if (sessionRef.current!.getPhase() !== 'idle') return;

            const deck = sessionRef.current!.getActiveDeck();
            const element = elementsRef.current[deck];
            if (element?.src) {
                if (!element.paused) return;
                // currentTime tells the two failures apart, and they have different causes: zero
                // means nothing ever pressed play on this deck, non-zero means it DID play and
                // something paused it again. Without it this line just says "it was silent".
                console.log(
                    '[Automix] the deck holding the next track was never started, starting it',
                    { deck, at: element.currentTime, readyState: element.readyState, ended: element.ended },
                );
                void element.play().catch(() => { });
                return;
            }
            // No source yet: the next track is still resolving. Keep looking rather than
            // concluding there is nothing wrong.
            if (attempts < STALL_ATTEMPTS) stallTimerRef.current = window.setTimeout(check, STALL_RETRY_MS);
        };
        stallTimerRef.current = window.setTimeout(check, STALL_GRACE_MS);
    }, []);

    /**
     * The pair separation is currently being spent on. Read only to decide whether to keep going.
     *
     * Deliberately a MOVING value, which is its whole job: a skip rewrites it, and a window queued for the
     * pair that was abandoned stops before it reaches the model. The session does not read this - it names
     * the pair it armed with, by key. Those are opposite requirements on the same two songs, and serving
     * both from here is what hid a bug for the stems' whole life: every gesture asked this ref for "the
     * outgoing track" a beat after it had already advanced, so it got the incoming one, whose tail nobody
     * had separated. Not once in a whole session did the stem gesture run.
     */
    const stemSongsRef = useRef<{ from: SongResult | null; to: SongResult | null }>({ from: null, to: null });

    const sessionRef = useRef<AutomixSession | null>(null);
    if (!sessionRef.current) {
        sessionRef.current = createAutomixSession({
            getContext: () => audioContextRef.current,
            getElement: deck => elementsRef.current[deck],
            getChain: deck => chainsRef.current[deck] ?? null,
            onActiveDeckChange: deck => {
                audioRef.current = elementsRef.current[deck];
                setActiveDeck(deck);
            },
            onTailSrcChange: (src, opts) => {
                // Ahead of the state updates below, which take that deck's source away from it:
                // this is the last moment the element can still say how long its track was, and the
                // last moment its element still holds the source of the track that just faded out.
                // Skipped when a cancel asks not to harvest: nothing played out, and the deck now in
                // the tail role is the incoming one, so recording it would file a track that never ran.
                if (src === null && opts?.harvest !== false) {
                    const active = sessionRef.current!.getActiveDeck();
                    const tailDeck = active === 'A' ? 'B' : 'A';
                    harvestRef.current(tailDeck);
                    // The blended equivalent of an `ended` event: this is the "played a whole track"
                    // moment for a faded song, which never fires `ended`. Uses the deck-pinned song and
                    // that deck's own src, because `currentSong`/`audioSrc` already name the arriving one.
                    const playedSong = deckSongRef.current[tailDeck];
                    if (playedSong) {
                        playedOutRef.current?.(playedSong, elementsRef.current[tailDeck]?.currentSrc || null);
                    }
                }
                setTailSrc(src);
                // Read synchronously, and that is the whole trick: the session calls this from the
                // same block that calls `advanceTrack` a few lines later, so what the ref holds
                // here is still the outgoing track. A snapshot taken from an effect would race the
                // advance and capture whichever of the two React had committed by then.
                setTransitionDisplay(src === null ? null : displayRef.current);
                // Mirrored into a ref so `getDisplayElement` can stay a stable callback: it is
                // read from an animation frame, and a changing identity there restarts the loop.
                displayHeldRef.current = src !== null;
                // Null is the last thing every settle does, whichever way the transition ended.
                if (src === null) {
                    // The deck that was fading out is idle again, and the source it is about to be
                    // offered is whatever was warmed for the transition that just finished - which
                    // the OTHER deck is now playing. Dropping it here stops that deck from loading
                    // the current track a second time.
                    setWarmSrc(null);
                    scheduleStallCheck();
                }
            },
            onAutoplayHoldChange: setAutoplayHeld,
            advanceTrack: () => advanceRef.current(),
            // Read through a ref, at the moment the gesture is scheduled rather than when the plan
            // was made: separation runs on its own clock and a window that lands inside that gap
            // is still worth using.
            getStems: (key, role) => getStemsByKey(key, role),
        });
    }
    const session = sessionRef.current;

    const bindDeck = useCallback((deck: AutomixDeckId, element: HTMLAudioElement | null) => {
        // A deck swapping to a DIFFERENT element mid-session means React unmounted and remounted
        // it. The replacement starts empty, so whatever was playing is gone and the fresh element
        // sits at currentTime 0 with nothing left to press play on it. Should never happen.
        const previous = elementsRef.current[deck];
        if (previous && element && previous !== element) {
            console.warn(`[Automix] deck ${deck} was remounted while it held a source`);
        }
        elementsRef.current[deck] = element;
        if (deck === session.getActiveDeck()) {
            audioRef.current = element;
        }
    }, [audioRef, session]);

    const registerDeckA = useCallback((element: HTMLAudioElement | null) => bindDeck('A', element), [bindDeck]);
    const registerDeckB = useCallback((element: HTMLAudioElement | null) => bindDeck('B', element), [bindDeck]);

    const deckSrc = useCallback(
        (deck: AutomixDeckId) => resolveDeckSrc({ deck, activeDeck, audioSrc, tailSrc, warmSrc }),
        [activeDeck, audioSrc, tailSrc, warmSrc],
    );

    const isActiveDeck = useCallback(
        (element: HTMLAudioElement | null) => Boolean(element) && element === audioRef.current,
        [audioRef],
    );

    /**
     * The deck the picture's clock belongs to, or null when the picture is live.
     *
     * `transitionDisplay` holds the title, cover and lyrics on the outgoing track for the length
     * of a blend, but a picture is only half of what the listener reads: the progress bar and the
     * lyric read-head are clocks, and left on the active deck they run on a track whose title
     * nobody can see yet. That is the lyric view jumping to the top of a song it is not showing.
     *
     * Stable on purpose - the caller reads it from an animation frame.
     */
    const getDisplayElement = useCallback(() => {
        if (!displayHeldRef.current) return null;
        const active = session.getActiveDeck();
        return elementsRef.current[active === 'A' ? 'B' : 'A'];
    }, [session]);

    const getActiveChain = useCallback(
        () => chainsRef.current[session.getActiveDeck()] ?? null,
        [session],
    );

    // Called once from the audio bridge on the first play, so both decks share the mix point, the
    // equaliser and the analyser. One equaliser downstream of the mix keeps CPU flat and, more
    // importantly, stops the tone from stepping in the middle of a blend.
    const connectDecks = useCallback((context: AudioContext, output: AudioNode) => {
        (['A', 'B'] as const).forEach(deck => {
            const element = elementsRef.current[deck];
            if (!element || chainsRef.current[deck]) return;
            chainsRef.current[deck] = connectAutomixDeck(context, element, output);
            // The song changes no blend was ever scheduled for. The analyser is only reset by
            // whatever starts the next track on this deck, so the readings are still the finished
            // track's when this fires.
            element.addEventListener('ended', () => harvestRef.current(deck));
        });
        return Boolean(chainsRef.current.A && chainsRef.current.B);
    }, []);

    /**
     * One console line per song, whichever way the decision went.
     *
     * A feature whose job is to refuse most song changes is otherwise indistinguishable from a
     * feature that is broken - which is exactly how the first build of this read.
     */
    const lastReportRef = useRef<string | null>(null);
    const report = useCallback((signature: string, message: string) => {
        if (lastReportRef.current === signature) return;
        lastReportRef.current = signature;
        console.log(`[Automix] ${message}`);
    }, []);

    /**
     * Runs on every timeupdate of the active deck.
     *
     * The plan is rebuilt here rather than memoised because the incoming track's lyrics arrive
     * asynchronously from the prefetcher: a plan cached at the start of a song would almost always
     * have been made blind. The early-out keeps that to a handful of evaluations in the closing
     * seconds of a track.
     */
    const checkTransitionPoint = useCallback((time: number) => {
        if (!currentSong || !audioSrc) return;
        // Never silent: a blend is scheduled backwards from the end of the track, so without a
        // duration this function can only do nothing - and doing nothing is indistinguishable from
        // the planner deciding against a transition. That is exactly how a duration left at zero
        // went unnoticed while it removed every second song change's transition.
        if (!Number.isFinite(duration) || duration <= 0) {
            return report(`${audioSrc}:no-duration`, 'no duration for this track yet, nothing to schedule a blend against');
        }
        // The longest blend, plus the lead it is armed ahead of. Everything this function does
        // happens inside that window, warming included - which gives the idle deck the better part
        // of ten seconds to buffer before anything is asked of it.
        if (duration - time > AUTOMIX_MAX_OVERLAP_SEC + AUTOMIX_ARM_LEAD_SEC) return;

        if (!isEnabled) return report('disabled', 'off - the Blend icon at the end of the volume row switches it on');
        // The report keys carry the mode: switching strategy mid-track otherwise reads as the same
        // decision as the last one and the log stays silent about the change.
        const modeTag = `${transition.mode}:`;
        if (loopMode === 'one') return report('loop-one', 'single-track loop, nothing to blend into');

        const nextSong = resolveNextQueueSong(playQueue, currentSong, loopMode);
        if (!nextSong) return report(`${audioSrc}:queue-end`, 'nothing queued after this track');

        // Nothing below applies while a transition is already in flight - `requestTransition` returns null
        // on sight - and the write underneath it is not free. This function runs on every timeupdate, the
        // deck it runs on becomes the INCOMING deck the moment anything arms, and by then
        // `resolveNextQueueSong` is answering about a song after the one being blended in. Recomputing the
        // warm source from that answer takes the source away from the deck the listener is hearing, which
        // is where "playback error, skipping" came from: the common case is a track whose bytes are in the
        // media cache, the prefetcher reports 'CACHED_IN_DB', and the line below turns it into null. The
        // warm slot belongs to the transition holding it until settle gives it back.
        if (session.getPhase() !== 'idle') return;

        const prefetched = getPrefetchedData(nextSong, audioQuality);
        // Buffer ahead, well before anything arms. 'CACHED_IN_DB' is the prefetcher's sentinel for
        // "the bytes are in the media cache", and there is nothing to warm with in that case -
        // playSong mints a fresh blob URL for those, a different string every time, so handing the
        // deck this one would only make it load the track twice. It is also the fast case.
        setWarmSrc(
            prefetched?.audioUrl && prefetched.audioUrl !== 'CACHED_IN_DB' ? prefetched.audioUrl : null,
        );

        const plan = session.requestTransition({
            time,
            audioSrc,
            from: { duration, lines: lyrics?.lines ?? null, profile: getTrackProfile(currentSong) },
            to: {
                duration: nextSong.durationMs / 1000,
                // Already in memory for online tracks: the queue prefetcher fetches the next few
                // songs' lyrics on every song change. Local files have no such cache, so they get
                // the planner's default-length blend instead of a vocal-placed one.
                lines: prefetched?.lyrics?.lines ?? null,
                profile: getTrackProfile(nextSong),
            },
            settings: transition,
            nextKey: getPlaybackSongKey(nextSong),
            fromKey: getPlaybackSongKey(currentSong),
        });
        if (!plan) return;

        if (session.getPhase() === 'armed') {
            report(`${audioSrc}:${modeTag}armed`, `blending ${plan.overlap}s - ${plan.reason}`);
        } else if (plan.kind !== 'fade') {
            report(`${audioSrc}:${modeTag}cut`, `plain cut - ${plan.reason}`);
        } else if (time >= plan.outStart) {
            report(`${audioSrc}:${modeTag}unwired`, `wanted a ${plan.overlap}s blend but the decks are not on the audio graph`);
        }
    }, [audioQuality, audioSrc, currentSong, duration, isEnabled, loopMode, lyrics, playQueue, report, session, transition]);

    /**
     * Reads the ref rather than the `currentSong` prop, and that is the whole correctness of it.
     *
     * The session checks this key against the one it planned for, to catch a queue that moved after
     * planning - a manual skip, an auto-skip past an unavailable track. But `currentSong` is React state:
     * playSong commits to the next track and only later does React render it. The incoming deck can fire
     * `playing` inside that window - it does whenever the next track was already buffered - and then the
     * state still names the PREVIOUS song. The session reads that as "the queue moved" and drops a blend
     * nobody moved anything under.
     *
     * playSong sets the ref synchronously, at the moment it commits to the track, so the ref and the deck
     * can never disagree the way the state and the deck can.
     */
    const handleActiveDeckPlaying = useCallback(() => {
        const key = currentSongKeyRef.current;
        session.handleActiveDeckPlaying(typeof key === 'string' ? key : null);
    }, [currentSongKeyRef, session]);

    const handleTailEnded = useCallback(() => session.handleTailEnded(), [session]);

    /** True while a deck other than the active one may still be sounding. */
    const isTransitionAudible = useCallback(() => session.getPhase() !== 'idle', [session]);

    /**
     * For the paths that stop everything outright rather than pausing.
     *
     * Those clear the active deck only; without this the deck fading out in the background would
     * keep playing with no control left pointing at it.
     */
    const abortTransition = useCallback(() => { session.abort(); }, [session]);

    /**
     * Cancels a blend back onto the deck still playing the OUTGOING track, without a reload.
     *
     * For a seek that lands mid-blend: the listener is dragging the outgoing track's bar, and that
     * track is already loaded and sounding on its own deck. Ordinary abort settles onto the incoming
     * deck, which then has to be re-played from scratch to get back to the outgoing song - the whole
     * song-change path, for a track that never left. This keeps it instead: the outgoing deck becomes
     * active and keeps playing, the caller need only move it to where the bar was dragged - or stop
     * it, for a pause that lands mid-blend.
     *
     * Returns true when the blend it cancelled was still ARMED, which a caller that is stopping has
     * to act on: the advance is already in flight with an autoplay intent behind it, and that intent
     * now points at the deck being kept. See `suppressAutoplayRef`.
     */
    const cancelBlendKeepingTail = useCallback(() => session.abort(true), [session]);

    // Both decks are measured continuously while playing, not only once a blend is imminent: the
    // tempo estimate needs seconds of history behind it, and by the time a transition is planned
    // there is none left to gather. One timer for both decks, and only while there is sound.
    //
    // `tailSrc` is the other half of "there is sound". A transition in flight drops the player
    // state to IDLE for as long as the incoming deck is loading - the whole lead - while the
    // outgoing deck plays on. Stopping the measurements there would hand the blend a beat grid and
    // a level reading from seconds ago, which is precisely the moment they have to be current.
    useEffect(() => {
        if (!isEnabled || (playerState !== PlayerState.PLAYING && tailSrc === null)) return;
        const timer = setInterval(() => {
            const context = audioContextRef.current;
            if (!context) return;
            const now = context.currentTime;
            (['A', 'B'] as const).forEach(deck => chainsRef.current[deck]?.analyser.tick(now));
            // The same tick, one property read wider: each deck's own position against the audio
            // clock. Forty of these a second is what lets a line be fitted through the staircase
            // `currentTime` reports, and that line is the difference between placing a handover
            // near a bar and placing it on one. See deckClock.
            session.sampleDecks(now);
        }, ANALYSER_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [audioContextRef, isEnabled, playerState, session, tailSrc]);

    /**
     * Separates the two ends a transition will need, as soon as the track that needs them starts.
     *
     * The lead time is the whole point. Separation is seconds of transformer per window - four times
     * faster than realtime on a fast machine and possibly slower than realtime on a slow one - so asking
     * for it when the transition arms, a second before it runs, would guarantee it was never ready. Asked
     * for at the top of the track instead, minutes rather than seconds.
     *
     * Deliberately fire-and-forget. Nothing waits on it and nothing fails if it does not finish: the
     * session reads whatever is there when the gesture is scheduled and falls back to the master crossfade
     * otherwise, which is what every build before stems did.
     */
    useEffect(() => {
        if (!isEnabled || !currentSong || transition.mode !== 'automix') return;
        if (!canSeparateStems()) return;

        const next = resolveNextQueueSong(playQueue, currentSong, loopMode);
        stemSongsRef.current = { from: currentSong, to: next };
        // The same pair, told to the cache: it decides what to throw away when it runs out of room,
        // and without this it can only go by age - which is how it came to evict the window a
        // transition was about to ask for in order to store one for a transition already abandoned.
        setWantedStems([
            stemWindowKey(currentSong, 'tail'),
            ...(next ? [stemWindowKey(next, 'head')] : []),
        ]);
        /*
         * Nothing is separated until there is a sound to separate towards.
         *
         * `playerState` sat in this effect's dependency list without ever being read, which is worse
         * than not being there: it looks like the gate it is not. So a restored session - the app
         * opened, a track loaded, nothing playing and possibly nothing ever going to - spent two
         * windows of htdemucs, twenty seconds and a multi-gigabyte peak apiece, on a transition that
         * exists only if the listener presses play. Bytes cached to disk once would be worth
         * speculating on; these are held in RAM and thrown away on quit.
         *
         * Above the wanted set, not below it: eviction and cancellation both read that, and leaving
         * it stale while paused would let the cache throw away the pair the next blend is coming for.
         *
         * `tailSrc` is the other half of "there is sound", the same pair of conditions the analyser
         * timer above uses. A transition in flight drops the player to IDLE for the whole lead while
         * the outgoing deck plays on, and that is exactly when the pair AFTER it should be starting.
         */
        if (playerState !== PlayerState.PLAYING && tailSrc === null) return;
        // Read through the same ref the session reads, so "still wanted" means exactly "still the
        // pair a transition would use" - a skip rewrites this on the next render and every window
        // queued for the abandoned pair stops before it reaches the model.
        const stillPaired = (song: SongResult, end: 'from' | 'to') => () => {
            const held = stemSongsRef.current[end];
            return Boolean(held && getPlaybackSongKey(held) === getPlaybackSongKey(song));
        };
        // The outgoing end first: it carries the vocal exit, which is the half of the gesture the
        // listening tests actually isolated. If only one window is ever ready this should be it -
        // though the session needs both before it will use either.
        void ensureStems({
            song: currentSong,
            role: 'tail',
            audioUrl: audioSrc,
            stillWanted: stillPaired(currentSong, 'from'),
            readBytes: () => localBytesRef.current?.(currentSong) ?? Promise.resolve(null),
        });
        if (next) {
            const prefetched = getPrefetchedData(next, audioQuality);
            void ensureStems({
                song: next,
                role: 'head',
                audioUrl: prefetched?.audioUrl && prefetched.audioUrl !== 'CACHED_IN_DB'
                    ? prefetched.audioUrl
                    : null,
                stillWanted: stillPaired(next, 'to'),
                // A local next-up song has no prefetch URL and never enters the media cache, so this is
                // the only way its head is ever separated. See readLocalBytes.
                readBytes: () => localBytesRef.current?.(next) ?? Promise.resolve(null),
            });
        }
    }, [audioQuality, audioSrc, currentSong, isEnabled, loopMode, playQueue, playerState, tailSrc, transition.mode]);

    // Any pause, from the UI, a media key or the OS, ends a transition. Watching player state
    // rather than the element's pause event matters: while armed the active deck is the silent
    // one, so it never fires a pause event of its own.
    useEffect(() => {
        if (playerState === PlayerState.PLAYING) {
            // Resuming re-authorises the advance that is still on its way.
            suppressAutoplayRef.current = false;
            return;
        }
        if (!isPausedByListener(playerState)) return;
        if (session.abort()) {
            suppressAutoplayRef.current = true;
        }
    }, [playerState, session]);

    // A song change the transition did not ask for ends it. Watching `currentSong` rather than
    // any playback event because this is a question about what the APP has committed to, and the
    // deck that needs stopping is the one no player control points at any more.
    useEffect(() => {
        session.handleSongChanged(currentSong ? getPlaybackSongKey(currentSong) : null);
    }, [currentSong, session]);

    useEffect(() => () => {
        if (stallTimerRef.current !== null) window.clearTimeout(stallTimerRef.current);
        session.dispose();
    }, [session]);

    return {
        activeDeck,
        autoplayHeld,
        transitionDisplay,
        // The exact src string React last rendered on the outgoing deck, so a cancel can re-point
        // `audioSrc` at it without changing the string (which would reload that deck).
        tailSrc,
        suppressAutoplayRef,
        registerDeckA,
        registerDeckB,
        deckSrc,
        isActiveDeck,
        getDisplayElement,
        connectDecks,
        getActiveChain,
        checkTransitionPoint,
        handleActiveDeckPlaying,
        handleTailEnded,
        isTransitionAudible,
        abortTransition,
        cancelBlendKeepingTail,
    };
}
