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

export const VISUALIZER_FRAME_RATE_OPTIONS: VisualizerFrameRate[] = ['auto', 120, 90, 60, 30, 15];
export const VISUALIZER_FRAME_RATE_STORAGE_KEY = 'visualizer_frame_rate';

export const isVisualizerFrameRate = (value: unknown): value is VisualizerFrameRate => (
    value === 'auto'
    || value === 120
    || value === 90
    || value === 60
    || value === 30
    || value === 15
);

export const parseVisualizerFrameRate = (value: string | null): VisualizerFrameRate => {
    if (value === 'auto' || value === null) {
        return 'auto';
    }

    const parsed = Number(value);
    return isVisualizerFrameRate(parsed) ? parsed : 'auto';
};

// Decides whether a RAF tick should run under the configured FPS cap.
export const shouldProcessFrameAtRate = (
    timestampMs: number,
    lastProcessedTimestampMs: number,
    frameRate: VisualizerFrameRate,
) => {
    if (frameRate === 'auto') {
        return true;
    }

    const intervalMs = 1000 / frameRate;
    return lastProcessedTimestampMs === 0 || timestampMs - lastProcessedTimestampMs >= intervalMs;
};

// Creates a shared RAF queue so every callback scheduled for an allowed frame flushes together.
export const createFrameRateLimitedRaf = (
    nativeRequestAnimationFrame: RequestAnimationFrameFn,
    nativeCancelAnimationFrame: CancelAnimationFrameFn,
    initialFrameRate: VisualizerFrameRate = 'auto',
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
        const frameCallbacks = Array.from(callbacks.entries());
        callbacks.clear();

        for (const [, callback] of frameCallbacks) {
            callback(timestamp);
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
    installedLimiter?.setFrameRate(frameRate);
};

export const installGlobalVisualizerFrameRateLimiter = () => {
    if (typeof window === 'undefined' || installedLimiter) {
        return;
    }

    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const initialFrameRate = parseVisualizerFrameRate(window.localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY));
    installedLimiter = createFrameRateLimitedRaf(nativeRequestAnimationFrame, nativeCancelAnimationFrame, initialFrameRate);

    window.requestAnimationFrame = installedLimiter.requestAnimationFrame;
    window.cancelAnimationFrame = installedLimiter.cancelAnimationFrame;
};
