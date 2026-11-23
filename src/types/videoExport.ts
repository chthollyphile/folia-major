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

export interface VideoExportPresetPair {
    width: number;
    height: number;
}

export type VideoExportPresetValues = [VideoExportPresetPair, VideoExportPresetPair, VideoExportPresetPair];

/** `window`: the real-time recording of the main window (MediaRecorder, with sound, no alpha). `alpha`: the off-screen transparent render through the user's ffmpeg. */
export type VideoExportKind = 'window' | 'alpha';

export interface VideoExportState {
    status: VideoExportStatus;
    /** Left out by older senders: a window recording. */
    kind?: VideoExportKind;
    presetId: string | null;
    progress: number;
    elapsed: number;
    duration: number;
    countdown: number | null;
    filePath: string | null;
    error: string | null;
}

export type VideoExportStartMode = 'from-start' | 'current';

/** The transparent formats (electron/alphaExport/ffmpegCapabilities.cjs ALPHA_FORMATS), in the order they are offered. */
export const ALPHA_VIDEO_FORMAT_IDS = ['prores', 'vp9', 'qtrle'] as const;
export type AlphaVideoFormatId = typeof ALPHA_VIDEO_FORMAT_IDS[number];

export const isAlphaVideoFormatId = (value: unknown): value is AlphaVideoFormatId => (
    typeof value === 'string' && (ALPHA_VIDEO_FORMAT_IDS as readonly string[]).includes(value)
);

/** Why a candidate ffmpeg cannot export transparent video. */
export type VideoExportFfmpegProblem = 'not-found' | 'not-runnable' | 'not-ffmpeg' | 'no-rawvideo' | 'no-alpha-encoder';

/** The ffmpeg the transparent export uses (`video-export-ffmpeg-status`). */
export interface VideoExportFfmpegStatus {
    available: boolean;
    /** `manual`: the file chosen in Settings; `auto`: found by the search; null: none fits. */
    source: 'manual' | 'auto' | null;
    path: string | null;
    version: string | null;
    formats: string[];
    /** The file chosen in Settings, kept even when it does not fit (then `manualProblem` says why). */
    manualPath: string | null;
    manualProblem: VideoExportFfmpegProblem | null;
    /** Every ffmpeg that was run during the search, with why it was passed over. */
    checked: { path: string; problem: VideoExportFfmpegProblem | null; version: string | null }[];
}

export interface VideoExportFfmpegChooseResult {
    canceled: boolean;
    ok: boolean;
    problem: VideoExportFfmpegProblem | null;
    status: VideoExportFfmpegStatus;
}

export interface AlphaVideoExportRequest {
    codec: AlphaVideoFormatId;
    width: number;
    height: number;
    fps: number;
    startSec: number;
    endSec: number;
    defaultName: string;
}

export interface AlphaVideoExportProgress {
    phase: 'waiting' | 'rendering' | 'done' | 'error';
    frame: number;
    totalFrames: number;
    percent: number;
    message?: string;
    waitingFor?: string;
}

export interface AlphaVideoExportResult {
    ok: boolean;
    /** The save dialog was closed. */
    canceled?: boolean;
    /** The export was cancelled while it ran. */
    cancelled?: boolean;
    error?: string;
    outputPath?: string;
    warnings?: string[];
}

export const DEFAULT_VIDEO_EXPORT_PRESET_VALUES: VideoExportPresetValues = [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
];
export const VIDEO_EXPORT_PRESET_MIN = 240;
export const VIDEO_EXPORT_PRESET_MAX = 4320;

const VIDEO_EXPORT_PRESET_IDS = [
    'landscape-preset-1',
    'landscape-preset-2',
    'landscape-preset-3',
] as const;

const clampVideoExportPresetValue = (value: number, fallback = 720) => {
    const integerValue = Math.round(value);
    const safeValue = Number.isFinite(integerValue) ? integerValue : fallback;
    const clampedValue = Math.min(VIDEO_EXPORT_PRESET_MAX, Math.max(VIDEO_EXPORT_PRESET_MIN, safeValue));
    return clampedValue % 2 === 0 ? clampedValue : clampedValue + 1;
};

const buildVideoExportPreset = (id: string, width: number, height: number): VideoExportPreset => {
    const safeWidth = clampVideoExportPresetValue(width, 1280);
    const safeHeight = clampVideoExportPresetValue(height, 720);
    const orientation = safeWidth >= safeHeight ? 'landscape' : 'portrait';

    return {
        id,
        label: `${safeWidth} x ${safeHeight}`,
        width: safeWidth,
        height: safeHeight,
        orientation,
    };
};

export const sanitizeVideoExportPresetValues = (values: readonly any[]): VideoExportPresetValues => {
    const fallbackValues = DEFAULT_VIDEO_EXPORT_PRESET_VALUES;

    return VIDEO_EXPORT_PRESET_IDS.map((_, index) => {
        const item = values[index];
        const w = (item && typeof item === 'object') ? Number(item.width) : fallbackValues[index].width;
        const h = (item && typeof item === 'object') ? Number(item.height) : fallbackValues[index].height;
        return {
            width: clampVideoExportPresetValue(w, fallbackValues[index].width),
            height: clampVideoExportPresetValue(h, fallbackValues[index].height),
        };
    }) as VideoExportPresetValues;
};

export const createVideoExportPresets = (values: readonly any[]): VideoExportPreset[] => {
    const safeValues = sanitizeVideoExportPresetValues(values);
    return safeValues.map((pair, index) => buildVideoExportPreset(VIDEO_EXPORT_PRESET_IDS[index], pair.width, pair.height));
};

export const VIDEO_EXPORT_PRESETS: VideoExportPreset[] = createVideoExportPresets(DEFAULT_VIDEO_EXPORT_PRESET_VALUES);

export const DEFAULT_VIDEO_EXPORT_PRESET_ID = 'landscape-preset-2';

export const idleVideoExportState = (): VideoExportState => ({
    status: 'idle',
    kind: 'window',
    presetId: null,
    progress: 0,
    elapsed: 0,
    duration: 0,
    countdown: null,
    filePath: null,
    error: null,
});
