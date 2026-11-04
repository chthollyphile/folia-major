import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { NextTrackOptions } from '../../../../types/appPlayback';
import { installExternalPlayback, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { onlineFailureOf } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { onlineFailureToast } from '../source/onlineFailureToast';

// src/components/app/playback/bridges/useExternalPlaybackBridge.ts
// The React side of the external playback route: mounts its guard and shim, moves the queue on
// when the provider's player reports the end of a track, and tells the listener what it could not
// do. Transport controls live with the other routes' (usePlaybackTransportController).

type UseExternalPlaybackBridgeParams = {
    handleNextTrack: (options?: NextTrackOptions) => Promise<void> | void;
};

export function useExternalPlaybackBridge({ handleNextTrack }: UseExternalPlaybackBridgeParams) {
    // Read here rather than passed in: the callback and i18n are the newest at the moment of an event.
    const { t } = useTranslation();
    const latestRef = useRef({ handleNextTrack, t });
    useEffect(() => {
        latestRef.current = { handleNextTrack, t };
    });

    useEffect(() => {
        installExternalPlayback();
        return subscribeExternalPlayback(event => {
            if (event.type === 'ended') {
                // As <audio>'s ended handler does: nothing after this when the queue is over.
                void latestRef.current.handleNextTrack({ allowStopOnMissing: true, shouldNavigateToPlayer: false });
                return;
            }
            if (event.type === 'foreign-track') {
                setStatusMessage({ type: 'info', text: latestRef.current.t('status.externalPlayerMovedOn') });
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
