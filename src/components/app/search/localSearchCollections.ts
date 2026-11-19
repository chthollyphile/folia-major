import type { TFunction } from 'i18next';
import type { LocalPlaylist, LocalSong } from '../../../types';
import type { ProviderArtistSummary } from '../../../types/onlineMusic';
import type { LocalGridViewCollectionDescriptor } from '../../../library/core/collection/collection.contract';
import type { LocalLibraryDisplayCatalog } from '../../../services/playbackAdapters';
import { buildLocalHomeGroups, type LocalHomeGroups } from '../../../library/core/home/localHomeModel';
import { applyLocalCollectionCoverOverrides } from '../../../library/core/collection/cover/localCollectionCover';
import { localCollectionCovers } from '../../../library/core/collection/cover/localCollectionCovers.service';
import { getLocalCoverAssetUrl } from '../../../services/localCoverAssetUrl';
import { buildLocalLibraryIndex, followEntityRedirect } from '../../../utils/localLibraryIndex';
import { createLocalGridViewCollection } from '../home/gridViewCollectionAdapters';

// src/components/app/search/localSearchCollections.ts
// 搜索页「本地」来源的专辑、歌单从哪来：与首页本地页签同一套分组（buildLocalHomeGroups）、同样换上自定义封面，
// 打开时就是同一张集合页。专辑另外带上专辑歌手（按歌手名也能搜到，结果行有副标题）。
// 分组到第一次搜本地专辑或歌单时才算，同一份曲库数据只算一次。

/** 曲库目录读好之前 ready 是 false：那时按歌曲的原始标签分组，和首页一样。 */
type LocalSearchCatalog = LocalLibraryDisplayCatalog & { ready?: boolean };

/**
 * 每首歌的歌手（跟随合并后的歌手实体），一次建好给所有专辑用。
 * 与 gridViewCollectionAdapters 的 resolveLocalAlbumArtists 同一口径；那个一张专辑扫一遍全部归属，这里要算整个曲库。
 */
const buildSongArtists = (catalog: LocalLibraryDisplayCatalog): Map<string, ProviderArtistSummary[]> => {
    const index = buildLocalLibraryIndex(catalog.entities, catalog.assignments);
    const songArtists = new Map<string, ProviderArtistSummary[]>();
    catalog.assignments.forEach(assignment => {
        const artists: ProviderArtistSummary[] = [];
        assignment.artistEntityIds.forEach(artistEntityId => {
            const activeArtistId = followEntityRedirect(artistEntityId, index.entitiesById);
            const artistEntity = activeArtistId ? index.entitiesById.get(activeArtistId) : undefined;
            if (!artistEntity || artistEntity.kind !== 'artist') return;
            artists.push({ id: artistEntity.id, entityId: artistEntity.id, name: artistEntity.displayName });
        });
        if (artists.length) songArtists.set(assignment.songId, artists);
    });
    return songArtists;
};

const albumArtistsOf = (songIds: string[], songArtists: Map<string, ProviderArtistSummary[]>) => {
    const seen = new Set<string>();
    const artists: ProviderArtistSummary[] = [];
    songIds.forEach(songId => songArtists.get(songId)?.forEach(artist => {
        const key = String(artist.id);
        if (seen.has(key)) return;
        seen.add(key);
        artists.push(artist);
    }));
    return artists;
};

/** 给搜索登记的读取函数（setLocalSearchCollectionsReader）：读本地专辑或歌单的集合描述。 */
export const createLocalSearchCollectionsReader = ({
    localSongs,
    localPlaylists,
    catalog,
    t,
}: {
    localSongs: LocalSong[];
    localPlaylists: LocalPlaylist[];
    catalog: LocalSearchCatalog;
    t: TFunction;
}) => {
    const catalogReady = catalog.ready !== false;
    let groups: LocalHomeGroups | null = null;
    let songArtists: Map<string, ProviderArtistSummary[]> | null = null;
    // 自定义封面可能在两次搜索之间换过：快照换了才重新套一遍。
    let albums: { overrides: ReadonlyMap<string, string>; list: LocalGridViewCollectionDescriptor[] } | null = null;
    return (kind: 'album' | 'playlist'): LocalGridViewCollectionDescriptor[] => {
        groups ??= buildLocalHomeGroups(
            localSongs,
            localPlaylists,
            t,
            catalogReady ? { entities: catalog.entities, assignments: catalog.assignments } : undefined,
            getLocalCoverAssetUrl,
        );
        const overrides = localCollectionCovers.getSnapshot();
        if (kind === 'playlist') {
            return applyLocalCollectionCoverOverrides(groups.playlists, overrides).map(createLocalGridViewCollection);
        }
        if (albums?.overrides !== overrides) {
            if (catalogReady) songArtists ??= buildSongArtists(catalog);
            const artistsBySong = songArtists;
            albums = {
                overrides,
                list: applyLocalCollectionCoverOverrides(groups.albums, overrides).map(group => {
                    const descriptor = createLocalGridViewCollection(group);
                    const artists = artistsBySong ? albumArtistsOf(descriptor.songIds, artistsBySong) : [];
                    return artists.length ? { ...descriptor, artists } : descriptor;
                }),
            };
        }
        return albums.list;
    };
};
