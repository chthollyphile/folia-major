import { setGlobalVisualizerFramesPaused } from './frameRateLimiter';

// src/utils/visualActivity.ts
// Suspend the window's visual work without unloading renderers or pausing audio.
// OBS sources install no focus guard; recordings explicitly keep the captured window active.
let visualsPaused = false;
let recordingCount = 0;
let updateActivity: (() => void) | undefined;
const listeners = new Set<() => void>();
const PAUSE_INACTIVE_VISUALS_STORAGE_KEY = 'pause_inactive_visuals';
const readStoredPauseInactiveVisuals = () => {
    try {
        return localStorage.getItem(PAUSE_INACTIVE_VISUALS_STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
};
let pauseInactiveVisuals = readStoredPauseInactiveVisuals();
export const getPauseInactiveVisuals = () => pauseInactiveVisuals;

export const setPauseInactiveVisuals = (enabled: boolean) => {
    pauseInactiveVisuals = enabled;
    try {
        localStorage.setItem(PAUSE_INACTIVE_VISUALS_STORAGE_KEY, String(enabled));
    } catch { /* Keep the setting usable when storage is unavailable. */ }
    updateActivity?.();
};

export const areVisualsPaused = () => visualsPaused;
export const subscribeVisualActivity = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const keepVisualsActiveForRecording = () => {
    recordingCount += 1;
    updateActivity?.();
    let released = false;
    return () => {
        if (released) return;
        released = true;
        recordingCount -= 1;
        updateActivity?.();
    };
};

// Install before importing animation libraries: some capture RAF at module initialization.
export const installVisualActivityPause = () => {
    if (updateActivity) return;
    const pausedAnimations = new Set<Animation>();
    let nativeInactive: boolean | undefined;
    let nativeRevision = 0;
    let disposed = false;
    let scanTimer: ReturnType<typeof setInterval> | undefined;
    const style = document.createElement('style');
    style.textContent = `html[data-visuals-paused],
        html[data-visuals-paused]::before, html[data-visuals-paused]::after,
        html[data-visuals-paused] *,
        html[data-visuals-paused] *::before, html[data-visuals-paused] *::after {
        animation-play-state: paused !important;
    }`;
    document.head.appendChild(style);

    const pauseAnimations = () => {
        for (const animation of document.getAnimations()) {
            if (animation.playState !== 'running') continue;
            pausedAnimations.add(animation);
            animation.pause();
        }
    };
    const resumeAnimations = () => {
        for (const animation of pausedAnimations) {
            // A removed/cancelled animation must not be resurrected on focus.
            if (animation.playState === 'paused') animation.play();
        }
        pausedAnimations.clear();
    };
    const update = () => {
        const inactive = nativeInactive ?? (document.visibilityState !== 'visible' || !document.hasFocus());
        const paused = pauseInactiveVisuals && recordingCount === 0 && inactive;
        if (paused === visualsPaused) return;
        visualsPaused = paused;
        if (paused) {
            setGlobalVisualizerFramesPaused(true);
            pauseAnimations();
            document.documentElement.setAttribute('data-visuals-paused', '');
            // Also catch WAAPI animations created by asynchronous work while inactive.
            scanTimer = setInterval(pauseAnimations, 250);
        } else {
            clearInterval(scanTimer);
            scanTimer = undefined;
            document.documentElement.removeAttribute('data-visuals-paused');
            resumeAnimations();
        }
        // Clock/video subscribers catch up before any queued visual frame can run.
        listeners.forEach(listener => listener());
        if (!paused) setGlobalVisualizerFramesPaused(false);
    };
    updateActivity = update;
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    const unsubscribeNative = window.electron?.onVisualActivityChanged?.(inactive => {
        nativeRevision += 1;
        nativeInactive = inactive;
        update();
    });
    const refreshNative = () => {
        const revision = ++nativeRevision;
        void window.electron?.getVisualInactive?.().then(inactive => {
            if (disposed || revision !== nativeRevision) return;
            nativeInactive = inactive;
            update();
        }).catch(() => {});
    };
    const unsubscribeWallpaper = window.electron?.onWallpaperModeChanged?.(refreshNative);
    refreshNative();
    update();

    return () => {
        disposed = true;
        unsubscribeNative?.();
        unsubscribeWallpaper?.();
        window.removeEventListener('focus', update);
        window.removeEventListener('blur', update);
        document.removeEventListener('visibilitychange', update);
        clearInterval(scanTimer);
        document.documentElement.removeAttribute('data-visuals-paused');
        resumeAnimations();
        style.remove();
        updateActivity = undefined;
        visualsPaused = false;
        listeners.forEach(listener => listener());
        setGlobalVisualizerFramesPaused(false);
    };
};
