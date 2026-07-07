import type { SongResult } from '../types';
import type { VideoExportPreset } from '../types/videoExport';

// src/services/electronVideoExport.ts
// Low-level Electron/Chromium recording helpers used by the player export hook.
const EXPORT_FRAME_RATE = 60;
const EXPORT_AUDIO_BITS_PER_SECOND = 320_000;
const VIDEO_EXPORT_FILE_EXTENSIONS = ['mp4', 'webm'] as const;

export type VideoExportFileExtension = typeof VIDEO_EXPORT_FILE_EXTENSIONS[number];

export type VideoExportFormat = {
    mimeType: string;
    extension: VideoExportFileExtension;
    displayName: string;
};

const getVideoBitsPerSecond = (preset: VideoExportPreset) => {
    const pixelCount = preset.width * preset.height;

    if (pixelCount >= 3_600_000) {
        return 50_000_000;
    }

    if (pixelCount >= 1_900_000) {
        return 28_000_000;
    }

    return 14_000_000;
};

export const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export const buildDefaultVideoExportFileName = (
    song: SongResult,
    preset: VideoExportPreset,
    extension: VideoExportFileExtension,
) => {
    const title = song.name?.trim() || 'folia-export';
    return `${title}-${preset.width}x${preset.height}.${extension}`;
};

export const getSupportedVideoExportFormat = (): VideoExportFormat | null => {
    const candidates: VideoExportFormat[] = [
        {
            mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            extension: 'mp4',
            displayName: 'MP4 Video',
        },
        {
            mimeType: 'video/mp4;codecs=avc1,mp4a.40.2',
            extension: 'mp4',
            displayName: 'MP4 Video',
        },
        {
            mimeType: 'video/mp4',
            extension: 'mp4',
            displayName: 'MP4 Video',
        },
        {
            mimeType: 'video/webm;codecs=vp8,opus',
            extension: 'webm',
            displayName: 'WebM Video',
        },
        {
            mimeType: 'video/webm;codecs=vp9,opus',
            extension: 'webm',
            displayName: 'WebM Video',
        },
        {
            mimeType: 'video/webm',
            extension: 'webm',
            displayName: 'WebM Video',
        },
    ];

    return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate.mimeType)) ?? null;
};

export const getVideoExportRecorderOptions = (preset: VideoExportPreset, format: VideoExportFormat): MediaRecorderOptions => ({
    mimeType: format.mimeType,
    audioBitsPerSecond: EXPORT_AUDIO_BITS_PER_SECOND,
    videoBitsPerSecond: getVideoBitsPerSecond(preset),
});

export const stopMediaStream = (stream: MediaStream | null) => {
    stream?.getTracks().forEach(track => track.stop());
};

// Forces the captured player document to stop painting cursor shapes during export.
export const installVideoExportCursorGuard = () => {
    const style = document.createElement('style');
    style.dataset.foliaVideoExportCursorGuard = 'true';
    style.textContent = 'html, body, body * { cursor: none !important; }';
    document.head.appendChild(style);

    return () => {
        style.remove();
    };
};

export const getAudioElementCaptureStream = (audioElement: HTMLAudioElement) => {
    const capturableAudio = audioElement as HTMLAudioElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
    };
    const stream = capturableAudio.captureStream?.() ?? capturableAudio.mozCaptureStream?.();

    if (!stream || stream.getAudioTracks().length === 0) {
        throw new Error('Current audio element cannot provide a recording track.');
    }

    return stream;
};

export const getMainWindowVideoCaptureStream = async (preset: VideoExportPreset) => {
    const source = await window.electron?.getMainWindowCaptureSource?.();
    if (!source) {
        throw new Error('Could not find the main player window capture source.');
    }

    return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            // Chromium's legacy desktop source constraints cannot be mixed with
            // standard cursor/displaySurface constraints; cursor hiding is handled
            // by installVideoExportCursorGuard while recording.
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: source.id,
                minWidth: preset.width,
                maxWidth: preset.width,
                minHeight: preset.height,
                maxHeight: preset.height,
                maxFrameRate: EXPORT_FRAME_RATE,
            },
        } as unknown as MediaTrackConstraints,
    });
};
