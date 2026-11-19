import type { LyricAntialias, LyricRenderScale, VisualizerFrameRate } from '../../types';

// src/components/perfCheck/perfCheckTypes.ts
// The performance check's shapes, shared by its window, the main window's half (the offer and the
// settings it applies) and the preload typings.

/** The three display settings a check tries and the user can apply from it. */
export interface PerfCheckSettings {
    frameRate: VisualizerFrameRate;
    scale: LyricRenderScale;
    antialias: LyricAntialias;
}

/** Every process's memory from the main process, MB: summed, and by Chromium's process type. */
export interface PerfCheckProcessMemory {
    totalMb: number;
    byType: Partial<Record<string, number>>;
    processes: number;
    /** The refresh rate of the display the check window is on, Hz; 0 where the system does not say. */
    refreshHz: number;
}

/** Frame statistics over one measured stretch. */
export interface PerfCheckFrames {
    /** Frames drawn per second. */
    fps: number;
    /** The 1% low: the frame rate of the slowest 1% of frames. */
    lowFps: number;
    /** Frames that took longer than one and a half of the target interval, as a share of all. */
    droppedShare: number;
    /** The frame rate this step aims at: the cap, or the display's refresh. */
    targetFps: number;
}

/** The GPU analysis measured beside the picture in one step. */
export interface PerfCheckInference {
    /** Median time of an htdemucs segment, ms; null when the separation could not run here. */
    segmentMs: number | null;
    /** How many times faster than the track the separation goes (the audio a segment moves on / its time). */
    realtime: number | null;
    /** One beat_this run over two chunks (a minute of audio), ms; null when it could not run. */
    beatsMs: number | null;
}

/** One step of the check: a set of settings, the picture alone and the picture beside the analysis. */
export interface PerfCheckStepResult {
    settings: PerfCheckSettings;
    /** What this step changed from the step before (the first: none). */
    changes: (keyof PerfCheckSettings)[];
    picture: PerfCheckFrames;
    withAnalysis: PerfCheckFrames;
    inference: PerfCheckInference;
    smooth: boolean;
}

/** Memory once the analysis models are loaded and running. */
export interface PerfCheckMemory {
    /** All of the app's processes, MB, the highest reading of the check. */
    appMb: number | null;
    /** The GPU process alone, MB. */
    gpuProcessMb: number | null;
    /** This window's JavaScript heap, MB (Chromium's performance.memory). */
    heapMb: number | null;
    /** What the analysis models hold on the graphics card, MB. */
    modelsMb: number;
}

export interface PerfCheckReport {
    steps: PerfCheckStepResult[];
    memory: PerfCheckMemory;
    /** The display's refresh, Hz, as measured. */
    refreshHz: number;
    /** The step recommended: the first smooth one, else the smoothest. */
    recommended: number;
    /** Whether the analysis could run on the GPU at all here. */
    gpuAnalysis: boolean;
}
