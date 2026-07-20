import type React from 'react';
import { PlayerState, type SongResult } from '../../../types';
import type { GridViewCollectionDescriptor } from './gridViewCollectionAdapters';
import type { HomeSurfaceProps } from './homeSurfaceTypes';
import { resolveSearchSource, type SearchSource } from '../../../stores/useSearchNavigationStore';
import type { OnlineProviderPlatformState } from '../../../hooks/useOnlineProviderPlatform';

// src/components/app/home/buildHomeModel.ts

export type HomeViewModel = {
    surfaceProps: HomeSurfaceProps;
    onlineProviderPlatform?: OnlineProviderPlatformState;
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    onBackCollection: () => void;
};

type BuildHomeModelParams = {
    onlineProviderPlatform?: OnlineProviderPlatformState;
    playSong: HomeSurfaceProps['onPlaySong'];
    navigateToPlayer: HomeSurfaceProps['onBackToPlayer'];
    refreshOnlineProviderPlaylists: () => Promise<unknown>;
    user: HomeSurfaceProps['user'];
    playlists: HomeSurfaceProps['playlists'];
    cloudPlaylist?: HomeSurfaceProps['cloudPlaylist'];
    currentSong: HomeSurfaceProps['currentTrack'];
    playerState: PlayerState;
    handlePlaylistSelect: HomeSurfaceProps['onSelectPlaylist'];
    handleAlbumSelect: HomeSurfaceProps['onSelectAlbum'];
    handleArtistSelect: HomeSurfaceProps['onSelectArtist'];
    focusedPlaylistIndex?: HomeSurfaceProps['focusedPlaylistIndex'];
    setFocusedPlaylistIndex?: HomeSurfaceProps['setFocusedPlaylistIndex'];
    focusedFavoriteAlbumIndex?: HomeSurfaceProps['focusedFavoriteAlbumIndex'];
    setFocusedFavoriteAlbumIndex?: HomeSurfaceProps['setFocusedFavoriteAlbumIndex'];
    focusedRadioIndex?: HomeSurfaceProps['focusedRadioIndex'];
    setFocusedRadioIndex?: HomeSurfaceProps['setFocusedRadioIndex'];
    openSettings: NonNullable<HomeSurfaceProps['onOpenSettings']>;
    navigateToSearch: (args: { query: string; sourceTab: SearchSource; replace?: boolean }) => void;
    openLocalAlbumByName?: HomeSurfaceProps['onSelectLocalAlbum'];
    openLocalArtistByName?: HomeSurfaceProps['onSelectLocalArtist'];
    localSongs: HomeSurfaceProps['localSongs'];
    localLibraryCatalog: HomeSurfaceProps['localLibraryCatalog'];
    localPlaylists: HomeSurfaceProps['localPlaylists'];
    onRefreshLocalSongs: HomeSurfaceProps['onRefreshLocalSongs'];
    onPlayLocalSong: HomeSurfaceProps['onPlayLocalSong'];
    onAddLocalSongToQueue?: HomeSurfaceProps['onAddLocalSongToQueue'];
    localMusicState: HomeSurfaceProps['localMusicState'];
    setLocalMusicState: HomeSurfaceProps['setLocalMusicState'];
    onMatchSong?: HomeSurfaceProps['onMatchSong'];
    onPlayNavidromeSong?: HomeSurfaceProps['onPlayNavidromeSong'];
    onAddNavidromeSongsToQueue?: HomeSurfaceProps['onAddNavidromeSongsToQueue'];
    onMatchNavidromeSong?: HomeSurfaceProps['onMatchNavidromeSong'];
    navidromeFocusedAlbumIndex?: HomeSurfaceProps['navidromeFocusedAlbumIndex'];
    setNavidromeFocusedAlbumIndex?: HomeSurfaceProps['setNavidromeFocusedAlbumIndex'];
    pendingNavidromeSelection?: HomeSurfaceProps['pendingNavidromeSelection'];
    setPendingNavidromeSelection: React.Dispatch<React.SetStateAction<any>>;
    stageSource?: HomeSurfaceProps['stageSource'];
    activePlaybackContext: 'main' | 'stage';
    openStagePlayer: () => Promise<void>;
    stageStatus?: HomeSurfaceProps['stageStatus'];
    setStageStatus: React.Dispatch<React.SetStateAction<any>>;
    leaveStagePlayback: () => void;
    clearStagePlaybackSession: () => void;
    clearPersistedStagePlaybackCache: () => Promise<void>;
    loadStageSessionIntoPlayback: (session: any) => Promise<void>;
    theme: HomeSurfaceProps['theme'];
    navidromeEnabled: HomeSurfaceProps['navidromeEnabled'];
    playAll: (songs: SongResult[]) => void;
    addAllToQueue: (songs: SongResult[]) => void;
    addSongToQueue: (song: SongResult) => void;
    onStatusMessage?: HomeSurfaceProps['onStatusMessage'];
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    onBackCollection: () => void;
};

// Builds the full Home model from raw app dependencies so App.tsx no longer assembles nested props inline.
export const buildHomeModel = ({
    onlineProviderPlatform,
    playSong,
    navigateToPlayer,
    refreshOnlineProviderPlaylists,
    user,
    playlists,
    cloudPlaylist,
    currentSong,
    playerState,
    handlePlaylistSelect,
    handleAlbumSelect,
    handleArtistSelect,
    focusedPlaylistIndex,
    setFocusedPlaylistIndex,
    focusedFavoriteAlbumIndex,
    setFocusedFavoriteAlbumIndex,
    focusedRadioIndex,
    setFocusedRadioIndex,
    openSettings,
    navigateToSearch,
    openLocalAlbumByName,
    openLocalArtistByName,
    localSongs,
    localLibraryCatalog,
    localPlaylists,
    onRefreshLocalSongs,
    onPlayLocalSong,
    onAddLocalSongToQueue,
    localMusicState,
    setLocalMusicState,
    onMatchSong,
    onPlayNavidromeSong,
    onAddNavidromeSongsToQueue,
    onMatchNavidromeSong,
    navidromeFocusedAlbumIndex,
    setNavidromeFocusedAlbumIndex,
    pendingNavidromeSelection,
    setPendingNavidromeSelection,
    stageSource,
    activePlaybackContext,
    openStagePlayer,
    stageStatus,
    setStageStatus,
    leaveStagePlayback,
    clearStagePlaybackSession,
    clearPersistedStagePlaybackCache,
    loadStageSessionIntoPlayback,
    theme,
    navidromeEnabled,
    playAll,
    addAllToQueue,
    addSongToQueue,
    onStatusMessage,
    onOpenCollection,
    onPushCollection,
    onBackCollection,
}: BuildHomeModelParams): HomeViewModel => {
    return {
        onlineProviderPlatform,
        onOpenCollection,
        onPushCollection,
        onBackCollection,
        surfaceProps: {
            onPlaySong: playSong,
            onBackToPlayer: navigateToPlayer,
            onRefreshUser: () => refreshOnlineProviderPlaylists(),
            user: onlineProviderPlatform?.activeProvider?.user ?? user,
            playlists: onlineProviderPlatform?.activeProvider?.collections.filter(collection => collection.type !== 'cloud') ?? playlists,
            cloudPlaylist: onlineProviderPlatform?.activeProvider?.collections.find(collection => collection.type === 'cloud') ?? cloudPlaylist,
            currentTrack: currentSong,
            isPlaying: playerState === PlayerState.PLAYING,
            onSelectPlaylist: handlePlaylistSelect,
            onSelectAlbum: handleAlbumSelect,
            onSelectArtist: handleArtistSelect,
            onPlayAll: playAll,
            onAddAllToQueue: addAllToQueue,
            onAddSongToQueue: addSongToQueue,
            onStatusMessage,
            focusedPlaylistIndex,
            setFocusedPlaylistIndex,
            focusedFavoriteAlbumIndex,
            setFocusedFavoriteAlbumIndex,
            focusedRadioIndex,
            setFocusedRadioIndex,
            onOpenSettings: openSettings,
            onSearchCommitted: (query, sourceTab, replace = false) => {
                navigateToSearch({ query, sourceTab: resolveSearchSource(sourceTab), replace });
            },
            onSelectLocalAlbum: openLocalAlbumByName,
            onSelectLocalArtist: openLocalArtistByName,
            localSongs,
            localLibraryCatalog,
            localPlaylists,
            onRefreshLocalSongs,
            onPlayLocalSong,
            onAddLocalSongToQueue,
            localMusicState,
            setLocalMusicState,
            onMatchSong,
            onPlayNavidromeSong,
            onAddNavidromeSongsToQueue,
            onMatchNavidromeSong,
            navidromeFocusedAlbumIndex,
            setNavidromeFocusedAlbumIndex,
            pendingNavidromeSelection,
            onPendingNavidromeSelectionHandled: () => setPendingNavidromeSelection(null),
            stageEnabled: Boolean(stageSource),
            stageSource,
            stageIsActive: activePlaybackContext === 'stage',
            onOpenStagePlayer: () => {
                void openStagePlayer();
            },
            stageStatus,
            onToggleStageMode: async (enabled) => {
                try {
                    const nextStatus = await window.electron?.setStageEnabled(enabled);
                    if (nextStatus) {
                        setStageStatus(nextStatus);
                        if (!enabled && activePlaybackContext === 'stage') {
                            leaveStagePlayback();
                        }
                        if (!enabled) {
                            clearStagePlaybackSession();
                            await clearPersistedStagePlaybackCache();
                        }
                    }
                } catch (error) {
                    console.error('[buildHomeModel] Failed to toggle stage mode:', error);
                }
            },
            onStageSourceChange: async (source) => {
                if (!window.electron?.saveSettings) {
                    return;
                }
                await window.electron.saveSettings('STAGE_MODE_SOURCE', source);
            },
            onRegenerateStageToken: async () => {
                const nextStatus = await window.electron?.regenerateStageToken();
                if (nextStatus) {
                    setStageStatus(nextStatus);
                }
            },
            onClearStageState: async () => {
                const nextStatus = await window.electron?.clearStageState();
                if (nextStatus) {
                    setStageStatus(nextStatus);
                    if (activePlaybackContext === 'stage') {
                        await loadStageSessionIntoPlayback(null);
                    }
                }
            },
            theme,
            navidromeEnabled,
        },
    };
};
