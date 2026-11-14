import type { LocalSong } from '../../types';
import { isBlob } from '../../utils/blobGuards';
import { getLocalSongAlbumContextKey } from '../../utils/localLibraryNames';
import { migrateLocalSongsRenderHints, migrateMatchedLyricsCarrierRenderHints } from '../../utils/lyrics/storageMigration';
import { appDatabase } from '../appDatabase';

// src/services/repositories/localSongRepository.ts
// Stores sanitized local-song records while retaining the existing read-time lyric migrations.

export const sanitizeLocalSongForStorage = (song: LocalSong): LocalSong => {
  const normalizedSong = migrateMatchedLyricsCarrierRenderHints(song).value ?? song;
  const { fileHandle, embeddedCover: _legacyCover, albumContextKey: _staleKey, ...persistedSong } = normalizedSong as LocalSong & {
    embeddedCover?: unknown;
  };
  // Recomputed on every write: the imported album or the path may have changed since the key was read.
  // A record missing those fields still saves, only without the key (as the v1 upgrade treats it).
  let albumContextKey: string | undefined;
  try {
    albumContextKey = getLocalSongAlbumContextKey(persistedSong);
  } catch {
    albumContextKey = undefined;
  }
  return albumContextKey ? { ...persistedSong, albumContextKey } : persistedSong;
};

const normalizeLocalSongFromStorage = (song: LocalSong): { value: LocalSong; changed: boolean } => {
  const legacySong = song as LocalSong & { embeddedCover?: unknown };
  if (legacySong.embeddedCover === undefined) return { value: song, changed: false };
  const { embeddedCover, ...normalizedSong } = legacySong;
  // A valid legacy Blob remains in IndexedDB until the background migrator commits external storage.
  return { value: normalizedSong, changed: !isBlob(embeddedCover) };
};

export const putLocalSong = async (song: LocalSong): Promise<void> => {
  await appDatabase.local_music.put(sanitizeLocalSongForStorage(song));
};

export const putLocalSongs = async (songs: LocalSong[]): Promise<void> => {
  if (songs.length > 0) {
    await appDatabase.local_music.bulkPut(songs.map(sanitizeLocalSongForStorage));
  }
};

// Applies the read-time cover sanitization and lyric render-hint migration, writing changed records back in the background.
const migrateStoredLocalSongs = (storedSongs: LocalSong[]): LocalSong[] => {
  const normalized = storedSongs.map(normalizeLocalSongFromStorage);
  const sanitizedSongs = normalized.filter(item => item.changed).map(item => item.value);
  if (sanitizedSongs.length > 0) {
    void putLocalSongs(sanitizedSongs).catch(error => {
      console.warn('[DB] Failed to write back sanitized local song covers', error);
    });
  }

  const migration = migrateLocalSongsRenderHints(normalized.map(item => item.value));
  if (migration.changedSongs.length > 0) {
    void putLocalSongs(migration.changedSongs).catch(error => {
      console.warn('[DB] Failed to write back migrated local song lyrics', error);
    });
  }
  return migration.value;
};

export const readLocalSongs = async (): Promise<LocalSong[]> => (
  migrateStoredLocalSongs(await appDatabase.local_music.toArray())
);

// 按主键读一条记录，读时迁移与 readLocalSongs 一致；播放和匹配路径只关心一首歌时用它，不读整张表。
export const readLocalSong = async (id: string): Promise<LocalSong | undefined> => {
  const storedSong = await appDatabase.local_music.get(id);
  return storedSong ? migrateStoredLocalSongs([storedSong])[0] : undefined;
};

export const removeLocalSong = async (id: string): Promise<void> => {
  await appDatabase.local_music.delete(id);
};

export const removeLocalSongs = async (ids: string[]): Promise<void> => {
  if (ids.length > 0) {
    await appDatabase.local_music.bulkDelete(ids);
  }
};

