import type { OnlineExploreProvider, ProviderCollection, ProviderExploreItem, ProviderExplorePage } from '../../../types/onlineMusic';
import { normalizeSodaCollection } from './sodaNormalize';
import { requestSoda } from './sodaTransport';

// src/services/onlineMusic/soda/sodaExplore.ts
//
// 汽水的探索页：没有登录也能读，内容是「按关键词搜到的公开歌单」。一栏一个关键词，
// 「更多」把同一栏接着往下翻；cursor 是 `<栏序号>:<offset>`，只对这一次读取有效。

const SHELVES = [
    { keyword: '热歌', title: '热门歌单' },
    { keyword: '国风', title: '国风歌单' },
    { keyword: '电子', title: '电子歌单' },
] as const;

const PAGE = 12;

const collectionsOf = (group: any): ProviderCollection[] => (
    (Array.isArray(group?.data) ? group.data : [])
        .map((row: any) => row?.entity?.playlist)
        .filter((playlist: any) => playlist?.id)
        .map(normalizeSodaCollection)
);

const sectionOf = (index: number, group: any): { id: string; title: string; items: ProviderExploreItem[]; moreCursor?: string } => {
    const shelf = SHELVES[index];
    const collections = collectionsOf(group);
    return {
        id: `soda-playlist-${index}`,
        title: shelf.title,
        items: collections.map((collection) => ({ kind: 'collection', collection })),
        ...(group?.has_more && collections.length > 0 ? { moreCursor: `${index}:${collections.length}` } : {}),
    };
};

export const sodaExplore: OnlineExploreProvider = {
    // 整页内容每次读取都重新搜一次；这一页没有「下一页」，续读只走各栏的 moreCursor。
    async getFeed(): Promise<ProviderExplorePage> {
        const sections = await Promise.all(SHELVES.map(async (shelf, index) => {
            const data = await requestSoda<any>('playlist_search', { query: shelf.keyword, cursor: 0, count: PAGE });
            return sectionOf(index, data.group);
        }));
        return { sections };
    },

    async getSectionItems(cursor: string) {
        const [indexText, offsetText] = cursor.split(':');
        const index = Number(indexText);
        const offset = Number(offsetText);
        if (!Number.isInteger(index) || !SHELVES[index] || !Number.isInteger(offset)) return { items: [] };
        const data = await requestSoda<any>('playlist_search', { query: SHELVES[index].keyword, cursor: offset, count: PAGE });
        const collections = collectionsOf(data.group);
        return {
            items: collections.map((collection) => ({ kind: 'collection', collection }) as ProviderExploreItem),
            ...(data.group?.has_more && collections.length > 0 ? { moreCursor: `${index}:${offset + collections.length}` } : {}),
        };
    },
};
