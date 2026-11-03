import i18n from '../../../i18n/config';
import type { UnifiedSong } from '../../../types';
import type { MediaId, ProviderCollection, ProviderPage, ProviderUser } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { normalizeQqCollection, normalizeQqSong } from './qqNormalize';
import { requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqLists.ts
// QQ 音乐里不是歌单、却当成集合打开的几样：排行榜、电台（探索页的卡片）和音乐云盘（qq-music-api 3.3.3）。
// 卡片在 providerData 里记下自己是哪一种（`list`），getPlaylistTracks 按它改走这里。

export type QqListKind = 'toplist' | 'radio';

// 一个榜一次最多读 100 首（后端的上限）。
const TOPLIST_PAGE_MAX = 100;
// 云盘一次最多读 1000 首（后端的上限）。
const CLOUD_PAGE_MAX = 1000;

// 422 是「上游成功但没有数据」：这一页是空的，不是失败。
const isEmptyAnswer = (error: unknown): boolean => (
    error instanceof OnlineProviderError && error.code === 'network' && error.httpStatus === 422
);

const emptyPage = (offset: number): ProviderPage<UnifiedSong> => ({ items: [], hasMore: false, nextOffset: offset });

/** 这个集合是不是排行榜或电台；是的话回它是哪一种。 */
export const qqListKindOf = (collection?: ProviderCollection): QqListKind | null => {
    const kind = collection?.providerId === 'qq' ? collection.providerData?.list : undefined;
    return kind === 'toplist' || kind === 'radio' ? kind : null;
};

/** `/recommend/toplists` 里的一个榜，做成能打开的集合。id 带前缀，免得和同号的歌单撞在一起。 */
export const qqToplistCollection = (raw: any): ProviderCollection | null => {
    const id = Number(raw?.id);
    const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    if (!Number.isSafeInteger(id) || id <= 0 || !title) return null;
    const period = typeof raw?.period === 'string' && raw.period ? raw.period : undefined;
    return normalizeQqCollection({
        id: `toplist-${id}`,
        title,
        picurl: raw?.cover,
        songnum: raw?.total,
        listennum: raw?.listenNum,
        desc: raw?.intro,
        providerData: { list: 'toplist', listId: id, ...(period ? { period } : {}) },
    });
};

/** `/radio/list` 里的一个电台，做成能打开的集合。 */
export const qqRadioCollection = (raw: any): ProviderCollection | null => {
    const id = Number(raw?.id);
    const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    if (!Number.isSafeInteger(id) || id <= 0 || !title) return null;
    return normalizeQqCollection({
        id: `radio-${id}`,
        title,
        picurl: raw?.picurl,
        listennum: raw?.listenNum,
        providerData: { list: 'radio', listId: id },
    });
};

const songsOf = (response: any): UnifiedSong[] => (
    (Array.isArray(response?.songs) ? response.songs : [])
        .map(normalizeQqSong)
        .filter((song: UnifiedSong) => Boolean(song.qqMid))
);

/** 一个榜（这一期，或卡片记下的那一期）的一页歌。 */
const getToplistTracks = async (collection: ProviderCollection, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> => {
    const period = collection.providerData?.period;
    try {
        const response = await requestQq<any>('recommend_toplist', {
            id: Number(collection.providerData?.listId),
            ...(typeof period === 'string' && period ? { period } : {}),
            offset,
            limit: Math.min(TOPLIST_PAGE_MAX, Math.max(1, limit)),
        });
        const items = songsOf(response);
        const total = Number(response?.total);
        // 后端按它给过的条数翻页：下一页从这一页给了几条算起，不从滤掉没有 mid 的歌后剩几条算。
        const given = Array.isArray(response?.songs) ? response.songs.length : 0;
        return {
            items,
            ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
            hasMore: response?.more === true && given > 0,
            nextOffset: offset + given,
        };
    } catch (error) {
        if (isEmptyAnswer(error)) return emptyPage(offset);
        throw error;
    }
};

/** 电台每次打开现给一批（约 9 首），没有下一页。 */
const getRadioTracks = async (collection: ProviderCollection, offset: number): Promise<ProviderPage<UnifiedSong>> => {
    if (offset > 0) return emptyPage(offset);
    try {
        const items = songsOf(await requestQq<any>('radio_tracks', { id: Number(collection.providerData?.listId) }));
        return { items, total: items.length, hasMore: false, nextOffset: items.length };
    } catch (error) {
        if (isEmptyAnswer(error)) return emptyPage(offset);
        throw error;
    }
};

/** 排行榜或电台的一页歌；别的集合不归这里管。 */
export const getQqListTracks = (collection: ProviderCollection, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> => (
    qqListKindOf(collection) === 'radio'
        ? getRadioTracks(collection, Math.max(0, offset))
        : getToplistTracks(collection, limit, Math.max(0, offset))
);

// 云盘里对得上曲库的歌（`playable`）照 songmid 播；自己上传、没对上曲库的文件只有资料、放不了，不列出来。
const playableCloudSongs = (data: unknown): UnifiedSong[] => (
    (Array.isArray(data) ? data : [])
        .filter((entry: any) => entry?.playable === true && entry.song && typeof entry.song === 'object')
        .map((entry: any) => normalizeQqSong(entry.song))
        .filter(song => Boolean(song.qqMid))
);

const CLOUD_COLLECTION_ID = 'cloud';

/** 音乐云盘在歌单里的那一项；云盘是空的就不出。 */
export const getQqCloudCollection = async (user?: ProviderUser): Promise<ProviderCollection | null> => {
    const response = await requestQq<any>('user_cloud', { offset: 0, limit: 1 });
    const count = Number(response?.count);
    if (!Number.isFinite(count) || count <= 0) return null;
    const first = playableCloudSongs(response?.data)[0];
    const coverUrl = first?.album.coverUrl || user?.avatarUrl;
    // 条目按应用的语言命名：名字用应用里云盘的那一句，描述写这个平台自己的网盘（微云音乐网盘）。
    return {
        providerId: 'qq',
        id: CLOUD_COLLECTION_ID as MediaId,
        name: i18n.t('navidrome.cloudDrive'),
        description: i18n.t('navidrome.qqCloudDriveDesc'),
        type: 'cloud',
        ...(coverUrl ? { coverUrl } : {}),
        // 后端的 count 连放不了的文件一起算，列表里只有放得了的。
        trackCount: count,
        isOwned: true,
    };
};

/** 云盘的一页歌。offset 是云盘里的位置：放不了的文件也占位置，所以一页可能比要的少。 */
export const getQqCloudTracks = async (limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> => {
    const safeOffset = Math.max(0, offset);
    const response = await requestQq<any>('user_cloud', {
        offset: safeOffset,
        limit: Math.min(CLOUD_PAGE_MAX, Math.max(1, limit)),
    });
    const listed = Array.isArray(response?.data) ? response.data.length : 0;
    const total = Number(response?.count);
    return {
        items: playableCloudSongs(response?.data),
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        hasMore: response?.hasMore === true && listed > 0,
        nextOffset: safeOffset + listed,
    };
};
