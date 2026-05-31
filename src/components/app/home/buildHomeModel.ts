import type React from 'react';
import { PlayerState, type HomeViewTab } from '../../../types';
import type LegacyHome from '../../Home';

// src/components/app/home/buildHomeModel.ts

type LegacyHomeProps = React.ComponentProps<typeof LegacyHome>;

export type HomeViewModel = {
    legacyProps: LegacyHomeProps;
};

type BuildHomeModelParams = {
    playSong: LegacyHomeProps['onPlaySong'];
    navigateToPlayer: LegacyHomeProps['onBackToPlayer'];
    refreshUserData: () => Promise<unknown>;
    user: LegacyHomeProps['user'];
    playlists: LegacyHomeProps['playlists'];
    cloudPlaylist?: LegacyHomeProps['cloudPlaylist'];
    currentSong: LegacyHomeProps['currentTrack'];
    playerState: PlayerState;
    handlePlaylistSelect: LegacyHomeProps['onSelectPlaylist'];
    handleAlbumSelect: LegacyHomeProps['onSelectAlbum'];
    handleArtistSelect: LegacyHomeProps['onSelectArtist'];
    focusedPlaylistIndex?: LegacyHomeProps['focusedPlaylistIndex'];
    setFocusedPlaylistIndex?: LegacyHomeProps['setFocusedPlaylistIndex'];
    focusedFavoriteAlbumIndex?: LegacyHomeProps['focusedFavoriteAlbumIndex'];
    setFocusedFavoriteAlbumIndex?: LegacyHomeProps['setFocusedFavoriteAlbumIndex'];
    focusedRadioIndex?: LegacyHomeProps['focusedRadioIndex'];
    setFocusedRadioIndex?: LegacyHomeProps['setFocusedRadioIndex'];
    openSettings: NonNullable<LegacyHomeProps['onOpenSettings']>;
    navigateToSearch: (args: { query: string; sourceTab: HomeViewTab; replace?: boolean }) => void;
    openLocalAlbumByName?: LegacyHomeProps['onSelectLocalAlbum'];
    openLocalArtistByName?: LegacyHomeProps['onSelectLocalArtist'];
    localSongs: LegacyHomeProps['localSongs'];
    localPlaylists: LegacyHomeProps['localPlaylists'];
    onRefreshLocalSongs: LegacyHomeProps['onRefreshLocalSongs'];
    onPlayLocalSong: LegacyHomeProps['onPlayLocalSong'];
    onAddLocalSongToQueue?: LegacyHomeProps['onAddLocalSongToQueue'];
    localMusicState: LegacyHomeProps['localMusicState'];
    setLocalMusicState: LegacyHomeProps['setLocalMusicState'];
    onMatchSong?: LegacyHomeProps['onMatchSong'];
    onPlayNavidromeSong?: LegacyHomeProps['onPlayNavidromeSong'];
    onAddNavidromeSongsToQueue?: LegacyHomeProps['onAddNavidromeSongsToQueue'];
    onMatchNavidromeSong?: LegacyHomeProps['onMatchNavidromeSong'];
    navidromeFocusedAlbumIndex?: LegacyHomeProps['navidromeFocusedAlbumIndex'];
    setNavidromeFocusedAlbumIndex?: LegacyHomeProps['setNavidromeFocusedAlbumIndex'];
    pendingNavidromeSelection?: LegacyHomeProps['pendingNavidromeSelection'];
    setPendingNavidromeSelection: React.Dispatch<React.SetStateAction<any>>;
    stageSource?: LegacyHomeProps['stageSource'];
    activePlaybackContext: 'main' | 'stage';
    openStagePlayer: () => Promise<void>;
    stageStatus?: LegacyHomeProps['stageStatus'];
    setStageStatus: React.Dispatch<React.SetStateAction<any>>;
    leaveStagePlayback: () => void;
    clearStagePlaybackSession: () => void;
    clearPersistedStagePlaybackCache: () => Promise<void>;
    loadStageSessionIntoPlayback: (session: any) => Promise<void>;
    theme: LegacyHomeProps['theme'];
    navidromeEnabled: LegacyHomeProps['navidromeEnabled'];
};

// Builds the full Home model from raw app dependencies so App.tsx no longer assembles nested props inline.
export const buildHomeModel = ({
    playSong,
    navigateToPlayer,
    refreshUserData,
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
}: BuildHomeModelParams): HomeViewModel => {
    return {
        legacyProps: {
            onPlaySong: playSong,
            onBackToPlayer: navigateToPlayer,
            onRefreshUser: () => refreshUserData(),
            user,
            playlists,
            cloudPlaylist,
            currentTrack: currentSong,
            isPlaying: playerState === PlayerState.PLAYING,
            onSelectPlaylist: handlePlaylistSelect,
            onSelectAlbum: handleAlbumSelect,
            onSelectArtist: handleArtistSelect,
            focusedPlaylistIndex,
            setFocusedPlaylistIndex,
            focusedFavoriteAlbumIndex,
            setFocusedFavoriteAlbumIndex,
            focusedRadioIndex,
            setFocusedRadioIndex,
            onOpenSettings: openSettings,
            onSearchCommitted: (query, sourceTab, replace = false) => {
                navigateToSearch({ query, sourceTab, replace });
            },
            onSelectLocalAlbum: openLocalAlbumByName,
            onSelectLocalArtist: openLocalArtistByName,
            localSongs,
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
