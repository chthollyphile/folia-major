import type React from 'react';
import type { LocalLibraryCatalogSnapshot } from '../../../hooks/useLocalLibraryCatalog';
import type {
    HomeViewTab,
    LocalLibraryGroup,
    LocalPlaylist,
    LocalSong,
    SongResult,
    StageSource,
    StageStatus,
    StatusMessage,
    Theme,
} from '../../../types';
import type { MediaId, ProviderCollection, ProviderUser } from '../../../types/onlineMusic';
import type { NavidromeSong, NavidromeViewSelection } from '../../../types/navidrome';

// src/components/app/home/homeSurfaceTypes.ts

export type HomeLocalMusicState = {
    activeRow: 0 | 1 | 2 | 3;
    selectedGroup: LocalLibraryGroup | null;
    detailStack: LocalLibraryGroup[];
    detailOriginView: 'home' | 'player' | null;
    focusedFolderIndex: number;
    focusedAlbumIndex: number;
    focusedArtistIndex: number;
    focusedPlaylistIndex: number;
};

export interface HomeSurfaceProps {
    onPlaySong: (song: SongResult, playlistCtx?: SongResult[], isFmCall?: boolean) => void;
    onBackToPlayer: () => void;
    onRefreshUser: () => void;
    user: ProviderUser | null;
    playlists: ProviderCollection[];
    cloudPlaylist?: ProviderCollection | null;
    currentTrack?: SongResult | null;
    isPlaying: boolean;
    onSelectPlaylist: (playlist: ProviderCollection) => void;
    onSelectAlbum: (albumId: MediaId) => void;
    onSelectArtist: (artistId: MediaId) => void;
    onSelectLocalAlbum?: (albumName: string) => void;
    onSelectLocalArtist?: (artistName: string) => void;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryCatalogSnapshot;
    localPlaylists: LocalPlaylist[];
    onRefreshLocalSongs: () => void;
    onPlayLocalSong: (song: LocalSong, queue?: LocalSong[]) => void;
    onAddLocalSongToQueue?: (song: LocalSong) => void;
    focusedPlaylistIndex?: number;
    setFocusedPlaylistIndex?: (index: number) => void;
    focusedFavoriteAlbumIndex?: number;
    setFocusedFavoriteAlbumIndex?: (index: number) => void;
    focusedRadioIndex?: number;
    setFocusedRadioIndex?: (index: number) => void;
    localMusicState: HomeLocalMusicState;
    setLocalMusicState: React.Dispatch<React.SetStateAction<HomeLocalMusicState>>;
    onMatchSong?: (song: LocalSong) => void;
    onPlayNavidromeSong?: (song: NavidromeSong, queue?: NavidromeSong[]) => void;
    onAddNavidromeSongsToQueue?: (songs: NavidromeSong[]) => void;
    onMatchNavidromeSong?: (song: NavidromeSong) => void;
    navidromeFocusedAlbumIndex?: number;
    setNavidromeFocusedAlbumIndex?: (index: number) => void;
    pendingNavidromeSelection?: NavidromeViewSelection | null;
    onPendingNavidromeSelectionHandled?: () => void;
    onSearchCommitted: (query: string, sourceTab: HomeViewTab, replace?: boolean) => void;
    stageEnabled?: boolean;
    stageSource?: StageSource | null;
    stageIsActive?: boolean;
    onOpenStagePlayer?: () => void;
    stageStatus?: StageStatus | null;
    onToggleStageMode?: (enabled: boolean) => Promise<void> | void;
    onStageSourceChange?: (source: StageSource) => Promise<void> | void;
    onRegenerateStageToken?: () => Promise<void> | void;
    onClearStageState?: () => Promise<void> | void;
    theme: Theme;
    onOpenSettings?: (initialTab?: 'help' | 'options') => void;
    navidromeEnabled?: boolean;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[]) => void;
    onAddSongToQueue?: (song: SongResult) => void;
    onStatusMessage?: (message: StatusMessage) => void;
}
