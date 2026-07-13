import type { LocalSong } from '../../types';
import { isBlob } from '../../utils/blobGuards';
import { migrateLocalSongsRenderHints, migrateMatchedLyricsCarrierRenderHints } from '../../utils/lyrics/storageMigration';
import { appDatabase } from '../appDatabase';

// src/services/repositories/localSongRepository.ts
// Stores sanitized local-song records while retaining the existing read-time lyric migrations.

export const sanitizeLocalSongForStorage = (song: LocalSong): LocalSong => {
  const normalizedSong = migrateMatchedLyricsCarrierRenderHints(song).value ?? song;
  const { fileHandle, embeddedCover, ...persistedSong } = normalizedSong;
  return isBlob(embeddedCover) ? { ...persistedSong, embeddedCover } : persistedSong;
};

const normalizeLocalSongFromStorage = (song: LocalSong): { value: LocalSong; changed: boolean } => {
  if (song.embeddedCover === undefined || isBlob(song.embeddedCover)) {
    return { value: song, changed: false };
  }

  const { embeddedCover: _embeddedCover, ...normalizedSong } = song;
  return { value: normalizedSong, changed: true };
};

export const putLocalSong = async (song: LocalSong): Promise<void> => {
  await appDatabase.local_music.put(sanitizeLocalSongForStorage(song));
};

export const putLocalSongs = async (songs: LocalSong[]): Promise<void> => {
  if (songs.length > 0) {
    await appDatabase.local_music.bulkPut(songs.map(sanitizeLocalSongForStorage));
  }
};

export const readLocalSongs = async (): Promise<LocalSong[]> => {
  const storedSongs = await appDatabase.local_music.toArray();
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

export const removeLocalSong = async (id: string): Promise<void> => {
  await appDatabase.local_music.delete(id);
};

export const removeLocalSongs = async (ids: string[]): Promise<void> => {
  if (ids.length > 0) {
    await appDatabase.local_music.bulkDelete(ids);
  }
};

