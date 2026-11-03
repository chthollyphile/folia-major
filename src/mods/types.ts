import type { LyricData, Theme, VisualizerMode } from '@/types';
import type { FoliumPlaybackSnapshot } from './folium/contract';
import type { VisualizerTuningBundle } from '@/components/visualizer/tuningRegistry';

// src/mods/types.ts
// Shared contracts between the mod system renderer surfaces and the Electron
// main-process loader. These mirrors are kept serialization-safe: everything
// crossing the IPC boundary must stay plain JSON-compatible data.

/**
 * 'skipped': the mod is enabled, but this run of the app was started without mods (the answer to
 * the safe-start question, or "reopen without mods"), so it was not run. Nothing is stored.
 */
export type ModStatus = 'loaded' | 'disabled' | 'error' | 'dependency-failed' | 'skipped';

/** What the main-process gate counted for one mod's Node entry (electron/modSystem/guard.cjs). */
export interface ModMainCallStats {
    /** Calls into the entry: its load, its activate, its rpc handlers, its disposers. */
    calls: number;
    /** Synchronous time spent in them, milliseconds. */
    totalMs: number;
    /** The longest single call, milliseconds. */
    longestMs: number;
    /** Calls that threw, or whose promise rejected. */
    failures: number;
}

export interface ModLabelMap {
    [key: string]: string | undefined;
    'zh-CN'?: string;
    'zh-TW'?: string;
    'en'?: string;
    'in'?: string;
    'vi'?: string;
}

/**
 * Official signature state (electron/modSystem/modSignature.cjs). A label only:
 * it never enables a mod or skips the enable confirmation.
 *   - verified: signed by a Folium key over exactly the files on disk;
 *   - beta:     the same, by a preview-channel key: security-reviewed only, may not work;
 *   - unsigned: no signature (an unreviewed third-party mod);
 *   - invalid:  a signature that does not check out (see `reason`).
 */
export type ModSignatureStatus = 'verified' | 'beta' | 'unsigned' | 'invalid';

export type ModSignatureInvalidReason =
    | 'malformed'
    | 'unknown-key'
    | 'revoked-key'
    | 'mod-mismatch'
    | 'bad-signature'
    | 'unverifiable'
    | 'digest-mismatch'
    | 'revoked-mod';

export interface ModSignatureInfo {
    status: ModSignatureStatus;
    reason: ModSignatureInvalidReason | null;
    keyId: string | null;
    keyLabel: string | null;
    signedAt: string | null;
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
    signature: ModSignatureInfo;
    /**
     * Development build only: the mod lives in the repository's mods/ directory,
     * so once confirmed, editing its files keeps the approval instead of
     * revoking it (see isDevSourceMod in electron/modSystem/approval.cjs).
     */
    devSource: boolean;
    /** Opted-in experimental surfaces (manifest `experimental`). */
    experimental: string[];
    /** Origins `folium.ui.embed` may load (manifest `embedOrigins`). */
    embedOrigins: string[];
    /** The Folia versions this mod needs (manifest `folia`); null when it names none. */
    folia: string | null;
    hasMain: boolean;
    /** folia-mod:// URL of the client entry, versioned by content digest; null unless loaded. */
    clientUrl: string | null;
    /** Position in the main process's dependency-resolved load plan; null when not in the plan. */
    loadOrder?: number | null;
    /**
     * Folium 1.6 only (electron/modSystem/deprecated.cjs): what the mod's mod.json and main entry use that
     * Folium 2 removes, one line each, e.g. "api.storage.data: removed in Folium 2, use api.storage".
     */
    warnings?: string[];
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

// 'waiting': the export has not drawn a frame yet because the mod of its lyric style is still starting.
export type ModExportPhase = 'waiting' | 'rendering' | 'done' | 'error' | 'cancelled';

export interface ModExportProgress {
    modId: string;
    phase: ModExportPhase;
    frame: number;
    totalFrames: number;
    percent: number;
    message?: string;
    /** With 'waiting': the name of the mod whose start the export waits for. */
    waitingFor?: string;
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

/**
 * A main entry's `api.rpc.send(name, payload)` on its way to that mod's client in the main window.
 * `json` is the payload as JSON text, checked (serializable, at most 64 KB) in the main process.
 */
export interface ModRpcMessage {
    modId: string;
    name: string;
    json: string;
}

/**
 * Folium 1.7: a mod's `secret` settings value was saved or cleared (`folia-mods:secret-changed`). The key
 * only: a value never travels with the notice.
 */
export interface ModSecretChange {
    modId: string;
    key: string;
}

/**
 * Folium 1.7: what the settings form knows about a mod's `secret` values (`state` on
 * `folia-mods:secrets`). `persistent` is false when the system has no credential encryption and values
 * last for this run only; `stored` lists the keys that hold a value, never the values.
 */
export interface ModSecretsState {
    persistent: boolean;
    stored: string[];
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
    /** This run of the app was started (or its window reopened) without mods. */
    startSkipped: boolean;
}

/**
 * A mod's disk usage in bytes, for the mods panel (`folia-mods:storage-usage`). `data` is all of
 * `mods-data/<id>` (the storage file and `paths.data`), `cache` is `mods-cache/<id>`; a missing
 * directory counts 0. Works for disabled mods too.
 */
export interface ModStorageUsageResult {
    ok: boolean;
    data?: number;
    cache?: number;
    /**
     * Only when true: `mods-cache/<id>` is a stray file or a dead link. It counts 0, but `paths.cache`
     * throws on every read until "clear cache" removes the entry.
     */
    cacheBroken?: boolean;
    error?: string;
}

/**
 * The mods panel's "clear cache" (`folia-mods:clear-cache`): `cleared` entries removed from the top of
 * `mods-cache/<id>`, which itself stays. `cache-clear-partial` when a running mod held some open.
 */
export interface ModClearCacheResult {
    ok: boolean;
    cleared?: number;
    error?: string;
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
    /** `duration`: the song's length in seconds, 0 when unknown; the export window hands it to mod styles. */
    songMeta: { title: string; artist: string; duration: number };
    /** Folium parameter values by scope, so exports render with the user's settings and tunings. */
    foliumParams: Record<string, Record<string, unknown>>;
}

export interface ModRuntimeSnapshot {
    /** Epoch ms of the push; main extrapolates `public.position` from it while playing. */
    capturedAt: number;
    public: FoliumPlaybackSnapshot;
    internal: ModExportHostState;
}
