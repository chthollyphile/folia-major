import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { NextTrackOptions } from '../../../../types/appPlayback';
import { installExternalPlayback, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { stopExternalSpectrumCapture, syncExternalSpectrumForRoute } from '../externalSpectrumCapture';
import { omni } from '../../../../services/onlineMusic/omni';
import { useDesktopSettingsStore } from '../../../../stores/useDesktopSettingsStore';
import { runExternalPlayerWarmUp } from '../externalPlayerWake';
import { onlineFailureOf } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { onlineFailureToast } from '../source/onlineFailureToast';

// src/components/app/playback/bridges/useExternalPlaybackBridge.ts
// The React side of the external playback route: mounts its guard and shim, moves the queue on
// when the provider's player reports the end of a track, and tells the listener what it could not
// do. Transport controls live with the other routes' (usePlaybackTransportController), and the
// system media keys with useMediaKeyTakeoverBridge, which holds them across every route.
// The queue is Folia's while the player sounds: a step the player made by its own controls (reported
// as an end with `skipped`) is pulled back to the queue.

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
    // exactly as long as the route is the external player's, because Folia's own decks would
    // otherwise be captured too once it sounds a song itself. A new track gets a fresh attempt, in
    // case the capture died with the player that carried the last one.
    useEffect(() => {
        const sync = (
            state: ReturnType<typeof usePlaybackStore.getState>,
            previous?: ReturnType<typeof usePlaybackStore.getState>,
        ) => {
            const songChanged = !previous
                || previous.playbackRoute !== 'external'
                || previous.currentSong !== state.currentSong;
            syncExternalSpectrumForRoute(state.playbackRoute, songChanged);
        };
        sync(usePlaybackStore.getState());
        const unsubscribe = usePlaybackStore.subscribe(sync);
        return () => {
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
                // As <audio>'s ended handler does: nothing after this when the queue is over. The
                // player moved on by itself, so this play may not wake it again (T5).
                void latestRef.current.handleNextTrack({ allowStopOnMissing: true, shouldNavigateToPlayer: false, autoAdvance: true });
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
}
