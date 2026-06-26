import { PlayerState, type LyricData, type PlaybackContext, type SongResult, type StagePlayerSnapshot } from '../types';
import type { RemoteControlSnapshot } from '../types/remoteControl';
import type { VideoExportState } from '../types/videoExport';
import { isLocalPlaybackSong, resolveNavidromePlaybackCarrier } from './appPlaybackGuards';
import { buildStagePlayerSnapshot } from './stagePlayerSnapshot';

// src/utils/playbackSyncBridge.ts
// Derives shared playback publisher models before adapting them to Electron-facing protocols.

export interface PlaybackSyncBridgeModel {
    activePlaybackContext: PlaybackContext;
    currentSong: SongResult | null;
    playQueue: SongResult[];
    hasTrack: boolean;
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    currentIndex: number;
    currentTimeSec: number;
    stagePositionSec: number;
    durationSec: number;
    stageDurationSec: number;
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
    isDaylight: boolean;
    isLiked: boolean;
    mainWindowWidth: number;
    mainWindowHeight: number;
    lyricOffsetMs?: number;
    sampledAt: number;
}

export interface BuildPlaybackSyncBridgeModelArgs {
    activePlaybackContext: PlaybackContext;
    currentSong: SongResult | null;
    playQueue: SongResult[];
    currentTimeSec: number;
    stagePositionSec?: number;
    durationSec: number;
    stageDurationSec?: number;
    playerState: PlayerState;
    coverUrl: string | null;
    cachedCoverUrl?: string | null;
    effectiveLoopMode: 'off' | 'all' | 'one';
    isFmMode: boolean;
    isStageActive: boolean;
    controlsDisabled: boolean;
    transparentModeEnabled: boolean;
    mainWindowClickThroughEnabled: boolean;
    mainWindowAlwaysOnTop?: boolean;
    mainWindowBorderVisible: boolean;
    playerChromeHidden: boolean;
    exportState: VideoExportState;
    isDaylight: boolean;
    isLiked: boolean;
    mainWindowWidth: number;
    mainWindowHeight: number;
    lyricOffsetMs?: number;
    sampledAt?: number;
}

export interface RemoteControlSnapshotOptions {
    lyrics?: LyricData | null;
    includeLyrics?: boolean;
}

export interface DiscordPresenceSnapshot {
    hasTrack: boolean;
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    currentTime: number;
    duration: number;
    playerState: PlayerState;
    updatedAt: number;
}

const clampFiniteNumber = (value: number, fallback = 0): number => {
    return Number.isFinite(value) ? value : fallback;
};

const getPlaybackSyncBridgeArtist = (song: SongResult | null): string | null => {
    if (!song) {
        return null;
    }

    const artistNames = song.artists?.map(artist => artist.name).filter(Boolean) ?? [];
    const primaryArtists = artistNames.length > 0
        ? artistNames
        : song.ar?.map(artist => artist.name).filter(Boolean) ?? [];
    if (primaryArtists.length > 0) {
        return primaryArtists.join(', ');
    }

    if (isLocalPlaybackSong(song)) {
        return song.localData.matchedArtists || song.localData.artist || null;
    }

    const navidromeSong = resolveNavidromePlaybackCarrier(song);
    return navidromeSong?.artists?.map(artist => artist.name).filter(Boolean).join(', ') || null;
};

const getPlaybackSyncBridgeCoverUrl = (
    song: SongResult | null,
    coverUrl: string | null,
    cachedCoverUrl: string | null | undefined,
): string | null => {
    return coverUrl || cachedCoverUrl || song?.al?.picUrl || song?.album?.picUrl || null;
};

// Builds the single playback model used by Electron publishers with protocol-specific adapters.
export const buildPlaybackSyncBridgeModel = ({
    activePlaybackContext,
    currentSong,
    playQueue,
    currentTimeSec,
    stagePositionSec,
    durationSec,
    stageDurationSec,
    playerState,
    coverUrl,
    cachedCoverUrl,
    effectiveLoopMode,
    isFmMode,
    isStageActive,
    controlsDisabled,
    transparentModeEnabled,
    mainWindowClickThroughEnabled,
    mainWindowAlwaysOnTop = false,
    mainWindowBorderVisible,
    playerChromeHidden,
    exportState,
    isDaylight,
    isLiked,
    mainWindowWidth,
    mainWindowHeight,
    lyricOffsetMs,
    sampledAt = Date.now(),
}: BuildPlaybackSyncBridgeModelArgs): PlaybackSyncBridgeModel => {
    const hasTrack = !isStageActive && Boolean(currentSong);
    const currentIndex = currentSong ? playQueue.findIndex(song => song.id === currentSong.id) : -1;
    const hasQueueNeighbors = playQueue.length > 1;
    const canGoPrevious = hasTrack && (currentIndex > 0 || (effectiveLoopMode === 'all' && hasQueueNeighbors));
    const canGoNext = hasTrack && (
        isFmMode ||
        currentIndex >= 0 && currentIndex < playQueue.length - 1 ||
        (effectiveLoopMode === 'all' && hasQueueNeighbors)
    );
    const safeCurrentTimeSec = Math.max(0, clampFiniteNumber(currentTimeSec));
    const safeDurationSec = Math.max(0, clampFiniteNumber(durationSec));

    return {
        activePlaybackContext,
        currentSong,
        playQueue,
        hasTrack,
        title: currentSong?.name ?? null,
        artist: getPlaybackSyncBridgeArtist(currentSong),
        coverUrl: getPlaybackSyncBridgeCoverUrl(currentSong, coverUrl, cachedCoverUrl),
        currentIndex,
        currentTimeSec: safeCurrentTimeSec,
        stagePositionSec: Math.max(0, clampFiniteNumber(stagePositionSec ?? safeCurrentTimeSec)),
        durationSec: safeDurationSec,
        stageDurationSec: Math.max(0, clampFiniteNumber(stageDurationSec ?? safeDurationSec)),
        playerState,
        canGoPrevious,
        canGoNext,
        controlsDisabled: controlsDisabled || !hasTrack,
        isStageActive,
        transparentModeEnabled,
        mainWindowClickThroughEnabled,
        mainWindowAlwaysOnTop,
        mainWindowBorderVisible,
        playerChromeHidden,
        exportState,
        isDaylight,
        isLiked,
        mainWindowWidth,
        mainWindowHeight,
        lyricOffsetMs,
        sampledAt,
    };
};

export const buildRemoteControlSnapshotFromPlaybackSyncBridge = (
    model: PlaybackSyncBridgeModel,
    options: RemoteControlSnapshotOptions = {},
): RemoteControlSnapshot => ({
    hasTrack: model.hasTrack,
    title: model.title,
    artist: model.artist,
    coverUrl: model.coverUrl,
    currentTime: model.currentTimeSec,
    duration: model.durationSec,
    playerState: model.playerState,
    canGoPrevious: model.canGoPrevious,
    canGoNext: model.canGoNext,
    controlsDisabled: model.controlsDisabled,
    isStageActive: model.isStageActive,
    transparentModeEnabled: model.transparentModeEnabled,
    mainWindowClickThroughEnabled: model.mainWindowClickThroughEnabled,
    mainWindowAlwaysOnTop: model.mainWindowAlwaysOnTop,
    mainWindowBorderVisible: model.mainWindowBorderVisible,
    playerChromeHidden: model.playerChromeHidden,
    exportState: model.exportState,
    isDaylight: model.isDaylight,
    ...(options.includeLyrics ? { lyrics: options.lyrics ?? null } : {}),
    lyricOffsetMs: model.lyricOffsetMs,
    isLiked: model.isLiked,
    updatedAt: model.sampledAt,
    mainWindowWidth: model.mainWindowWidth,
    mainWindowHeight: model.mainWindowHeight,
});

export const buildStagePlayerSnapshotFromPlaybackSyncBridge = (
    model: PlaybackSyncBridgeModel,
): StagePlayerSnapshot => buildStagePlayerSnapshot({
    activePlaybackContext: model.activePlaybackContext,
    isExternalPlaybackSourceActive: model.isStageActive,
    currentSong: model.currentSong,
    playQueue: model.playQueue,
    playerState: model.playerState,
    positionMs: model.stagePositionSec * 1000,
    durationMs: model.stageDurationSec * 1000,
    canGoPrevious: model.canGoPrevious,
    canGoNext: model.canGoNext,
    coverUrl: model.coverUrl,
});

export const buildDiscordPresenceSnapshotFromPlaybackSyncBridge = (
    model: PlaybackSyncBridgeModel,
): DiscordPresenceSnapshot => ({
    hasTrack: model.hasTrack,
    title: model.title,
    artist: model.artist,
    coverUrl: model.coverUrl,
    currentTime: model.currentTimeSec,
    duration: model.durationSec,
    playerState: model.playerState,
    updatedAt: model.sampledAt,
});

export const buildTaskbarControlsFromPlaybackSyncBridge = (model: PlaybackSyncBridgeModel) => ({
    hasActiveTrack: model.hasTrack,
    canGoPrevious: model.canGoPrevious,
    canGoNext: model.canGoNext,
    isPlaying: model.hasTrack && model.playerState === PlayerState.PLAYING,
});
