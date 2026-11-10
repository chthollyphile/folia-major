import type { NavidromeConfig, SubsonicAlbum, SubsonicArtist, SubsonicPlaylist, SubsonicSong } from '../../../../types/navidrome';
import type { LibraryNavidromeHomeResource, LibraryNavidromeHomeSnapshot } from '../homeModel.contract';
import { EMPTY_NAVIDROME_HOME_DATA } from './navidromeHomeModel';

// src/library/core/home/navidrome/navidromeHomeLibrary.service.ts
// Navidrome 首页概览的读取（原 suites/grid/home/useNavidromeGridLibrary 的请求部分）：字母序专辑按页读完
// （每页 500，最多 20 页），最近添加 / 最近播放各取 500（保持服务器顺序），再并行取歌单、歌手、100 首随机歌、
// 收藏的歌。每次 load 先重读服务器配置（设置里改了配置，下次进 Navidrome 页签就生效），领一个 generation，
// 旧的读取晚到时丢掉。上游经注入的 deps（默认装配在 navidromeHomeLibraryDeps）。
// 资源由首页宿主持有（library/app/useLibraryHomeResources），显示 Navidrome 页签的 surface 挂载时 ensure：
// 换 suite 时新 surface 的 ensure 不会再读；宿主在离开 Navidrome 页签或首页时 invalidate，下次进来重读
// （与原先「每次进页签都重新请求」一致）。

export const NAVIDROME_ALBUM_PAGE_SIZE = 500;
export const NAVIDROME_MAX_ALBUM_PAGES = 20;
export const NAVIDROME_RECENT_ALBUM_LIMIT = 500;
export const NAVIDROME_RANDOM_SONG_COUNT = 100;

export type NavidromeHomeLibraryDeps = {
    getConfig(): NavidromeConfig | null;
    getAlbumList2(config: NavidromeConfig, type: 'alphabeticalByName' | 'newest' | 'recent', size: number, offset?: number): Promise<SubsonicAlbum[]>;
    getPlaylists(config: NavidromeConfig): Promise<SubsonicPlaylist[]>;
    getArtists(config: NavidromeConfig): Promise<SubsonicArtist[]>;
    getRandomSongs(config: NavidromeConfig, size: number): Promise<SubsonicSong[]>;
    getStarred2(config: NavidromeConfig): Promise<SubsonicSong[]>;
};

/** 读完全部字母序专辑：某一页不满一页就停；读取作废时不再请求后面的页。 */
export const loadAllNavidromeAlbums = async (
    deps: Pick<NavidromeHomeLibraryDeps, 'getAlbumList2'>,
    config: NavidromeConfig,
    isCurrent: () => boolean = () => true,
): Promise<SubsonicAlbum[]> => {
    const albums: SubsonicAlbum[] = [];
    for (let page = 0; page < NAVIDROME_MAX_ALBUM_PAGES && isCurrent(); page += 1) {
        const pageAlbums = await deps.getAlbumList2(config, 'alphabeticalByName', NAVIDROME_ALBUM_PAGE_SIZE, page * NAVIDROME_ALBUM_PAGE_SIZE);
        albums.push(...pageAlbums);
        if (pageAlbums.length < NAVIDROME_ALBUM_PAGE_SIZE) break;
    }
    return albums;
};

export const createNavidromeHomeLibrary = (deps: NavidromeHomeLibraryDeps): LibraryNavidromeHomeResource => {
    let snapshot: LibraryNavidromeHomeSnapshot = { config: deps.getConfig(), isLoading: false, data: EMPTY_NAVIDROME_HOME_DATA };
    let generation = 0;
    /** 作废之后发起过读取（正在读或已经读完）：ensure 不再读。 */
    let requested = false;
    let inFlight: Promise<void> = Promise.resolve();
    const listeners = new Set<() => void>();

    const commit = (next: LibraryNavidromeHomeSnapshot) => {
        snapshot = next;
        listeners.forEach(listener => listener());
    };

    const resource: LibraryNavidromeHomeResource = {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        load: () => {
            requested = true;
            inFlight = load();
            return inFlight;
        },
        ensure: () => (requested ? inFlight : resource.load()),
        invalidate: () => {
            requested = false;
        },
    };

    /** 读一次概览：先重读配置，领一个 generation，作废的读取不再写入。 */
    async function load(): Promise<void> {
        const ticket = ++generation;
        const isCurrent = () => ticket === generation;
        const config = deps.getConfig();
        if (!config) {
            commit({ config: null, isLoading: false, data: EMPTY_NAVIDROME_HOME_DATA });
            return;
        }
        commit({ ...snapshot, config, isLoading: true });
        try {
            const albums = await loadAllNavidromeAlbums(deps, config, isCurrent);
            if (!isCurrent()) return;
            const [
                recentlyAddedAlbums,
                recentlyPlayedAlbums,
                playlists,
                artists,
                randomSongs,
                favoriteSongs,
            ] = await Promise.all([
                deps.getAlbumList2(config, 'newest', NAVIDROME_RECENT_ALBUM_LIMIT),
                deps.getAlbumList2(config, 'recent', NAVIDROME_RECENT_ALBUM_LIMIT),
                deps.getPlaylists(config),
                deps.getArtists(config),
                deps.getRandomSongs(config, NAVIDROME_RANDOM_SONG_COUNT),
                deps.getStarred2(config),
            ]);
            if (!isCurrent()) return;
            commit({
                config,
                isLoading: false,
                data: { albums, recentlyAddedAlbums, recentlyPlayedAlbums, playlists, artists, randomSongs, favoriteSongs },
            });
        } catch (error) {
            if (!isCurrent()) return;
            console.error('[LibraryHome] Failed to load the Navidrome overview:', error);
            commit({ ...snapshot, isLoading: false });
        }
    }

    return resource;
};
