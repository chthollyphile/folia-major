import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { NextTrackOptions } from '../../../../types/appPlayback';
import { getExternalSong, installExternalPlayback, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
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
// The queue is Folia's while the player sounds: for a player that declares it, the system media keys
// are held for as long as its session exists and run Folia's previous / next / play-pause, and a step
// the player made by its own controls (reported as an end with `skipped`) is pulled back to the queue
// the same way.

type UseExternalPlaybackBridgeParams = {
    handleNextTrack: (options?: NextTrackOptions) => Promise<void> | void;
    handlePrevTrack: (options?: { replayCurrentAtStart?: boolean }) => void;
    /** One press of previous / play-pause / next, as the taskbar buttons make it. */
    runTransportAction: (action: TransportButtonAction) => void;
};

/**
 * Whether the media keys belong to the external player now: an external session exists (a paused one
 * too) and the provider of the song it holds declares that it keeps a media session of its own.
 */
const externalSessionHoldsMediaKeys = (): boolean => {
    if (usePlaybackStore.getState().playbackRoute !== 'external') return false;
    const song = getExternalSong();
    return song !== null && omni.holdsExternalPlaybackMediaKeys(song);
};

export function useExternalPlaybackBridge({ handleNextTrack, handlePrevTrack, runTransportAction }: UseExternalPlaybackBridgeParams) {
    // Read here rather than passed in: the callback and i18n are the newest at the moment of an event.
    const { t } = useTranslation();
    const latestRef = useRef({ handleNextTrack, handlePrevTrack, runTransportAction, t });
    useEffect(() => {
        latestRef.current = { handleNextTrack, handlePrevTrack, runTransportAction, t };
    });

    // The system media keys while the external player sounds: only a player that declares
    // `holdsMediaKeys` (one that keeps a media session of its own, and says why there) takes them, and
    // it takes them for as long as its session exists, a pause included. A key given back on a pause
    // does not come back to Folia: the system hands it to the app holding that session, which resumes
    // and moves on in its own queue instead of asking Folia (the declaration in the provider's own
    // folder records the measurement). Held, it runs Folia's queue; when the session ends — the
    // playback stops, another engine takes it, the queue is over — the keys are given back.
    useEffect(() => {
        const electron = window.electron;
        if (!electron?.setExternalMediaKeys || !electron.onExternalMediaKey) return;
        let held = false;
        // Read anew rather than remembered: the answer changes with the session, the route, and the
        // way the provider plays. Nothing is sent while the answer is the one already in force.
        const applyHold = () => {
            const wanted = externalSessionHoldsMediaKeys();
            if (wanted === held) return;
            held = wanted;
            void electron.setExternalMediaKeys(wanted).catch(error => {
                console.warn(wanted
                    ? '[ExternalPlayback] the media keys could not be taken'
                    : '[ExternalPlayback] the media keys could not be given back', error);
            });
        };
        const stopListening = electron.onExternalMediaKey(action => latestRef.current.runTransportAction(action));
        applyHold();
        const stopRouteWatch = usePlaybackStore.subscribe(applyHold);
        // Every answer of the player, a paused session's included: a change of the way the provider
        // plays is noticed here within one round of its clock.
        const stopPlayerWatch = subscribeExternalPlayback(applyHold);
        return () => {
            stopPlayerWatch();
            stopRouteWatch();
            stopListening();
            // The app, or this bridge, is leaving: the keys are given back whatever the session did.
            if (held) void electron.setExternalMediaKeys(false).catch(error => {
                console.warn('[ExternalPlayback] the media keys could not be given back', error);
            });
        };
    }, []);

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
