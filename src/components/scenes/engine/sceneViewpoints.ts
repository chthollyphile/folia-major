import { useSyncExternalStore } from 'react';
import type { SceneAnchor } from '../definition';

// src/components/scenes/engine/sceneViewpoints.ts
// The viewpoints the running scene published (its viewpoint anchors), for the seat map. The host sets them once
// the scene is loaded and clears them when it stops, so the seat map never imports a scene's code.

export type ViewpointAnchor = Extract<SceneAnchor, { kind: 'viewpoint' }>;

const NO_VIEWPOINTS: readonly ViewpointAnchor[] = [];
let published: { sceneId: string; viewpoints: readonly ViewpointAnchor[] } | null = null;
const listeners = new Set<() => void>();

/** Sets the running scene's viewpoints; `null` clears them if they are still that scene's. */
export const publishSceneViewpoints = (sceneId: string, viewpoints: readonly ViewpointAnchor[] | null) => {
    if (!viewpoints && published?.sceneId !== sceneId) return;
    published = viewpoints ? { sceneId, viewpoints } : null;
    listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
const read = () => published;

/** The viewpoints of that scene while it runs; empty otherwise. */
export const useSceneViewpoints = (sceneId: string | undefined): readonly ViewpointAnchor[] => {
    const current = useSyncExternalStore(subscribe, read, read);
    return current && current.sceneId === sceneId ? current.viewpoints : NO_VIEWPOINTS;
};
