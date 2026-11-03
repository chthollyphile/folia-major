import type { LibraryArtistResource } from './artist.contract';
import type { LibraryCollectionDescriptor } from '../collection/collection.contract';
import { createResourceRegistry, type ResourceRegistry, type ResourceRegistryOptions } from '../shared/resourceRegistry.service';

// src/library/core/artist/artistResourceRegistry.service.ts
// 歌手资源的生命周期，与集合资源同一套纪律（resourceRegistry：StrictMode 宽限、孤儿回收、离开即暂停、有界 LRU）。
// 在线与 Navidrome 歌手进 LRU（最多 3 个）：从歌手页打开专辑再返回、或者很快重开同一个歌手，资源自己认可
// （详情已到、没有失败）就直接复用，不重新请求；被暂停的专辑分页在复用时续上。本地歌手是同步派生的，离开即销毁。

export type ArtistResourceRegistry = ResourceRegistry<LibraryArtistResource, LibraryCollectionDescriptor>;

export const createArtistResourceRegistry = (options: ResourceRegistryOptions = {}): ArtistResourceRegistry => (
    createResourceRegistry<LibraryArtistResource, LibraryCollectionDescriptor>({
        ...options,
        retainable: resource => resource.source !== 'local',
    })
);

/** 应用里共用的那一个。 */
export const artistResourceRegistry = createArtistResourceRegistry();
