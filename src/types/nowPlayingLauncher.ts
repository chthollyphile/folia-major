// src/types/nowPlayingLauncher.ts
// Status contract for the desktop Now Playing auto-launch (electron/nowPlayingLauncher.cjs).

export type NowPlayingLauncherError = 'missing-executable' | 'invalid-executable' | 'spawn-failed';

export interface NowPlayingLauncherStatus {
    /** Only Windows builds offer auto-launch: Now Playing ships for Windows only. */
    supported: boolean;
    enabled: boolean;
    executablePath: string | null;
    lastError: NowPlayingLauncherError | null;
}
