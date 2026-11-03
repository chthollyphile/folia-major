import type {
    LibraryCollectionDescriptor,
    LibraryCollectionIdentity,
    OnlineGridViewCollectionDescriptor,
} from './collection.contract';

// src/library/core/collection/collectionIdentity.ts
// 集合身份的唯一真源。在线集合的身份必须带 provider：两个 provider 下的歌单 id 完全可能相同，
// 只用「来源 + 类型 + id」时它们共用同一个 React key、同一条去重判断和同一份恢复记录，
// 后打开的那个会直接显示前一个的曲目。

/**
 * 一个集合的稳定身份：来源 + 类型 + id，在线集合再加上 provider
 * （本地/Navidrome 为 `source:type:id`，在线为 `online:providerId:type:id`）。
 *
 * 两个用途共用它：作 GridView / ArtistGridView 的 React key，以及判断「这次 push 的目标
 * 是不是已经在看的那一层」。后者是必须的 —— 专辑详情里的曲目卡片带着自己的专辑入口，
 * 点它等于再压一层同一张专辑，返回要按很多次才能退出去；歌手页的曲目卡片带着同一张歌手
 * 的入口，同理。两处各写一份 key 迟早会分叉，所以放在这里。
 */
export const collectionKey = (collection: LibraryCollectionIdentity | null | undefined): string => {
    if (!collection) return '';
    if (collection.source === 'online') {
        return `online:${collection.providerId}:${collection.type}:${String(collection.id)}`;
    }
    return `${collection.source}:${collection.type}:${String(collection.id)}`;
};

/** 写进浏览器地址栏的集合路径；只用于展示与分享，恢复走 history.state。 */
export const collectionHashPath = (collection: LibraryCollectionIdentity): string => {
    const id = encodeURIComponent(String(collection.id));
    if (collection.source === 'online') {
        return `#collection/online/${encodeURIComponent(collection.providerId)}/${collection.type}/${id}`;
    }
    return `#collection/${collection.source}/${collection.type}/${id}`;
};

/**
 * 集合内容的版本标记：曲目更新时间、集合更新时间或曲目数任一变化，已加载的曲目就需要重新校验。
 * 与 GridView 触发重新加载的依赖是同一组字段。
 */
export const collectionRevision = (
    collection: Pick<LibraryCollectionDescriptor, 'tracksUpdatedAt' | 'updatedAt' | 'trackCount'> | null | undefined,
): string => (
    collection
        ? `${collection.tracksUpdatedAt ?? ''}|${collection.updatedAt ?? ''}|${collection.trackCount ?? ''}`
        : ''
);

/** 是不是云盘集合（类型为 cloud，或 id 为 -100）；缓存键、变更能力与网格都按它区分云盘。 */
export const isCloudDriveCollection = (collection: Pick<OnlineGridViewCollectionDescriptor, 'type' | 'id'>): boolean => (
    collection.type === 'cloud' || Number(collection.id) === -100
);
