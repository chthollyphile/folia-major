import type { LocalSong } from '../types';
import type {
  LocalLibraryAssignment,
  LocalLibraryAssignmentOrigin,
  LocalLibraryEntity,
  LocalSongMetadataSource,
} from '../types/localLibrary';
import { buildLocalLibraryIndex, followEntityRedirect } from '../utils/localLibraryIndex';
import {
  cleanLocalLibraryName,
  getImportedAlbumName,
  getImportedArtistNames,
  splitLocalLibraryArtistNames,
} from '../utils/localLibraryNames';
import { appDatabase } from './appDatabase';
import { createLocalLibraryAssignment, resolveEntityNames } from './localLibraryCatalogInternals';
import { assignImportedSongs } from './localLibraryImportCatalog';
import { sanitizeLocalSongForStorage } from './repositories/localSongRepository';

// src/services/localLibraryCatalogService.ts
// Applies every song/entity/assignment mutation in a single Dexie transaction.

export { assignImportedSongs, ensureLocalLibraryInitialized } from './localLibraryImportCatalog';
export {
  mergeEntities,
  moveEntityMembersToExistingEntity,
  setEntityDisplayName,
  splitArtistEntityToTargets,
  splitEntity,
} from './localLibraryEntityMutations';

export interface MatchedLocalMetadata {
  source?: LocalSongMetadataSource;
  title?: string;
  artists?: Array<{ id?: number | string; name: string }>;
  album?: { id?: number | string; name: string };
  songId?: number | string;
  coverUrl?: string;
}

export const applyMatchedMetadata = async (
  songId: string,
  metadata: MatchedLocalMetadata,
  options: {
    lyricsOnly?: boolean;
    songPatch?: Partial<LocalSong>;
    protectOrigins?: LocalLibraryAssignmentOrigin[];
    assignmentOrigin?: Extract<LocalLibraryAssignmentOrigin, 'auto-match' | 'manual-match'>;
  } = {},
): Promise<LocalSong | undefined> => {
  return await appDatabase.transaction(
    'rw',
    [appDatabase.local_music, appDatabase.local_library_entities, appDatabase.local_library_assignments],
    async () => {
      const song = await appDatabase.local_music.get(songId);
      if (!song) return undefined;
      const updatedSong: LocalSong = { ...song, ...options.songPatch };
      const assignmentOrigin = options.assignmentOrigin || 'auto-match';
      if (metadata.source) {
        updatedSong.onlineMetadata = {
          source: metadata.source,
          songId: metadata.songId,
          albumId: metadata.album?.id,
          title: cleanLocalLibraryName(metadata.title),
          artists: metadata.artists?.filter(artist => cleanLocalLibraryName(artist.name)) || [],
          album: cleanLocalLibraryName(metadata.album?.name)
            ? { id: metadata.album?.id, name: cleanLocalLibraryName(metadata.album?.name)! }
            : undefined,
          coverUrl: metadata.coverUrl,
          matchMode: assignmentOrigin === 'manual-match' ? 'manual' : 'auto',
          matchedAt: Date.now(),
        };
      }
      if (!options.lyricsOnly) {
        const entities = await appDatabase.local_library_entities.toArray();
        const current = await appDatabase.local_library_assignments.get(songId);
        const protectedOrigins = new Set(options.protectOrigins || []);
        const hasArtistMetadata = metadata.artists !== undefined
          && !Boolean(current && protectedOrigins.has(current.artistOrigin));
        const artists = metadata.artists?.filter(artist => cleanLocalLibraryName(artist.name)) || [];
        const artistIds = hasArtistMetadata
          ? resolveEntityNames(entities, 'artist', artists.map(artist => artist.name), current?.artistEntityIds)
          : current?.artistEntityIds || [];
        const hasAlbumMetadata = Boolean(cleanLocalLibraryName(metadata.album?.name))
          && !Boolean(current && protectedOrigins.has(current.albumOrigin));
        const albumName = hasAlbumMetadata ? cleanLocalLibraryName(metadata.album?.name) : undefined;
        const albumId = albumName
          ? resolveEntityNames(entities, 'album', [albumName], current?.albumEntityId ? [current.albumEntityId] : [])[0]
          : current?.albumEntityId;
        if (metadata.title?.trim()) {
          updatedSong.title = metadata.title.trim();
          updatedSong.titleOrigin = assignmentOrigin;
        }
        await Promise.all([
          appDatabase.local_library_entities.bulkPut(entities),
          appDatabase.local_library_assignments.put({
            songId,
            artistEntityIds: artistIds,
            artistOrigin: hasArtistMetadata ? assignmentOrigin : current?.artistOrigin || 'import',
            albumEntityId: albumId,
            albumOrigin: hasAlbumMetadata ? assignmentOrigin : current?.albumOrigin || 'import',
            updatedAt: Date.now(),
          }),
        ]);
      }
      await appDatabase.local_music.put(sanitizeLocalSongForStorage(updatedSong));
      return updatedSong;
    },
  );
};

export const applyManualMetadata = async (
  songId: string,
  artistNames: string[],
  albumName?: string,
): Promise<LocalSong | undefined> => {
  return await appDatabase.transaction(
    'rw',
    [appDatabase.local_music, appDatabase.local_library_entities, appDatabase.local_library_assignments],
    async () => {
      const song = await appDatabase.local_music.get(songId);
      if (!song) return undefined;
      const entities = await appDatabase.local_library_entities.toArray();
      const current = await appDatabase.local_library_assignments.get(songId);
      const cleanedArtists = artistNames.flatMap(splitLocalLibraryArtistNames);
      const cleanedAlbum = cleanLocalLibraryName(albumName);
      const artistIds = resolveEntityNames(entities, 'artist', cleanedArtists, current?.artistEntityIds);
      const albumId = cleanedAlbum
        ? resolveEntityNames(entities, 'album', [cleanedAlbum], current?.albumEntityId ? [current.albumEntityId] : [])[0]
        : undefined;
      await Promise.all([
        appDatabase.local_library_entities.bulkPut(entities),
        appDatabase.local_library_assignments.put(createLocalLibraryAssignment(songId, artistIds, albumId, 'manual')),
      ]);
      return song;
    },
  );
};

export const restoreImportedMetadata = async (
  songId: string,
  songPatch: Partial<LocalSong> = {},
): Promise<LocalSong | undefined> => appDatabase.transaction(
  'rw',
  [appDatabase.local_music, appDatabase.local_library_entities, appDatabase.local_library_assignments],
  async () => {
    const song = await appDatabase.local_music.get(songId);
    if (!song) return undefined;
    const restored: LocalSong = {
      ...song,
      ...songPatch,
      title: song.importedMetadata.title,
      titleOrigin: 'import',
    };
    const entities = await appDatabase.local_library_entities.toArray();
    const current = await appDatabase.local_library_assignments.get(songId);
    const artistEntityIds = resolveEntityNames(
      entities,
      'artist',
      getImportedArtistNames(restored),
      current?.artistEntityIds,
    );
    const albumName = getImportedAlbumName(restored);
    const albumEntityId = albumName
      ? resolveEntityNames(entities, 'album', [albumName], current?.albumEntityId ? [current.albumEntityId] : [])[0]
      : undefined;
    await Promise.all([
      appDatabase.local_music.put(sanitizeLocalSongForStorage(restored)),
      appDatabase.local_library_entities.bulkPut(entities),
      appDatabase.local_library_assignments.put(createLocalLibraryAssignment(
        songId,
        artistEntityIds,
        albumEntityId,
        'import',
      )),
    ]);
    return restored;
  },
);

const getAssignmentEntityIds = (assignment: LocalLibraryAssignment): string[] => [
  ...assignment.artistEntityIds,
  ...(assignment.albumEntityId ? [assignment.albumEntityId] : []),
];

const collectOrphanedEntityIds = (
  deletedAssignments: LocalLibraryAssignment[],
  remainingAssignments: LocalLibraryAssignment[],
  entities: LocalLibraryEntity[],
): string[] => {
  const { entitiesById } = buildLocalLibraryIndex(entities);
  const resolveEntityId = (entityId: string) => followEntityRedirect(entityId, entitiesById) || entityId;
  const affectedEntityIds = new Set(
    deletedAssignments.flatMap(getAssignmentEntityIds).map(resolveEntityId),
  );
  const referencedEntityIds = new Set(
    remainingAssignments.flatMap(getAssignmentEntityIds).map(resolveEntityId),
  );

  return entities
    .filter(entity => {
      const resolvedId = resolveEntityId(entity.id);
      return affectedEntityIds.has(resolvedId) && !referencedEntityIds.has(resolvedId);
    })
    .map(entity => entity.id);
};

// Deletes songs and assignments atomically, then removes only entity families with no remaining members.
const deleteSongRecords = async (songIds: string[]): Promise<void> => {
  const uniqueSongIds = Array.from(new Set(songIds));
  if (uniqueSongIds.length === 0) return;

  await appDatabase.transaction(
    'rw',
    [appDatabase.local_music, appDatabase.local_library_entities, appDatabase.local_library_assignments],
    async () => {
      const deletedSongIdSet = new Set(uniqueSongIds);
      const [deletedAssignments, assignments, entities] = await Promise.all([
        appDatabase.local_library_assignments.bulkGet(uniqueSongIds),
        appDatabase.local_library_assignments.toArray(),
        appDatabase.local_library_entities.toArray(),
      ]);
      const orphanedEntityIds = collectOrphanedEntityIds(
        deletedAssignments.filter((assignment): assignment is LocalLibraryAssignment => Boolean(assignment)),
        assignments.filter(assignment => !deletedSongIdSet.has(assignment.songId)),
        entities,
      );

      await Promise.all([
        appDatabase.local_music.bulkDelete(uniqueSongIds),
        appDatabase.local_library_assignments.bulkDelete(uniqueSongIds),
        appDatabase.local_library_entities.bulkDelete(orphanedEntityIds),
      ]);
    },
  );
};

export const deleteSongAssignment = async (songId: string): Promise<void> => deleteSongRecords([songId]);

export const deleteSongAssignments = async (songIds: string[]): Promise<void> => deleteSongRecords(songIds);
