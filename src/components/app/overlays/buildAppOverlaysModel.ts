import type React from 'react';
import type { MotionValue } from 'framer-motion';
import type FloatingPlayerControls from '../../FloatingPlayerControls';
import type SearchResultsOverlay from '../../SearchResultsOverlay';
import type DevDebugOverlay from '../../DevDebugOverlay';
import type PlaylistView from '../views/PlaylistView';
import type AlbumView from '../views/AlbumView';
import type ArtistView from '../views/ArtistView';
import type { SongResult, UnifiedSong, LyricData, PlayerState } from '../../../types';

// src/components/app/overlays/buildAppOverlaysModel.ts

type SearchOverlayProps = React.ComponentProps<typeof SearchResultsOverlay>;
type FloatingControlsProps = React.ComponentProps<typeof FloatingPlayerControls>;
type DebugOverlayProps = React.ComponentProps<typeof DevDebugOverlay>;
type PlaylistOverlayProps = React.ComponentProps<typeof PlaylistView>;
type AlbumOverlayProps = React.ComponentProps<typeof AlbumView>;
type ArtistOverlayProps = React.ComponentProps<typeof ArtistView>;

export type AppOverlaysModel = {
    homeOverlay?: {
        isVisible: boolean;
        content: React.ReactNode;
    } | null;
    searchOverlay?: SearchOverlayProps | null;
    detailOverlay?: (
        | { type: 'playlist'; props: PlaylistOverlayProps }
        | { type: 'album'; props: AlbumOverlayProps }
        | { type: 'artist'; props: ArtistOverlayProps }
    ) | null;
    debugOverlay?: DebugOverlayProps | null;
    floatingControls?: FloatingControlsProps | null;
};

type BuildAppOverlaysModelParams = {
    currentView: string;
    isOverlayVisible: boolean;
    topOverlay: any;
    overlayStack: any[];
    homeContent: React.ReactNode;
    theme: any;
    isDaylight: boolean;
    closeSearchView: () => void;
    handleSearchOverlaySubmit: () => Promise<void>;
    handleSearchLoadMore: () => Promise<void>;
    handleSearchResultPlay: (track: UnifiedSong) => void;
    handleSearchResultArtistSelect: (track: UnifiedSong, artistName: string, artistId?: number) => void;
    handleSearchResultAlbumSelect: (track: UnifiedSong, albumName: string, albumId?: number) => void;
    popOverlay: () => void;
    playSong: (song: SongResult, queue?: SongResult[], isFmCall?: boolean) => Promise<void>;
    playOnlineQueueFromStart: (songs: SongResult[]) => void;
    addNeteaseSongsToQueue: (songs: SongResult[]) => void;
    addNeteaseSongToQueue: (song: SongResult) => void;
    handleAlbumSelect: (albumId: number) => void;
    handleArtistSelect: (artistId: number) => void;
    userId?: number;
    playlists: Array<{ id: number }>;
    refreshUserData: () => Promise<void>;
    isDev: boolean;
    isDevDebugOverlayVisible: boolean;
    devDebugSnapshot: any;
    currentTime: MotionValue<number>;
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
    noTrackText: string;
};

// Builds the full overlay model, including detail overlays and floating playback controls.
export const buildAppOverlaysModel = ({
    currentView,
    isOverlayVisible,
    topOverlay,
    overlayStack,
    homeContent,
    theme,
    isDaylight,
    closeSearchView,
    handleSearchOverlaySubmit,
    handleSearchLoadMore,
    handleSearchResultPlay,
    handleSearchResultArtistSelect,
    handleSearchResultAlbumSelect,
    popOverlay,
    playSong,
    playOnlineQueueFromStart,
    addNeteaseSongsToQueue,
    addNeteaseSongToQueue,
    handleAlbumSelect,
    handleArtistSelect,
    userId,
    playlists,
    refreshUserData,
    isDev,
    isDevDebugOverlayVisible,
    devDebugSnapshot,
    currentTime,
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
    noTrackText,
}: BuildAppOverlaysModelParams): AppOverlaysModel => ({
    homeOverlay: currentView === 'home' && !isOverlayVisible
        ? { isVisible: true, content: homeContent }
        : null,
    searchOverlay: currentView === 'home'
        ? {
            theme,
            isDaylight,
            onClose: closeSearchView,
            onSubmitSearch: handleSearchOverlaySubmit,
            onLoadMore: handleSearchLoadMore,
            onPlayTrack: handleSearchResultPlay,
            onSelectArtist: handleSearchResultArtistSelect,
            onSelectAlbum: handleSearchResultAlbumSelect,
        }
        : null,
    detailOverlay: isOverlayVisible && topOverlay
        ? (topOverlay.type === 'playlist'
            ? {
                type: 'playlist' as const,
                props: {
                    key: `playlist-${topOverlay.playlist.id}-${overlayStack.length - 1}`,
                    playlist: topOverlay.playlist,
                    onBack: popOverlay,
                    onPlaySong: (song, ctx) => {
                        void playSong(song, ctx, false);
                    },
                    onPlayAll: songs => {
                        playOnlineQueueFromStart(songs);
                    },
                    onAddAllToQueue: addNeteaseSongsToQueue,
                    onAddSongToQueue: addNeteaseSongToQueue,
                    onSelectAlbum: handleAlbumSelect,
                    onSelectArtist: handleArtistSelect,
                    currentUserId: userId,
                    isLikedSongsPlaylist: playlists[0]?.id === topOverlay.playlist.id,
                    onPlaylistMutated: async () => {
                        await refreshUserData();
                    },
                    theme,
                    isDaylight,
                },
            }
            : topOverlay.type === 'album'
                ? {
                    type: 'album' as const,
                    props: {
                        key: `album-${topOverlay.id}-${overlayStack.length - 1}`,
                        albumId: topOverlay.id,
                        onBack: popOverlay,
                        onPlaySong: (song, ctx) => {
                            void playSong(song, ctx, false);
                        },
                        onPlayAll: songs => {
                            playOnlineQueueFromStart(songs);
                        },
                        onAddAllToQueue: addNeteaseSongsToQueue,
                        onAddSongToQueue: addNeteaseSongToQueue,
                        onSelectArtist: handleArtistSelect,
                        theme,
                        isDaylight,
                    },
                }
                : {
                    type: 'artist' as const,
                    props: {
                        key: `artist-${topOverlay.id}-${overlayStack.length - 1}`,
                        artistId: topOverlay.id,
                        onBack: popOverlay,
                        onPlaySong: (song, ctx) => {
                            void playSong(song, ctx, false);
                        },
                        onSelectAlbum: handleAlbumSelect,
                        theme,
                        isDaylight,
                    },
                })
        : null,
    debugOverlay: isDev && currentView === 'player' && isDevDebugOverlayVisible
        ? {
            snapshot: devDebugSnapshot,
            currentTime,
            isDaylight,
        }
        : null,
    floatingControls: currentSong
        ? {
            currentSong,
            playerState,
            currentTime,
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
                    if (playerState !== 'playing') {
                        setPlayerState('playing');
                    }
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
