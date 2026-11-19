import { useSyncExternalStore } from 'react';

// src/components/app/playback/surface/surfaceShowing.ts
// Whether a surface picture (plan §4.2) shows now: one is in the box (surfaceMount.ts) and the box is shown (the
// player page is the view, SurfacePlaybackHost.tsx). The stage reads it to leave its own background out over the
// picture, and only then: behind the home wall the stage keeps its background while the box is hidden. The stage's
// chunk is loaded with the mod API, so this file reaches nothing of omni or the external route
// (foliumServicesBoundary.test.ts, D114).

let pictureIn = false;
let boxShown = false;
let showing = false;
const listeners = new Set<() => void>();

const update = () => {
    const next = pictureIn && boxShown;
    if (showing === next) return;
    showing = next;
    for (const listener of listeners) listener();
};

/** For surfaceMount.ts: the picture went in or came out. */
export const setSurfacePictureIn = (next: boolean): void => {
    pictureIn = next;
    update();
};

/** For SurfacePlaybackHost.tsx: the box was shown or hidden. */
export const setSurfaceBoxShown = (next: boolean): void => {
    boxShown = next;
    update();
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const read = () => showing;

/** Whether a surface picture shows now: the player page leaves its own background out over it. */
export const isSurfaceShowing = (): boolean => showing;

/** isSurfaceShowing as React state. */
export const useSurfaceShowing = (): boolean => useSyncExternalStore(subscribe, read, () => false);
