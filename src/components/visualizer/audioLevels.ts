// src/components/visualizer/audioLevels.ts
// Defines the analyser-scale contract shared by live playback and visualizer preview sources.

export const VISUALIZER_AUDIO_MAX = 255;

export const normalizeVisualizerAudioLevel = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value / VISUALIZER_AUDIO_MAX));
};

export const toVisualizerAudioLevel = (normalizedValue: number): number => {
    if (!Number.isFinite(normalizedValue)) return 0;
    return Math.min(VISUALIZER_AUDIO_MAX, Math.max(0, normalizedValue * VISUALIZER_AUDIO_MAX));
};
