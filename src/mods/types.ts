import type { LyricData, Theme, VisualizerMode } from '@/types';
import type { FoliumPlaybackSnapshot } from './folium/contract';
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
    /** Opted-in experimental surfaces (manifest `experimental`). */
    experimental: string[];
    /** Origins `folium.ui.embed` may load (manifest `embedOrigins`). */
    embedOrigins: string[];
    /** Host version range; present only on mods that use `folium.internals`. */
    folia: string | null;
    hasMain: boolean;
    /** folia-mod:// URL of the client entry, versioned by content digest; null unless loaded. */
    clientUrl: string | null;
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
 * What the renderer pushes to the main process whenever the playing song, its
 * lyrics, the theme or the visualizer settings change. Two halves that never mix:
 *   - `public`: the Folium DTO main-side mods read via runtime.getPlaybackSnapshot;
 *   - `internal`: host-private render state the export service replays verbatim.
 */
export interface ModExportHostState {
    lyricData: LyricData | null;
    visualizerMode: VisualizerMode | null;
    visualizerTunings: VisualizerTuningBundle | null;
    theme: Theme | null;
    songMeta: { title: string; artist: string };
    /** Folium parameter values by scope, so exports render with the user's settings and tunings. */
    foliumParams: Record<string, Record<string, unknown>>;
}

export interface ModRuntimeSnapshot {
    /** Epoch ms of the push; main extrapolates `public.position` from it while playing. */
    capturedAt: number;
    public: FoliumPlaybackSnapshot;
    internal: ModExportHostState;
}
