import { create } from 'zustand';

// src/mods/visualizerModulation.ts
// Generic renderer-side modulation channel between mods and builtin visualizers.
// A mod writes real-time multipliers / strengths for a mode (e.g. "sonnet"); the
// visualizer reads them every frame without recreating its render context. The
// channel is renderer-local on purpose: no IPC round-trip is needed to modulate
// an animation that is already running in React / Pixi.

const EMPTY_MODULATION: Record<string, number> = Object.freeze({});

interface ModVisualizerModulationState {
    byMode: Record<string, Record<string, number>>;
    setModulation: (mode: string, patch: Record<string, number>) => void;
    resetModulation: (mode?: string) => void;
}

export const useModVisualizerModulationStore = create<ModVisualizerModulationState>((set) => ({
    byMode: {},
    setModulation: (mode, patch) => set((state) => ({
        byMode: {
            ...state.byMode,
            [mode]: { ...(state.byMode[mode] ?? {}), ...patch },
        },
    })),
    resetModulation: (mode) => set((state) => {
        if (!mode) {
            return { byMode: {} };
        }
        const next = { ...state.byMode };
        delete next[mode];
        return { byMode: next };
    }),
}));

/**
 * Subscribes a component to the current modulation map for `mode`. Returns a
 * stable empty object when no mod has written anything, so callers re-render
 * only when a value actually changes.
 */
export const useModVisualizerModulation = (mode: string): Record<string, number> =>
    useModVisualizerModulationStore((state) => state.byMode[mode] ?? EMPTY_MODULATION);

export const setVisualizerModulation = (mode: string, patch: Record<string, number>): void =>
    useModVisualizerModulationStore.getState().setModulation(mode, patch);

export const resetVisualizerModulation = (mode?: string): void =>
    useModVisualizerModulationStore.getState().resetModulation(mode);