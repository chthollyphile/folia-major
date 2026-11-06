import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { NextTrackOptions } from '../../../../types/appPlayback';
import { installExternalPlayback, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { omni } from '../../../../services/onlineMusic/omni';
import { useDesktopSettingsStore } from '../../../../stores/useDesktopSettingsStore';
import { runExternalPlayerWarmUp } from '../externalPlayerWake';
import { onlineFailureOf } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { onlineFailureToast } from '../source/onlineFailureToast';
import type { TransportButtonAction } from './useTransportCommandRefs';

// src/components/app/playback/bridges/useExternalPlaybackBridge.ts
// The React side of the external playback route: mounts its guard and shim, moves the queue on
// when the provider's player reports the end of a track, and tells the listener what it could not
// do. Transport controls live with the other routes' (usePlaybackTransportController).
// The queue is Folia's while the player sounds: the system media keys are held for as long as the
// route is the external one and run Folia's previous / next / play-pause, and a step the player made
// by its own controls (reported as an end with `skipped`) is pulled back to the queue the same way.

type UseExternalPlaybackBridgeParams = {
    handleNextTrack: (options?: NextTrackOptions) => Promise<void> | void;
    handlePrevTrack: (options?: { replayCurrentAtStart?: boolean }) => void;
    /** One press of previous / play-pause / next, as the taskbar buttons make it. */
    runTransportAction: (action: TransportButtonAction) => void;
};

export function useExternalPlaybackBridge({ handleNextTrack, handlePrevTrack, runTransportAction }: UseExternalPlaybackBridgeParams) {
    // Read here rather than passed in: the callback and i18n are the newest at the moment of an event.
    const { t } = useTranslation();
    const latestRef = useRef({ handleNextTrack, handlePrevTrack, runTransportAction, t });
    useEffect(() => {
        latestRef.current = { handleNextTrack, handlePrevTrack, runTransportAction, t };
    });

    // The system media keys belong to the player that sounded last, and that is the external
    // player's own app, which would move on in its own queue. While this route is on, Folia holds
    // the keys and runs its queue; leaving the route (or the app) gives them back.
    const isExternalRouteActive = usePlaybackStore(state => state.playbackRoute === 'external');
    useEffect(() => {
        const electron = window.electron;
        if (!isExternalRouteActive || !electron?.setExternalMediaKeys || !electron.onExternalMediaKey) return;
        void electron.setExternalMediaKeys(true).catch(error => {
            console.warn('[ExternalPlayback] the media keys could not be taken', error);
        });
        const stopListening = electron.onExternalMediaKey(action => latestRef.current.runTransportAction(action));
        return () => {
            stopListening();
            void electron.setExternalMediaKeys(false).catch(error => {
                console.warn('[ExternalPlayback] the media keys could not be given back', error);
            });
        };
    }, [isExternalRouteActive]);

    // The setting that wakes the players Folia steers but does not own: once per launch, and only
    // where the listener asked for it.
    useEffect(() => {
        void runExternalPlayerWarmUp(
            useDesktopSettingsStore.getState().wakeExternalPlayersOnLaunch,
            () => omni.warmUpExternalPlayers(),
        );
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
            if (event.type === 'advertisement') {
                if (!event.active) return;
                // The player's own advertisement between songs: Folia says so instead of drawing
                // the queued song, and reads no lyrics for it.
                setStatusMessage({ type: 'info', text: latestRef.current.t('status.externalPlayerAdvertisement') });
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
