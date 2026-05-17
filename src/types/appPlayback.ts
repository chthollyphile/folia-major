import type { LyricData, PlayerState, SongResult, StageLoopMode, StageLyricsSession, StageMediaSession, StageStatus } from '../types';

// Shared playback-specific types extracted from App.tsx.
export type PlaybackNavigationOptions = {
    shouldNavigateToPlayer?: boolean;
    unavailableSkipCount?: number;
};

export type NextTrackOptions = PlaybackNavigationOptions & {
    allowStopOnMissing?: boolean;
};

export type UnavailableReplacementRequest = {
    originalSong: SongResult;
    replacementSong: SongResult;
    replacementSongId: number;
    typeDesc?: string;
    queue: SongResult[];
    isFmCall: boolean;
    options: PlaybackNavigationOptions;
};

export type SkipPromptMessageKey = 'status.songUnavailablePrompt' | 'status.playbackErrorPrompt';

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

export type StageEntryKeyOptions = {
    entryKind: StageStatus['activeEntryKind'];
    lyricsSession: StageLyricsSession | null;
    mediaSession: StageMediaSession | null;
};

export type StageLoopModeLike = StageLoopMode;
