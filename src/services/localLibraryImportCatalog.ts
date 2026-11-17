import type { LocalSong } from '../types';
import { computeImportedAssignments } from '../utils/localLibraryImportAssignment';
import { appDatabase } from './appDatabase';
import { createLocalLibraryEntityId } from './localLibraryCatalogInternals';
import { prefetchImportAssignmentLookup } from './localLibraryImportLookup';
import { sanitizeLocalSongForStorage } from './repositories/localSongRepository';
import { isBlob } from '../utils/blobGuards';
import {
  deleteUnreferencedLocalCoverAssets,
  prepareLocalSongsCoverAssets,
} from './localCoverAssetService';

// src/services/localLibraryImportCatalog.ts
// Handles import/rescan assignment and the idempotent legacy bootstrap transaction.

// Reads only what this batch needs (by index, inside the caller's transaction), applies the shared rules
// in memory, and writes this batch's songs, its assignments and the entities it created.
const assignImportedSongsInTransaction = async (
  songs: LocalSong[],
  preserveNonImportAssignments: boolean,
): Promise<string[]> => {
  if (songs.length === 0) return [];
  const existingRows = await appDatabase.local_music.bulkGet(songs.map(song => song.id));
  const existingSongById = new Map(existingRows.flatMap(song => (song ? [[song.id, song] as const] : [])));
  const replacedCoverAssetIds = songs.flatMap(song => {
    const previousAssetId = existingSongById.get(song.id)?.localCoverAssetId;
    return previousAssetId && previousAssetId !== song.localCoverAssetId ? [previousAssetId] : [];
  });
  const lookup = await prefetchImportAssignmentLookup(songs, preserveNonImportAssignments);
  const { assignments, created } = computeImportedAssignments(
    songs,
    lookup,
    preserveNonImportAssignments,
    createLocalLibraryEntityId,
  );

  const songsForStorage = songs.map(song => {
    const persisted = sanitizeLocalSongForStorage(song);
    const existing = existingSongById.get(song.id) as (LocalSong & { embeddedCover?: unknown }) | undefined;
    return isBlob(existing?.embeddedCover) && (!song.localCoverAssetId || song.localCoverNeedsAssetMigration)
      ? { ...persisted, embeddedCover: existing.embeddedCover }
      : persisted;
  });

  await Promise.all([
    appDatabase.local_music.bulkPut(songsForStorage),
    created.length > 0 ? appDatabase.local_library_entities.bulkPut(created) : Promise.resolve(),
    appDatabase.local_library_assignments.bulkPut(assignments),
  ]);
  return replacedCoverAssetIds;
};

export const assignImportedSongs = async (
  songs: LocalSong[],
  options: { preserveNonImportAssignments?: boolean } = {},
): Promise<void> => {
  const songsWithValidatedCovers = await prepareLocalSongsCoverAssets(songs);
  let replacedCoverAssetIds: string[];
  try {
    replacedCoverAssetIds = await appDatabase.transaction(
      'rw',
      [
        appDatabase.local_music,
        appDatabase.local_library_entities,
        appDatabase.local_library_assignments,
        appDatabase.local_cover_assets,
      ],
      () => assignImportedSongsInTransaction(songsWithValidatedCovers, options.preserveNonImportAssignments ?? true),
    );
  } catch (error) {
    await deleteUnreferencedLocalCoverAssets(songsWithValidatedCovers.flatMap(song => (
      song.localCoverAssetId ? [song.localCoverAssetId] : []
    )));
    throw error;
  }
  await deleteUnreferencedLocalCoverAssets(replacedCoverAssetIds);
};

// Repairs only genuinely missing assignments; the v0.8 upgrade owns legacy conversion.
// Compares primary keys only, so a library with every song assigned costs no record reads.
export const ensureLocalLibraryInitialized = async (): Promise<void> => {
  const [songIds, assignedSongIds] = await Promise.all([
    appDatabase.local_music.toCollection().primaryKeys(),
    appDatabase.local_library_assignments.toCollection().primaryKeys(),
  ]);
  const assigned = new Set(assignedSongIds);
  const missingIds = songIds.filter(songId => !assigned.has(songId));
  if (missingIds.length === 0) return;
  const missing = (await appDatabase.local_music.bulkGet(missingIds)).filter((song): song is LocalSong => Boolean(song));
  if (missing.length > 0) await assignImportedSongs(missing, { preserveNonImportAssignments: false });
};
