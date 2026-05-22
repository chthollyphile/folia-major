// src/types/videoExport.ts
// Shared video recording presets and status payloads for the Electron player.
export type VideoExportStatus =
    | 'idle'
    | 'preparing'
    | 'countdown'
    | 'recording'
    | 'finalizing'
    | 'done'
    | 'error';

export interface VideoExportPreset {
    id: string;
    label: string;
    width: number;
    height: number;
    orientation: 'landscape' | 'portrait';
}

export interface VideoExportState {
    status: VideoExportStatus;
    presetId: string | null;
    progress: number;
    elapsed: number;
    duration: number;
    countdown: number | null;
    filePath: string | null;
    error: string | null;
}

export type VideoExportStartMode = 'from-start' | 'current';

export const VIDEO_EXPORT_PRESETS: VideoExportPreset[] = [
    { id: 'landscape-720p', label: '1280 x 720', width: 1280, height: 720, orientation: 'landscape' },
    { id: 'landscape-1080p', label: '1920 x 1080', width: 1920, height: 1080, orientation: 'landscape' },
    { id: 'landscape-1440p', label: '2560 x 1440', width: 2560, height: 1440, orientation: 'landscape' },
];

export const DEFAULT_VIDEO_EXPORT_PRESET_ID = 'landscape-1080p';

export const idleVideoExportState = (): VideoExportState => ({
    status: 'idle',
    presetId: null,
    progress: 0,
    elapsed: 0,
    duration: 0,
    countdown: null,
    filePath: null,
    error: null,
});
