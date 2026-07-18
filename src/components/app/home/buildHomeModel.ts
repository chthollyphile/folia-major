import type React from 'react';
import { PlayerState, type SongResult } from '../../../types';
import type LegacyHome from '../../Home';
import type { GridViewCollectionDescriptor } from './gridViewCollectionAdapters';
import { resolveSearchSource, type SearchSource } from '../../../stores/useSearchNavigationStore';
import type { OnlineProviderPlatformState } from '../../../hooks/useOnlineProviderPlatform';

// src/components/app/home/buildHomeModel.ts

type LegacyHomeProps = React.ComponentProps<typeof LegacyHome>;

export type HomeViewModel = {
    legacyProps: LegacyHomeProps;
    onlineProviderPlatform?: OnlineProviderPlatformState;
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    onBackCollection: () => void;
};

type BuildHomeModelParams = {
    onlineProviderPlatform?: OnlineProviderPlatformState;
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
    navigateToSearch: (args: { query: string; sourceTab: SearchSource; replace?: boolean }) => void;
    openLocalAlbumByName?: LegacyHomeProps['onSelectLocalAlbum'];
    openLocalArtistByName?: LegacyHomeProps['onSelectLocalArtist'];
    localSongs: LegacyHomeProps['localSongs'];
    localLibraryCatalog: LegacyHomeProps['localLibraryCatalog'];
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
    playAll: (songs: SongResult[]) => void;
    addAllToQueue: (songs: SongResult[]) => void;
    addSongToQueue: (song: SongResult) => void;
    onStatusMessage?: LegacyHomeProps['onStatusMessage'];
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    onBackCollection: () => void;
};

// Builds the full Home model from raw app dependencies so App.tsx no longer assembles nested props inline.
export const buildHomeModel = ({
    onlineProviderPlatform,
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
