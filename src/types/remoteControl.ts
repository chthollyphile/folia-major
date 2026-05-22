import type { PlayerState } from '../types';
import type { VideoExportPreset, VideoExportStartMode, VideoExportState } from './videoExport';

// src/types/remoteControl.ts
// Shared payloads for the Electron remote control window.
export type RemoteControlCommand =
    | { type: 'play-pause' }
    | { type: 'previous' }
    | { type: 'next' }
    | { type: 'seek'; time: number }
    | { type: 'open-export' }
    | { type: 'start-export'; preset: VideoExportPreset; startMode: VideoExportStartMode }
    | { type: 'stop-export' }
    | { type: 'cancel-export' };

export interface RemoteControlSnapshot {
    hasTrack: boolean;
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    currentTime: number;
    duration: number;
    playerState: PlayerState;
    canGoPrevious: boolean;
    canGoNext: boolean;
    controlsDisabled: boolean;
    isStageActive: boolean;
    exportState: VideoExportState;
    updatedAt: number;
}
