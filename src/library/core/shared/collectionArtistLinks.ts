import type { LibraryCollectionDescriptor } from '../collection/collection.contract';
import type { ProviderArtistSummary } from '../../../types/onlineMusic';

// src/library/core/shared/collectionArtistLinks.ts
// 集合上列的歌手（专辑页头的专辑歌手，#1058）能不能点开歌手页、打开时用哪个 id：网格的信息面板和 Bravais 的专辑海报认同一条规则。
// 本地和 Navidrome 的歌手 id 就是能打开的 id（本地是歌手实体 id）；在线的要问平台（services/onlineMusic/catalogRefs 的
// resolveCollectionArtistCatalogId，属于 service，由调用方注入）：各平台拿不到真实 id 时会填占位 id，原样打开是空页。

/** 在线集合上的一位歌手打开时用的 id；打不开时为 undefined。 */
export type CollectionArtistResolver = (
    providerId: string,
    artist: Pick<ProviderArtistSummary, 'id' | 'catalogRef'>,
) => number | string | undefined;

/** 集合上的一位歌手：targetId 有值时可以打开（交给宿主的 onOpenArtist，不带曲目，按集合的来源打开）。 */
export type CollectionArtistLink = { artist: ProviderArtistSummary; targetId: number | string | undefined };

/** 集合（描述，可以已经盖上详情）上每位有名字的歌手能不能打开。 */
export const resolveCollectionArtistLinks = (
    collection: Pick<LibraryCollectionDescriptor, 'source' | 'artists'> & { providerId?: string },
    resolveOnline: CollectionArtistResolver,
): CollectionArtistLink[] => (
    (collection.artists ?? []).filter(artist => artist?.name).map(artist => {
        if (collection.source === 'online') {
            return { artist, targetId: collection.providerId ? resolveOnline(collection.providerId, artist) : undefined };
        }
        const targetId = artist.entityId || artist.id;
        return { artist, targetId: targetId === undefined || targetId === '' ? undefined : targetId };
    })
);
