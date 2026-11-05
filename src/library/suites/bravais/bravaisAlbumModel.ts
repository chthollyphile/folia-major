import type { LibraryCollectionDescriptor } from '../../core/collection/collection.contract';
import type { CollectionDetail } from '../../core/shared/resource.contract';
import type { BravaisSeamAlbum, BravaisSeamAlbumArtist } from './bravaisSeamModels';
import { formatAlbumDuration } from '../../core/collection/albumDuration';
import { resolveCollectionArtistLinks, type CollectionArtistResolver } from '../../core/shared/collectionArtistLinks';

// src/library/suites/bravais/bravaisAlbumModel.ts
// 专辑页海报的信息（纯投影）：详情盖在集合描述上（与网格信息面板同一条规则），只有专辑类型的集合有。
// 专辑歌手能打开的可以点开歌手页（与网格信息面板同一条规则：core/shared/collectionArtistLinks，在线的问平台）；只有一串名字
// （albumArtist）时不能点。
// 总时长的写法与网格信息面板相同（core/collection/albumDuration，单位秒）；年份没有时从发行时间里取。

export { formatAlbumDuration };

const resolveYear = (info: Partial<CollectionDetail> & { albumPublishTime?: number }) => {
    if (info.albumYear && Number.isFinite(info.albumYear)) return String(info.albumYear);
    const time = info.publishedAt ?? info.albumPublishTime;
    if (!time || !Number.isFinite(time)) return '';
    const year = new Date(time).getFullYear();
    return Number.isFinite(year) ? String(year) : '';
};

export const projectBravaisSeamAlbum = ({
    collection,
    detail,
    trackCount,
    labels,
    resolveOnlineArtist,
}: {
    collection: LibraryCollectionDescriptor;
    detail: CollectionDetail | null | undefined;
    /** 已知的曲目数（详情的、描述的或已经载入的）。 */
    trackCount: number;
    labels: { kind: string; trackCount: (count: number) => string };
    /** 在线专辑的歌手打开时用哪个 id（services/onlineMusic/catalogRefs 的 resolveCollectionArtistCatalogId）。 */
    resolveOnlineArtist: CollectionArtistResolver;
}): BravaisSeamAlbum | undefined => {
    if (collection.type !== 'album') return undefined;
    const info = { ...collection, ...(detail ?? {}) } as LibraryCollectionDescriptor;
    const year = resolveYear(info);
    const artists = resolveCollectionArtistLinks(info, resolveOnlineArtist).map(({ artist, targetId }): BravaisSeamAlbumArtist => ({
        name: artist.name,
        ...(targetId !== undefined ? { targetId } : {}),
        ...(artist.catalogRef ? { catalogRef: artist.catalogRef } : {}),
    }));
    return {
        coverUrl: info.coverUrl || undefined,
        artists: artists.length ? artists : (info.albumArtist ? [{ name: info.albumArtist }] : []),
        kicker: year ? `${labels.kind} · ${year}` : labels.kind,
        facts: [
            trackCount > 0 ? labels.trackCount(trackCount) : '',
            formatAlbumDuration(info.albumDuration),
            info.albumGenre ?? '',
        ].filter(Boolean),
    };
};
