import type { TFunction } from 'i18next';
import type { SubsonicAlbum, SubsonicArtist } from '../../../../types/navidrome';
import type { NavidromeGridViewCollectionType } from '../../collection/collection.contract';
import type { LibraryHomeCard, LibraryHomeListAction, LibraryNavidromeHomeData } from '../homeModel.contract';
import { createCoverPlaceholder, pickRandomSongCoverUrl } from '../../../../utils/coverPlaceholders';

// src/library/core/home/navidrome/navidromeHomeModel.ts
// Navidrome 页签的模型（原样搬自 NavidromeGrid3DView）：五个 section、各 section 的卡片（含两个虚拟歌单
// 「随机」「收藏」，现在带 isVirtual）、打开卡片时的集合类型、刷新动作。封面 URL 要带服务器鉴权参数，由调用方
// 注入（navidromeApi.getCoverArtUrl 绑好配置）；虚拟歌单的封面从歌曲里随机挑一张（与原先一样每次组装都重挑）。

export type NavidromeHomeSection = 'albums' | 'recently-added' | 'recently-played' | 'playlists' | 'artists';

export const NAVIDROME_RANDOM_PLAYLIST_ID = '__navi_random__';
export const NAVIDROME_FAVORITES_PLAYLIST_ID = '__navi_favorites__';

/** section 的顺序与文案 key。 */
export const NAVIDROME_HOME_SECTIONS: readonly { key: NavidromeHomeSection; labelKey: string }[] = [
    { key: 'albums', labelKey: 'navidrome.albums' },
    { key: 'recently-added', labelKey: 'navidrome.recentlyAdded' },
    { key: 'recently-played', labelKey: 'navidrome.recents' },
    { key: 'playlists', labelKey: 'home.playlists' },
    { key: 'artists', labelKey: 'navidrome.artists' },
];

export const DEFAULT_NAVIDROME_HOME_SECTION: NavidromeHomeSection = 'albums';

export const isNavidromeHomeSection = (value: unknown): value is NavidromeHomeSection => (
    NAVIDROME_HOME_SECTIONS.some(section => section.key === value)
);

export const navidromeSectionLabelKey = (section: NavidromeHomeSection): string => (
    NAVIDROME_HOME_SECTIONS.find(entry => entry.key === section)?.labelKey ?? 'navidrome.albums'
);

/** 列表为空时的文案 key。 */
export const navidromeSectionEmptyKey = (section: NavidromeHomeSection): string => (
    section === 'playlists'
        ? 'navidrome.noPlaylistsFound'
        : section === 'artists'
            ? 'navidrome.noArtistsFound'
            : 'navidrome.noAlbumsFound'
);

/** Navidrome 封面 id → URL（navidromeApi.getCoverArtUrl 绑好当前配置）。 */
export type NavidromeCoverArtUrl = (coverArtId: string, size?: number) => string;

/** 专辑卡（全部专辑、最近添加、最近播放共用）。专辑卡没有 type（不可隐藏）。 */
export const buildNavidromeAlbumCards = (albums: readonly SubsonicAlbum[], coverArtUrl: NavidromeCoverArtUrl): LibraryHomeCard[] => (
    albums.map(album => ({
        id: album.id,
        name: album.name,
        coverUrl: album.coverArt ? coverArtUrl(album.coverArt, 600) : createCoverPlaceholder(album.name, 'playlist'),
        description: album.artist,
        trackCount: album.songCount,
        albumArtist: album.artist,
        albumYear: album.year,
        albumGenre: album.genre,
        albumDuration: album.duration,
    }))
);

/** 歌单卡：虚拟的「随机」「收藏」在前（isVirtual），然后是服务器上的歌单（可编辑）。 */
export const buildNavidromePlaylistCards = (
    data: Pick<LibraryNavidromeHomeData, 'randomSongs' | 'favoriteSongs' | 'playlists'>,
    { t, coverArtUrl }: { t: TFunction; coverArtUrl: NavidromeCoverArtUrl },
): LibraryHomeCard[] => {
    const randomCover = pickRandomSongCoverUrl(data.randomSongs, coverArtUrl);
    const favoritesCover = pickRandomSongCoverUrl(data.favoriteSongs, coverArtUrl);
    return [
        {
            id: NAVIDROME_RANDOM_PLAYLIST_ID,
            name: t('navidrome.random') || 'Random',
            coverUrl: randomCover || createCoverPlaceholder(t('navidrome.random') || 'Random', 'playlist'),
            description: t('navidrome.randomDesc'),
            trackCount: data.randomSongs.length,
            type: 'playlist',
            isVirtual: true,
        },
        {
            id: NAVIDROME_FAVORITES_PLAYLIST_ID,
            name: t('navidrome.favorites') || 'Favorites',
            coverUrl: favoritesCover || createCoverPlaceholder(t('navidrome.favorites') || 'Favorites', 'playlist'),
            description: t('navidrome.favorites'),
            trackCount: data.favoriteSongs.length,
            type: 'playlist',
            isVirtual: true,
        },
        ...data.playlists.map(playlist => ({
            id: playlist.id,
            name: playlist.name,
            coverUrl: playlist.coverArt ? coverArtUrl(playlist.coverArt, 600) : createCoverPlaceholder(playlist.name, 'playlist'),
            description: playlist.owner || t('home.playlists'),
            trackCount: playlist.songCount,
            editable: true,
            type: 'playlist',
        })),
    ];
};

/** 歌手卡（没有 type，不可隐藏）。 */
export const buildNavidromeArtistCards = (
    artists: readonly SubsonicArtist[],
    { t, coverArtUrl }: { t: TFunction; coverArtUrl: NavidromeCoverArtUrl },
): LibraryHomeCard[] => artists.map(artist => ({
    id: artist.id,
    name: artist.name,
    coverUrl: artist.coverArt
        ? coverArtUrl(artist.coverArt, 600)
        : artist.artistImageUrl || createCoverPlaceholder(artist.name, 'artist'),
    description: t('navidrome.artists'),
    trackCount: artist.albumCount,
}));

/** 某个 section 的卡片。 */
export const buildNavidromeSectionCards = (
    section: NavidromeHomeSection,
    data: LibraryNavidromeHomeData,
    deps: { t: TFunction; coverArtUrl: NavidromeCoverArtUrl },
): LibraryHomeCard[] => {
    switch (section) {
        case 'albums': return buildNavidromeAlbumCards(data.albums, deps.coverArtUrl);
        case 'recently-added': return buildNavidromeAlbumCards(data.recentlyAddedAlbums, deps.coverArtUrl);
        case 'recently-played': return buildNavidromeAlbumCards(data.recentlyPlayedAlbums, deps.coverArtUrl);
        case 'playlists': return buildNavidromePlaylistCards(data, deps);
        case 'artists': return buildNavidromeArtistCards(data.artists, deps);
    }
    return [];
};

/** 打开卡片时的集合类型：三个专辑 section 是 album，歌手是 artist，歌单里两个虚拟歌单各有类型。 */
export const resolveNavidromeCollectionType = (
    section: NavidromeHomeSection,
    cardId: string | number,
): NavidromeGridViewCollectionType => {
    if (section === 'albums' || section === 'recently-added' || section === 'recently-played') return 'album';
    if (section === 'artists') return 'artist';
    if (cardId === NAVIDROME_RANDOM_PLAYLIST_ID) return 'random';
    if (cardId === NAVIDROME_FAVORITES_PLAYLIST_ID) return 'favorites';
    return 'playlist';
};

/** Navidrome 页签右上角的刷新（读取中禁用）。 */
export const resolveNavidromeHomeActions = (isLoading: boolean): LibraryHomeListAction[] => [{
    id: 'refresh',
    labelKey: 'options.audioOutputRefresh',
    fallbackLabel: 'Refresh',
    pending: isLoading,
    disabled: isLoading,
}];

export const EMPTY_NAVIDROME_HOME_DATA: LibraryNavidromeHomeData = Object.freeze({
    albums: [],
    recentlyAddedAlbums: [],
    recentlyPlayedAlbums: [],
    playlists: [],
    artists: [],
    randomSongs: [],
    favoriteSongs: [],
}) as LibraryNavidromeHomeData;
