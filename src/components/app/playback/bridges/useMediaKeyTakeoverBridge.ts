import { useEffect, useRef } from 'react';
import { PlayerState } from '../../../../types';
import type { SongResult } from '../../../../types';
import type { PlaybackNavigationOptions } from '../../../../types/appPlayback';
import { getExternalSong, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { omni } from '../../../../services/onlineMusic/omni';
import { useDesktopSettingsStore } from '../../../../stores/useDesktopSettingsStore';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
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

/**
 * Whether a press is the same one arriving twice: the keys held on globalShortcut and this app's own
 * media session (useMediaSessionBridge) must not both run one physical press. The shortcut takes the
 * key from the system before the session sees it, so only one of the two runs it; this is the guard
 * for the case where both do, and it is far shorter than any second press of the same key.
 */
const SAME_PRESS_MS = 120;

export const isRepeatedMediaKeyPress = (
    previous: { action: TransportButtonAction; atMs: number } | null,
    action: TransportButtonAction,
    nowMs: number,
): boolean => previous !== null && previous.action === action && nowMs - previous.atMs < SAME_PRESS_MS;

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

        let held = false;
        // Read anew rather than remembered: the answer changes with the setting, the way the player
        // plays, the route and the player's session. Nothing is sent while it stays the same.
        const applyHold = () => {
            const wanted = shouldHoldMediaKeys(readHoldFacts());
            if (wanted === held) return;
            held = wanted;
            void electron.setExternalMediaKeys(wanted).catch(error => {
                console.warn(wanted
                    ? '[MediaKeys] the media keys could not be taken'
                    : '[MediaKeys] the media keys could not be given back', error);
            });
        };

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

        let lastPress: { action: TransportButtonAction; atMs: number } | null = null;
        const stopListening = electron.onExternalMediaKey(action => {
            const nowMs = performance.now();
            if (isRepeatedMediaKeyPress(lastPress, action, nowMs)) {
                console.info('[MediaKeys] the same press arrived twice; only the first one runs');
                return;
            }
            lastPress = { action, atMs: nowMs };
            runPress(action);
        });

        applyHold();
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
            if (held) void electron.setExternalMediaKeys(false).catch(error => {
                console.warn('[MediaKeys] the media keys could not be given back', error);
            });
        };
    }, []);
}
