import type { PlayerState, LyricData, SubtitleContentMode } from '../types';
import type { VideoExportPreset, VideoExportStartMode, VideoExportState } from './videoExport';
import type { FoliumRemoteActionDef } from '../mods/folium/contract';

// src/types/remoteControl.ts
// Shared payloads for the Electron remote control window.
export type PlayerChromeVisibilityMode = 'always-hidden' | 'always-visible' | 'auto-hide';

/** Serializable presentation only; action callbacks stay in the main window. */
export type RemoteActionDescriptor = Pick<FoliumRemoteActionDef,
    'id' | 'label' | 'icon' | 'disabled' | 'pressed' | 'count' | 'tone'> & {
    readonly handle: string;
};

export interface RemoteActionsSnapshot {
    readonly epoch: string;
    /** Presentation revision, not an execution precondition. */
    readonly revision: number;
    readonly trackKey: string | null;
    readonly items: readonly RemoteActionDescriptor[];
}

export interface RemoteActionActivation {
    type: 'remote-action';
    epoch: string;
    handle: string;
    trackKey: string | null;
}

export interface RemoteTrackTransition {
    /** Unix time when the audible AutoMix/Crossfade transition started. */
    startedAtMs: number;
    /** Actual wall-clock span scheduled by the shared transition session. */
    durationSec: number;
    /** Point inside the span where the incoming track becomes dominant, 0..1. */
    crossover: number;
}

/** One row of the play queue as the remote window shows it. Built by the main window. */
export interface RemoteQueueItem {
    /** getPlaybackSongKey: the remote names a row by it, so a queue that moved meanwhile still finds it. */
    readonly key: string;
    readonly title: string;
    readonly artist: string;
    /** Already translated ("Unavailable", "Video"), or empty. */
    readonly tag: string;
    /** Normalized: position, title, artists, album, aliases, translated names. */
    readonly searchText: string;
}

export type RemoteQueueCommandType = 'queue-play' | 'queue-play-next' | 'queue-move-to-end' | 'queue-remove';

/** A row of the queue acted on from the remote: its key, and where it was in the queue the remote saw. */
export interface RemoteQueueCommand {
    type: RemoteQueueCommandType;
    key: string;
    index: number;
}

/** Where the remote window grew to show the queue, and by how much. */
export interface RemoteQueueExpansion {
    direction: 'down' | 'up';
    /** Pixels added to the window's height. */
    height: number;
}

/** What the large row of a lyric pair shows: the line itself, its translation or its romanization. */
export type RemoteLyricMainRow = 'original' | 'translation' | 'romanization';
/** What the small row under it shows; 'auto' follows the main window's 副字幕 (subtitleContentMode). */
export type RemoteLyricSubRow = 'auto' | 'translation' | 'romanization' | 'original' | 'none';

/**
 * The remote window's lyric: one pair (the line being sung, large, and a small row under it) or two,
 * the second pair being the next line. The rows of the second pair are kept while only one is shown,
 * so going back to two brings them back.
 */
export interface RemoteLyricLayout {
    pairs: 1 | 2;
    rows: [RemoteLyricMainRow, RemoteLyricSubRow, RemoteLyricMainRow, RemoteLyricSubRow];
}

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
    | { type: 'set-player-chrome-visibility-mode'; mode: PlayerChromeVisibilityMode }
    | { type: 'open-export' }
    | { type: 'start-export'; preset: VideoExportPreset; startMode: VideoExportStartMode }
    | { type: 'stop-export' }
    | { type: 'cancel-export' }
    | { type: 'toggle-like' }
    /** Brings the main window up with the settings open on the remote window's page. */
    | { type: 'open-remote-settings' }
    | RemoteQueueCommand
    | RemoteActionActivation;

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
    /** Present while an AutoMix or explicitly selected Crossfade transition is audible. */
    trackTransition: RemoteTrackTransition | null;
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
    /** The main window's setting for what sits under a lyric line; the remote's second line follows it. */
    subtitleContentMode: SubtitleContentMode;
    /** The remote window's own lyric rows (its settings page). Absent from a main window that predates it. */
    remoteLyricLayout?: RemoteLyricLayout;
    isLiked?: boolean;
    canLike?: boolean;
    likeUnavailableProvider?: string;
    updatedAt: number;
    /** Changes after an intentional seek or a new media timeline, permitting small backward seeks. */
    clockRevision?: number;
    mainWindowWidth?: number;
    mainWindowHeight?: number;
    remoteActions?: RemoteActionsSnapshot;
    /**
     * The play queue. Like `lyrics`, only sent when it changed (and on the first publish after the
     * remote opens); the main process and the remote keep the last one sent.
     */
    queue?: readonly RemoteQueueItem[];
    /** Key of the song the player holds (during an AutoMix blend the incoming one; `trackKey` is the audible one). */
    queuePlayingKey?: string | null;
    /** An external stage is playing: the queue can only be played from, not edited. */
    queueReadOnly?: boolean;
}
