import type { SongResult, StageSource } from '../../../types';
import type { GridViewCollectionDescriptor } from './gridViewCollectionAdapters';
import type { HomeSurfaceProps } from './homeSurfaceTypes';
import { resolveSearchSource, type SearchSource } from '../../../stores/useSearchNavigationStore';
import type { ProviderAccountSummary } from '../../../types/onlineMusic';
import type { LibraryAccountController } from '../../../library/core/account/account.contract';
import { openSettings } from '../../../stores/useSettingsModalStore';
import { noteQueueStarted } from '../playing-song-locator/playingSongLocator';

// src/components/app/home/buildHomeModel.ts

export type HomeViewModel = {
    surfaceProps: HomeSurfaceProps;
    /** 在线账户 controller（App 持有，见 library/app/useLibraryAccountController），首页外壳交给首页 surface。 */
    account: LibraryAccountController;
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    /** 跳到集合栈的第 depth 层（保留的层数，0 为整个关掉），浏览器历史同步退回；见 useAppNavigation 的 popCollectionTo。 */
    onPopCollectionTo: (depth: number) => void;
    onBackCollection: () => void;
};

// What this file can read for itself, so the caller never names it. See useHomeModel below.
type HomeModelAmbient = {
    currentSong: HomeSurfaceProps['currentTrack'];
    activePlaybackContext: 'main' | 'stage';
    navidromeEnabled: HomeSurfaceProps['navidromeEnabled'];
};

export type HomeModelDeps = {
    account: LibraryAccountController;
    /** controller 快照里的当前平台摘要（未变时身份稳定）；首页的账户与在线歌单优先取它。 */
    activeProvider?: ProviderAccountSummary;
    // App's playSong: its 4th argument is navigation options, not the surface's `from`, so it is wrapped below.
    playSong: (song: SongResult, queue?: SongResult[], isFmCall?: boolean) => void;
    navigateToPlayer: HomeSurfaceProps['onBackToPlayer'];
    navigateToLattice: NonNullable<HomeSurfaceProps['onOpenLattice']>;
    /** fb3：暂停 / 继续（应用的 togglePlay；useHomeModel 给它稳定身份）。 */
    togglePlayback: NonNullable<HomeSurfaceProps['onTogglePlayback']>;
    /** fb3：按「播放后进入的视图」进入播放视图（播放胶囊的同一个导航）。 */
    enterPlaybackView: NonNullable<HomeSurfaceProps['onEnterPlaybackView']>;
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
    stageSource?: StageSource | null;
    openStagePlayer: () => Promise<void>;
    theme: HomeSurfaceProps['theme'];
    playAll: (songs: SongResult[]) => void;
    addAllToQueue: (songs: SongResult[], options?: { suppressToast?: boolean }) => number | void;
    addSongToQueue: (song: SongResult) => void;
    onStatusMessage?: HomeSurfaceProps['onStatusMessage'];
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    onPopCollectionTo: (depth: number) => void;
    onBackCollection: () => void;
};

type BuildHomeModelParams = HomeModelAmbient & HomeModelDeps;

// Builds the full Home model from raw app dependencies so App.tsx no longer assembles nested props inline.
export const buildHomeModel = ({
    account,
    activeProvider,
    playSong,
    navigateToPlayer,
    navigateToLattice,
    togglePlayback,
    enterPlaybackView,
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
    onPopCollectionTo,
    onBackCollection,
}: BuildHomeModelParams): HomeViewModel => {
    // Whatever starts a queue from the home screen says where: on a collection's page (`from`),
    // or anywhere else (the explore tab, an artist's page, a card's own "play", the personal
    // radio). "Locate the playing song" goes by it (playing-song-locator/playingSongLocator.ts).
    return {
        account,
        onOpenCollection,
        onPushCollection,
        onPopCollectionTo,
        onBackCollection,
        surfaceProps: {
            onPlaySong: (song, queue, isFmCall, from) => {
                // (A song played with no queue of its own joins the queue there is.)
                if (queue?.length) noteQueueStarted(from ?? null, [song, ...queue]);
                playSong(song, queue, isFmCall);
            },
            onBackToPlayer: navigateToPlayer,
            onOpenLattice: navigateToLattice,
            onTogglePlayback: togglePlayback,
            onEnterPlaybackView: enterPlaybackView,
            onRefreshUser: () => refreshOnlineProviderPlaylists(),
            // An anonymous selected provider must not inherit a different platform's account.
            user: activeProvider ? activeProvider.user : user,
            playlists: activeProvider?.collections.filter(collection => collection.type !== 'cloud') ?? playlists,
            cloudPlaylist: activeProvider?.collections.find(collection => collection.type === 'cloud') ?? cloudPlaylist,
            currentTrack: currentSong,
            onPlayAll: (songs, from) => {
                noteQueueStarted(from ?? null, songs);
                playAll(songs);
            },
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
