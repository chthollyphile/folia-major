import { useEffect, useMemo, useRef } from 'react';
import { PlayerState } from '../../types';

// src/components/remote/useRemoteClock.ts
// The remote window's one running clock. The main window sends the playback time every 500 ms;
// between two sends the clock runs on by itself, so the lyric fill and the progress line move
// every frame without a React render. Readers subscribe and write to the DOM themselves.

/** A snapshot that arrives this soon after a seek was sent may still carry the time from before it. */
const SEEK_SETTLE_MS = 800;

export interface RemoteClock {
    /** Playback time now, in seconds. */
    getTime: () => number;
    /** The time the line and the time text show: the position being dragged to, else the playback time. */
    getShownTime: () => number;
    getDuration: () => number;
    /** Called every frame while playing, and once after each change while not. Returns the unsubscribe. */
    subscribe: (listener: () => void) => () => void;
    /** The user is dragging the line to `time`. */
    previewSeek: (time: number) => void;
    /**
     * The drag ended: the previewed time stays shown until the player has caught up.
     * Null when nothing was previewed since the last release: there is nothing new to send.
     */
    releaseSeek: () => number | null;
    /** Drops a preview that was not released: the line and the time text go back to the song. */
    cancelSeek: () => void;
}

type UseRemoteClockParams = {
    /**
     * When the main window read `currentTime` (its Date.now()). Changes with every snapshot, so the
     * clock re-anchors even when the time did not move.
     */
    updatedAt: number;
    currentTime: number;
    duration: number;
    playerState: PlayerState;
};

export const useRemoteClock = ({ updatedAt, currentTime, duration, playerState }: UseRemoteClockParams): RemoteClock => {
    const isPlaying = playerState === PlayerState.PLAYING;
    const stateRef = useRef({
        anchorTime: currentTime,
        anchorAt: performance.now(),
        duration,
        isPlaying,
        seekPreview: null as number | null,
        isDragging: false,
        seekReleasedAt: 0,
    });
    const listenersRef = useRef(new Set<() => void>());

    const clock = useMemo<RemoteClock>(() => {
        const notify = () => listenersRef.current.forEach(listener => listener());
        const getTime = () => {
            const state = stateRef.current;
            if (!state.isPlaying) {
                return state.anchorTime;
            }
            const upperBound = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : Number.POSITIVE_INFINITY;
            return Math.min(upperBound, state.anchorTime + (performance.now() - state.anchorAt) / 1000);
        };

        return {
            getTime,
            getShownTime: () => stateRef.current.seekPreview ?? getTime(),
            getDuration: () => stateRef.current.duration,
            subscribe: listener => {
                listenersRef.current.add(listener);
                return () => {
                    listenersRef.current.delete(listener);
                };
            },
            previewSeek: time => {
                stateRef.current.isDragging = true;
                stateRef.current.seekPreview = time;
                notify();
            },
            releaseSeek: () => {
                const state = stateRef.current;
                if (!state.isDragging) {
                    return null;
                }
                state.isDragging = false;
                state.seekReleasedAt = Date.now();
                return state.seekPreview;
            },
            cancelSeek: () => {
                const state = stateRef.current;
                // A released preview is left alone: it is waiting for the player to catch up.
                if (!state.isDragging) {
                    return;
                }
                state.isDragging = false;
                state.seekPreview = null;
                notify();
            },
        };
    }, []);

    useEffect(() => {
        const state = stateRef.current;
        // While playing, the song has moved on since the main window read the time: anchoring to
        // that time as it is would run the clock back by the trip here at every snapshot that
        // arrives later than the one before. Both windows share the machine's clock.
        const sinceReadSec = isPlaying ? Math.max(0, Date.now() - updatedAt) / 1000 : 0;
        state.anchorTime = currentTime + sinceReadSec;
        state.anchorAt = performance.now();
        state.duration = duration;
        state.isPlaying = isPlaying;
        if (!state.isDragging && Date.now() - state.seekReleasedAt > SEEK_SETTLE_MS) {
            state.seekPreview = null;
        }
        listenersRef.current.forEach(listener => listener());
    }, [updatedAt, currentTime, duration, isPlaying]);

    useEffect(() => {
        if (!isPlaying) {
            return;
        }

        let frameId = 0;
        const tick = () => {
            listenersRef.current.forEach(listener => listener());
            frameId = requestAnimationFrame(tick);
        };
        frameId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameId);
    }, [isPlaying]);

    return clock;
};
