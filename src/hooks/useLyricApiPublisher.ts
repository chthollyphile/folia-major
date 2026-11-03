import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LyricData } from '../types';
import type { LyricApiStatus } from '../types/lyricApi';
import { omni } from '../services/onlineMusic/omni';

// src/hooks/useLyricApiPublisher.ts
// Keeps the desktop-local lyrics API synchronized with the current lyric object.

const emptyStatus = (): LyricApiStatus => ({
    enabled: false,
    running: false,
    port: 32109,
    url: null,
    error: null,
});

export const useLyricApiPublisher = ({
    isElectronWindow,
    lyrics,
    offset,
    audioSrc,
}: {
    isElectronWindow: boolean;
    lyrics: LyricData | null;
    offset: number;
    /** The address the main player is loading: a preview clip's start inside its song is looked up by it. */
    audioSrc: string | null;
}) => {
    const [status, setStatus] = useState<LyricApiStatus>(() => emptyStatus());

    const refreshStatus = useCallback(async () => {
        if (!isElectronWindow || !window.electron?.getLyricApiStatus) {
            const nextStatus = emptyStatus();
            setStatus(nextStatus);
            return nextStatus;
        }
        const nextStatus = await window.electron.getLyricApiStatus();
        setStatus(nextStatus);
        return nextStatus;
    }, [isElectronWindow]);

    useEffect(() => {
        void refreshStatus();
        return window.electron?.onLyricApiStatusChanged?.(setStatus);
    }, [refreshStatus]);

    // A preview clip may start somewhere inside its song, while the position a client reads from the
    // player is the clip's own: the snapshot carries that start (`clipStartMs`, 0 for a whole song) so
    // the client can line the lyrics up. omni records it per address as it hands the address out.
    const clipStartMs = useMemo(() => (audioSrc ? omni.previewClipStartMsOfAudioSource(audioSrc) : 0), [audioSrc]);

    // Published again when the address changes as well as the lyrics: the same lyrics can move from a
    // preview clip to the whole song (or back), and a snapshot left with the old start would misalign them.
    useEffect(() => {
        if (!status.enabled || !window.electron?.publishLyricApiData) {
            return;
        }
        void window.electron.publishLyricApiData(lyrics, offset, clipStartMs).catch((error) => {
            console.warn('[Lyric API] Failed to publish lyrics:', error);
        });
    }, [audioSrc, clipStartMs, lyrics, offset, status.enabled]);

    const setEnabled = useCallback(async (enabled: boolean) => {
        if (!window.electron?.setLyricApiEnabled) {
            return emptyStatus();
        }
        const nextStatus = await window.electron.setLyricApiEnabled(enabled);
        setStatus(nextStatus);
        return nextStatus;
    }, []);

    return {
        lyricApiStatus: status,
        refreshLyricApiStatus: refreshStatus,
        setLyricApiEnabled: setEnabled,
    };
};
