import { getNavidromeConfig, navidromeApi } from '../../../../services/navidromeService';
import type { NavidromeHomeLibraryDeps } from './navidromeHomeLibrary.service';

// src/library/core/home/navidrome/navidromeHomeLibraryDeps.service.ts
// Navidrome 首页概览的默认装配：配置读 localStorage，请求经 navidromeApi。单测给 createNavidromeHomeLibrary
// 注入假 deps，不经过这里。

export const navidromeHomeLibraryDeps: NavidromeHomeLibraryDeps = {
    getConfig: () => getNavidromeConfig(),
    getAlbumList2: (config, type, size, offset) => navidromeApi.getAlbumList2(config, type, size, offset),
    getPlaylists: config => navidromeApi.getPlaylists(config),
    getArtists: config => navidromeApi.getArtists(config),
    // A read the server answered nothing to (null) is an empty list here: the home overview shows what it has.
    getRandomSongs: async (config, size) => (await navidromeApi.getRandomSongs(config, size)) ?? [],
    getStarred2: async config => (await navidromeApi.getStarred2(config)) ?? [],
};
