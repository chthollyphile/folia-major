import { useShallow } from 'zustand/react/shallow';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { collectVisualizerTunings, type VisualizerTuningMap } from './tuningRegistry';

// src/components/visualizer/useVisualizerTunings.ts
//
// The per-visualizer tuning bundle. Two surfaces publish it - the on-screen renderer and the OBS
// browser source - and App.tsx assembled it for both, which is the only reason it lived there.
// It is collected from the styles' tuning.ts files, so a style's tuning needs no line here.

// The store holds a tuning for every style that has a tuning.ts, so every key is present; readers
// such as App.tsx take a style's tuning without a guard.
export const useVisualizerTunings = () => useVisualizerSettingsStore(useShallow(state => (
    collectVisualizerTunings(state as unknown as Record<string, unknown>) as VisualizerTuningMap
)));
