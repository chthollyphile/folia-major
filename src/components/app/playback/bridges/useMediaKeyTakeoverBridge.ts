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
// Holding is the only way to keep a press: a key Folia lets go goes to the other program's own media
// session (electron/mediaKeys.cjs; why that session outlasts the song is in
// docs/spotify-official-client.md). Who may ask for them is the provider's own declaration, answered
// through omni: Folia knows only that some player asks, never which one. Held, a press runs Folia's own
// transport and queue on whatever route the song on screen sounds: that program's player, this app's
// decks, or mpv. Where no provider declares them, nothing is held and the app's own media session
// behaves exactly as it did before this route existed.

type PlaySong = (
    song: SongResult,
    queue: SongResult[],
    isFm: boolean,
    options?: PlaybackNavigationOptions,
) => Promise<void>;

/**
 * What the decision to hold the keys is made of. Read anew on every change, never remembered.
 *
 * The song is the whole answer: `getExternalSong` is the track this window started in the player (or
 * adopted from a window it replaced), and it is null while Folia's own decks sound or the player
 * holds nothing. A track the player's own window put on is paused by Folia and never becomes the
 * session's song (externalPlayback's `applyStatus`), so it is not one Folia answers for.
 */
export type MediaKeyHoldFacts = {
    /** The switch: let Folia hold the keys at all. */
    settingOn: boolean;
    /** The route the song on screen sounds on. */
    route: string;
    /** The song this window started in the external player, null when it holds none. */
    externalSong: SongResult | null;
    /** That song's player declared the keys are Folia's while it sounds (see omni). */
    holdsMediaKeysWhilePlaying: boolean;
};

/**
 * Whether Folia holds the media keys now: only while a song it started sounds in a player whose
 * provider declares `holdsMediaKeysWhilePlaying`, and only with the listener's switch on.
 *
 * Every other state is the upstream behaviour, where the app's own media session keeps the keys:
 * a local or built-in song sounding, the external player idle or stopped, the switch off, and a
 * player that declares nothing about the keys (Soloist). A key Folia does not hold goes to whichever
 * program the system hands it to, exactly as before this route existed - a player whose session is
 * left to itself keeps its own behaviour, which is what the provider declares by leaving the field
 * out.
 */
export const shouldHoldMediaKeys = (facts: MediaKeyHoldFacts): boolean => (
    facts.settingOn
    && facts.route === 'external'
    && facts.externalSong !== null
    && facts.holdsMediaKeysWhilePlaying
);

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
 * At the end of a played-out queue the transport has nothing to step to, so play and next start the
 * list over from its first song (a shuffle reorders the queue itself, so its first song is the one the
 * listener would start with; nothing plays out under a repeat mode), and previous replays the song
 * that just ended rather than doing nothing.
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
 * Only an answer that came back saying the wish is in force counts as done: a failed send leaves the
 * wish outstanding, and so does one the main process could not carry out - the system refusing a key
 * is answered as `enabled: false` (electron/mediaKeys.cjs), and reading that as done would leave
 * Folia believing it holds keys another program took. A wish is compared with the one on its way
 * before the last answer, so an opposite wish is never dropped as already there.
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
            // `force` sends regardless: the mount, whose main process may hold what a window before
            // this one left.
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
            }, (error: unknown) => {
                if (settles(wanted)) onError(wanted, error);
            });
        },
        /** This bridge is leaving: the keys go back whatever the main process last accepted. */
        release() {
            if (held === false && inFlight !== true) return;
            inFlight = null;
            held = false;
            void Promise.resolve(send(false)).catch((error: unknown) => onError(false, error));
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
        settingOn: useDesktopSettingsStore.getState().holdMediaKeysForExternalPlayer,
        route: usePlaybackStore.getState().playbackRoute,
        externalSong: song,
        holdsMediaKeysWhilePlaying: song !== null && omni.externalPlaybackTraits(song).holdsMediaKeysWhilePlaying,
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
        if (!electron) return;
        const { setExternalMediaKeys, onExternalMediaKey } = electron;
        if (typeof setExternalMediaKeys !== 'function' || typeof onExternalMediaKey !== 'function') return;

        const holder = createMediaKeyHoldSender(
            wanted => setExternalMediaKeys(wanted),
            (wanted, error) => {
                console.warn(wanted
                    ? '[MediaKeys] the media keys could not be taken'
                    : '[MediaKeys] the media keys could not be given back', error);
            },
        );
        // Read anew rather than remembered: the answer changes with the setting, the route and the
        // song the player holds. Nothing is sent while it stays the same.
        const applyHold = () => holder.apply(shouldHoldMediaKeys(readHoldFacts()));

        const runPress = (action: TransportButtonAction) => {
            const state = usePlaybackStore.getState();
            const plan = planMediaKeyAction(action, isQueuePlayedOut(state));
            if (plan === 'transport') {
                latestRef.current.runTransportAction(action);
                return;
            }
            const song = plan === 'restart-list' ? state.playQueue.at(0) : state.playQueue.at(-1);
            if (!song) return;
            console.info(`[MediaKeys] the queue is over; ${action} plays ${plan === 'restart-list' ? 'the list from its first song' : 'the song that just ended'} again`);
            void latestRef.current.playSong(song, state.playQueue, state.isFmMode, {
                shouldNavigateToPlayer: false,
                startAtSec: 0,
            });
        };

        const stopListening = onExternalMediaKey(action => {
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
        // Every answer of the player: the song it holds, and whether it is sounding one at all, is
        // what the answer turns on.
        const stopPlayerWatch = subscribeExternalPlayback(applyHold);
        return () => {
            stopPlayerWatch();
            stopSettingsWatch();
            stopPlaybackWatch();
            stopListening();
            // The app, or this bridge, is leaving: the keys are given back whatever the session did.
            holder.release();
        };
    }, []);
}
