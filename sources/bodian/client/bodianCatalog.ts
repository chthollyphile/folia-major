import type { FoliumSourceCatalog, FoliumSourceCollection } from '@folia/folium';
import { bodianPage, normalizeBodianCollection, normalizeBodianSong } from './bodianNormalize';
import { requestBodian } from './bodianTransport';
import type { BodianOperation } from './bodianTransport';

// sources/bodian/client/bodianCatalog.ts

export async function bodianSongPage(operation: BodianOperation, id: string, limit: number, offset: number, source?: number) {
    const data = await requestBodian<any>(operation, { id, limit, offset, source });
    const raw = data.resultList ?? data.list;
    if (!Array.isArray(raw)) throw new Error('Bodian song page is missing its list');
    return bodianPage(raw.map(normalizeBodianSong), data.total, offset, limit, data.bodianPagination);
}

export const bodianCatalog: FoliumSourceCatalog = {
    // The host asks only of Bodian's own songs, which carry their album's and artists' ids already.
    canResolveSongCatalogRefs: () => true,
    resolveSongCatalogRefs: async song => song,
    async getPlaylistTracks(id, limit, offset, collection) {
        const discoverIndex = collection?.data?.discoverIndex;
        if (typeof discoverIndex === 'number') {
            const data = await requestBodian<any>('ai_playlist_detail', { index: discoverIndex });
            const raw = Array.isArray(data.musicList) ? data.musicList : [];
            const items = raw.slice(offset, offset + limit).map(normalizeBodianSong);
            return bodianPage(items, raw.length, offset, limit);
        }
        return bodianSongPage('playlist_tracks', id, limit, offset, Number(collection?.data?.source ?? 4));
    },
    async getPlaylistDetail(id, collection) {
        if (typeof collection?.data?.discoverIndex === 'number') return collection;
        return normalizeBodianCollection(await requestBodian('playlist_detail', { id, source: Number(collection?.data?.source ?? 4) }));
    },
    getAlbumTracks: (id, limit = 50, offset = 0) => bodianSongPage('album_tracks', id, limit, offset),
    async getAlbumDetail(id) {
        const data = await requestBodian<any>('album_detail', { id });
        return normalizeBodianCollection(data.albumInfo, 'album');
    },
    async getArtistDetail(id) {
        const data = await requestBodian<any>('artist_detail', { id });
        return normalizeBodianCollection(data.artistInfo, 'artist');
    },
    getArtistSongs: (id, limit, offset) => bodianSongPage('artist_songs', id, limit, offset),
    async getArtistAlbums(id, limit, offset) {
        const data = await requestBodian<any>('artist_albums', { id, limit, offset });
        return bodianPage<FoliumSourceCollection>(data.resultList.map((item: unknown) => normalizeBodianCollection(item, 'album')), data.total, offset, limit, data.bodianPagination);
    },
};
