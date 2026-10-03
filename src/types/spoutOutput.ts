// src/types/spoutOutput.ts
// Shared contract for the Windows-only Spout2 output (electron/spoutOutput.cjs). Field names and
// error codes are pinned by the integration contract — do not rename.

export type SpoutOutputError =
    | 'helper-missing'
    | 'name-in-use'
    | 'd3d-init-failed'
    | 'spout-register-failed'
    | 'helper-crashed'
    | 'unsupported-platform';

export interface SpoutOutputStatus {
    /** process.platform === 'win32'; the whole settings section hides when false. */
    supported: boolean;
    /** Persisted setting, not live state. */
    enabled: boolean;
    /** Helper reported ready and the offscreen overlay window is painting. */
    running: boolean;
    senderName: string;
    width: number;
    height: number;
    fps: 30 | 60;
    error: SpoutOutputError | null;
}

export interface SpoutOutputConfigPatch {
    enabled?: boolean;
    senderName?: string;
    width?: number;
    height?: number;
    fps?: 30 | 60;
}
