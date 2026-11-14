import type { UnifiedSong } from '@/types';
import type { OnlineCatalogProvider, OnlineExploreProvider, ProviderCollection, ProviderExploreItem } from '@/types/onlineMusic';
import type { FoliumSourceCatalog, FoliumSourceExplore } from '../../sources/contract';
import { toHostPage, toSourceCollection, toSourceSong } from '../sourceDtos';
import { list, record, type SourceAdapterKit } from './kit';

// src/mods/folium/registries/sourceAdapter/catalog.ts
// catalog@1 and explore@1 as the host's internal `catalog` and `explore`: albums, artists, playlists and their
// songs, and the source's own recommendation page.

export const buildCatalog = (kit: SourceAdapterKit, catalog: FoliumSourceCatalog): OnlineCatalogProvider => {
    const of = (entry?: ProviderCollection) => (entry ? toSourceCollection(entry) : undefined);
    const songs = (offset: number) => (page: unknown) => toHostPage(page, offset, kit.song);
    const canResolveSongCatalogRefs = catalog.canResolveSongCatalogRefs?.bind(catalog);
    const resolveSongCatalogRefs = catalog.resolveSongCatalogRefs?.bind(catalog);
    const getPlaylistTracks = catalog.getPlaylistTracks?.bind(catalog);
    const getPlaylistDetail = catalog.getPlaylistDetail?.bind(catalog);
    const getCloudTracks = catalog.getCloudTracks?.bind(catalog);
    const getListeningRankTracks = catalog.getListeningRankTracks?.bind(catalog);
    const getAlbumTracks = catalog.getAlbumTracks?.bind(catalog);
    const getAlbumDetail = catalog.getAlbumDetail?.bind(catalog);
    const getArtistSongs = catalog.getArtistSongs?.bind(catalog);
    const getArtistAlbums = catalog.getArtistAlbums?.bind(catalog);
    const getArtistDetail = catalog.getArtistDetail?.bind(catalog);
    const getSubscriptionStatus = catalog.getSubscriptionStatus?.bind(catalog);
    return {
        ...(canResolveSongCatalogRefs ? {
            canResolveSongCatalogRefs: kit.sync('canResolveSongCatalogRefs', (song: UnifiedSong) => canResolveSongCatalogRefs(toSourceSong(song)), () => false),
        } : {}),
        ...(resolveSongCatalogRefs ? {
            resolveSongCatalogRefs: async (song) => kit.song(await kit.run('resolveSongCatalogRefs', () => resolveSongCatalogRefs(toSourceSong(song)))) ?? song,
        } : {}),
        ...(getPlaylistTracks ? {
            getPlaylistTracks: async (id, limit, offset, entry) => songs(offset)(await kit.run('getPlaylistTracks', () => getPlaylistTracks(String(id), limit, offset, of(entry)))),
        } : {}),
        ...(getPlaylistDetail ? {
            getPlaylistDetail: async (id, entry) => kit.collection(await kit.run('getPlaylistDetail', () => getPlaylistDetail(String(id), of(entry)))),
        } : {}),
        ...(getCloudTracks ? {
            getCloudTracks: async (limit, offset, entry) => songs(offset)(await kit.run('getCloudTracks', () => getCloudTracks(limit, offset, of(entry)))),
        } : {}),
        ...(getListeningRankTracks ? {
            getListeningRankTracks: async (range, limit, offset, entry) => songs(offset)(
                await kit.run('getListeningRankTracks', () => getListeningRankTracks(range, limit, offset, of(entry))),
            ),
        } : {}),
        ...(getAlbumTracks ? {
            getAlbumTracks: async (id, limit, offset, entry) => songs(offset ?? 0)(
                await kit.run('getAlbumTracks', () => getAlbumTracks(String(id), limit, offset, of(entry))),
            ),
        } : {}),
        ...(getAlbumDetail ? {
            getAlbumDetail: async (id, entry) => kit.collection(await kit.run('getAlbumDetail', () => getAlbumDetail(String(id), of(entry)))),
        } : {}),
        ...(getArtistSongs ? {
            getArtistSongs: async (id, limit, offset) => songs(offset)(await kit.run('getArtistSongs', () => getArtistSongs(String(id), limit, offset))),
        } : {}),
        ...(getArtistAlbums ? {
            getArtistAlbums: async (id, limit, offset) => toHostPage(await kit.run('getArtistAlbums', () => getArtistAlbums(String(id), limit, offset)), offset, kit.collection),
        } : {}),
        ...(getArtistDetail ? {
            getArtistDetail: async (id) => kit.collection(await kit.run('getArtistDetail', () => getArtistDetail(String(id)))),
        } : {}),
        ...(getSubscriptionStatus ? {
            getSubscriptionStatus: async (type, id, entry) => (await kit.run('getSubscriptionStatus', () => getSubscriptionStatus(type, String(id), of(entry)))) === true,
        } : {}),
    };
};

const exploreItem = (kit: SourceAdapterKit, value: unknown): ProviderExploreItem | null => {
    const item = record(value);
    if (!item) return null;
    const extra = {
        ...(typeof item.wideCoverUrl === 'string' ? { wideCoverUrl: item.wideCoverUrl } : {}),
        ...(typeof item.subtitle === 'string' ? { subtitle: item.subtitle } : {}),
    };
    if (item.kind === 'song') {
        const song = kit.song(item.song);
        return song ? { kind: 'song', song, ...extra } : null;
    }
    if (item.kind === 'collection') {
        const collection = kit.collection(item.collection);
        return collection ? { kind: 'collection', collection, ...(item.isMix === true ? { isMix: true } : {}), ...extra } : null;
    }
    return null;
};

const exploreItems = (kit: SourceAdapterKit, value: unknown): ProviderExploreItem[] => (
    list(value).map((item) => exploreItem(kit, item)).filter((item): item is ProviderExploreItem => item !== null)
);

export const buildExplore = (kit: SourceAdapterKit, explore: FoliumSourceExplore): OnlineExploreProvider => {
    const getSectionItems = explore.getSectionItems?.bind(explore);
    const songsShownAs = explore.songsShownAs?.bind(explore);
    return {
        getFeed: async (cursor, listened) => {
            const page = record(await kit.run('getFeed', () => explore.getFeed(cursor, listened?.map(toSourceSong))));
            return {
                sections: list(page?.sections).flatMap((value) => {
                    const section = record(value);
                    if (!section) return [];
                    return [{
                        id: String(section.id),
                        title: typeof section.title === 'string' ? section.title : '',
                        items: exploreItems(kit, section.items),
                        ...(typeof section.moreCursor === 'string' ? { moreCursor: section.moreCursor } : {}),
                        ...(section.changesWithRead === true ? { changesWithRead: true } : {}),
                    }];
                }),
                ...(typeof page?.nextCursor === 'string' ? { nextCursor: page.nextCursor } : {}),
                ...(page?.refreshReadsAnew === true ? { refreshReadsAnew: true } : {}),
            };
        },
        ...(getSectionItems ? {
            getSectionItems: async (cursor) => {
                const page = record(await kit.run('getSectionItems', () => getSectionItems(cursor)));
                return { items: exploreItems(kit, page?.items), ...(typeof page?.moreCursor === 'string' ? { moreCursor: page.moreCursor } : {}) };
            },
        } : {}),
        ...(songsShownAs ? {
            songsShownAs: async (played) => {
                const answer = record(await kit.run('songsShownAs', () => songsShownAs(played.map(toSourceSong))));
                const shown = new Map<string, UnifiedSong | null>();
                Object.entries(answer ?? {}).forEach(([id, value]) => shown.set(id, value === null ? null : kit.song(value)));
                return shown;
            },
        } : {}),
    };
};
