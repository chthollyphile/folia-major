import type { PlaybackRequest } from './externalPlayback';
import type {
    LyricData,
    NowPlayingLyricPayload,
    NowPlayingTrackSnapshot,
    PlayerState,
    SongResult,
    StageLoopMode,
    StageLyricsSession,
    StageMediaSession,
    StageSource,
    StageStatus,
} from '../types';
import type { MediaId } from './onlineMusic';

// Shared playback-specific types extracted from App.tsx.
export type PlaybackNavigationOptions = {
    /** Shared cancellation and source-commit acknowledgement across playback providers. */
    request?: PlaybackRequest;
    autoplay?: boolean;
    shouldNavigateToPlayer?: boolean;
    unavailableSkipCount?: number;
    unifiedQueue?: SongResult[];
    /**
     * Set only by the automix blend's own advance. That play skips extension `beforePlay` hooks:
     * the blend starts the arriving track on a fixed schedule, and its cancel paths assume the
     * advance has already moved playback to that track.
     */
    isAutomixAdvance?: boolean;
};

/** 本地 / Navidrome 歌曲的播放选项（onPlayLocalSong / onPlayNavidromeSong）。 */
export type LibraryPlayOptions = PlaybackNavigationOptions & {
    /**
     * 这次点歌是否仍是最新请求，由 playSong 传入。为 false 时这次播放的失败既不提示也不报告：用户已经点了别的歌，
     * 旧请求的失败不该盖住新歌的消息，也不该让模组（playback.failed）对新歌动手。不传时只看库内播放之间的先后。
     */
    isCurrent?: () => boolean;
};

export type NextTrackOptions = PlaybackNavigationOptions & {
    reason?: 'ended' | 'playback-error';
    allowStopOnMissing?: boolean;
    /**
     * The track to step from, when it is deliberately NOT the one the listener can see.
     *
     * Next/previous normally step from the displayed track, because during a blend the queue has
     * already advanced and `currentSong` names the song arriving rather than the one being heard.
     * Two callers really do mean the internal one: the blend's own advance, and skipping a track
     * that failed to play - that failure belongs to the active deck, not to what is on screen.
     */
    fromSong?: SongResult;
};

export type UnavailableReplacementRequest = {
    originalSong: SongResult;
    replacementSong: SongResult;
    replacementSongId: MediaId;
    typeDesc?: string;
    queue: SongResult[];
    isFmCall: boolean;
    options: PlaybackNavigationOptions;
};

export type SkipPromptMessageKey = 'status.songUnavailablePrompt' | 'status.playbackErrorPrompt' | 'status.songUnplayableSkipPrompt';

export type PlaybackSnapshot = {
    currentSong: SongResult | null;
    lyrics: LyricData | null;
    cachedCoverUrl: string | null;
    audioSrc: string | null;
    playQueue: SongResult[];
    isFmMode: boolean;
    playerState: PlayerState;
    currentTime: number;
    duration: number;
    currentLineIndex: number;
};

export type StageLyricsClockState = {
    startTimeSec: number;
    endTimeSec: number;
    baseTimeSec: number;
    startedAtMs: number | null;
};

export type NowPlayingClockState = {
    baseTimeSec: number;
    startedAtMs: number | null;
    durationSec: number;
};

export type WindowPlaybackHandoffUiState = {
    currentView: 'home' | 'player' | 'lattice';
    playerChromeHidden: boolean;
    mainWindowBorderVisible: boolean;
    transparentModeEnabled: boolean;
};

export type WindowPlaybackHandoffNowPlayingState = {
    track: NowPlayingTrackSnapshot | null;
    lyricPayload: NowPlayingLyricPayload | null;
    paused: boolean;
    progressMs: number;
    progressQuality: 'precise' | 'coarse';
    displayTimeSec: number;
};

export type WindowPlaybackHandoffStageState = {
    status: StageStatus | null;
    source: StageSource | null;
    playback: PlaybackSnapshot | null;
    lyricsClock: StageLyricsClockState | null;
};

export type WindowPlaybackHandoff = {
    version: 1;
    capturedAt: number;
    activePlaybackContext: 'main' | 'stage';
    mainPlayback: PlaybackSnapshot | null;
    activePlayback: PlaybackSnapshot | null;
    stage: WindowPlaybackHandoffStageState;
    nowPlaying: WindowPlaybackHandoffNowPlayingState;
    ui: WindowPlaybackHandoffUiState;
};

export type StageEntryKeyOptions = {
    entryKind: StageStatus['activeEntryKind'];
    lyricsSession: StageLyricsSession | null;
    mediaSession: StageMediaSession | null;
};

export type StageLoopModeLike = StageLoopMode;
