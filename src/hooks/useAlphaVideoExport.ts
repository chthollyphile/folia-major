import { useCallback, useRef } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { AlphaVideoFormatId, VideoExportPreset, VideoExportStartMode, VideoExportState } from '../types/videoExport';
import { idleVideoExportState } from '../types/videoExport';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { currentTime } from '../stores/motionSignals';

// src/hooks/useAlphaVideoExport.ts
// The transparent branch of the player's video export: the main process renders the lyrics off-screen
// on a synthetic clock and pipes the frames into the user's full ffmpeg (electron/alphaExport/), so
// the file keeps its alpha channel. Unlike the window recording it has no sound, does not resize or
// take over the main window, and playback goes on meanwhile. Progress lands in the same export state
// the remote window shows, with `kind: 'alpha'`.

const ALPHA_EXPORT_FPS = 30;

type UseAlphaVideoExportOptions = {
    setExportState: React.Dispatch<React.SetStateAction<VideoExportState>>;
    /** Shared with the window recording: only one export of either kind runs at a time. */
    runningRef: React.RefObject<boolean>;
};

export const useAlphaVideoExport = ({ setExportState, runningRef }: UseAlphaVideoExportOptions) => {
    const { t } = useTranslation();
    const activeRef = useRef(false);

    const errorText = useCallback((code: string | undefined) => (
        code ? t(`mods.errors.${code}`, { value: code, defaultValue: code }) : t('remote.error')
    ), [t]);

    const startAlphaExport = useCallback(async (preset: VideoExportPreset, startMode: VideoExportStartMode, format: AlphaVideoFormatId) => {
        const electron = window.electron;
        if (runningRef.current) {
            return;
        }
        if (!electron?.startAlphaVideoExport || !electron.onAlphaVideoExportProgress) {
            setExportState({ ...idleVideoExportState(), kind: 'alpha', status: 'error', presetId: preset.id, error: t('export.windowRecordingUnsupported') });
            return;
        }
        const playback = usePlaybackStore.getState();
        const song = playback.currentSong;
        if (!song) {
            setExportState({ ...idleVideoExportState(), kind: 'alpha', status: 'error', presetId: preset.id, error: t('export.noRecordableContent') });
            return;
        }

        runningRef.current = true;
        activeRef.current = true;
        const startSec = startMode === 'from-start' ? 0 : Math.max(0, currentTime.get());
        const songDuration = Number.isFinite(playback.duration) && playback.duration > startSec ? playback.duration : 0;
        // 0 lets the main process end two seconds after the last lyric line.
        const endSec = songDuration;
        setExportState({
            ...idleVideoExportState(),
            kind: 'alpha',
            status: 'preparing',
            presetId: preset.id,
            duration: songDuration > 0 ? songDuration - startSec : 0,
        });

        const unsubscribe = electron.onAlphaVideoExportProgress((progress) => {
            if (!activeRef.current) return;
            if (progress.phase === 'rendering' && !progress.message) {
                setExportState(prev => ({ ...prev, status: 'recording', progress: Math.min(1, progress.percent / 100) }));
            } else if (progress.phase === 'done') {
                setExportState(prev => ({ ...prev, status: 'finalizing', progress: 1 }));
            }
        });

        try {
            const title = song.name.trim() || 'folia-export';
            const result = await electron.startAlphaVideoExport({
                codec: format,
                width: preset.width,
                height: preset.height,
                fps: ALPHA_EXPORT_FPS,
                startSec,
                endSec,
                defaultName: `${title}-${preset.width}x${preset.height}-alpha`,
            });
            if (result.canceled || result.cancelled) {
                setExportState(idleVideoExportState());
                return;
            }
            if (!result.ok) {
                setExportState({ ...idleVideoExportState(), kind: 'alpha', status: 'error', presetId: preset.id, error: errorText(result.error) });
                return;
            }
            if (result.warnings?.length) {
                console.warn('[VideoExportAlpha] finished with warnings', result.warnings);
            }
            setExportState(prev => ({ ...prev, status: 'done', progress: 1, filePath: result.outputPath ?? null }));
        } catch (error) {
            console.warn('[VideoExportAlpha] export failed', error);
            setExportState({ ...idleVideoExportState(), kind: 'alpha', status: 'error', presetId: preset.id, error: errorText(undefined) });
        } finally {
            unsubscribe();
            activeRef.current = false;
            runningRef.current = false;
        }
    }, [errorText, runningRef, setExportState, t]);

    /** Ends a running transparent export without a file. Returns whether one was running. */
    const cancelAlphaExport = useCallback(() => {
        if (!activeRef.current) return false;
        void window.electron?.cancelAlphaVideoExport?.();
        return true;
    }, []);

    return { startAlphaExport, cancelAlphaExport };
};
