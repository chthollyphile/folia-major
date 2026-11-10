import i18n from '../../../i18n/config';
import type { OnlineCatalogProvider, OnlineLibraryProvider, ProviderCollection, ProviderLikedSongIds, ProviderPage } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { normalizeQishuiCollection, normalizeQishuiSong, record, type QishuiRecord } from './qishuiNormalize';
import { requestQishui } from './qishuiTransport';
import { createQishuiSceneCover } from './qishuiSceneCover';

// Catalogue and account collection reads; paging metadata is supplied by the car bridge.
const RECENT_ID = 'recent-played';
const recentCollection = async (): Promise<ProviderCollection> => ({ providerId: 'qishui', id: RECENT_ID, type: 'history',
    name: i18n.t('qishui.recentPlayed'), isOwned: false, coverUrl: await createQishuiSceneCover(RECENT_ID, '') });
export const qishuiCatalog: OnlineCatalogProvider = {
    async getPlaylistTracks(id, limit, offset, collection) {
        if (id === RECENT_ID) {
            const page = await requestQishui<ProviderPage<unknown>>('recent_played', { limit, offset });
            return { ...page, items: page.items.map(normalizeQishuiSong) };
        }
        const page = await requestQishui<ProviderPage<unknown>>('playlist_tracks', { id: String(id), limit, offset,
            ownerId: typeof collection?.providerData?.ownerId === 'string' ? collection.providerData.ownerId : '' });
        return { ...page, items: page.items.map(normalizeQishuiSong) };
    },
    async getPlaylistDetail(id, collection) {
        if (id === RECENT_ID) return recentCollection();
        const raw = await requestQishui('playlist_detail', { id: String(id), limit: 1,
            ownerId: typeof collection?.providerData?.ownerId === 'string' ? collection.providerData.ownerId : '' });
        if (!raw) return null;
        const detail = normalizeQishuiCollection({ ...record(raw), isOwned: collection?.isOwned ?? record(raw).isOwned });
        return { ...collection, ...detail, ...(collection?.isLiked === true ? { isLiked: true } : {}) };
    },
    async getArtistSongs(id, limit, offset) {
        const page = await requestQishui<ProviderPage<unknown>>('artist_songs', { id: String(id), limit, offset });
        return { ...page, items: page.items.map(normalizeQishuiSong) };
    },
    async getArtistDetail(id) {
        const raw = await requestQishui('artist_detail', { id: String(id) });
        return raw ? normalizeQishuiCollection(raw, 'artist') : null;
    },
};
export const qishuiLibrary: OnlineLibraryProvider = {
    async getUserPlaylists(_userId, limit, offset) {
        // The read-only history card occupies one row; translate the library offset to playlist rows.
        const first = offset === 0;
        const page = await requestQishui<ProviderPage<QishuiRecord>>('user_playlists', {
            limit: first ? Math.max(1, limit - 1) : limit, offset: Math.max(0, offset - 1),
        });
        const rows = first && limit === 1 ? [] : page.items.map(item => normalizeQishuiCollection(item));
        const items = [...(first ? [await recentCollection()] : []), ...rows];
        return { items, hasMore: first && limit === 1 ? page.items.length > 0 || page.hasMore : page.hasMore,
            nextOffset: offset + items.length, ...(page.total === undefined ? {} : { total: page.total + 1 }) };
    },
    async getLikedSongIds() {
        const data = await requestQishui<ProviderLikedSongIds>('liked_songs');
        if (!Array.isArray(data.ids) || data.ids.some(id => typeof id !== 'string' || !/^\d+$/.test(id)) || typeof data.whole !== 'boolean') {
            throw new OnlineProviderError('invalid-response', 'Qishui liked songs are missing', 'qishui');
        }
        console.info('[Qishui] Liked songs read', { count: data.ids.length, whole: data.whole });
        return { ids: data.ids, whole: data.whole };
    },
};
