import { useEffect, useMemo, type RefObject } from 'react';
import type { MotionValue } from 'framer-motion';
import { createTimePulse, trackRestTime } from './livePreviewFeed';

// src/components/visualizer/preview/stillClockPulse.ts
// A style tells a word where the time is only when the time changes, and a style is lazy: its code
// arrives, and it is mounted, when it arrives. A preview whose clock stands still (paused, or the
// player itself paused) has no change to give it, so what is mounted into the preview's box is the
// cue to stir the clock for a short while (createTimePulse).

/** How long the box has to stay quiet after something is mounted in it before the clock is stirred. */
const MOUNT_SETTLE_MS = 100;

/**
 * Calls `onMount` once the box has been quiet for MOUNT_SETTLE_MS after nodes were added to it.
 * Nodes taken away are no cue (an exit animation ending), and nothing is noticed while `isBusy`:
 * the stirring itself makes words change and mount.
 */
export const observeMounts = (box: HTMLElement, onMount: () => void, isBusy: () => boolean): (() => void) => {
    let timer: number | undefined;
    const observer = new MutationObserver((records) => {
        if (isBusy() || !records.some(record => record.addedNodes.length > 0)) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(onMount, MOUNT_SETTLE_MS);
    });
    observer.observe(box, { childList: true, subtree: true });
    return () => {
        observer.disconnect();
        window.clearTimeout(timer);
    };
};

type StillClockPulseOptions = {
    /** The clock the preview draws from. */
    time: MotionValue<number>;
    /** The clock stands still: the preview is paused. */
    still: boolean;
    /** The box the preview is drawn in. */
    boxRef: RefObject<HTMLElement | null>;
    /** Changes when the preview is drawn from something else, which mounts it anew. */
    restartKey: string;
};

/** Stirs the clock of a paused sample preview, now and whenever something is mounted in its box. */
export const useStillClockPulse = ({ time, still, boxRef, restartKey }: StillClockPulseOptions) => {
    const pulse = useMemo(() => createTimePulse(time), [time]);
    useEffect(() => {
        const box = boxRef.current;
        if (!still || !box) return undefined;
        // The sample starts over when its style changes, whatever the pulse was resting on.
        const rest = trackRestTime(time);
        const stir = () => {
            if (!pulse.running()) pulse.start(rest.get);
        };
        stir();
        const stop = observeMounts(box, stir, pulse.running);
        return () => {
            stop();
            pulse.stop();
            rest.stop();
        };
    }, [still, time, pulse, boxRef, restartKey]);
};
