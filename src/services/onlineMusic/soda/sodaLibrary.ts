import type { OnlineLibraryProvider, ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { normalizeSodaCollection } from './sodaNormalize';
import { requestSoda } from './sodaTransport';

// src/services/onlineMusic/soda/sodaLibrary.ts
//
// 账号自己的歌单。汽水把「我喜欢」也放在歌单列表里（kind === 'liked'），所以它照账号的规矩变成一个带
// isLiked 的集合，红心读的是它。

interface SodaPlaylist {
    id?: string | number;
    name?: string;
    title?: string;
    coverUrl?: string;
    url_cover?: unknown;
    trackCount?: number;
    count_tracks?: number;
    description?: string;
    desc?: string;
    kind?: string;
}

const collectionOf = (playlist: SodaPlaylist): ProviderCollection => {
    // 账号接口给的是扁平字段（name/coverUrl），匿名接口给的是汽水原始字段（title/url_cover），两种都收。
    if (playlist?.url_cover || playlist?.title) return normalizeSodaCollection(playlist);
    const liked = String(playlist?.kind ?? '') === 'liked';
    return {
        providerId: 'soda',
        id: String(playlist?.id ?? ''),
        type: 'playlist',
        name: String(playlist?.name ?? ''),
        ...(playlist?.coverUrl ? { coverUrl: String(playlist.coverUrl) } : {}),
        ...(playlist?.description ? { description: String(playlist.description) } : {}),
        ...(Number(playlist?.trackCount) > 0 ? { trackCount: Number(playlist.trackCount) } : {}),
        ...(liked ? { isLiked: true } : {}),
    };
};

/** 「我喜欢」是歌单列表里 kind === 'liked' 的那一个；没有登录或平台不给就是 null。 */
const likedPlaylistOf = async (): Promise<SodaPlaylist | null> => {
    const answer = await requestSoda<{ items: SodaPlaylist[] }>('user_playlists', { limit: 200, cursor: 0 });
    const items = Array.isArray(answer.items) ? answer.items : [];
    return items.find((item) => String(item?.kind ?? '') === 'liked') ?? null;
};

export const sodaLibrary: OnlineLibraryProvider = {
    async getUserPlaylists(_userId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> {
        const answer = await requestSoda<{ items: SodaPlaylist[] }>('user_playlists', { limit, cursor: offset });
        const items = (Array.isArray(answer.items) ? answer.items : []).map(collectionOf).filter((item) => item.id);
        return { items, hasMore: items.length >= limit, nextOffset: offset + items.length };
    },

    /**
     * 喜欢的歌就是「我喜欢」那个歌单的曲目。汽水没有更便宜的计数接口，所以整份读；
     * 读回来正好装满一页就当作没读全，交给 likedChecks 逐首再问。
     */
    async getLikedSongIds() {
        const liked = await likedPlaylistOf();
        if (!liked?.id) return { ids: [], whole: true };
        const answer = await requestSoda<{ ids: string[]; whole: boolean }>('liked_ids', { limit: 500 });
        return { ids: Array.isArray(answer.ids) ? answer.ids : [], whole: answer.whole !== false };
    },
};
