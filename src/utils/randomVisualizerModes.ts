import type { VisualizerMode } from '../types';
import { BUILTIN_VISUALIZER_MODES } from '../types/visualizerModes';

// The built-in styles eligible for per-song random selection; no renderer or tuning state lives here.
export type RandomVisualizerMode = typeof BUILTIN_VISUALIZER_MODES[number];

export const normalizeRandomVisualizerModes = (value: unknown): RandomVisualizerMode[] => {
    const selected = new Set(Array.isArray(value) ? value : []);
    const modes = BUILTIN_VISUALIZER_MODES.filter(mode => selected.has(mode));
    return modes.length > 0 ? modes : [...BUILTIN_VISUALIZER_MODES];
};

/** Picks within the saved selection, excluding the current style whenever another choice exists. */
export const pickRandomVisualizerMode = (
    modes: readonly VisualizerMode[],
    current: VisualizerMode,
    random: () => number = Math.random,
): RandomVisualizerMode => {
    const selected = normalizeRandomVisualizerModes(modes);
    const alternatives = selected.filter(mode => mode !== current);
    const candidates = alternatives.length > 0 ? alternatives : selected;
    return candidates[Math.floor(random() * candidates.length)];
};
