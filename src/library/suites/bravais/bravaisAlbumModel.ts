import type { LibraryCollectionDescriptor } from '../../core/collection/collection.contract';
import type { ProviderCollection } from '../../../types/onlineMusic';
import type { BravaisSeamAlbum } from './bravaisSeamModels';

// src/library/suites/bravais/bravaisAlbumModel.ts
// 专辑页海报的信息（纯投影）：详情盖在集合描述上（与网格信息面板同一条规则），只有专辑类型的集合有。
// 总时长的写法与网格信息面板相同（超过 10000 当毫秒）；年份没有时从发行时间里取。

export const formatAlbumDuration = (duration?: number) => {
    if (!duration || !Number.isFinite(duration)) return '';
    const totalSeconds = duration > 10000 ? Math.round(duration / 1000) : Math.round(duration);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const resolveYear = (info: Partial<ProviderCollection> & { albumYear?: number; publishedAt?: number; albumPublishTime?: number }) => {
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
}: {
    collection: LibraryCollectionDescriptor;
    detail: ProviderCollection | null | undefined;
    /** 已知的曲目数（详情的、描述的或已经载入的）。 */
    trackCount: number;
    labels: { kind: string; trackCount: (count: number) => string };
}): BravaisSeamAlbum | undefined => {
    if (collection.type !== 'album') return undefined;
    const info = { ...collection, ...(detail ?? {}) } as LibraryCollectionDescriptor;
    const year = resolveYear(info);
    const artists = (info.artists ?? []).map(artist => artist.name).filter(Boolean);
    return {
        coverUrl: info.coverUrl || undefined,
        artists: artists.length ? artists : (info.albumArtist ? [info.albumArtist] : []),
        kicker: year ? `${labels.kind} · ${year}` : labels.kind,
        facts: [
            trackCount > 0 ? labels.trackCount(trackCount) : '',
            formatAlbumDuration(info.albumDuration),
            info.albumGenre ?? '',
        ].filter(Boolean),
    };
};
