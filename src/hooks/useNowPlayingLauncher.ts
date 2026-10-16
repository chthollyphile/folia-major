import { useCallback, useEffect, useState } from 'react';
import type { NowPlayingLauncherStatus } from '../types/nowPlayingLauncher';

// src/hooks/useNowPlayingLauncher.ts
// Reads and changes the desktop Now Playing auto-launch settings through the preload bridge.
// Returns a null status outside Electron or when the main process predates the feature.

export function useNowPlayingLauncher() {
    const [status, setStatus] = useState<NowPlayingLauncherStatus | null>(null);

    useEffect(() => {
        let cancelled = false;
        void window.electron?.getNowPlayingLauncherStatus?.()
            .then(nextStatus => {
                if (!cancelled) setStatus(nextStatus);
            })
            .catch(error => console.warn('[NowPlaying] Failed to read auto-launch status.', error));
        return () => {
            cancelled = true;
        };
    }, []);

    const setEnabled = useCallback(async (enabled: boolean) => {
        const nextStatus = await window.electron?.setNowPlayingAutoLaunch?.(enabled);
        if (nextStatus) setStatus(nextStatus);
    }, []);

    const chooseExecutable = useCallback(async () => {
        const nextStatus = await window.electron?.chooseNowPlayingExecutable?.();
        if (nextStatus) setStatus(nextStatus);
    }, []);

    return { status, setEnabled, chooseExecutable };
}
