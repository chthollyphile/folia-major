import type {
    HomeViewTab,
    LocalLibraryAssignment,
    LocalLibraryEntity,
    LocalLibraryGroup,
    LocalPlaylist,
    LocalSong,
    SongResult,
    StatusMessage,
    Theme,
} from '../../../types';
import type { ProviderCollection, ProviderUser } from '../../../types/onlineMusic';
import type { NavidromeSong } from '../../../types/navidrome';
import type { PlaybackNavigationOptions } from '../../../types/appPlayback';

// src/library/core/contracts/home.ts
// 首页 surface 的数据契约：应用的首页模型（buildHomeModel）交给任何一套 suite 的同一份输入——账户与在线歌单、
// 本地曲库、Navidrome、舞台入口、播放回调。原先定义在 components/app/home/homeSurfaceTypes.ts（那里保留同名别名）；
// 放进 core 之后 suite 的首页组件按契约接收，不再依赖应用外壳的类型。P3.3 提取首页模型时在这里继续收拢。
// 契约只引用 src/types，所以 hook 里的几个类型（本地曲库快照、在线 provider 平台）在这里按结构写一份；
// 两边一旦不一致，Home.tsx 把首页模型交给 surface 的那一行就会编译失败。

export type LibraryHomeLocalMusicState = {
    activeRow: 0 | 1 | 2 | 3;
    selectedGroup: LocalLibraryGroup | null;
    detailStack: LocalLibraryGroup[];
    detailOriginView: 'home' | 'player' | null;
    focusedFolderIndex: number;
    focusedAlbumIndex: number;
    focusedArtistIndex: number;
    focusedPlaylistIndex: number;
};

/** 与 React 的 `Dispatch<SetStateAction<T>>` 同形；契约不 import react。 */
export type LibraryStateSetter<T> = (next: T | ((previous: T) => T)) => void;

/** 本地曲库的实体与归属快照（与 hooks/useLocalLibraryCatalog 的 LocalLibraryCatalogSnapshot 同形）。 */
export type LibraryLocalCatalogSnapshot = {
    entities: LocalLibraryEntity[];
    assignments: LocalLibraryAssignment[];
    ready: boolean;
    reload: () => Promise<void>;
};

/** 首页模型给出的数据与回调（即原 HomeSurfaceProps）。集合宿主与端口也从这里取来源回调。 */
export interface LibraryHomeData {
    onPlaySong: (song: SongResult, playlistCtx?: SongResult[], isFmCall?: boolean, options?: PlaybackNavigationOptions) => void | Promise<void>;
    onBackToPlayer: () => void;
    /**
     * fb3：暂停 / 继续正在播放的那首（与播放条、空格同一个开关）。资料库里「正在播放的那张卡」上的播放键用它，
     * 而不是再「立即播放」一次。身份稳定。
     */
    onTogglePlayback?: () => void;
    /**
     * fb3：进入播放视图——按「播放后进入的视图」去 Lattice 或播放页，「留在原处」时去播放页（与播放胶囊同一条规则）。
     * bravais 正在播放的聚焦卡上的「进入」按钮用它。身份稳定。
     */
    onEnterPlaybackView?: () => void;
    onRefreshUser: () => void;
    user: ProviderUser | null;
    playlists: ProviderCollection[];
    cloudPlaylist?: ProviderCollection | null;
    currentTrack?: SongResult | null;
    localSongs: LocalSong[];
    localLibraryCatalog: LibraryLocalCatalogSnapshot;
    localPlaylists: LocalPlaylist[];
    onRefreshLocalSongs: () => Promise<void> | void;
    onAddLocalSongToQueue?: (song: LocalSong) => void;
    focusedPlaylistIndex?: number;
    setFocusedPlaylistIndex?: (index: number) => void;
    localMusicState: LibraryHomeLocalMusicState;
    setLocalMusicState: LibraryStateSetter<LibraryHomeLocalMusicState>;
    onAddNavidromeSongsToQueue?: (songs: NavidromeSong[]) => void;
    navidromeFocusedAlbumIndex?: number;
    setNavidromeFocusedAlbumIndex?: (index: number) => void;
    onSearchCommitted: (query: string, sourceTab: HomeViewTab, replace?: boolean) => void;
    stageEnabled?: boolean;
    stageIsActive?: boolean;
    onOpenStagePlayer?: () => void;
    theme: Theme;
    onOpenSettings?: (initialTab?: 'help' | 'options') => void;
    onOpenLattice?: () => void;
    navidromeEnabled?: boolean;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[], options?: { suppressToast?: boolean }) => number | void;
    onAddSongToQueue?: (song: SongResult) => void;
    onStatusMessage?: (message: StatusMessage) => void;
}
