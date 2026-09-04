import type React from 'react';
import type { SongResult, StageSource } from '../../../types';
import type { GridViewCollectionDescriptor } from './gridViewCollectionAdapters';
import type { HomeSurfaceProps } from './homeSurfaceTypes';
import { resolveSearchSource, type SearchSource } from '../../../stores/useSearchNavigationStore';
import type { OnlineProviderPlatformState } from '../../../hooks/useOnlineProviderPlatform';
import { openSettings } from '../../../stores/useSettingsModalStore';

// src/components/app/home/buildHomeModel.ts

export type HomeViewModel = {
    surfaceProps: HomeSurfaceProps;
    onlineProviderPlatform?: OnlineProviderPlatformState;
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    onBackCollection: () => void;
};

// What this file can read for itself, so the caller never names it. See useHomeModel below.
type HomeModelAmbient = {
    currentSong: HomeSurfaceProps['currentTrack'];
    activePlaybackContext: 'main' | 'stage';
    navidromeEnabled: HomeSurfaceProps['navidromeEnabled'];
};

export type HomeModelDeps = {
    onlineProviderPlatform?: OnlineProviderPlatformState;
    playSong: HomeSurfaceProps['onPlaySong'];
    navigateToPlayer: HomeSurfaceProps['onBackToPlayer'];
    navigateToLattice: NonNullable<HomeSurfaceProps['onOpenLattice']>;
    refreshOnlineProviderPlaylists: () => Promise<unknown>;
    user: HomeSurfaceProps['user'];
    playlists: HomeSurfaceProps['playlists'];
    cloudPlaylist?: HomeSurfaceProps['cloudPlaylist'];
    focusedPlaylistIndex?: HomeSurfaceProps['focusedPlaylistIndex'];
    setFocusedPlaylistIndex?: HomeSurfaceProps['setFocusedPlaylistIndex'];
    navigateToSearch: (args: { query: string; sourceTab: SearchSource; replace?: boolean }) => void;
    localSongs: HomeSurfaceProps['localSongs'];
    localLibraryCatalog: HomeSurfaceProps['localLibraryCatalog'];
    localPlaylists: HomeSurfaceProps['localPlaylists'];
    onRefreshLocalSongs: HomeSurfaceProps['onRefreshLocalSongs'];
    onAddLocalSongToQueue?: HomeSurfaceProps['onAddLocalSongToQueue'];
    localMusicState: HomeSurfaceProps['localMusicState'];
    setLocalMusicState: HomeSurfaceProps['setLocalMusicState'];
    onAddNavidromeSongsToQueue?: HomeSurfaceProps['onAddNavidromeSongsToQueue'];
    navidromeFocusedAlbumIndex?: HomeSurfaceProps['navidromeFocusedAlbumIndex'];
    setNavidromeFocusedAlbumIndex?: HomeSurfaceProps['setNavidromeFocusedAlbumIndex'];
    pendingNavidromeSelection?: HomeSurfaceProps['pendingNavidromeSelection'];
    setPendingNavidromeSelection: React.Dispatch<React.SetStateAction<any>>;
    stageSource?: StageSource | null;
    openStagePlayer: () => Promise<void>;
    theme: HomeSurfaceProps['theme'];
    playAll: (songs: SongResult[]) => void;
    addAllToQueue: (songs: SongResult[]) => void;
    addSongToQueue: (song: SongResult) => void;
    onStatusMessage?: HomeSurfaceProps['onStatusMessage'];
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    onBackCollection: () => void;
};

type BuildHomeModelParams = HomeModelAmbient & HomeModelDeps;

// Builds the full Home model from raw app dependencies so App.tsx no longer assembles nested props inline.
export const buildHomeModel = ({
    onlineProviderPlatform,
    playSong,
    navigateToPlayer,
    navigateToLattice,
    refreshOnlineProviderPlaylists,
    user,
    playlists,
    cloudPlaylist,
    currentSong,
    focusedPlaylistIndex,
    setFocusedPlaylistIndex,
    navigateToSearch,
    localSongs,
    localLibraryCatalog,
    localPlaylists,
    onRefreshLocalSongs,
    onAddLocalSongToQueue,
    localMusicState,
    setLocalMusicState,
    onAddNavidromeSongsToQueue,
    navidromeFocusedAlbumIndex,
    setNavidromeFocusedAlbumIndex,
    pendingNavidromeSelection,
    setPendingNavidromeSelection,
    stageSource,
    activePlaybackContext,
    openStagePlayer,
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
            onOpenLattice: navigateToLattice,
            onRefreshUser: () => refreshOnlineProviderPlaylists(),
            user: onlineProviderPlatform?.activeProvider?.user ?? user,
            playlists: onlineProviderPlatform?.activeProvider?.collections.filter(collection => collection.type !== 'cloud') ?? playlists,
            cloudPlaylist: onlineProviderPlatform?.activeProvider?.collections.find(collection => collection.type === 'cloud') ?? cloudPlaylist,
            currentTrack: currentSong,
            onPlayAll: playAll,
            onAddAllToQueue: addAllToQueue,
            onAddSongToQueue: addSongToQueue,
            onStatusMessage,
            focusedPlaylistIndex,
            setFocusedPlaylistIndex,
            onOpenSettings: openSettings,
            onSearchCommitted: (query, sourceTab, replace = false) => {
                navigateToSearch({ query, sourceTab: resolveSearchSource(sourceTab), replace });
            },
            localSongs,
            localLibraryCatalog,
            localPlaylists,
            onRefreshLocalSongs,
            onAddLocalSongToQueue,
            localMusicState,
            setLocalMusicState,
            onAddNavidromeSongsToQueue,
            navidromeFocusedAlbumIndex,
            setNavidromeFocusedAlbumIndex,
            pendingNavidromeSelection,
            onPendingNavidromeSelectionHandled: () => setPendingNavidromeSelection(null),
            stageEnabled: Boolean(stageSource),
            stageIsActive: activePlaybackContext === 'stage',
            onOpenStagePlayer: () => {
                void openStagePlayer();
            },
            theme,
            navidromeEnabled,
        },
    };
};
