import { useCallback, useEffect, useState } from 'react';
import type { VideoExportFfmpegChooseResult, VideoExportFfmpegStatus } from '../types/videoExport';

// src/hooks/useVideoExportFfmpegStatus.ts
// The ffmpeg the transparent video export uses, as the main process found it (electron/alphaExport/),
// for the remote window's export tab and the settings group: read once on mount, searched again on
// request, and changed by choosing a file or going back to the search. Null until the first answer
// and outside the desktop app.

export const useVideoExportFfmpegStatus = () => {
    const [status, setStatus] = useState<VideoExportFfmpegStatus | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async (refresh: boolean) => {
        const read = window.electron?.getVideoExportFfmpegStatus;
        if (!read) return;
        setBusy(true);
        try {
            setStatus(await read(refresh));
        } catch (error) {
            console.warn('[VideoExportFfmpeg] status read failed', error);
        } finally {
            setBusy(false);
        }
    }, []);

    // Read again when the window comes back to the front: the choice may have changed in another window.
    // The main process answers from its cache, so this runs nothing.
    useEffect(() => {
        void load(false);
        const onFocus = () => { void load(false); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [load]);

    const refresh = useCallback(() => load(true), [load]);

    /** Opens the file dialog; resolves to the dialog's result, or null outside the desktop app. */
    const choose = useCallback(async (): Promise<VideoExportFfmpegChooseResult | null> => {
        const pick = window.electron?.chooseVideoExportFfmpeg;
        if (!pick) return null;
        setBusy(true);
        try {
            const result = await pick();
            setStatus(result.status);
            return result;
        } catch (error) {
            console.warn('[VideoExportFfmpeg] choosing a file failed', error);
            return null;
        } finally {
            setBusy(false);
        }
    }, []);

    const clearChoice = useCallback(async () => {
        const clear = window.electron?.clearVideoExportFfmpeg;
        if (!clear) return;
        setBusy(true);
        try {
            setStatus(await clear());
        } catch (error) {
            console.warn('[VideoExportFfmpeg] clearing the chosen file failed', error);
        } finally {
            setBusy(false);
        }
    }, []);

    return { status, busy, refresh, choose, clearChoice };
};
