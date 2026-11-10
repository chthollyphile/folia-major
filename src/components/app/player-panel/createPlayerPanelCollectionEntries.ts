import type { TFunction } from 'i18next';
import type { LocalSong, SongResult } from '../../../types';
import type { LocalLibraryCatalogSnapshot } from '../../../hooks/useLocalLibraryCatalog';
import type { CollectionNavigationOrigin } from '../../../stores/useCollectionNavigationStore';
import type { GridViewCollectionDescriptor } from '../home/gridViewCollectionAdapters';
import {
    buildLocalCatalogIndex,
    resolveLocalCatalogLink,
    resolveLocalSongEntityId,
} from '../../../library/core/shared/localCatalogLinks';
import { isLocalPlaybackSong } from '../../../utils/appPlaybackGuards';
import { getSongAlbumLabel, getSongArtistLabel, getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';

// src/components/app/player-panel/createPlayerPanelCollectionEntries.ts
//
// The four "open what is playing in the grid" entries behind the player panel's title, artist and
// album. They lived inline in App.tsx as ~140 lines of closure inside the model's argument list,
// which is the one place in the app where nobody would look for them.

type PlayerPanelCollectionEntriesParams = {
    currentSong: SongResult | null;
    /** The displayed song, which during a blend is the held one - covers and labels must match it. */
    displaySong: SongResult | null;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryCatalogSnapshot;
    navigateToCollection: (
        collection: GridViewCollectionDescriptor,
        origin: CollectionNavigationOrigin,
    ) => void;
    t: TFunction;
};

export type PlayerPanelCollectionEntries = {
    openCurrentLocalAlbum: () => void;
    openCurrentLocalArtist: (requestedEntityId?: string) => void;
    openCurrentNavidromeAlbum: () => void;
    openCurrentNavidromeArtist: () => void;
};

export const createPlayerPanelCollectionEntries = ({
    currentSong,
    displaySong,
    localSongs,
    localLibraryCatalog,
    navigateToCollection,
    t,
}: PlayerPanelCollectionEntriesParams): PlayerPanelCollectionEntries => {
    // 当前这首本地歌归属的专辑 / 歌手：解析规则与宿主的嵌套打开、歌手页同一份（core/shared/localCatalogLinks）。
    const resolveCurrentLocalLink = (kind: 'album' | 'artist', requestedEntityId?: string) => {
        if (!currentSong || !isLocalPlaybackSong(currentSong)) return null;
        const catalogIndex = buildLocalCatalogIndex(localLibraryCatalog);
        const entityId = requestedEntityId || resolveLocalSongEntityId(catalogIndex, currentSong.localRef.songId, kind);
        const link = resolveLocalCatalogLink(localLibraryCatalog, localSongs, { kind, entityId }, catalogIndex);
        return link && link.songs.length > 0 ? link : null;
    };

    const openCurrentLocalAlbum = () => {
        const link = resolveCurrentLocalLink('album');
        if (!link) return;
        navigateToCollection({
            source: 'local',
            id: link.entity.id,
            entityId: link.entity.id,
            name: link.entity.displayName,
            type: 'album',
            coverUrl: getSongCoverUrl(displaySong),
            description: getSongArtistLabel(displaySong),
            trackCount: link.songs.length,
            songIds: link.songs.map(song => song.id),
        }, 'player');
    };

    const openCurrentLocalArtist = (requestedEntityId?: string) => {
        const link = resolveCurrentLocalLink('artist', requestedEntityId);
        if (!link) return;
        navigateToCollection({
            source: 'local',
            id: link.entity.id,
            entityId: link.entity.id,
            name: link.entity.displayName,
            type: 'artist',
            coverUrl: getSongCoverUrl(currentSong),
            description: `${link.songs.length} ${t('home.songs')}`,
            trackCount: link.songs.length,
            songIds: link.songs.map(song => song.id),
        }, 'player');
    };

    const openCurrentNavidromeAlbum = () => {
        const currentNavidromeSong = (currentSong as any)?.navidromeData;
        const playbackCarrier = currentNavidromeSong?.navidromeData;
        const albumId = currentNavidromeSong?.albumId || playbackCarrier?.albumId;
        if (albumId) {
            const albumName = getSongAlbumLabel(currentSong) || t('localMusic.unknownAlbum');
            navigateToCollection({
                source: 'navidrome',
                id: albumId,
                name: albumName,
                type: 'album',
                coverUrl: getSongCoverUrl(currentSong),
            }, 'player');
        }
    };

    const openCurrentNavidromeArtist = () => {
        const currentNavidromeSong = (currentSong as any)?.navidromeData;
        const playbackCarrier = currentNavidromeSong?.navidromeData;
        const artistId = currentNavidromeSong?.artistId || playbackCarrier?.artistId;
        if (artistId) {
            const artistName = getSongArtistLabel(currentSong).split(',')[0]?.trim() || t('localMusic.unknownArtist');
            navigateToCollection({
                source: 'navidrome',
                id: artistId,
                name: artistName,
                type: 'artist',
                coverUrl: getSongCoverUrl(currentSong),
            }, 'player');
        }
    };

    return {
        openCurrentLocalAlbum,
        openCurrentLocalArtist,
        openCurrentNavidromeAlbum,
        openCurrentNavidromeArtist,
    };
};
