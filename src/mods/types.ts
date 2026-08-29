import type { LyricData, SongResult, Theme, VisualizerMode } from '@/types';
import type { VisualizerTuningBundle } from '@/components/visualizer/tuningRegistry';

// src/mods/types.ts
// Shared contracts between the mod system renderer surfaces and the Electron
// main-process loader. These mirrors are kept serialization-safe: everything
// crossing the IPC boundary must stay plain JSON-compatible data.

export type ModStatus = 'loaded' | 'disabled' | 'error' | 'dependency-failed';

export interface ModLabelMap {
    [key: string]: string | undefined;
    'zh-CN'?: string;
    'en'?: string;
    'in'?: string;
}

export interface ModCommandParamOption {
    value: string;
    label: ModLabelMap;
}

export interface ModCommandParam {
    key: string;
    label: ModLabelMap;
    type: 'number' | 'text' | 'boolean' | 'select';
    description?: ModLabelMap;
    defaultValue?: string | number | boolean;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    options?: ModCommandParamOption[];
    required?: boolean;
    /** When true the numeric param renders as a live slider and re-submits the command (debounced) on every drag tick. */
    live?: boolean;
    /**
     * When set, this numeric param modulates a builtin visualizer live in the
     * renderer (no main-process round-trip): dragging writes straight into the
     * shared modulation store via `setVisualizerModulation(mode, { [key]: value })`.
     */
    modulate?: {
        /** Visualizer mode to modulate, e.g. "sonnet". */
        mode: string;
    };
}

export interface ModCommandInfo {
    id: string;
    label: ModLabelMap;
    description: ModLabelMap;
    params: ModCommandParam[];
    permissions: string[];
}

export interface ModVisualizerContribution {
    id: string;
    /** Registry mode id, always prefixed `mod:<modId>:<id>` by the loader. */
    mode: string;
    /** Entry file path relative to the mod directory. */
    entry: string;
    /** Absolute folia-mod:// URL the renderer dynamically imports. */
    url: string;
    label: ModLabelMap;
    order: number;
}

export interface ModRuntimeInfo {
    id: string;
    name: string;
    version: string | null;
    author: string | null;
    description: string | null;
    permissions: string[];
    status: ModStatus;
    error: string | null;
    enabled: boolean;
    /**
     * The mod had been enabled, but its files changed since that confirmation,
     * so the loader revoked the approval. The user has to confirm the new code
     * before it runs again.
     */
    trustStale: boolean;
    commands: ModCommandInfo[];
    visualizers: ModVisualizerContribution[];
}

/*
 * Result of a toggle. Enabling goes through a main-process confirmation dialog,
 * so it can fail for reasons the panel has to report ('enable-declined' when
 * the user cancelled, 'mod-content-unverifiable' when the tree cannot be
 * hashed) rather than silently doing nothing.
 */
export interface ModSetEnabledResult {
    ok: boolean;
    error?: string;
    mods: ModRuntimeInfo[];
}

export type ModExportPhase = 'rendering' | 'done' | 'error' | 'cancelled';

export interface ModExportProgress {
    modId: string;
    phase: ModExportPhase;
    frame: number;
    totalFrames: number;
    percent: number;
    message?: string;
}

export interface ModExportResult {
    ok: boolean;
    outputPath?: string;
    frameCount?: number;
    sizeBytes?: number;
    durationSec?: number;
    warnings?: string[];
    error?: string;
    cancelled?: boolean;
}

export interface ModLogEntry {
    modId: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    details?: string;
}

export interface ModFfmpegStatus {
    available: boolean;
    path: string | null;
    version: string | null;
    candidates: string[];
}

export interface ModsListPayload {
    mods: ModRuntimeInfo[];
    ffmpeg: ModFfmpegStatus;
    directories: string[];
}

/*
 * Runtime snapshot pushed from the open panel so main-process mods can act on
 * the song the user is currently looking at. Only plain data crosses the IPC
 * boundary; visualizer and theme values are serialized as-is.
 */
export interface ModRuntimeSnapshot {
    song: Pick<SongResult, 'id' | 'name' | 'artists' | 'album'> | null;
    songTitle?: string | null;
    songArtist?: string | null;
    lyricData: LyricData | null;
    theme: Theme | null;
    visualizerMode: VisualizerMode | null;
    /** Current visualizer tuning bundle lifted straight from the settings store, for faithful export. */
    visualizerTunings?: VisualizerTuningBundle | null;
    lyricTimelineOffsetMs?: number;
}