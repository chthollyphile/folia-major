// src/utils/frameRateLimiter.ts
// Shared helpers and global RAF gate for optional visualizer frame throttling.

import type { VisualizerFrameRate } from '../types';

type AnimationFrameCallback = FrameRequestCallback;
type RequestAnimationFrameFn = (callback: AnimationFrameCallback) => number;
type CancelAnimationFrameFn = (handle: number) => void;

type FrameRateLimitedRaf = {
    requestAnimationFrame: RequestAnimationFrameFn;
    cancelAnimationFrame: CancelAnimationFrameFn;
    setFrameRate: (frameRate: VisualizerFrameRate) => void;
    getFrameRate: () => VisualizerFrameRate;
};

type WindowWithVisualizerFrameRateLimiter = Window & {
    __foliaNativeRequestAnimationFrame?: RequestAnimationFrameFn;
    __foliaNativeCancelAnimationFrame?: CancelAnimationFrameFn;
};

export const VISUALIZER_FRAME_RATE_OPTIONS = [60, 90, 120] as const satisfies VisualizerFrameRate[];
export const VISUALIZER_FRAME_RATE_STORAGE_KEY = 'visualizer_frame_rate';
const FRAME_INTERVAL_TOLERANCE_MS = 1;

export const isVisualizerFrameRate = (value: unknown): value is VisualizerFrameRate => (
    value === 'off'
    || value === 120
    || value === 90
    || value === 60
);

export const parseVisualizerFrameRate = (value: string | null): VisualizerFrameRate => {
    if (value === 'off' || value === 'auto' || value === null) {
        return 'off';
    }

    const parsed = Number(value);
    return isVisualizerFrameRate(parsed) ? parsed : 'off';
};

// Decides whether a RAF tick should run under the configured FPS cap.
export const shouldProcessFrameAtRate = (
    timestampMs: number,
    lastProcessedTimestampMs: number,
    frameRate: VisualizerFrameRate,
) => {
    if (frameRate === 'off') {
        return true;
    }

    const intervalMs = 1000 / frameRate - FRAME_INTERVAL_TOLERANCE_MS;
    return lastProcessedTimestampMs === 0 || timestampMs - lastProcessedTimestampMs >= intervalMs;
};

const reportAnimationFrameCallbackError = (error: unknown) => {
    console.error('Error in requestAnimationFrame callback:', error);
    setTimeout(() => {
        throw error;
    }, 0);
};

// Creates a shared RAF queue so every callback scheduled for an allowed frame flushes together.
export const createFrameRateLimitedRaf = (
    nativeRequestAnimationFrame: RequestAnimationFrameFn,
    nativeCancelAnimationFrame: CancelAnimationFrameFn,
    initialFrameRate: VisualizerFrameRate = 60,
): FrameRateLimitedRaf => {
    let frameRate = initialFrameRate;
    let nextHandle = 1;
    let nativeFrameHandle: number | null = null;
    let lastProcessedTimestamp = 0;
    const callbacks = new Map<number, AnimationFrameCallback>();

    const scheduleNativeFrame = () => {
        if (nativeFrameHandle !== null || callbacks.size === 0) {
            return;
        }

        nativeFrameHandle = nativeRequestAnimationFrame(processNativeFrame);
    };

    const processNativeFrame = (timestamp: number) => {
        nativeFrameHandle = null;

        if (!shouldProcessFrameAtRate(timestamp, lastProcessedTimestamp, frameRate)) {
            scheduleNativeFrame();
            return;
        }

        lastProcessedTimestamp = timestamp;
        const frameHandles = Array.from(callbacks.keys());

        for (const handle of frameHandles) {
            // Match native RAF: an earlier callback may cancel a later one in the same frame.
            const callback = callbacks.get(handle);
            if (!callback) continue;
            callbacks.delete(handle);
            try {
                callback(timestamp);
            } catch (error) {
                reportAnimationFrameCallbackError(error);
            }
        }

        scheduleNativeFrame();
    };

    return {
        requestAnimationFrame: (callback) => {
            const handle = nextHandle;
            nextHandle += 1;
            callbacks.set(handle, callback);
            scheduleNativeFrame();
            return handle;
        },
        cancelAnimationFrame: (handle) => {
            callbacks.delete(handle);
            if (callbacks.size === 0 && nativeFrameHandle !== null) {
                nativeCancelAnimationFrame(nativeFrameHandle);
                nativeFrameHandle = null;
            }
        },
        setFrameRate: (nextFrameRate) => {
            frameRate = nextFrameRate;
            lastProcessedTimestamp = 0;

            if (nativeFrameHandle !== null) {
                nativeCancelAnimationFrame(nativeFrameHandle);
                nativeFrameHandle = null;
            }
            scheduleNativeFrame();
        },
        getFrameRate: () => frameRate,
    };
};

let installedLimiter: FrameRateLimitedRaf | null = null;

export const setGlobalVisualizerFrameRate = (frameRate: VisualizerFrameRate) => {
    if (typeof window === 'undefined') {
        return;
    }

    if (frameRate === 'off') {
        restoreGlobalVisualizerFrameRateLimiter();
        return;
    }

    if (!installedLimiter) {
        installGlobalVisualizerFrameRateLimiter(frameRate);
        return;
    }

    installedLimiter.setFrameRate(frameRate);
};

// Asks for the display's next frame, past the cap. For work that has to land in the same frame as
// something the cap does not hold back: a library that took `requestAnimationFrame` before the cap
// was switched on (framer-motion does, when its module loads) keeps running on every display frame.
export const requestUncappedAnimationFrame = (callback: AnimationFrameCallback): number => {
    const frameWindow = window as WindowWithVisualizerFrameRateLimiter;
    return (frameWindow.__foliaNativeRequestAnimationFrame ?? window.requestAnimationFrame).call(window, callback);
};

// Cancels a frame asked for with `requestUncappedAnimationFrame`.
export const cancelUncappedAnimationFrame = (handle: number) => {
    const frameWindow = window as WindowWithVisualizerFrameRateLimiter;
    (frameWindow.__foliaNativeCancelAnimationFrame ?? window.cancelAnimationFrame).call(window, handle);
};

export const restoreGlobalVisualizerFrameRateLimiter = () => {
    if (typeof window === 'undefined') {
        return;
    }

    const frameWindow = window as WindowWithVisualizerFrameRateLimiter;
    if (frameWindow.__foliaNativeRequestAnimationFrame) {
        window.requestAnimationFrame = frameWindow.__foliaNativeRequestAnimationFrame;
    }
    if (frameWindow.__foliaNativeCancelAnimationFrame) {
        window.cancelAnimationFrame = frameWindow.__foliaNativeCancelAnimationFrame;
    }
    installedLimiter = null;
};

export const installGlobalVisualizerFrameRateLimiter = (overrideFrameRate?: VisualizerFrameRate) => {
    if (typeof window === 'undefined') {
        return;
    }

    const initialFrameRate = overrideFrameRate
        ?? parseVisualizerFrameRate(window.localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY));
    if (initialFrameRate === 'off') {
        restoreGlobalVisualizerFrameRateLimiter();
        return;
    }

    if (installedLimiter) {
        installedLimiter.setFrameRate(initialFrameRate);
        return;
    }

    const frameWindow = window as WindowWithVisualizerFrameRateLimiter;
    frameWindow.__foliaNativeRequestAnimationFrame ??= window.requestAnimationFrame;
    frameWindow.__foliaNativeCancelAnimationFrame ??= window.cancelAnimationFrame;
    const nativeRequestAnimationFrame: RequestAnimationFrameFn = (callback) => (
        frameWindow.__foliaNativeRequestAnimationFrame?.call(window, callback) ?? 0
    );
    const nativeCancelAnimationFrame: CancelAnimationFrameFn = (handle) => {
        frameWindow.__foliaNativeCancelAnimationFrame?.call(window, handle);
    };
    installedLimiter = createFrameRateLimitedRaf(nativeRequestAnimationFrame, nativeCancelAnimationFrame, initialFrameRate);

    window.requestAnimationFrame = installedLimiter.requestAnimationFrame;
    window.cancelAnimationFrame = installedLimiter.cancelAnimationFrame;
};
