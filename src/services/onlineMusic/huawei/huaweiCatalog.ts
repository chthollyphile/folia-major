import type { OnlineCatalogProvider, ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { huaweiPage, normalizeHuaweiCollection, normalizeHuaweiSong } from './huaweiNormalize';
import { requestHuawei } from './huaweiTransport';

// src/services/onlineMusic/huawei/huaweiCatalog.ts

interface HuaweiAlbumAnswer {
    id: string;
    name?: string;
    coverUrl?: string;
    totalCount?: number;
    items: unknown[];
    hasMore?: boolean;
    nextOffset?: number;
}

interface HuaweiArtistAnswer {
    id: string;
    name?: string;
    coverUrl?: string;
    items: unknown[];
    albums?: Array<{ id: string; name: string; coverUrl?: string }>;
}

interface HuaweiPlaylistItem {
    id: string;
    name: string;
    kind: 'owned' | 'collected';
    coverUrl?: string;
    trackCount?: number;
    playCount?: number;
    description?: string;
}

interface HuaweiPlaylistAnswer {
    items: HuaweiPlaylistItem[];
    hasMore?: boolean;
    nextOffset?: number;
}

interface HuaweiPlaylistTracksAnswer {
    items: unknown[];
    total?: number;
    hasMore?: boolean;
    nextOffset?: number;
}

const playlistKind = (collection?: ProviderCollection): 'owned' | 'collected' | null => {
    const kind = collection?.providerData?.kind;
    return kind === 'owned' || kind === 'collected' ? kind : null;
};

export const huaweiPlaylistCollection = (item: HuaweiPlaylistItem): ProviderCollection => ({
    providerId: 'huawei',
    id: item.id,
    type: 'playlist',
    name: item.name,
    isOwned: item.kind === 'owned',
    ...(item.coverUrl ? { coverUrl: item.coverUrl } : {}),
    ...(typeof item.trackCount === 'number' ? { trackCount: item.trackCount } : {}),
    ...(typeof item.playCount === 'number' ? { playCount: item.playCount } : {}),
    ...(item.description ? { description: item.description } : {}),
    providerData: { kind: item.kind },
});

/** The account's Huawei Music playlists, including its liked songs ("我喜欢的音乐"). */
export const listHuaweiPlaylists = async (limit = 50, offset = 0): Promise<ProviderPage<ProviderCollection>> => {
    const answer = await requestHuawei<HuaweiPlaylistAnswer>('library_playlists', { limit, offset });
    const items = Array.isArray(answer.items) ? answer.items : [];
    const collections = items
        .filter(item => item.id && item.name)
        .map(huaweiPlaylistCollection);
    return huaweiPage(collections, answer.nextOffset ?? offset + items.length, Boolean(answer.hasMore));
};

const findHuaweiPlaylist = async (id: string): Promise<ProviderCollection | null> => {
    let offset = 0;
    for (;;) {
        const page = await listHuaweiPlaylists(50, offset);
        const found = page.items.find(collection => String(collection.id) === id);
        if (found) return found;
        if (!page.hasMore || page.nextOffset <= offset) return null;
        offset = page.nextOffset;
    }
};

const pageOf = (items: unknown[], answer: HuaweiAlbumAnswer, limit: number, offset: number): ProviderPage<ReturnType<typeof normalizeHuaweiSong>> => {
    const songs = items.map(normalizeHuaweiSong);
    const nextOffset = answer.nextOffset ?? offset + songs.length;
    const hasMore = typeof answer.hasMore === 'boolean'
        ? answer.hasMore
        : songs.length === limit && (answer.totalCount ?? 0) > nextOffset;
    return huaweiPage(songs, nextOffset, hasMore, answer.totalCount);
};

export const huaweiCatalog: OnlineCatalogProvider = {
    canResolveSongCatalogRefs: song => song.sourceRef.kind === 'online' && song.sourceRef.providerId === 'huawei',
    resolveSongCatalogRefs: song => Promise.resolve(song),
    async getAlbumTracks(id, limit = 50, offset = 0) {
        const answer = await requestHuawei<HuaweiAlbumAnswer>('album', { id: String(id), limit, offset });
        return pageOf(Array.isArray(answer.items) ? answer.items : [], answer, limit, offset);
    },
    async getAlbumDetail(id) {
        const answer = await requestHuawei<HuaweiAlbumAnswer>('album', { id: String(id), limit: 1, offset: 0 });
        const collection = normalizeHuaweiCollection(answer, 'album');
        return typeof answer.totalCount === 'number' && Number.isFinite(answer.totalCount)
            ? { ...collection, trackCount: answer.totalCount }
            : collection;
    },
    async getArtistSongs(id, limit, offset) {
        const answer = await requestHuawei<HuaweiArtistAnswer>('artist', { id: String(id) });
        const rows = Array.isArray(answer.items) ? answer.items : [];
        const songs = rows.slice(offset, offset + limit).map(normalizeHuaweiSong);
        return huaweiPage(songs, offset + songs.length, offset + songs.length < rows.length);
    },
    async getArtistAlbums(id, limit, offset) {
        const answer = await requestHuawei<HuaweiArtistAnswer>('artist', { id: String(id) });
        const rows = Array.isArray(answer.albums) ? answer.albums : [];
        const albums = rows.slice(offset, offset + limit).map(album => normalizeHuaweiCollection(album, 'album'));
        return huaweiPage<ProviderCollection>(albums, offset + albums.length, offset + albums.length < rows.length);
    },
    async getArtistDetail(id) {
        const answer = await requestHuawei<HuaweiArtistAnswer>('artist', { id: String(id) });
        const collection = normalizeHuaweiCollection(answer, 'artist');
        return {
            ...collection,
            trackCount: Array.isArray(answer.items) ? answer.items.length : undefined,
            albumCount: Array.isArray(answer.albums) ? answer.albums.length : undefined,
        };
    },
    async getPlaylistTracks(id, limit, offset, collection) {
        const kind = playlistKind(collection) ?? playlistKind((await findHuaweiPlaylist(String(id))) ?? undefined);
        if (!kind) throw new OnlineProviderError('invalid-response', 'Huawei Music playlist kind is missing', 'huawei');
        const answer = await requestHuawei<HuaweiPlaylistTracksAnswer>('playlist_tracks', {
            id: String(id), kind, limit, offset,
        });
        const items = (Array.isArray(answer.items) ? answer.items : []).map(normalizeHuaweiSong);
        return huaweiPage(
            items,
            answer.nextOffset ?? offset + items.length,
            Boolean(answer.hasMore),
            answer.total,
        );
    },
    async getPlaylistDetail(id, collection) {
        if (collection?.providerId === 'huawei') return collection;
        return findHuaweiPlaylist(String(id));
    },
};

export type HuaweiCatalogPage = ProviderPage<ReturnType<typeof normalizeHuaweiSong>>;
