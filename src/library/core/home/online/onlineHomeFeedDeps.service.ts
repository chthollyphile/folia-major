import { omni } from '../../../../services/onlineMusic/omni';
import { getSongCoverUrl } from '../../../../services/onlineMusic/songMetadata';
import type { OnlineHomeFeedDeps } from './onlineHomeFeeds.service';

// src/library/core/home/online/onlineHomeFeedDeps.service.ts
// 在线首页资源的默认装配：上游都经 omni（按当前 provider 调用，provider 切换后它自己也会拒绝旧应答），
// 封面按 provider 解析。单测直接给 createFavoriteAlbumsFeed / createRadioFeed 注入假 deps，不经过这里。

export const onlineHomeFeedDeps: OnlineHomeFeedDeps = {
    getUserAlbums: (userId, page) => omni.getUserAlbums(userId, page),
    getHomeFeed: limit => omni.getHomeFeed(limit),
    songCoverUrl: (song, providerId) => getSongCoverUrl(song, providerId),
    supportsDailySongs: providerId => omni.supportsDailySongs(providerId),
};
