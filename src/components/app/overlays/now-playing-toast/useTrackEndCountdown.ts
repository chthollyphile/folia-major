import { useRef, useState } from 'react';
import { useMotionValueEvent } from 'framer-motion';
import { currentTime } from '../../../../stores/motionSignals';

// src/components/app/overlays/now-playing-toast/useTrackEndCountdown.ts
// Whether the now playing card is previewing the queue's next track: the last seconds of a track
// that ends plainly (a blend announces its own, see App's blendNextUpTrack).

/** How many seconds before a track ends the now playing card previews the queue's next track. */
const NEXT_UP_LEAD_SEC = 5;

type UseTrackEndCountdownParams = {
    /** Something can show the preview and there is a track to preview. */
    enabled: boolean;
    /** Length of the track on screen, in seconds. */
    duration: number;
};

/** True during the last NEXT_UP_LEAD_SEC seconds of the track on screen, while `enabled`. */
export function useTrackEndCountdown({ enabled, duration }: UseTrackEndCountdownParams): boolean {
    const [countdownActive, setCountdownActive] = useState(false);
    // The playback clock moves every frame. The setter is called only when the answer changes: a
    // same-value setState right after a commit is not skipped by React, it re-runs the component
    // that calls this hook (the whole of App) once more before bailing out.
    const countdownActiveRef = useRef(false);
    useMotionValueEvent(currentTime, 'change', (time) => {
        const shouldPreview = enabled
            && Number.isFinite(duration)
            && duration > 0
            && duration - time > 0
            && duration - time <= NEXT_UP_LEAD_SEC;
        if (countdownActiveRef.current === shouldPreview) return;
        countdownActiveRef.current = shouldPreview;
        setCountdownActive(shouldPreview);
    });
    return countdownActive;
}
