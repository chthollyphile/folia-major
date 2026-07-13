import type { Dispatch, SetStateAction } from 'react';
import type { HomeViewTab, LocalLibraryGroup, LocalSong, SongResult } from '../../../types';
import { isLocalPlaybackSong } from '../../../utils/appPlaybackGuards';
import type { LocalLibraryCatalogSnapshot } from '../../../hooks/useLocalLibraryCatalog';
import type { LocalLibraryEntity } from '../../../types/localLibrary';
import { normalizeLocalLibraryName } from '../../../utils/localLibraryNames';
import { buildLocalLibraryIndex, followEntityRedirect } from '../../../utils/localLibraryIndex';

// src/components/app/navigation/createLocalLibraryNavigation.ts

type LocalMusicState = {
    activeRow: 0 | 1 | 2 | 3;
    selectedGroup: LocalLibraryGroup | null;
    detailStack: LocalLibraryGroup[];
    detailOriginView: 'home' | 'player' | null;
    focusedFolderIndex: number;
    focusedAlbumIndex: number;
    focusedArtistIndex: number;
    focusedPlaylistIndex: number;
};

type CreateLocalLibraryNavigationParams = {
    currentView: string;
    currentSong: SongResult | null;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryCatalogSnapshot;
    setHomeViewTab: (tab: HomeViewTab) => void;
    setLocalMusicState: Dispatch<SetStateAction<LocalMusicState>>;
    navigateDirectHome: (options?: { clearContext?: boolean }) => void;
};

// Creates local library navigation helpers for album and artist drill-in flows.
export const createLocalLibraryNavigation = ({
    currentView,
    currentSong,
    localSongs,
    localLibraryCatalog,
    setHomeViewTab,
    setLocalMusicState,
    navigateDirectHome,
    t,
}: CreateLocalLibraryNavigationParams & {
    t: (key: string) => string;
}) => {
    const catalogIndex = buildLocalLibraryIndex(
        localLibraryCatalog.entities,
        localLibraryCatalog.assignments,
    );
    const openLocalLibraryGroup = (group: LocalLibraryGroup, row: 0 | 1 | 2 | 3) => {
        setHomeViewTab('local');
        setLocalMusicState(prev => ({
            ...prev,
            activeRow: row,
            selectedGroup: group,
            detailStack: prev.selectedGroup && prev.selectedGroup.id !== group.id
                ? [...prev.detailStack, prev.selectedGroup]
                : prev.selectedGroup
                    ? prev.detailStack
                    : [],
            detailOriginView: prev.selectedGroup
                ? prev.detailOriginView
                : (currentView === 'player' ? 'player' : null),
        }));
        navigateDirectHome({ clearContext: false });
    };

    const getEntitySongs = (entity: LocalLibraryEntity) => {
        const memberIds = new Set(localLibraryCatalog.assignments
            .filter(assignment => entity.kind === 'artist'
                ? assignment.artistEntityIds.includes(entity.id)
                : assignment.albumEntityId === entity.id)
            .map(assignment => assignment.songId));
        return localSongs.filter(song => memberIds.has(song.id));
    };

    const openEntity = (entity: LocalLibraryEntity) => {
        const songs = getEntitySongs(entity);
        if (songs.length === 0) return;
        openLocalLibraryGroup({
            type: entity.kind,
            id: entity.id,
            entityId: entity.id,
            name: entity.displayName,
            songs,
            coverUrl: songs.find(song => song.matchedCoverUrl)?.matchedCoverUrl,
            description: `${songs.length} ${t('home.songs')}`,
        }, entity.kind === 'album' ? 1 : 2);
    };

    const findEntityByName = (kind: LocalLibraryEntity['kind'], name: string) => {
        const normalizedName = normalizeLocalLibraryName(name);
        const matches = localLibraryCatalog.entities.filter(entity => (
            entity.kind === kind &&
            !entity.mergedInto &&
            entity.normalizedAliases.includes(normalizedName)
        ));
        return matches.length === 1 ? matches[0] : undefined;
    };

    const openCurrentLocalAlbum = () => {
        if (!isLocalPlaybackSong(currentSong) || !currentSong.localData) {
            return;
        }

        const assignment = localLibraryCatalog.assignments.find(item => item.songId === currentSong.localData?.id);
        const entityId = assignment?.albumEntityId
            ? followEntityRedirect(assignment.albumEntityId, catalogIndex.entitiesById)
            : undefined;
        const entity = entityId ? catalogIndex.entitiesById.get(entityId) : undefined;
        if (entity) openEntity(entity);
    };

    const openCurrentLocalArtist = () => {
        if (!isLocalPlaybackSong(currentSong) || !currentSong.localData) {
            return;
        }

        const assignment = localLibraryCatalog.assignments.find(item => item.songId === currentSong.localData?.id);
        const entityId = assignment?.artistEntityIds[0]
            ? followEntityRedirect(assignment.artistEntityIds[0], catalogIndex.entitiesById)
            : undefined;
        const entity = entityId ? catalogIndex.entitiesById.get(entityId) : undefined;
        if (entity) openEntity(entity);
    };

    const openLocalAlbumByName = (albumName: string) => {
        const entity = albumName && findEntityByName('album', albumName);
        if (entity) openEntity(entity);
    };

    const openLocalArtistByName = (artistName: string) => {
        const entity = artistName && findEntityByName('artist', artistName);
        if (entity) openEntity(entity);
    };

    return {
        openCurrentLocalAlbum,
        openCurrentLocalArtist,
        openLocalAlbumByName,
        openLocalArtistByName,
    };
};
