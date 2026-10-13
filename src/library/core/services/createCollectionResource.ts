import type { MediaId } from '../../../types/onlineMusic';
import type { LibraryCollectionDescriptor } from '../contracts/collection';
import type { CollectionResource } from '../contracts/resource';
import { collectionKey, isCloudDriveCollection } from '../model/collectionIdentity';
import { omni } from '../../../services/onlineMusic/omni';
import { useRecentPlaysStore } from '../../../stores/useRecentPlaysStore';
import { readOnlineTracksCache, writeOnlineTracksCache } from './onlineCollectionCache';
import { createOnlineCollectionResource, type OnlineCollectionResourceDeps } from './onlineCollectionResource';
import { createNavidromeCollectionResource } from './navidromeCollectionResource';
import { resolveNavidromeServerScope } from './navidromeCollectionTracks';
import { createStaticCollectionResource } from './staticCollectionResource';

// src/library/core/services/createCollectionResource.ts
// 资源的默认装配：在线走 omni 与在线缓存，Navidrome 走 Subsonic。单测直接构造各资源并注入依赖，
// 不经过这里，所以不需要 mock 整个 omni。

const onlineDeps: OnlineCollectionResourceDeps = {
    getCollectionTracks: (collection, page) => omni.getCollectionTracks(collection, page),
    getCollectionDetail: collection => omni.getCollectionDetail(collection),
    getPersonalFm: () => omni.getPersonalFm(),
    getDailySongs: () => omni.getDailySongs(),
    getRecentPlays: () => useRecentPlaysStore.getState().entries.map(entry => entry.song),
    readCache: readOnlineTracksCache,
    writeCache: writeOnlineTracksCache,
};

/**
 * 资源的身份：集合身份之外，再区分数据的作用域。云盘属于某个账号；Navidrome 的同一个 id
 * 换了服务器或账号就不是同一份数据。普通在线集合不加账号：用户信息晚到时不该让资源重建一次。
 */
export const resolveCollectionResourceKey = (
    descriptor: LibraryCollectionDescriptor,
    currentUserId?: MediaId | null,
): string => {
    const base = collectionKey(descriptor);
    if (descriptor.source === 'online' && isCloudDriveCollection(descriptor)) {
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
