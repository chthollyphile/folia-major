import { memo, useEffect } from 'react';
import { useMotionValueEvent } from 'framer-motion';
import { currentTime } from '../../../../stores/motionSignals';
import { isInTrackEndCountdown, useTrackEndCountdownStore } from './trackEndCountdownStore';

// src/components/app/overlays/now-playing-toast/TrackEndCountdownHost.tsx
// Follows the playback clock and keeps trackEndCountdownStore's answer current, in a component of
// its own that draws nothing: App mounts it and is not re-rendered when the answer flips.

type TrackEndCountdownHostProps = {
    /** Something can show the preview and there is a track to preview. */
    enabled: boolean;
    /** Length of the track on screen, in seconds. */
    duration: number;
};

/** Mounted once by App; renders nothing. */
export const TrackEndCountdownHost = memo(function TrackEndCountdownHost({ enabled, duration }: TrackEndCountdownHostProps) {
    // The clock moves every frame; the store is written only when the answer changes.
    useMotionValueEvent(currentTime, 'change', (time) => {
        const active = isInTrackEndCountdown({ enabled, duration, time });
        const store = useTrackEndCountdownStore.getState();
        if (store.active !== active) store.setActive(active);
    });
    useEffect(() => () => useTrackEndCountdownStore.getState().setActive(false), []);
    return null;
});
