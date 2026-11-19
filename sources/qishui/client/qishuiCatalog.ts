import type { FoliumSourceCatalog, FoliumSourceCollection, FoliumSourceLibrary, FoliumSourcePage } from '@folia/folium';
import { normalizeQishuiCollection, normalizeQishuiSong, qishuiOwnerOf, record, type QishuiRecord } from './qishuiNormalize';
import { qishuiError, requestQishui } from './qishuiTransport';
import { createQishuiSceneCover } from './qishuiSceneCover';

// sources/qishui/client/qishuiCatalog.ts
// 曲库与账号的歌单读取（catalog@1、library@1）；分页的数由车机桥给。账号歌单的第一行是只读的「最近播放」卡，
// 名字按读的时候的界面语言写出（collection 的 name 是文字，不是 FoliumText）。

const RECENT_ID = 'recent-played';

/** What the catalogue needs of the host: the mod's own text in the current language. */
export interface QishuiCatalogEnv {
    translate(key: string): string;
}

export function createQishuiCatalog(env: QishuiCatalogEnv): { catalog: FoliumSourceCatalog; library: FoliumSourceLibrary } {
    const recentCollection = async (): Promise<FoliumSourceCollection> => ({
        id: RECENT_ID, type: 'history', name: env.translate('recentPlayed'), isOwned: false,
        coverUrl: await createQishuiSceneCover(RECENT_ID, ''),
    });
    const catalog: FoliumSourceCatalog = {
        async getPlaylistTracks(id, limit, offset, collection) {
            const page = id === RECENT_ID
                ? await requestQishui<FoliumSourcePage<unknown>>('recent_played', { limit, offset })
                : await requestQishui<FoliumSourcePage<unknown>>('playlist_tracks', { id, limit, offset, ownerId: qishuiOwnerOf(collection) });
            return { ...page, items: page.items.map(normalizeQishuiSong) };
        },
        async getPlaylistDetail(id, collection) {
            if (id === RECENT_ID) return recentCollection();
            const raw = await requestQishui('playlist_detail', { id, limit: 1, ownerId: qishuiOwnerOf(collection) });
            if (!raw) return null;
            const detail = normalizeQishuiCollection({ ...record(raw), isOwned: collection?.isOwned ?? record(raw).isOwned });
            return { ...collection, ...detail, ...(collection?.isLiked === true ? { isLiked: true } : {}) };
        },
        async getArtistSongs(id, limit, offset) {
            const page = await requestQishui<FoliumSourcePage<unknown>>('artist_songs', { id, limit, offset });
            return { ...page, items: page.items.map(normalizeQishuiSong) };
        },
        async getArtistDetail(id) {
            const raw = await requestQishui('artist_detail', { id });
            return raw ? normalizeQishuiCollection(raw, 'artist') : null;
        },
    };
    const library: FoliumSourceLibrary = {
        async getUserPlaylists(_userId, limit, offset) {
            // The read-only history card occupies one row; translate the library offset to playlist rows.
            const first = offset === 0;
            const page = await requestQishui<FoliumSourcePage<QishuiRecord>>('user_playlists', {
                limit: first ? Math.max(1, limit - 1) : limit, offset: Math.max(0, offset - 1),
            });
            const rows = first && limit === 1 ? [] : page.items.map(item => normalizeQishuiCollection(item));
            const items = [...(first ? [await recentCollection()] : []), ...rows];
            return { items, hasMore: first && limit === 1 ? page.items.length > 0 || page.hasMore : page.hasMore,
                nextOffset: offset + items.length, ...(page.total === undefined ? {} : { total: page.total + 1 }) };
        },
        async getLikedSongIds() {
            const data = await requestQishui<{ ids: unknown; whole: unknown }>('liked_songs');
            const ids = data.ids;
            if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^\d+$/.test(id)) || typeof data.whole !== 'boolean') {
                throw qishuiError('invalid-response', 'Qishui liked songs are missing');
            }
            console.info('[Qishui] Liked songs read', { count: ids.length, whole: data.whole });
            return { ids: ids as string[], whole: data.whole };
        },
    };
    return { catalog, library };
}
