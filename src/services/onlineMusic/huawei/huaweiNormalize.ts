import type { Artist, SongResult, UnifiedSong } from '../../../types';
import type { JsonValue, ProviderCollection, ProviderPage, ProviderUser } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/huawei/huaweiNormalize.ts

export type HuaweiRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is HuaweiRecord => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

export const huaweiRecord = (value: unknown): HuaweiRecord => (isRecord(value) ? value : {});

const text = (value: unknown): string => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
};

const numberOf = (value: unknown): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') return Number(value);
    return Number.NaN;
};

const parseJson = (value: unknown): unknown => {
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return null; }
    }
    return value;
};

const contentExtra = (item: HuaweiRecord): HuaweiRecord => huaweiRecord(parseJson(item.contentExInfo ?? item.contentExInfoJson));

const ref = (kind: 'album' | 'artist', id: string) => (
    id ? { providerId: 'huawei' as const, kind, id } : undefined
);

const artistsOf = (item: HuaweiRecord, extra: HuaweiRecord): Artist[] => {
    const pairs = Array.isArray(item.artistNamePairs) ? item.artistNamePairs
        : Array.isArray(extra.artistNamePairs) ? extra.artistNamePairs : [];
    const names = pairs
        .map(pair => huaweiRecord(pair))
        .map(pair => ({ id: text(pair.code ?? pair.artistID ?? pair.id), name: text(pair.name ?? pair.artistName) }))
        .filter(artist => artist.name);
    if (names.length > 0) {
        return names.map(artist => ({
            id: artist.id, name: artist.name, catalogRef: ref('artist', artist.id),
        }));
    }
    const ids = Array.isArray(item.artistID) ? item.artistID.map(text) : [];
    const name = text(item.artistName ?? extra.artistNames ?? item.singerName);
    if (!name) return [];
    const single = ids.length === 1 ? ids[0] : '';
    return [{ id: single, name, catalogRef: ref('artist', single) }];
};

const durationMsOf = (item: HuaweiRecord, extra: HuaweiRecord): number => {
    const direct = numberOf(item.duration ?? item.durationSeconds);
    if (Number.isFinite(direct) && direct > 0) return direct < 10000 ? direct * 1000 : direct;
    const files = huaweiRecord(extra.completeFileInfos);
    const first = Object.values(files).find(value => numberOf(huaweiRecord(value).duration) > 0);
    const seconds = numberOf(huaweiRecord(first).duration);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
};

const coverOf = (item: HuaweiRecord): string => {
    const picture = huaweiRecord(item.picture);
    return text(picture.bigImgURL || picture.middleImgURL || picture.smallImgURL || item.coverUrl || item.cover);
};

export const normalizeHuaweiSong = (raw: unknown): UnifiedSong => {
    const item = huaweiRecord(raw);
    if (item.sourceRef && huaweiRecord(item.sourceRef).providerId === 'huawei') return raw as UnifiedSong;
    const id = text(item.contentID ?? item.contentId ?? item.songCode ?? item.id);
    const name = text(item.contentName ?? item.songName ?? item.name);
    if (!id || !name) throw new OnlineProviderError('invalid-response', 'Huawei Music song has no id or name', 'huawei');
    const extra = contentExtra(item);
    const album = huaweiRecord(item.albumNamePair);
    const albumId = text(item.albumID ?? item.albumId ?? album.id ?? album.albumID ?? extra.albumCode);
    const albumName = text(item.albumName ?? album.name ?? album.albumName ?? extra.albumName);
    const lyricUrl = text(item.lyricAddress ?? item.lyricAddres ?? extra.lyricAddres ?? extra.lyricAddress);
    const providerData: Record<string, JsonValue> = {};
    if (lyricUrl) providerData.lyricUrl = lyricUrl;
    return {
        id,
        name,
        artists: artistsOf(item, extra),
        album: {
            id: albumId,
            name: albumName,
            coverUrl: coverOf(item),
            catalogRef: ref('album', albumId),
        },
        durationMs: durationMsOf(item, extra),
        sourceRef: {
            kind: 'online',
            providerId: 'huawei',
            mediaId: id,
            providerData,
        },
    };
};

export const normalizeHuaweiUser = (raw: unknown): ProviderUser => {
    const item = huaweiRecord(raw);
    const avatarUrl = text(item.avatarUrl);
    return {
        id: text(item.id ?? item.userId),
        nickname: text(item.nickname) || '华为音乐账号',
        ...(avatarUrl ? { avatarUrl } : {}),
    };
};

export const normalizeHuaweiCollection = (raw: unknown, type: 'album' | 'artist' | 'playlist' = 'album'): ProviderCollection => {
    const item = huaweiRecord(raw);
    if (item.providerId === 'huawei') return raw as ProviderCollection;
    const typedId = type === 'artist' ? item.artistCode : type === 'playlist' ? item.musicListID : item.albumCode;
    const typedName = type === 'artist' ? item.artistName : type === 'playlist' ? item.contentName : item.albumName;
    const id = text(item.id ?? typedId ?? item.contentID);
    const name = text(item.name ?? typedName ?? item.contentName);
    if (!id || !name) throw new OnlineProviderError('invalid-response', `Huawei Music ${type} has no id or name`, 'huawei');
    const picture = huaweiRecord(item.picture);
    const trackCount = numberOf(item.totalCount);
    const description = text(item.description || item.listDesc);
    return {
        providerId: 'huawei',
        id,
        type,
        name,
        coverUrl: text(item.coverUrl || picture.bigImgURL || picture.middleImgURL || picture.smallImgURL),
        ...(Number.isFinite(trackCount) && trackCount > 0 ? { trackCount } : {}),
        ...(description ? { description } : {}),
        ...(type === 'playlist'
            ? { providerData: { kind: item.providerData && huaweiRecord(item.providerData).kind === 'owned' ? 'owned' : 'collected' } }
            : {}),
    };
};

export const huaweiPage = <T>(items: T[], nextOffset: number, hasMore: boolean, total?: number): ProviderPage<T> => ({
    items,
    nextOffset,
    hasMore,
    ...(typeof total === 'number' && Number.isFinite(total) ? { total } : {}),
});

export const huaweiLyricUrl = (song: SongResult): string => {
    const source = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'huawei'
        ? song.sourceRef : undefined;
    const value = source?.providerData?.lyricUrl;
    return typeof value === 'string' ? value : '';
};
