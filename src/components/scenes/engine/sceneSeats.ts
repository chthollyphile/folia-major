import { useSyncExternalStore } from 'react';
import type { SceneAnchor } from '../definition';

// src/components/scenes/engine/sceneSeats.ts
// The seats the running scene published (its seat anchors), for the seat map. The host sets them once
// the scene is loaded and clears them when it stops, so the seat map never imports a scene's code.

export type SeatAnchor = Extract<SceneAnchor, { kind: 'seat' }>;

const NO_SEATS: readonly SeatAnchor[] = [];
let published: { sceneId: string; seats: readonly SeatAnchor[] } | null = null;
const listeners = new Set<() => void>();

/** Sets the running scene's seats; `null` clears them if they are still that scene's. */
export const publishSceneSeats = (sceneId: string, seats: readonly SeatAnchor[] | null) => {
    if (!seats && published?.sceneId !== sceneId) return;
    published = seats ? { sceneId, seats } : null;
    listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
const read = () => published;

/** The seats of that scene while it runs; empty otherwise. */
export const useSceneSeats = (sceneId: string | undefined): readonly SeatAnchor[] => {
    const current = useSyncExternalStore(subscribe, read, read);
    return current && current.sceneId === sceneId ? current.seats : NO_SEATS;
};
