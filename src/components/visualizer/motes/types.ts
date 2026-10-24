// Motes' particle density, spatial depth, lyric motion, and audio response settings.
export interface MotesTuning {
    density: number;
    scatter: number;
    transition: number;
    depth: number;
    drift: number;
    audioResponse: number;
}

export const DEFAULT_MOTES_TUNING: MotesTuning = {
    density: 1,
    scatter: 1,
    transition: 0.45,
    depth: 0.7,
    drift: 0.6,
    audioResponse: 0.25,
};

export const MOTES_TUNING_LIMITS = {
    density: { min: 0.6, max: 1.6, step: 0.05 },
    scatter: { min: 0, max: 2, step: 0.05 },
    transition: { min: 0.15, max: 0.8, step: 0.05 },
    depth: { min: 0, max: 1, step: 0.05 },
    drift: { min: 0, max: 1, step: 0.05 },
    audioResponse: { min: 0, max: 1, step: 0.05 },
} as const;
