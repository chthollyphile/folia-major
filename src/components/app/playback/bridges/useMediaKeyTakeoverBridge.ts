import { useEffect, useRef } from 'react';
import { PlayerState } from '../../../../types';
import type { SongResult } from '../../../../types';
import type { PlaybackNavigationOptions } from '../../../../types/appPlayback';
import { getExternalSong, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { omni } from '../../../../services/onlineMusic/omni';
import { useDesktopSettingsStore } from '../../../../stores/useDesktopSettingsStore';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { mediaKeyPressGate } from '../../../../utils/mediaKeyPressGate';
import type { TransportButtonAction } from './useTransportCommandRefs';

// src/components/app/playback/bridges/useMediaKeyTakeoverBridge.ts
// The system media keys while Folia holds them: whether to hold them at all, and what one press runs.
// Why holding is the only way to keep a press is electron/mediaKeys.cjs (Windows gives a key Folia lets
// go to the other program's own media session, which then resumes and moves on in its own queue). Who
// may ask for them is the provider's own declaration, answered through omni: Folia here knows only
// that some player asks, never which one. Held, a press runs Folia's own transport and queue, on
// whatever route the song on screen sounds: the other program's player, this app's decks, or mpv.

type PlaySong = (
    song: SongResult,
    queue: SongResult[],
    isFm: boolean,
    options?: PlaybackNavigationOptions,
) => Promise<void>;

/** What the decision to hold the keys is made of. Read anew on every change, never remembered. */
export type MediaKeyHoldFacts = {
    /** The setting: hold them for as long as that player's program runs, not only while it sounds a song. */
    holdWhileRunning: boolean;
    /** A player of another program asks for them for as long as Folia runs (see omni). */
    playerAsksForAsLongAsFoliaRuns: boolean;
    /** The route the song on screen sounds on. */
    route: string;
    /** The song the external player holds, null when it holds none (nothing started, or it stopped). */
    externalSong: SongResult | null;
    /** That song's player keeps a media session of its own, so a key given back is taken by it. */
    sessionDeclares: boolean;
};

/**
 * Whether Folia holds the media keys now.
 *
 * The setting asks for them for the whole run: the player's own program keeps its media session
 * between Folia's songs, so a key let go at the end of a queue, on leaving that player's route, or
 * when that program stopped, is handed to that program and never comes back to Folia. Turned off,
 * the answer is the one before it: only while that player's session exists (a paused one too).
 */
export const shouldHoldMediaKeys = (facts: MediaKeyHoldFacts): boolean => {
    if (facts.holdWhileRunning && facts.playerAsksForAsLongAsFoliaRuns) return true;
    return facts.route === 'external' && facts.externalSong !== null && facts.sessionDeclares;
};

/**
 * Whether the queue has played itself out: the last song ended with no next one, which is what
 * stopAtQueueEnd leaves (usePlaybackQueueController) - idle, with the song and the queue still there
 * for the listener to see. A step of the queue keeps its state from this moment on.
 */
export const isQueuePlayedOut = (state: { playerState: PlayerState; currentSong: SongResult | null; playQueue: SongResult[] }): boolean => (
    state.playerState === PlayerState.IDLE && state.currentSong !== null && state.playQueue.length > 0
);

/** What one press runs: the ordinary transport, or one of the two presses at the end of a list. */
export type MediaKeyActionPlan = 'transport' | 'restart-list' | 'replay-last';

/**
 * The plan of one press.
 *
 * At the end of a played-out queue there is nothing for the transport to step to, so play and next
 * start the list over from its first song (a shuffle reorders the queue itself, so its first song is
 * the one the listener would start with; nothing played out under a repeat mode to begin with), and
 * previous replays the song that just ended, which is the last one in the queue - the step back a
 * listener asking for "that one again" means, rather than a silent no-op.
 */
export const planMediaKeyAction = (action: TransportButtonAction, queuePlayedOut: boolean): MediaKeyActionPlan => {
    if (!queuePlayedOut) return 'transport';
    return action === 'previous' ? 'replay-last' : 'restart-list';
};

/** What the main process answers a wish with: whether it holds the keys now, and which ones it took. */
export type MediaKeyHoldAnswer = {
    enabled: boolean;
    /** The accelerators the system let Folia have; empty when it refused all three. */
    held: string[];
};

/**
 * The wish sent to the main process, and what became of it.
 *
 * Only an answer that came back, and that says the wish is now the state, is remembered: a send that
 * failed leaves the wish outstanding, and so does one the main process could not carry out - the
 * system refusing a key is answered as `enabled: false` (electron/mediaKeys.cjs), and reading that
 * as done would leave Folia believing it holds keys another program took. Both send again on the next
 * change of state instead. `force` sends it even when it looks like it is already there - the mount,
 * whose main process may hold what a window before this one left. A wish is compared with a wish on
 * its way before the last answer: one sent over an outstanding opposite one is the one that decides,
 * and dropping it as "already there" would leave the main process where the older one left it.
 */
export const createMediaKeyHoldSender = (
    send: (wanted: boolean) => Promise<MediaKeyHoldAnswer | null | undefined>,
    onError: (wanted: boolean, error: unknown) => void,
) => {
    /** What the main process last accepted: null until a send landed and said the wish is in force. */
    let held: boolean | null = null;
    /** The wish on its way, or null: a newer one is only sent over a settled one. */
    let inFlight: boolean | null = null;
    const settles = (wanted: boolean) => {
        if (inFlight !== wanted) return false;
        inFlight = null;
        return true;
    };
    return {
        apply(wanted: boolean, force = false) {
            // Only with nothing on its way does a settled answer speak for the state: an outstanding
            // wish is older than this one, whatever it is.
            if (!force && (wanted === inFlight || (inFlight === null && wanted === held))) return;
            inFlight = wanted;
            void send(wanted).then(answer => {
                if (!settles(wanted)) return;
                if (answer?.enabled === wanted) {
                    held = wanted;
                    return;
                }
                // Not in force: the next change of state asks again, as it does after a failed send.
                console.warn(wanted
                    ? '[MediaKeys] the system did not give Folia the media keys'
                    : '[MediaKeys] the system still holds the media keys', answer);
            }, error => {
                if (settles(wanted)) onError(wanted, error);
            });
        },
        /** This bridge is leaving: the keys go back whatever the main process last accepted. */
        release() {
            if (held === false && inFlight !== true) return;
            inFlight = null;
            held = false;
            void Promise.resolve(send(false)).catch(error => onError(false, error));
        },
    };
};

type UseMediaKeyTakeoverBridgeParams = {
    /** One press of previous / play-pause / next, run the way the taskbar buttons run it. */
    runTransportAction: (action: TransportButtonAction) => void;
    /** Plays a song of the queue as the queue's own: the two presses at the end of a played-out list. */
    playSong: PlaySong;
};

const readHoldFacts = (): MediaKeyHoldFacts => {
    const song = getExternalSong();
    return {
        holdWhileRunning: useDesktopSettingsStore.getState().holdMediaKeysForExternalPlayer,
        playerAsksForAsLongAsFoliaRuns: omni.wantsMediaKeyTakeoverWhileRunning(),
        route: usePlaybackStore.getState().playbackRoute,
        externalSong: song,
        sessionDeclares: song !== null && omni.holdsExternalPlaybackMediaKeys(song),
    };
};

export function useMediaKeyTakeoverBridge({ runTransportAction, playSong }: UseMediaKeyTakeoverBridgeParams) {
    // Read here rather than passed in: these are the newest at the moment of a press, which comes
    // long after the render that registered them.
    const latestRef = useRef({ runTransportAction, playSong });
    useEffect(() => {
        latestRef.current = { runTransportAction, playSong };
    });

    useEffect(() => {
        const electron = window.electron;
        if (!electron?.setExternalMediaKeys || !electron.onExternalMediaKey) return;

        const holder = createMediaKeyHoldSender(
            wanted => electron.setExternalMediaKeys(wanted),
            (wanted, error) => {
                console.warn(wanted
                    ? '[MediaKeys] the media keys could not be taken'
                    : '[MediaKeys] the media keys could not be given back', error);
            },
        );
        // Read anew rather than remembered: the answer changes with the setting, the way the player
        // plays, the route and the player's session. Nothing is sent while it stays the same.
        const applyHold = () => holder.apply(shouldHoldMediaKeys(readHoldFacts()));

        const runPress = (action: TransportButtonAction) => {
            const state = usePlaybackStore.getState();
            const plan = planMediaKeyAction(action, isQueuePlayedOut(state));
            if (plan === 'transport') {
                latestRef.current.runTransportAction(action);
                return;
            }
            const song = plan === 'restart-list' ? state.playQueue[0] : state.playQueue[state.playQueue.length - 1];
            if (!song) return;
            console.info(`[MediaKeys] the queue is over; ${action} plays ${plan === 'restart-list' ? 'the list from its first song' : 'the song that just ended'} again`);
            void latestRef.current.playSong(song, state.playQueue, state.isFmMode, {
                shouldNavigateToPlayer: false,
                startAtSec: 0,
            });
        };

        const stopListening = electron.onExternalMediaKey(action => {
            // The app's own media session may receive the same press (useMediaSessionBridge): the two
            // paths share this record, so the press runs once.
            if (!mediaKeyPressGate.claim(action)) {
                console.info('[MediaKeys] the same press arrived twice; only the first one runs');
                return;
            }
            runPress(action);
        });

        // Sent whatever it is at the mount: the main process may hold what a window before this one
        // left, and this window is the one that answers a press from now on.
        holder.apply(shouldHoldMediaKeys(readHoldFacts()), true);
        const stopPlaybackWatch = usePlaybackStore.subscribe(applyHold);
        const stopSettingsWatch = useDesktopSettingsStore.subscribe(applyHold);
        // Every answer of the player, a paused session's included: the session coming or going is
        // what the answer turns on when the setting is off.
        const stopPlayerWatch = subscribeExternalPlayback(applyHold);
        // The way the player plays (which decides whether it asks at all) is picked in its setup.
        const stopAskingWatch = omni.subscribeMediaKeyTakeoverWanted(applyHold);
        return () => {
            stopAskingWatch();
            stopPlayerWatch();
            stopSettingsWatch();
            stopPlaybackWatch();
            stopListening();
            // The app, or this bridge, is leaving: the keys are given back whatever the session did.
            holder.release();
        };
    }, []);
}
