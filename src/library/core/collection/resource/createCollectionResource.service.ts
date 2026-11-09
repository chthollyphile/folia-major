import type { MediaId } from '../../../../types/onlineMusic';
import type { LibraryCollectionDescriptor } from '../collection.contract';
import type { CollectionResource } from '../../shared/resource.contract';
import { collectionKey, isCloudDriveCollection } from '../collectionIdentity';
import { omni } from '../../../../services/onlineMusic/omni';
import { readOnlineTracksCache, resolveOnlineTracksTargetTime, writeOnlineTracksCache } from './onlineCollectionCache.service';
import { createOnlineCollectionResource, type OnlineCollectionResourceDeps } from './onlineCollectionResource.service';
import { createNavidromeCollectionResource } from './navidromeCollectionResource.service';
import { resolveNavidromeServerScope } from './navidromeCollectionTracks.service';
import { createStaticCollectionResource } from './staticCollectionResource.service';
import { loadPreferredDailySongs } from '../dailyRecommendationLoad.service';

// src/library/core/collection/resource/createCollectionResource.service.ts
// 资源的默认装配：在线走 omni 与在线缓存，Navidrome 走 Subsonic。单测直接构造各资源并注入依赖，
// 不经过这里，所以不需要 mock 整个 omni。

const onlineDeps: OnlineCollectionResourceDeps = {
    getCollectionTracks: (collection, page) => omni.getCollectionTracks(collection, page),
    getCollectionDetail: collection => omni.getCollectionDetail(collection),
    getPersonalFm: () => omni.getPersonalFm(),
    // 上次看的是风格推荐时直接取风格推荐（dailyRecommendationLoad.service）。
    getDailySongs: loadPreferredDailySongs,
    readCache: readOnlineTracksCache,
    writeCache: writeOnlineTracksCache,
    beginLikedListRead: collection => omni.beginLikedListRead(collection),
    endLikedListRead: (read, songs, whole) => omni.endLikedListRead(read, songs, whole),
};

/**
 * 资源的身份：集合身份之外，再区分数据的作用域。云盘属于某个账号；Navidrome 的同一个 id
 * 换了服务器或账号就不是同一份数据。有版本的普通在线集合不加账号：用户信息晚到时不该让资源重建一次。
 * 无版本的在线集合也按账号隔离：它们的短时内存复用不能把上一账号的内容交给下一账号。
 */
export const resolveCollectionResourceKey = (
    descriptor: LibraryCollectionDescriptor,
    currentUserId?: MediaId | null,
): string => {
    const base = collectionKey(descriptor);
    if (descriptor.source === 'online'
        && (isCloudDriveCollection(descriptor) || resolveOnlineTracksTargetTime(descriptor) <= 0)) {
        return `${base}|u:${currentUserId ?? 'anonymous'}`;
    }
    if (descriptor.source === 'navidrome') {
        return `${base}|srv:${resolveNavidromeServerScope()}`;
    }
    return base;
};

/** 按来源创建资源；本地集合的曲目由调用方算好，用 createStaticCollectionResource。 */
export const createCollectionResource = (key: string, descriptor: LibraryCollectionDescriptor): CollectionResource => {
    if (descriptor.source === 'online') return createOnlineCollectionResource(key, onlineDeps);
    if (descriptor.source === 'navidrome') return createNavidromeCollectionResource(key);
    return createStaticCollectionResource(key, []);
};
