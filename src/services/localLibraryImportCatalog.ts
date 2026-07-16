import type { LocalSong } from '../types';
import type { LocalLibraryAssignment } from '../types/localLibrary';
import {
  getAlbumImportContextKey,
  getImportedAlbumName,
  getImportedArtistNames,
  normalizeLocalLibraryName,
} from '../utils/localLibraryNames';
import { appDatabase } from './appDatabase';
import { resolveEntityNames } from './localLibraryCatalogInternals';
import { sanitizeLocalSongForStorage } from './repositories/localSongRepository';

// src/services/localLibraryImportCatalog.ts
// Handles import/rescan assignment and the idempotent legacy bootstrap transaction.

const assignImportedSongsInTransaction = async (
  songs: LocalSong[],
  preserveNonImportAssignments: boolean,
): Promise<void> => {
  if (songs.length === 0) return;
  const [entities, assignments, allSongs] = await Promise.all([
    appDatabase.local_library_entities.toArray(),
    appDatabase.local_library_assignments.toArray(),
    appDatabase.local_music.toArray(),
  ]);
  const assignmentBySongId = new Map(assignments.map(assignment => [assignment.songId, assignment]));
  const songById = new Map([...allSongs, ...songs].map(song => [song.id, song]));
  const albumContext = new Map<string, string>();

  assignments.forEach(assignment => {
    if (!assignment.albumEntityId) return;
    const song = songById.get(assignment.songId);
    const albumName = song && getImportedAlbumName(song);
    if (song && albumName) albumContext.set(getAlbumImportContextKey(song, albumName), assignment.albumEntityId);
  });

  const nextAssignments: LocalLibraryAssignment[] = [];
  songs.forEach(song => {
    const current = assignmentBySongId.get(song.id);
    const preserveArtist = Boolean(preserveNonImportAssignments && current && current.artistOrigin !== 'import');
    const preserveAlbum = Boolean(preserveNonImportAssignments && current && current.albumOrigin !== 'import');
    const albumName = getImportedAlbumName(song);
    let albumId = preserveAlbum ? current?.albumEntityId : undefined;
    if (!preserveAlbum && albumName) {
      const contextKey = getAlbumImportContextKey(song, albumName);
      const normalizedArtistNames = new Set(getImportedArtistNames(song).map(normalizeLocalLibraryName));
      const artistOverlapAlbumIds = assignments.flatMap(assignment => {
        if (!assignment.albumEntityId) return [];
        const overlaps = assignment.artistEntityIds.some(entityId => {
          const entity = entities.find(item => item.id === entityId);
          return entity?.normalizedAliases.some(alias => normalizedArtistNames.has(alias));
        });
        return overlaps ? [assignment.albumEntityId] : [];
      });
      const uniqueOverlapAlbumIds = Array.from(new Set(artistOverlapAlbumIds));
      const preferredId = albumContext.get(contextKey)
        || current?.albumEntityId
        || (uniqueOverlapAlbumIds.length === 1 ? uniqueOverlapAlbumIds[0] : undefined);
      albumId = resolveEntityNames(entities, 'album', [albumName], preferredId ? [preferredId] : [])[0];
      if (albumId) albumContext.set(contextKey, albumId);
    }
    const albumArtistContext = albumId
      ? [...assignments, ...nextAssignments]
          .filter(assignment => assignment.albumEntityId === albumId)
          .flatMap(assignment => assignment.artistEntityIds)
      : [];
    const artistIds = preserveArtist
      ? current?.artistEntityIds || []
      : resolveEntityNames(
          entities,
          'artist',
          getImportedArtistNames(song),
          current?.artistEntityIds.length ? current.artistEntityIds : albumArtistContext,
        );
    nextAssignments.push({
      songId: song.id,
      artistEntityIds: artistIds,
      artistOrigin: preserveArtist ? current?.artistOrigin || 'import' : 'import',
      albumEntityId: albumId,
      albumOrigin: preserveAlbum ? current?.albumOrigin || 'import' : 'import',
      updatedAt: Date.now(),
    });
  });

  await Promise.all([
    appDatabase.local_music.bulkPut(songs.map(sanitizeLocalSongForStorage)),
    appDatabase.local_library_entities.bulkPut(entities),
    appDatabase.local_library_assignments.bulkPut(nextAssignments),
  ]);
};

export const assignImportedSongs = async (
  songs: LocalSong[],
  options: { preserveNonImportAssignments?: boolean } = {},
): Promise<void> => {
  await appDatabase.transaction(
    'rw',
    [appDatabase.local_music, appDatabase.local_library_entities, appDatabase.local_library_assignments],
    () => assignImportedSongsInTransaction(songs, options.preserveNonImportAssignments ?? true),
  );
};

// Repairs only genuinely missing assignments; the v0.8 upgrade owns legacy conversion.
export const ensureLocalLibraryInitialized = async (): Promise<void> => {
  const [songs, assignments] = await Promise.all([
    appDatabase.local_music.toArray(),
    appDatabase.local_library_assignments.toArray(),
  ]);
  const assignedIds = new Set(assignments.map(assignment => assignment.songId));
  const missing = songs.filter(song => !assignedIds.has(song.id));
  if (missing.length > 0) await assignImportedSongs(missing, { preserveNonImportAssignments: false });
};
