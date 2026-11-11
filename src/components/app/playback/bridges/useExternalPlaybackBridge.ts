import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { NextTrackOptions } from '../../../../types/appPlayback';
import { getExternalSong, installExternalPlayback, isExternalRoute, stopForeignExternalPlayback, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { stopExternalSpectrumCapture, syncExternalSpectrumForRoute } from '../externalSpectrumCapture';
import { omni } from '../../../../services/onlineMusic/omni';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { useDesktopSettingsStore } from '../../../../stores/useDesktopSettingsStore';
import { runExternalPlayerWarmUp } from '../externalPlayerWake';
import { onlineFailureOf } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { onlineFailureToast } from '../source/onlineFailureToast';
import { adoptPlayerTrack, followsPlayerChangesForShownSong, followRunningExternalPlayer } from './externalPlayerFollow';

// src/components/app/playback/bridges/useExternalPlaybackBridge.ts
// The React side of the external playback route: mounts its guard and shim, moves the queue on
// when the provider's player reports the end of a track, and tells the listener what it could not
// do. Transport controls live with the other routes' (usePlaybackTransportController), and the
// system media keys with useMediaKeyTakeoverBridge, which holds them across every route.
// The queue is Folia's while the player sounds: a step the player made by its own controls (reported
// as an end with `skipped`) is pulled back to the queue. A player the listener keeps using by hand
// (`followsPlayerChanges`) is watched instead: a track they start there becomes the song this app
// shows, whether a song of Folia's was sounding in the player or nothing was.

/** How often a player the listener keeps using is read while nothing of Folia's sounds in it. */
const PLAYER_WATCH_INTERVAL_MS = 3000;

type UseExternalPlaybackBridgeParams = {
    handleNextTrack: (options?: NextTrackOptions) => Promise<void> | void;
    handlePrevTrack: (options?: { replayCurrentAtStart?: boolean }) => void;
};

export function useExternalPlaybackBridge({ handleNextTrack, handlePrevTrack }: UseExternalPlaybackBridgeParams) {
    // Read here rather than passed in: the callback and i18n are the newest at the moment of an event.
    const { t } = useTranslation();
    const latestRef = useRef({ handleNextTrack, handlePrevTrack, t });
    useEffect(() => {
        latestRef.current = { handleNextTrack, handlePrevTrack, t };
    });

    // The setting that wakes the players Folia steers but does not own: once per launch, and only
    // where the listener asked for it.
    useEffect(() => {
        void runExternalPlayerWarmUp(
            useDesktopSettingsStore.getState().wakeExternalPlayersOnLaunch,
            () => omni.warmUpExternalPlayers(),
        );
    }, []);

    // The external route's real spectrum, where the build can capture the machine's own sound: held
    // exactly as long as that sound is wanted, because Folia's own decks would otherwise be captured
    // too once it sounds a song itself. Wanting it takes the route, the provider's declaration and
    // the listener's switch (externalSpectrumCapture). A new track gets a fresh attempt, in case the
    // capture died with the player that carried the last one; so does turning the switch back on
    // mid-song, and a song whose provider declares the capture after one that did not.
    useEffect(() => {
        const sync = (songChanged: boolean) => {
            const state = usePlaybackStore.getState();
            const song = state.currentSong;
            syncExternalSpectrumForRoute({
                route: state.playbackRoute,
                capturesSystemAudio: song !== null && omni.externalPlaybackTraits(song).capturesSystemAudio,
                settingOn: useDesktopSettingsStore.getState().externalSystemAudioSpectrum,
            }, songChanged);
        };
        const onPlaybackChange = (
            state: ReturnType<typeof usePlaybackStore.getState>,
            previous: ReturnType<typeof usePlaybackStore.getState>,
        ) => {
            sync(previous.playbackRoute !== 'external' || previous.currentSong !== state.currentSong);
        };
        sync(true);
        const unsubscribe = usePlaybackStore.subscribe(onPlaybackChange);
        // The switch lives in the desktop settings store, not the playback store: turning it off has
        // to end a running capture at once, without waiting for a store change that never comes.
        const unsubscribeSettings = useDesktopSettingsStore.subscribe(() => sync(false));
        return () => {
            unsubscribeSettings();
            unsubscribe();
            stopExternalSpectrumCapture();
        };
    }, []);

    useEffect(() => {
        installExternalPlayback();
        return subscribeExternalPlayback(event => {
            if (event.type === 'ended') {
                if (event.skipped === 'previous') {
                    // The player was stepped back by its own controls: Folia's queue steps back, and at
                    // the head of the queue the current song starts over rather than the player staying
                    // on the track it moved to.
                    latestRef.current.handlePrevTrack({ replayCurrentAtStart: true });
                    return;
                }
                if (event.skipped === 'next') {
                    // Stepped on by its own controls: Folia's next song, and the queue's end stops it.
                    // A listener's press, so unlike an advance of its own it may start the player.
                    void latestRef.current.handleNextTrack({ allowStopOnMissing: true, shouldNavigateToPlayer: false });
                    return;
                }
                // Repeat one: the song that ended is the one to hear again, from its start. The
                // player is left to its own end (or to the song Folia wrote for it that it could not
                // give up), and the queue does not step on. Only for a song the player said it was
                // playing: an end reported before that one ever sounded is not its own end, and
                // replaying it there would restart it where it stands, over and over.
                if (event.heard
                    && useAudioSettingsStore.getState().loopMode === 'one'
                    && !usePlaybackStore.getState().isFmMode) {
                    void latestRef.current.handleNextTrack({
                        allowStopOnMissing: true, shouldNavigateToPlayer: false, autoAdvance: true, replayCurrent: true,
                    });
                    return;
                }
                // As <audio>'s ended handler does: nothing after this when the queue is over. The
                // player moved on by itself, so this play may not wake it again; a song that played
                // to its end is what may count as the queue having played out.
                void latestRef.current.handleNextTrack({
                    allowStopOnMissing: true, shouldNavigateToPlayer: false, autoAdvance: true, playedToEnd: true,
                });
                return;
            }
            if (event.type === 'track-changed') {
                // The player's own window moved it on: the track it names is taken over in place of
                // the song on screen, and the take-over's own session replaces this one. Where the
                // track cannot be looked up, the player is stopped as it always was.
                const current = usePlaybackStore.getState().currentSong;
                void (current
                    ? adoptPlayerTrack(current, event.status, {
                        isWanted: () => isExternalRoute() && getExternalSong() !== null,
                    })
                    : Promise.resolve('untouched')
                ).then(outcome => {
                    if (outcome !== 'adopted') stopForeignExternalPlayback();
                }, (error: unknown) => {
                    console.warn('[ExternalPlayback] the track the player moved on to could not be taken over', error);
                    stopForeignExternalPlayback();
                });
                return;
            }
            if (event.type === 'foreign-track') {
                setStatusMessage({ type: 'info', text: latestRef.current.t('status.externalPlayerMovedOn') });
                return;
            }
            if (event.type === 'degraded' && event.active) {
                // Once per episode: the service reports the change, and coming back resets it. A
                // status message, never a dialog: the songs still play, just steered coarsely.
                setStatusMessage({ type: 'info', text: latestRef.current.t('status.externalPlayerFallback') });
                return;
            }
            if (event.type === 'failure') {
                const song = usePlaybackStore.getState().currentSong;
                const providerId = song?.sourceRef?.kind === 'online' ? song.sourceRef.providerId : undefined;
                setStatusMessage(onlineFailureToast(
                    onlineFailureOf({ operation: 'audio', providerId }, { error: event.error }),
                    latestRef.current.t,
                ));
            }
        });
    }, []);

    // A player the listener keeps using beside Folia (`followsPlayerChanges`) is read slowly while
    // nothing of Folia's sounds in it: what they start there - another song, or the first one of the
    // evening - becomes the song this app shows, as a take-over at launch would. A session of this
    // route is not read again (its own polls follow the player), the page is not read while it is
    // hidden, and one read is on its way at a time. Reading a player starts nothing: a player that
    // is closed stays closed, and one left running is only asked what it is on.
    useEffect(() => {
        // A page is what makes a player watchable at all: the read is skipped where there is none.
        if (typeof document === 'undefined') return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let running = false;
        let stopped = false;
        const stop = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
        };
        const arm = () => {
            stop();
            if (stopped) return;
            timer = setTimeout(() => {
                timer = null;
                void tick();
            }, PLAYER_WATCH_INTERVAL_MS);
        };
        const tick = async () => {
            if (stopped) return;
            if (running || document.visibilityState === 'hidden') {
                arm();
                return;
            }
            // Nothing to watch where a session of this route already follows the player (its own polls
            // are the read), and nothing where the song on screen plays in a player whose listener
            // does not drive it by hand.
            const following = isExternalRoute() && getExternalSong() !== null;
            if (following || !followsPlayerChangesForShownSong()) {
                arm();
                return;
            }
            running = true;
            try {
                await followRunningExternalPlayer();
            } catch (error) {
                console.warn('[ExternalPlayback] the player the listener uses could not be read', error);
            } finally {
                running = false;
                arm();
            }
        };
        // A page shown again after a while reads the player at once rather than a full interval later.
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') stop();
            else arm();
        };
        document.addEventListener('visibilitychange', onVisibility);
        arm();
        return () => {
            stopped = true;
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);
}
