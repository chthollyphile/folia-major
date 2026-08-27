import type { PlayerState, LyricData } from '../types';
import type { VideoExportPreset, VideoExportStartMode, VideoExportState } from './videoExport';

// src/types/remoteControl.ts
// Shared payloads for the Electron remote control window.
export type PlayerChromeVisibilityMode = 'always-hidden' | 'always-visible' | 'auto-hide';

export type RemoteControlCommand =
    | { type: 'play-pause' }
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'previous' }
    | { type: 'next' }
    | { type: 'seek'; time: number }
    | { type: 'cycle-loop-mode' }
    | { type: 'resize-main-window'; width: number; height: number }
    | { type: 'set-main-window-border-visible'; visible: boolean }
    | { type: 'set-main-window-click-through'; enabled: boolean }
    | { type: 'set-main-window-always-on-top'; enabled: boolean }
    | { type: 'set-transparent-mode-enabled'; enabled: boolean }
    | { type: 'disable-transparent-mode' }
    | { type: 'cycle-player-chrome-visibility-mode' }
    | { type: 'open-export' }
    | { type: 'start-export'; preset: VideoExportPreset; startMode: VideoExportStartMode }
    | { type: 'stop-export' }
    | { type: 'cancel-export' }
    | { type: 'toggle-like' };

export interface RemoteControlSnapshot {
    hasTrack: boolean;
    /** 当前曲目标识，遥控窗口据此判断"换歌了"并触发过渡 */
    trackKey: string | null;
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    currentTime: number;
    duration: number;
    playerState: PlayerState;
    loopMode: 'off' | 'all' | 'one';
    canGoPrevious: boolean;
    canGoNext: boolean;
    prevTrackKey: string | null;
    prevTrackTitle: string | null;
    prevTrackArtist: string | null;
    prevTrackCoverUrl: string | null;
    nextTrackKey: string | null;
    nextTrackTitle: string | null;
    nextTrackArtist: string | null;
    nextTrackCoverUrl: string | null;
    controlsDisabled: boolean;
    isStageActive: boolean;
    transparentModeEnabled: boolean;
    mainWindowClickThroughEnabled: boolean;
    mainWindowAlwaysOnTop: boolean;
    mainWindowBorderVisible: boolean;
    playerChromeHidden: boolean;
    playerChromeVisibilityMode: PlayerChromeVisibilityMode;
    exportState: VideoExportState;
    isDaylight?: boolean;
    lyrics?: LyricData | null;
    lyricOffsetMs?: number;
    isLiked?: boolean;
    canLike?: boolean;
    likeUnavailableProvider?: string;
    updatedAt: number;
    mainWindowWidth?: number;
    mainWindowHeight?: number;
}
