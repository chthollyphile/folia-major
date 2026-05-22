import type { SongResult } from '../types';
import type { VideoExportPreset } from '../types/videoExport';

// src/services/electronVideoExport.ts
// Low-level Electron/Chromium recording helpers used by the player export hook.
const EXPORT_FRAME_RATE = 60;
const EXPORT_AUDIO_BITS_PER_SECOND = 320_000;

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

export const buildDefaultVideoExportFileName = (song: SongResult, preset: VideoExportPreset) => {
    const title = song.name?.trim() || 'folia-export';
    return `${title}-${preset.width}x${preset.height}.webm`;
};

export const getSupportedVideoExportMimeType = () => {
    const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
    ];

    return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate)) || '';
};

export const getVideoExportRecorderOptions = (preset: VideoExportPreset, mimeType: string): MediaRecorderOptions => ({
    ...(mimeType ? { mimeType } : {}),
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
        throw new Error('当前音频元素无法提供录制音轨。');
    }

    return stream;
};

export const getMainWindowVideoCaptureStream = async (preset: VideoExportPreset) => {
    const source = await window.electron?.getMainWindowCaptureSource?.();
    if (!source) {
        throw new Error('无法找到主播放器窗口的采集源。');
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
