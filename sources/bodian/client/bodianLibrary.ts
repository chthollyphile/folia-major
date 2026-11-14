import type { FoliumSourceCollection, FoliumSourceLibrary } from '@folia/folium';
import { bodianPage, normalizeBodianCollection } from './bodianNormalize';
import { bodianError, requestBodian } from './bodianTransport';

// sources/bodian/client/bodianLibrary.ts

const playlistPages = new Map<string, { at: number; items: FoliumSourceCollection[] }>();
export const clearBodianLibraryCache = () => playlistPages.clear();

// Empty collections are represented as {} or []; populated collections use a named list field.
export function bodianCollectionItems(data: unknown, field: string): unknown[] {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        if (Object.keys(data).length === 0) return [];
        const list = (data as Record<string, unknown>)[field];
        if (Array.isArray(list)) return list;
    }
    throw bodianError('invalid-response', `Bodian ${field} is missing`);
}

async function allPlaylists(userId: string): Promise<FoliumSourceCollection[]> {
    const items: FoliumSourceCollection[] = [];
    const seen = new Set<string>();
    let offset = 0;
    while (true) {
        const data = await requestBodian<any>('user_playlists', { limit: 100, offset });
        if (offset === 0) {
            if (data.liked?.id) items.push(normalizeBodianCollection({ ...data.liked, isOwned: true, isLiked: true }));
            items.push(...bodianCollectionItems(data.owned, 'playLists').map(raw => normalizeBodianCollection({ ...(raw as object), isOwned: true })));
        }
        const collected = bodianCollectionItems(data.collected, 'playLists').map(raw => normalizeBodianCollection({ ...(raw as object), isOwned: false }));
        const previousCount = seen.size;
        collected.forEach(item => seen.add(`${item.data?.source}:${item.id}`));
        items.push(...collected);
        const page = bodianPage(collected, data.collected?.total, offset, 100, data.collected?.bodianPagination);
        // A mixed upstream page may contain only albums; its filtered playlist page is empty but still advances.
        if (!page.hasMore || page.nextOffset <= offset || (collected.length > 0 && seen.size === previousCount)) break;
        offset = page.nextOffset;
    }
    const unique = [...new Map(items.map(item => [`${item.data?.source}:${item.id}`, item])).values()];
    playlistPages.set(userId, { at: Date.now(), items: unique });
    return unique;
}

export const bodianLibrary: FoliumSourceLibrary = {
    async getUserPlaylists(userId, limit, offset) {
        const cached = playlistPages.get(userId);
        const items = offset > 0 && cached && Date.now() - cached.at < 60_000 ? cached.items : await allPlaylists(userId);
        return bodianPage(items.slice(offset, offset + limit), items.length, offset, limit);
    },
    async getUserAlbums(_userId, limit, offset) {
        const data = await requestBodian<any>('user_albums', { limit, offset });
        const items = bodianCollectionItems(data, 'albumList').map(item => normalizeBodianCollection(item, 'album'));
        return bodianPage(items, data.total, offset, limit, data.bodianPagination);
    },
    async getLikedSongIds() {
        const ids = new Set<string>();
        let offset = 0;
        let whole = false;
        while (true) {
            const data = await requestBodian<any>('liked_songs', { limit: 100, offset });
            if (!Array.isArray(data.list)) throw bodianError('invalid-response', 'Bodian liked songs are missing');
            const previousCount = ids.size;
            for (const item of data.list) if (item.id != null) ids.add(String(item.id));
            const page = bodianPage(data.list, data.total, offset, 100, data.bodianPagination);
            // Whole where the list ends and is not short of Bodian's own count of it. Where the
            // reading stops for another reason, songs past that point may be liked too.
            whole = !page.hasMore && (page.total === undefined || page.nextOffset >= page.total);
            if (!page.hasMore || page.nextOffset <= offset || ids.size === previousCount) break;
            offset = page.nextOffset;
        }
        return { ids: [...ids], whole };
    },
    // Bodian's own count of the liked list, from the first request of the read above. It can be
    // more than the ids that read brings: a page may leave out songs that are no longer available.
    async getLikedSongCount() {
        const data = await requestBodian<any>('liked_songs', { limit: 100, offset: 0 });
        return bodianPage([], data?.total, 0, 100).total ?? null;
    },
};
