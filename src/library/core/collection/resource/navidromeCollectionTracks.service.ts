import type { SongResult } from '../../../../types';
import type { NavidromeConfig, SubsonicAlbum, SubsonicSong } from '../../../../types/navidrome';
import type { NavidromeGridViewCollectionDescriptor } from '../collection.contract';
import type { CollectionDetail } from '../../shared/resource.contract';
import { getNavidromeConfig, navidromeApi } from '../../../../services/navidromeService';
import { buildNavidromeQueue } from '../../../../services/playbackAdapters';

// src/library/core/collection/resource/navidromeCollectionTracks.service.ts
// Navidrome 集合的曲目：按集合类型调用对应的 Subsonic 接口，再统一转成播放用的歌曲。
// 原在 components/app/home/gridViewCollectionAdapters.ts，资源层在 services 里，不能反向依赖组件目录。

/** 当前 Navidrome 服务器的作用域：换服务器或换账号时，同 id 的集合不是同一份数据。 */
export const resolveNavidromeServerScope = (): string => {
    const config = getNavidromeConfig();
    return config ? `${config.serverUrl}|${config.username}` : '';
};

/** 专辑歌手（带 id，页头的歌手名可以点开歌手页）：OpenSubsonic 的 artists 优先，老服务器用 artistId + artist。 */
const navidromeAlbumArtists = (album: SubsonicAlbum): Pick<CollectionDetail, 'artists'> => {
    const artists = (album.artists ?? []).filter(artist => artist?.id && artist.name);
    if (artists.length) return { artists: artists.map(artist => ({ id: artist.id, name: artist.name })) };
    return album.artistId && album.artist ? { artists: [{ id: album.artistId, name: album.artist }] } : {};
};

/**
 * getAlbum 读回来的专辑信息，写法与首页专辑卡（navidromeHomeModel 的 buildNavidromeAlbumCards）一致：
 * 从歌曲、播放器、搜索跳到专辑时，集合描述里只有 id、名字和歌曲封面，页头的歌手、年份、流派、时长靠它补全。
 */
export const toNavidromeAlbumDetail = (config: NavidromeConfig, album: SubsonicAlbum): CollectionDetail => ({
    id: album.id,
    name: album.name,
    type: 'album',
    ...(album.coverArt ? { coverUrl: navidromeApi.getCoverArtUrl(config, album.coverArt, 600) } : {}),
    description: album.artist,
    trackCount: album.songCount,
    albumArtist: album.artist,
    ...navidromeAlbumArtists(album),
    albumYear: album.year,
    albumGenre: album.genre,
    albumDuration: album.duration,
    publishedAt: album.year ? new Date(album.year, 0, 1).getTime() : undefined,
});

// Loads Navidrome tracks for GridView without moving Navidrome service logic into GridView itself.
// `failed` says that a read brought nothing back (the service answers nothing for such a read,
// it does not throw), or that no server is set up to read from: the tracks are then not the
// whole collection. An artist's tracks may still be those of the albums that were read.
// `detail` is the album's own information, for an album that was read.
export const resolveNavidromeGridViewTracks = async (
    descriptor: NavidromeGridViewCollectionDescriptor
): Promise<{ tracks: SongResult[]; failed: boolean; detail?: CollectionDetail }> => {
    const config = getNavidromeConfig();
    if (!config) {
        return { tracks: [], failed: true };
    }

    let subsonicSongs: SubsonicSong[] = [];
    let failed = false;
    let detail: CollectionDetail | undefined;

    if (descriptor.type === 'album') {
        const albumDetail = await navidromeApi.getAlbum(config, descriptor.id);
        failed = !albumDetail;
        subsonicSongs = albumDetail?.song || [];
        detail = albumDetail ? toNavidromeAlbumDetail(config, albumDetail) : undefined;
    } else if (descriptor.type === 'playlist') {
        const playlistDetail = await navidromeApi.getPlaylist(config, descriptor.id);
        failed = !playlistDetail;
        subsonicSongs = playlistDetail?.entry || [];
    } else if (descriptor.type === 'artist') {
        const artistDetail = await navidromeApi.getArtist(config, descriptor.id);
        const albums = artistDetail?.album || [];
        const albumResults = await Promise.all(albums.map(album => navidromeApi.getAlbum(config, album.id)));
        failed = !artistDetail || albumResults.some(album => !album);
        subsonicSongs = albumResults.flatMap(album => album?.song || []);
    } else if (descriptor.type === 'random') {
        const songs = await navidromeApi.getRandomSongs(config, 100);
        failed = !songs;
        subsonicSongs = songs ?? [];
    } else if (descriptor.type === 'favorites') {
        const songs = await navidromeApi.getStarred2(config);
        failed = !songs;
        subsonicSongs = songs ?? [];
    }

    const navidromeSongs = subsonicSongs.map(song => navidromeApi.toNavidromeSong(config, song));
    return { tracks: buildNavidromeQueue(navidromeSongs), failed, ...(detail ? { detail } : {}) };
};
