import type { LocalSong } from '../types';
import { cleanLocalLibraryName } from '../utils/localLibraryNames';
import { appDatabase } from './appDatabase';
import { createLocalLibraryAssignment, resolveEntityNames } from './localLibraryCatalogInternals';
import { assignImportedSongs } from './localLibraryImportCatalog';
import { sanitizeLocalSongForStorage } from './repositories/localSongRepository';

// src/services/localLibraryCatalogService.ts
// Applies every song/entity/assignment mutation in a single Dexie transaction.

export { assignImportedSongs, ensureLocalLibraryInitialized } from './localLibraryImportCatalog';
export { mergeEntities, setEntityDisplayName, splitEntity } from './localLibraryEntityMutations';

export interface MatchedLocalMetadata {
  artists?: Array<{ id?: number | string; name: string }>;
  album?: { id?: number | string; name: string };
  songId?: number;
  coverUrl?: string;
}

export const applyMatchedMetadata = async (
  songId: string,
  metadata: MatchedLocalMetadata,
  options: { lyricsOnly?: boolean; songPatch?: Partial<LocalSong> } = {},
): Promise<LocalSong | undefined> => {
  return await appDatabase.transaction(
    'rw',
    [appDatabase.local_music, appDatabase.local_library_entities, appDatabase.local_library_assignments],
    async () => {
      const song = await appDatabase.local_music.get(songId);
      if (!song) return undefined;
      const updatedSong: LocalSong = { ...song, ...options.songPatch };
      if (!options.lyricsOnly) {
        const entities = await appDatabase.local_library_entities.toArray();
        const current = await appDatabase.local_library_assignments.get(songId);
        const hasArtistMetadata = metadata.artists !== undefined;
        const artists = metadata.artists?.filter(artist => cleanLocalLibraryName(artist.name)) || [];
        const artistIds = hasArtistMetadata
          ? resolveEntityNames(entities, 'artist', artists.map(artist => artist.name), current?.artistEntityIds)
          : current?.artistEntityIds || [];
        const albumName = cleanLocalLibraryName(metadata.album?.name);
        const albumId = albumName
          ? resolveEntityNames(entities, 'album', [albumName], current?.albumEntityId ? [current.albumEntityId] : [])[0]
          : current?.albumEntityId;
        if (hasArtistMetadata) {
          updatedSong.matchedArtistEntities = artists;
          updatedSong.matchedArtists = artists.map(artist => artist.name).join(', ') || updatedSong.matchedArtists;
        }
        if (albumName) {
          updatedSong.matchedAlbumId = typeof metadata.album?.id === 'number' ? metadata.album.id : updatedSong.matchedAlbumId;
          updatedSong.matchedAlbumName = albumName;
        }
        updatedSong.matchedSongId = metadata.songId ?? updatedSong.matchedSongId;
        updatedSong.matchedCoverUrl = metadata.coverUrl ?? updatedSong.matchedCoverUrl;
        updatedSong.useOnlineMetadata = true;
        await Promise.all([
          appDatabase.local_library_entities.bulkPut(entities),
          appDatabase.local_library_assignments.put({
            songId,
            artistEntityIds: artistIds,
            artistOrigin: hasArtistMetadata ? 'matched' : current?.artistOrigin || 'import',
            albumEntityId: albumId,
            albumOrigin: albumName ? 'matched' : current?.albumOrigin || 'import',
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
      const cleanedArtists = artistNames.map(cleanLocalLibraryName).filter((name): name is string => Boolean(name));
      const cleanedAlbum = cleanLocalLibraryName(albumName);
      const artistIds = resolveEntityNames(entities, 'artist', cleanedArtists, current?.artistEntityIds);
      const albumId = cleanedAlbum
        ? resolveEntityNames(entities, 'album', [cleanedAlbum], current?.albumEntityId ? [current.albumEntityId] : [])[0]
        : undefined;
      const updatedSong = {
        ...song,
        manualArtistNames: cleanedArtists,
        manualAlbumName: cleanedAlbum,
      };
      await Promise.all([
        appDatabase.local_music.put(sanitizeLocalSongForStorage(updatedSong)),
        appDatabase.local_library_entities.bulkPut(entities),
        appDatabase.local_library_assignments.put(createLocalLibraryAssignment(songId, artistIds, albumId, 'manual')),
      ]);
      return updatedSong;
    },
  );
};

export const restoreImportedMetadata = async (songId: string): Promise<LocalSong | undefined> => {
  const song = await appDatabase.local_music.get(songId);
  if (!song) return undefined;
  const restored = { ...song, useOnlineMetadata: false };
  delete restored.manualArtistNames;
  delete restored.manualAlbumName;
  await assignImportedSongs([restored], { preserveNonImportAssignments: false });
  return restored;
};

export const deleteSongAssignment = async (songId: string): Promise<void> => {
  await appDatabase.transaction(
    'rw',
    [appDatabase.local_music, appDatabase.local_library_assignments],
    async () => {
      await Promise.all([
        appDatabase.local_music.delete(songId),
        appDatabase.local_library_assignments.delete(songId),
      ]);
    },
  );
};

export const deleteSongAssignments = async (songIds: string[]): Promise<void> => {
  await appDatabase.transaction(
    'rw',
    [appDatabase.local_music, appDatabase.local_library_assignments],
    async () => {
      await Promise.all([
        appDatabase.local_music.bulkDelete(songIds),
        appDatabase.local_library_assignments.bulkDelete(songIds),
      ]);
    },
  );
};
