import type { HomeViewTab, LocalLibraryGroup, LocalSong, SongResult } from '../../../types';
import { isLocalPlaybackSong } from '../../../utils/appPlaybackGuards';
import type { LocalLibraryCatalogSnapshot } from '../../../hooks/useLocalLibraryCatalog';
import type { LocalLibraryEntity } from '../../../types/localLibrary';
import { normalizeLocalLibraryName } from '../../../utils/localLibraryNames';
import { buildLocalLibraryIndex, followEntityRedirect } from '../../../utils/localLibraryIndex';
import {
    createLocalGridViewCollection,
    type GridViewCollectionDescriptor,
} from '../home/gridViewCollectionAdapters';

// src/components/app/navigation/createLocalLibraryNavigation.ts

type CreateLocalLibraryNavigationParams = {
    currentSong: SongResult | null;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryCatalogSnapshot;
    setHomeViewTab: (tab: HomeViewTab) => void;
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
};

// Creates local library navigation helpers for album and artist drill-in flows.
export const createLocalLibraryNavigation = ({
    currentSong,
    localSongs,
    localLibraryCatalog,
    setHomeViewTab,
    onOpenCollection,
    t,
}: CreateLocalLibraryNavigationParams & {
    t: (key: string) => string;
}) => {
    const catalogIndex = buildLocalLibraryIndex(
        localLibraryCatalog.entities,
        localLibraryCatalog.assignments,
    );
    const getEntitySongs = (entity: LocalLibraryEntity) => {
        const memberIds = new Set(localLibraryCatalog.assignments
            .filter(assignment => entity.kind === 'artist'
                ? assignment.artistEntityIds.some(entityId => (
                    followEntityRedirect(entityId, catalogIndex.entitiesById) === entity.id
                ))
                : Boolean(assignment.albumEntityId && (
                    followEntityRedirect(assignment.albumEntityId, catalogIndex.entitiesById) === entity.id
                )))
            .map(assignment => assignment.songId));
        return localSongs.filter(song => memberIds.has(song.id));
    };

    const openEntity = (entity: LocalLibraryEntity) => {
        const songs = getEntitySongs(entity);
        if (songs.length === 0) return;
        const group: LocalLibraryGroup = {
            type: entity.kind,
            id: entity.id,
            entityId: entity.id,
            name: entity.displayName,
            songs,
            coverUrl: songs.find(song => song.onlineMetadata?.coverUrl)?.onlineMetadata?.coverUrl,
            description: `${songs.length} ${t('home.songs')}`,
        };
        setHomeViewTab('local');
        onOpenCollection(createLocalGridViewCollection(group));
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

    const findEntityById = (kind: LocalLibraryEntity['kind'], entityId?: string) => {
        const activeEntityId = entityId
            ? followEntityRedirect(entityId, catalogIndex.entitiesById)
            : undefined;
        const entity = activeEntityId ? catalogIndex.entitiesById.get(activeEntityId) : undefined;
        return entity?.kind === kind ? entity : undefined;
    };

    // Resolves a clicked search-result artist inside that song's own assignments.
    const findAssignedArtist = (songId: string | undefined, artistName: string) => {
        if (!songId) return undefined;
        const assignment = catalogIndex.assignmentsBySongId.get(songId);
        const normalizedName = normalizeLocalLibraryName(artistName);
        const matches = assignment?.artistEntityIds.flatMap(entityId => {
            const entity = findEntityById('artist', entityId);
            return entity?.normalizedAliases.includes(normalizedName) ? [entity] : [];
        }) || [];
        return matches.length === 1 ? matches[0] : undefined;
    };

    const openCurrentLocalAlbum = () => {
        if (!isLocalPlaybackSong(currentSong)) {
            return;
        }

        const assignment = localLibraryCatalog.assignments.find(item => item.songId === currentSong.localRef.songId);
        const entityId = assignment?.albumEntityId
            ? followEntityRedirect(assignment.albumEntityId, catalogIndex.entitiesById)
            : undefined;
        const entity = entityId ? catalogIndex.entitiesById.get(entityId) : undefined;
        if (entity) openEntity(entity);
    };

    const openCurrentLocalArtist = (requestedEntityId?: string) => {
        if (!isLocalPlaybackSong(currentSong)) {
            return;
        }

        const assignment = localLibraryCatalog.assignments.find(item => item.songId === currentSong.localRef.songId);
        const sourceEntityId = requestedEntityId || assignment?.artistEntityIds[0];
        const entityId = sourceEntityId
            ? followEntityRedirect(sourceEntityId, catalogIndex.entitiesById)
            : undefined;
        const entity = entityId ? catalogIndex.entitiesById.get(entityId) : undefined;
        if (entity) openEntity(entity);
    };

    const openLocalAlbumByName = (albumName: string, songId?: string, requestedEntityId?: string) => {
        const assignment = songId ? catalogIndex.assignmentsBySongId.get(songId) : undefined;
        const entity = findEntityById('album', requestedEntityId)
            || findEntityById('album', assignment?.albumEntityId)
            || (albumName ? findEntityByName('album', albumName) : undefined);
        if (entity) openEntity(entity);
    };

    const openLocalArtistByName = (artistName: string, songId?: string, requestedEntityId?: string) => {
        const entity = findEntityById('artist', requestedEntityId)
            || findAssignedArtist(songId, artistName)
            || (artistName ? findEntityByName('artist', artistName) : undefined);
        if (entity) openEntity(entity);
    };

    return {
        openCurrentLocalAlbum,
        openCurrentLocalArtist,
        openLocalAlbumByName,
        openLocalArtistByName,
    };
};
