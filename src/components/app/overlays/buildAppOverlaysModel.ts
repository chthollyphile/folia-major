import type React from 'react';
import type { MotionValue } from 'framer-motion';
import type FloatingPlayerControls from '../../FloatingPlayerControls';
import type SearchWorkspace from '../search/SearchWorkspace';
import type DevDebugOverlay from '../../DevDebugOverlay';
import { PlayerState } from '../../../types';
import type { SongResult, UnifiedSong, LyricData } from '../../../types';

// src/components/app/overlays/buildAppOverlaysModel.ts

type SearchOverlayProps = React.ComponentProps<typeof SearchWorkspace>;
type FloatingControlsProps = React.ComponentProps<typeof FloatingPlayerControls>;
type DebugOverlayProps = React.ComponentProps<typeof DevDebugOverlay>;

export type AppOverlaysModel = {
    searchOverlay?: SearchOverlayProps | null;
    debugOverlay?: DebugOverlayProps | null;
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
    isDev: boolean;
    isDevDebugOverlayVisible: boolean;
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
    isDev,
    isDevDebugOverlayVisible,
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
    debugOverlay: isDev && currentView === 'player' && isDevDebugOverlayVisible
        ? {
            snapshot: devDebugSnapshot,
            currentTime,
            lyricCurrentTime,
            isDaylight,
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
        }
        : null,
});
