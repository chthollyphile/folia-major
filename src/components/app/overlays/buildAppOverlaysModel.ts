import type React from 'react';
import type { MotionValue } from 'framer-motion';
import type FloatingPlayerControls from '../../FloatingPlayerControls';
import type SearchWorkspace from '../search/SearchWorkspace';
import type DevDebugOverlay from '../../DevDebugOverlay';
import type MemoryMonitorWindow from '../../debug/MemoryMonitorWindow';
import { PlayerState } from '../../../types';
import type { SongResult, UnifiedSong, LyricData } from '../../../types';
import { resolvePlaybackNeighbors } from '../../../utils/playbackNeighbors';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';

// src/components/app/overlays/buildAppOverlaysModel.ts

type SearchOverlayProps = React.ComponentProps<typeof SearchWorkspace>;
type FloatingControlsProps = React.ComponentProps<typeof FloatingPlayerControls>;
type DebugOverlayProps = React.ComponentProps<typeof DevDebugOverlay>;
type MemoryMonitorProps = React.ComponentProps<typeof MemoryMonitorWindow>;

export type AppOverlaysModel = {
    searchOverlay?: SearchOverlayProps | null;
    debugOverlay?: DebugOverlayProps | null;
    memoryMonitor?: MemoryMonitorProps | null;
    floatingControls?: FloatingControlsProps | null;
};

type BuildAppOverlaysModelParams = {
    currentView: FloatingControlsProps['currentView'];
    isSearchOpen: boolean;
    theme: any;
    isDaylight: boolean;
    closeSearchView: () => void;
    handleSearchOverlaySubmit: SearchOverlayProps['onSubmitSearch'];
    handleSearchLoadMore: () => Promise<void>;
    handleSearchResultPlay: (track: UnifiedSong) => void;
    handleSearchResultAddToQueue: (track: UnifiedSong) => void;
    handleSearchResultArtistOpen: SearchOverlayProps['onOpenArtist'];
    handleSearchResultAlbumOpen: SearchOverlayProps['onOpenAlbum'];
    isDevDebugOverlayVisible: boolean;
    setIsDevDebugOverlayVisible: (visible: boolean) => void;
    isMemoryMonitorVisible: boolean;
    setIsMemoryMonitorVisible: (visible: boolean) => void;
    memoryMonitorShortcutLabel: string;
    devDebugSnapshot: any;
    currentTime: MotionValue<number>;
    lyricCurrentTime: MotionValue<number>;
    currentSong: SongResult | null;
    playerState: PlayerState;
    duration: number;
    effectiveLoopMode: 'off' | 'all' | 'one';
    audioSrc: string | null;
    canToggleCurrentPlayback: boolean;
    isNowPlayingControlDisabled: boolean;
    lyrics: LyricData | null;
    activePlaybackContext: 'main' | 'stage';
    stageActiveEntryKind: string | null;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
    stageLyricsClockRef: React.MutableRefObject<{ startTimeSec: number }>;
    setPlayerState: React.Dispatch<React.SetStateAction<PlayerState>>;
    togglePlay: FloatingControlsProps['onTogglePlay'];
    toggleLoop: FloatingControlsProps['onToggleLoop'];
    navigateToPlayer: () => void;
    isPlayerChromeHidden: boolean;
    shouldHidePlayerProgressBar: boolean;
    onSeekMainAudio: (time: number) => void;
    onStagePlayerSeek: () => Promise<unknown>;
    noTrackText: string;
    playQueue: SongResult[];
    isFmMode: boolean;
    isNowPlayingStageActive: boolean;
    handlePrevTrack: () => void;
    handleNextTrack: () => void;
    prevTrackLabel: string;
    nextTrackLabel: string;
};

// Builds the full overlay model, including detail overlays and floating playback controls.
export const buildAppOverlaysModel = ({
    currentView,
    isSearchOpen,
    theme,
    isDaylight,
    closeSearchView,
    handleSearchOverlaySubmit,
    handleSearchLoadMore,
    handleSearchResultPlay,
    handleSearchResultAddToQueue,
    handleSearchResultArtistOpen,
    handleSearchResultAlbumOpen,
    isDevDebugOverlayVisible,
    setIsDevDebugOverlayVisible,
    isMemoryMonitorVisible,
    setIsMemoryMonitorVisible,
    memoryMonitorShortcutLabel,
    devDebugSnapshot,
    currentTime,
    lyricCurrentTime,
    currentSong,
    playerState,
    duration,
    effectiveLoopMode,
    audioSrc,
    canToggleCurrentPlayback,
    isNowPlayingControlDisabled,
    lyrics,
    activePlaybackContext,
    stageActiveEntryKind,
    syncStageLyricsClock,
    stageLyricsClockRef,
    setPlayerState,
    togglePlay,
    toggleLoop,
    navigateToPlayer,
    isPlayerChromeHidden,
    shouldHidePlayerProgressBar,
    onSeekMainAudio,
    onStagePlayerSeek,
    noTrackText,
    playQueue,
    isFmMode,
    isNowPlayingStageActive,
    handlePrevTrack,
    handleNextTrack,
    prevTrackLabel,
    nextTrackLabel,
}: BuildAppOverlaysModelParams): AppOverlaysModel => ({
    searchOverlay: currentView === 'home'
        ? {
            theme,
            isDaylight,
            onClose: closeSearchView,
            onSubmitSearch: handleSearchOverlaySubmit,
            onLoadMore: handleSearchLoadMore,
            onPlayTrack: handleSearchResultPlay,
            onAddTrackToQueue: handleSearchResultAddToQueue,
            onOpenArtist: handleSearchResultArtistOpen,
            onOpenAlbum: handleSearchResultAlbumOpen,
        }
        : null,
    // Not gated on the view, and that was a real hole: the app cold-starts on the home page,
    // so after a restart the chord opened nothing until something had been played - which
    // reads exactly like the switch in Settings having lost its setting. This overlay is the
    // only console the packaged build has, and the pages it could not be opened from are the
    // ones where a problem stops you ever reaching the player.
    debugOverlay: isDevDebugOverlayVisible && devDebugSnapshot
        ? {
            snapshot: devDebugSnapshot,
            currentTime,
            lyricCurrentTime,
            isDaylight,
            onClose: () => setIsDevDebugOverlayVisible(false),
        }
        : null,
    // Independent of the log window on purpose: they answer different questions and are read side
    // by side. Closing either one stops neither the console buffer nor the sampling behind it.
    memoryMonitor: isMemoryMonitorVisible
        ? {
            isDaylight,
            shortcutLabel: memoryMonitorShortcutLabel,
            onClose: () => setIsMemoryMonitorVisible(false),
        }
        : null,
    floatingControls: currentSong
        ? {
            currentSong,
            playerState,
            currentTime,
            lyricCurrentTime,
            duration,
            loopMode: effectiveLoopMode,
            currentView,
            audioSrc,
            canTogglePlay: canToggleCurrentPlayback,
            controlsDisabled: isNowPlayingControlDisabled,
            lyrics,
            onSeek: (time) => {
                if (isNowPlayingControlDisabled) {
                    return;
                }

                if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
                    syncStageLyricsClock(time, duration, playerState, stageLyricsClockRef.current.startTimeSec);
                    currentTime.set(time);
                    if (playerState !== PlayerState.PLAYING) {
                        setPlayerState(PlayerState.PLAYING);
                    }
                    void onStagePlayerSeek();
                } else {
                    onSeekMainAudio(time);
                }
            },
            onTogglePlay: togglePlay,
            onToggleLoop: toggleLoop,
            onNavigateToPlayer: navigateToPlayer,
            noTrackText,
            primaryColor: 'var(--text-primary)',
            secondaryColor: 'var(--text-secondary)',
            theme,
            isDaylight,
            isHidden: currentView === 'player' && isPlayerChromeHidden,
            hideControlBar: shouldHidePlayerProgressBar,
            trackNavigation: ((): FloatingControlsProps['trackNavigation'] => {
                const neighbors = resolvePlaybackNeighbors({
                    playQueue,
                    currentSong,
                    loopMode: effectiveLoopMode,
                    isFmMode,
                    isStageActive: isNowPlayingStageActive,
                });

                return {
                    currentTrackKey: getPlaybackSongKey(currentSong),
                    onPrev: handlePrevTrack,
                    onNext: handleNextTrack,
                    canPrev: neighbors.prev.canGo && !isNowPlayingControlDisabled,
                    canNext: neighbors.next.canGo && !isNowPlayingControlDisabled,
                    prevTitle: neighbors.prev.title,
                    nextTitle: neighbors.next.title,
                    prevLabel: prevTrackLabel,
                    nextLabel: nextTrackLabel,
                };
            })(),
        }
        : null,
});
