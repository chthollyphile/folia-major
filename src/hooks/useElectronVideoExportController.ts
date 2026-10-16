import { hasExternalPlayback } from '../services/externalPlaybackSession';
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { RefObject } from 'react';
import type { MotionValue } from 'framer-motion';
import type { SongResult } from '../types';
import type { RemoteControlCommand } from '../types/remoteControl';
import type { VideoExportPreset, VideoExportState } from '../types/videoExport';
import { idleVideoExportState } from '../types/videoExport';
import {
    buildDefaultVideoExportFileName,
    getAudioElementCaptureStream,
    getMainWindowVideoCaptureStream,
    getVideoExportRecorderOptions,
    getSupportedVideoExportFormat,
    installVideoExportCursorGuard,
    stopMediaStream,
    wait,
    waitForExportViewport,
} from '../services/electronVideoExport';
import {
    createPresetSizedVideoStream,
    isVideoExportFramePipelineSupported,
} from '../services/videoExportFramePipeline';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useAppChromeStore } from '../stores/useAppChromeStore';
import { setIsPanelOpen } from '../stores/useAppViewStore';
import { currentTime } from '../stores/motionSignals';

// src/hooks/useElectronVideoExportController.ts
// Records the real player window so audio.currentTime remains the single animation clock.
type UseElectronVideoExportControllerOptions = {
    isElectronWindow: boolean;
    audioRef: RefObject<HTMLAudioElement | null>;
    navigateToPlayer: () => void;
    pausePlayback: () => void;
    resumePlayback: () => Promise<void>;
};

const COUNTDOWN_SECONDS = 3;

export const useElectronVideoExportController = ({
    isElectronWindow,
    audioRef,
    navigateToPlayer,
    pausePlayback,
    resumePlayback,
}: UseElectronVideoExportControllerOptions) => {
    // Read here rather than passed in: store fields, a module-level motion signal, or i18n.
    const { t } = useTranslation();
    const currentSong = usePlaybackStore(state => state.currentSong);
    const duration = usePlaybackStore(state => state.duration);
    const setIsPlayerChromeHidden = useAppChromeStore(state => state.setIsPlayerChromeHidden);

    const [exportState, setExportState] = useState<VideoExportState>(idleVideoExportState);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const cancelRequestedRef = useRef(false);
    const runningRef = useRef(false);

    const stopActiveExport = useCallback((discard: boolean) => {
        cancelRequestedRef.current = discard;
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
        }
    }, []);

    const startExport = useCallback(async (preset: VideoExportPreset, startMode: 'from-start' | 'current') => {
        if (hasExternalPlayback()) {
            setExportState({ ...idleVideoExportState(), status: 'error', presetId: preset.id, error: t('status.externalPlaybackActive') });
            return;
        }
        if (!isElectronWindow || runningRef.current) {
            return;
        }

        const audioElement = audioRef.current;
        if (!audioElement || !currentSong) {
            setExportState({
                ...idleVideoExportState(),
                status: 'error',
                presetId: preset.id,
                error: t('export.noRecordableContent'),
            });
            return;
        }

        const electron = window.electron;
        if (!electron?.chooseVideoExportPath || !navigator.mediaDevices?.getDisplayMedia || !isVideoExportFramePipelineSupported() || !electron.prepareVideoExportWindow || !electron.restoreVideoExportWindow || !electron.openVideoExportFile || !electron.appendVideoExportChunk || !electron.finishVideoExportFile || !electron.abortVideoExportFile) {
            setExportState({
                ...idleVideoExportState(),
                status: 'error',
                presetId: preset.id,
                error: t('export.windowRecordingUnsupported'),
            });
            return;
        }

        runningRef.current = true;
        cancelRequestedRef.current = false;
        let videoStream: MediaStream | null = null;
        let audioStream: MediaStream | null = null;
        let combinedStream: MediaStream | null = null;
        let progressIntervalId: number | null = null;
        let endedListener: (() => void) | null = null;
        let removeCursorGuard: (() => void) | null = null;
        let presetStreamCleanup: (() => void) | null = null;
        // Set while a partial export file is open on disk; cleared once it is finished.
        let fileSessionId: string | null = null;
        const wasPaused = audioElement.paused;
        const previousLoop = audioElement.loop;
        const previousTime = audioElement.currentTime;

        try {
            const exportFormat = getSupportedVideoExportFormat();
            if (!exportFormat) {
                throw new Error(t('export.noExportCodec'));
            }

            const saveResult = await electron.chooseVideoExportPath(
                buildDefaultVideoExportFileName(currentSong, preset, exportFormat.extension),
                exportFormat.extension,
                exportFormat.displayName,
            );
            if (saveResult.canceled || !saveResult.filePath) {
                setExportState(idleVideoExportState());
                return;
            }

            // Open the output before touching the window so an unwritable path fails fast.
            fileSessionId = await electron.openVideoExportFile(saveResult.filePath);
            const writeSessionId = fileSessionId;

            const exportStartTime = startMode === 'from-start' ? 0 : Math.max(0, audioElement.currentTime);
            const safeDuration = Number.isFinite(duration) && duration > 0
                ? duration
                : audioElement.duration;
            const exportDuration = Number.isFinite(safeDuration) && safeDuration > exportStartTime
                ? safeDuration - exportStartTime
                : 0;

            setExportState({
                status: 'preparing',
                presetId: preset.id,
                progress: 0,
                elapsed: 0,
                duration: exportDuration,
                countdown: null,
                filePath: saveResult.filePath,
                error: null,
            });

            navigateToPlayer();
            setIsPanelOpen(false);
            setIsPlayerChromeHidden(true);
            removeCursorGuard = installVideoExportCursorGuard();
            pausePlayback();
            audioElement.pause();
            audioElement.loop = false;

            if (startMode === 'from-start') {
                audioElement.currentTime = 0;
                currentTime.set(0);
            }

            const prepareWindow = async () => {
                const prepared = await electron.prepareVideoExportWindow({
                    width: preset.width,
                    height: preset.height,
                    dpr: window.devicePixelRatio,
                });
                if (prepared === false || !prepared.success) {
                    throw new Error(t('export.windowResizeFailed'));
                }
            };
            await prepareWindow();
            if (!await waitForExportViewport(preset)) {
                // One retry covers a resize that lost a race with the window manager.
                await prepareWindow();
                await waitForExportViewport(preset);
            }
            videoStream = await getMainWindowVideoCaptureStream(preset);

            // Pins the output to the exact preset resolution; frames normally arrive a pixel
            // or two larger and are center-cropped without resampling.
            const presetSized = createPresetSizedVideoStream(videoStream, preset);
            videoStream = presetSized.stream;
            presetStreamCleanup = presetSized.cleanup;

            audioStream = getAudioElementCaptureStream(audioElement);
            combinedStream = new MediaStream([
                ...videoStream.getVideoTracks(),
                ...audioStream.getAudioTracks(),
            ]);

            for (let remaining = COUNTDOWN_SECONDS; remaining > 0; remaining -= 1) {
                setExportState(prev => ({
                    ...prev,
                    status: 'countdown',
                    countdown: remaining,
                }));
                await wait(1000);
                if (cancelRequestedRef.current) {
                    throw new Error(t('export.recordingCancelled'));
                }
            }

            const recorder = new MediaRecorder(combinedStream, getVideoExportRecorderOptions(preset, exportFormat));
            recorderRef.current = recorder;
            const requestStop = () => {
                if (recorder.state !== 'inactive') {
                    recorder.stop();
                }
            };
            // Each timeslice chunk is appended to the file as it arrives instead of being kept
            // in memory; a 4K recording of a whole song is far too large for one buffer.
            // The chain keeps chunks in order, and a failed write stops the recording.
            let writeChain: Promise<void> = Promise.resolve();
            let writeError: unknown = null;
            const stopped = new Promise<void>((resolve, reject) => {
                recorder.ondataavailable = event => {
                    const chunk = event.data;
                    if (chunk.size === 0) {
                        return;
                    }
                    writeChain = writeChain
                        .then(async () => {
                            if (writeError !== null || cancelRequestedRef.current) {
                                return;
                            }
                            await electron.appendVideoExportChunk(writeSessionId, await chunk.arrayBuffer());
                        })
                        .catch(error => {
                            writeError ??= error;
                            requestStop();
                        });
                };
                recorder.onerror = () => reject(new Error(t('export.recorderUnknownError')));
                recorder.onstop = () => resolve();
            });
            endedListener = requestStop;
            audioElement.addEventListener('ended', requestStop, { once: true });

            recorder.start(1000);
            setExportState(prev => ({
                ...prev,
                status: 'recording',
                countdown: null,
            }));
            await resumePlayback();

            progressIntervalId = window.setInterval(() => {
                const elapsed = Math.max(0, audioElement.currentTime - exportStartTime);
                const progress = exportDuration > 0 ? Math.min(1, elapsed / exportDuration) : 0;
                setExportState(prev => ({
                    ...prev,
                    status: 'recording',
                    elapsed,
                    progress,
                }));

                if (exportDuration > 0 && elapsed >= exportDuration - 0.12) {
                    requestStop();
                }
            }, 250);

            await stopped;
            // The final dataavailable fires before stop, so this drains every queued chunk.
            await writeChain;

            if (progressIntervalId !== null) {
                window.clearInterval(progressIntervalId);
                progressIntervalId = null;
            }

            if (cancelRequestedRef.current) {
                setExportState(idleVideoExportState());
                return;
            }

            if (writeError !== null) {
                throw writeError instanceof Error ? writeError : new Error(String(writeError));
            }

            setExportState(prev => ({
                ...prev,
                status: 'finalizing',
                progress: 1,
                elapsed: exportDuration,
            }));
            fileSessionId = null;
            await electron.finishVideoExportFile(writeSessionId);
            setExportState(prev => ({
                ...prev,
                status: 'done',
                progress: 1,
                elapsed: exportDuration,
                filePath: saveResult.filePath,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setExportState({
                ...idleVideoExportState(),
                status: cancelRequestedRef.current ? 'idle' : 'error',
                presetId: preset.id,
                error: cancelRequestedRef.current ? null : message,
            });
        } finally {
            if (progressIntervalId !== null) {
                window.clearInterval(progressIntervalId);
            }
            if (endedListener) {
                audioElement.removeEventListener('ended', endedListener);
            }
            recorderRef.current = null;
            if (fileSessionId !== null) {
                // Cancelled or failed: drop the partial file instead of leaving a broken video.
                void electron.abortVideoExportFile(fileSessionId).catch(() => {});
            }
            stopMediaStream(videoStream);
            stopMediaStream(audioStream);
            stopMediaStream(combinedStream);
            audioElement.loop = previousLoop;
            if (wasPaused) {
                audioElement.pause();
                audioElement.currentTime = previousTime;
                currentTime.set(previousTime);
            }
            setIsPlayerChromeHidden(false);
            removeCursorGuard?.();
            presetStreamCleanup?.();
            void electron.restoreVideoExportWindow();
            runningRef.current = false;
            cancelRequestedRef.current = false;
        }
    }, [audioRef, currentSong, currentTime, duration, isElectronWindow, navigateToPlayer, pausePlayback, resumePlayback, setIsPanelOpen, setIsPlayerChromeHidden]);

    const handleExportCommand = useCallback((command: RemoteControlCommand) => {
        if (command.type === 'start-export') {
            void startExport(command.preset, command.startMode);
            return true;
        }

        if (command.type === 'stop-export') {
            stopActiveExport(false);
            return true;
        }

        if (command.type === 'cancel-export') {
            stopActiveExport(true);
            return true;
        }

        return false;
    }, [startExport, stopActiveExport]);

    // Automatically reset export status back to 'idle' after completion (3s) or error (4s)
    useEffect(() => {
        if (exportState.status === 'done') {
            const timer = window.setTimeout(() => {
                setExportState(prev => prev.status === 'done' ? idleVideoExportState() : prev);
            }, 3000);
            return () => window.clearTimeout(timer);
        }
        if (exportState.status === 'error') {
            const timer = window.setTimeout(() => {
                setExportState(prev => prev.status === 'error' ? idleVideoExportState() : prev);
            }, 4000);
            return () => window.clearTimeout(timer);
        }
    }, [exportState.status]);

    useEffect(() => () => {
        stopActiveExport(true);
    }, [stopActiveExport]);

    return {
        exportState,
        isExportRunning: () => runningRef.current,
        handleExportCommand,
    };
};
