import { omni } from '../../../services/onlineMusic/omni';
import { getNavidromeConfig, navidromeApi } from '../../../services/navidromeService';
import { getLocalCoverAssetUrl } from '../../../services/localCoverAssetUrl';
import { applyLocalSongCoverDisplay, buildLocalQueue } from '../../../services/playbackAdapters';
import type { ArtistResourceDeps } from './artistResource.service';

// src/library/core/artist/artistResourceDeps.service.ts
// 歌手资源的默认装配：在线经 omni，Navidrome 读 localStorage 的配置后经 navidromeApi，本地歌的封面与播放曲目
// 照原 ArtistGridView 的做法（512 的本地封面、优先在线元数据封面；buildLocalQueue 带 catalog 显示名）。
// 翻译由调用方给（宿主的绑定传 i18n 的 t，调用时读当前语言）。单测给 createArtistResource 注入假 deps，不经过这里。

export const createArtistResourceDeps = (t: ArtistResourceDeps['t']): ArtistResourceDeps => ({
    getArtistDetail: descriptor => omni.getArtistDetail(descriptor as Parameters<typeof omni.getArtistDetail>[0]),
    getArtistSongs: (descriptor, page) => omni.getArtistSongs(descriptor as Parameters<typeof omni.getArtistSongs>[0], page),
    getArtistAlbums: (descriptor, page) => omni.getArtistAlbums(descriptor as Parameters<typeof omni.getArtistAlbums>[0], page),
    connectNavidrome: () => {
        const config = getNavidromeConfig();
        if (!config) return null;
        return {
            getArtist: artistId => navidromeApi.getArtist(config, artistId),
            getAlbum: albumId => navidromeApi.getAlbum(config, albumId),
            coverArtUrl: coverArtId => navidromeApi.getCoverArtUrl(config, coverArtId, 600),
            toSong: song => navidromeApi.toNavidromeSong(config, song),
        };
    },
    local: {
        resolveCoverUrl: (song) => {
            const localCoverUrl = getLocalCoverAssetUrl(song.localCoverAssetId, 512);
            return (song.useOnlineCover ? (song.onlineMetadata?.coverUrl || localCoverUrl) : localCoverUrl) || undefined;
        },
        toTracks: (songs, catalog) => buildLocalQueue(songs, undefined, catalog),
        applyCover: (track, coverUrl) => applyLocalSongCoverDisplay(track, coverUrl),
    },
    t,
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
});
