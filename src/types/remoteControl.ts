import type { PlayerState, LyricData } from '../types';
import type { VideoExportPreset, VideoExportStartMode, VideoExportState } from './videoExport';

// src/types/remoteControl.ts
// Shared payloads for the Electron remote control window.
export type RemoteControlCommand =
    | { type: 'play-pause' }
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'previous' }
    | { type: 'next' }
    | { type: 'seek'; time: number }
    | { type: 'resize-main-window'; width: number; height: number }
    | { type: 'set-main-window-border-visible'; visible: boolean }
    | { type: 'set-main-window-click-through'; enabled: boolean }
    | { type: 'set-main-window-always-on-top'; enabled: boolean }
    | { type: 'set-transparent-mode-enabled'; enabled: boolean }
    | { type: 'disable-transparent-mode' }
    | { type: 'set-player-chrome-hidden'; hidden: boolean }
    | { type: 'open-export' }
    | { type: 'start-export'; preset: VideoExportPreset; startMode: VideoExportStartMode }
    | { type: 'stop-export' }
    | { type: 'cancel-export' }
    | { type: 'toggle-like' };

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
    transparentModeEnabled: boolean;
    mainWindowClickThroughEnabled: boolean;
    mainWindowAlwaysOnTop: boolean;
    mainWindowBorderVisible: boolean;
    playerChromeHidden: boolean;
    exportState: VideoExportState;
    isDaylight?: boolean;
    lyrics?: LyricData | null;
    lyricOffsetMs?: number;
    isLiked?: boolean;
    updatedAt: number;
    mainWindowWidth?: number;
    mainWindowHeight?: number;
}
