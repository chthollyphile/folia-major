import { backendPlayback, usesPlaybackBackend } from './controller';

// Small transport seams keep existing HTML media behavior intact when no backend is selected.

export const playbackPosition = (element: HTMLMediaElement | null) => usesPlaybackBackend()
    ? backendPlayback.getPosition() : element?.currentTime ?? 0;

export const seekPlayback = (element: HTMLMediaElement | null, seconds: number) => {
    if (usesPlaybackBackend()) return backendPlayback.seek(seconds);
    if (element) element.currentTime = seconds;
    return Promise.resolve();
};

export const pausePlaybackOutput = (element: HTMLMediaElement | null) => {
    if (usesPlaybackBackend()) return backendPlayback.pause();
    element?.pause();
    return Promise.resolve();
};
