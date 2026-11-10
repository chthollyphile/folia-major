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
    shouldNavigateToPlayer?: boolean;
    unavailableSkipCount?: number;
    unifiedQueue?: SongResult[];
    /**
     * Set only by the automix blend's own advance. That play skips extension `beforePlay` hooks:
     * the blend starts the arriving track on a fixed schedule, and its cancel paths assume the
     * advance has already moved playback to that track.
     */
    isAutomixAdvance?: boolean;
    /**
     * Set only by playSong when it hands a local or Navidrome song to the library controller (playSong
     * itself never reads it): true once a whole-queue write (a mod's replaceQueue, its undo) came while
     * the play waited and the play's queue was the store's, so the landing leaves the new queue standing.
     */
    queueRewritten?: () => boolean;
    /**
     * Where a local or Navidrome song starts, in seconds, instead of its beginning: the web route's
     * deck seeks there once its metadata is in, the HiFi route loads mpv there. Set by the HiFi bridge
     * when it moves the song it was playing to the other engine (a HiFi failure, HiFi switched off, a
     * replay after the queue ended), so the listener keeps their place. Only onPlayLocalSong and
     * onPlayNavidromeSong read it.
     */
    startAtSec?: number;
    /**
     * false: the song is loaded and left paused, as a paused song moved to the other engine stays
     * paused. Not given: it plays, as every play does. Only onPlayLocalSong and onPlayNavidromeSong read it.
     */
    autoplay?: boolean;
    /**
     * The play's own progress and success toasts ('loading', 'loaded', the external player's own
     * 'preparing' line) are not shown: the toast that is showing stays (why the song left HiFi, or the
     * line about the song skipped just before this one). Read where a play puts those lines on screen,
     * the external player's start included, and by onPlayLocalSong and onPlayNavidromeSong.
     */
    quietLoadedToast?: boolean;
    /**
     * Set only where the play was not pressed: the deck ran out, the blend advanced, or a provider's
     * own player reported the track ended. Such a play may not start or restart the player outside
     * the app, and a player that cannot be reached stops it where it is instead of failing it.
     */
    autoAdvance?: boolean;
};

export type NextTrackOptions = PlaybackNavigationOptions & {
    allowStopOnMissing?: boolean;
    /**
     * Set only by a provider's own player reporting the end of a song while the queue repeats one
     * song: this song starts over from its beginning instead of the queue stepping on. A press of
     * next, and a player its listener stepped by its own controls, never carry it.
     */
    replayCurrent?: boolean;
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
    /**
     * The queue and Personal FM of the moment the dialog is confirmed, when a whole-queue write came
     * since the play that opened it and that play's queue was the store's; null otherwise, and then
     * `queue` and `isFmCall` stand.
     */
    liveQueue?: () => { queue: SongResult[]; isFmCall: boolean } | null;
    /** Personal FM was ended from outside since the play that opened it (a switch to another platform): the other version plays without it. */
    fmEnded?: () => boolean;
};

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
    /** Provider id → the extra radio on air in it, while FM plays: which radio the queue came from. Its mode choice is not carried. */
    fmStations?: Record<string, string>;
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
