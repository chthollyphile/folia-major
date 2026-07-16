import type { LocalLibrarySnapshot, LocalSong } from '../types';
import type { MigrationResult } from '../utils/lyrics/renderHints';
import { appDatabase } from './appDatabase';
import type { CacheData, SessionData } from './dbTypes';
import {
  assignImportedSongs,
  deleteSongAssignment,
  deleteSongAssignments,
  ensureLocalLibraryInitialized,
} from './localLibraryCatalogService';
import {
  clearBrowserCacheByCategory,
  clearCacheTables,
  getBrowserCacheUsage,
  getBrowserCacheUsageByCategory,
  getCacheKeysByPrefix,
  putCacheEntry,
  readCacheEntriesByPrefix,
  readCacheEntry,
  removeCacheEntries,
  removeCacheEntriesByPrefix,
  removeCacheEntry,
  type CacheCategory,
} from './repositories/cacheRepository';
import {
  readLocalSongs,
} from './repositories/localSongRepository';
import { clearSessionValues, putSessionValue, readSession } from './repositories/sessionRepository';
import { readThemeRegistryEntries, writeThemeRegistryEntries } from './repositories/themeRegistryRepository';
import { clearCoverAssets, getCoverAssetUsage } from './binaryAssetStore';

// src/services/db.ts
// Keeps the historical storage API stable while delegating every IndexedDB operation to Dexie repositories.

export type { CacheData, SessionData } from './dbTypes';
export { getCacheKeysByPrefix, removeCacheEntries, removeCacheEntriesByPrefix };

const hasElectronAudioCacheBridge = () => (
  typeof window !== 'undefined' &&
  Boolean(window.electron?.getAudioCacheUsage && window.electron?.clearAudioCache)
);

const hasElectronAudioCacheStatsBridge = () => (
  typeof window !== 'undefined' && Boolean(window.electron?.getAudioCacheStats)
);

export const saveSessionData = async (key: keyof SessionData, value: unknown): Promise<void> => {
  try {
    await putSessionValue(key, value);
  } catch (error) {
    console.error('Failed to save to DB', error);
  }
};

export const getSessionData = async (): Promise<SessionData> => {
  try {
    return await readSession();
  } catch (error) {
    console.error('Failed to read DB', error);
    return {};
  }
};

export const clearSession = async (): Promise<void> => {
  try {
    await clearSessionValues();
  } catch (error) {
    console.error('Failed to clear DB', error);
  }
};

export const saveToCache = async (key: string, data: unknown): Promise<void> => {
  try {
    await putCacheEntry(key, data);
  } catch (error) {
    console.error('Cache save failed', error);
  }
};

export const getFromCache = async <T>(key: string): Promise<T | null> => {
  try {
    return await readCacheEntry<T>(key);
  } catch {
    return null;
  }
};

export const getCacheEntriesByPrefix = async <T>(prefix: string): Promise<Array<{ key: string; data: T; timestamp: number }>> => {
  try {
    return await readCacheEntriesByPrefix<T>(prefix);
  } catch (error) {
    console.error('Cache prefix scan failed', error);
    return [];
  }
};

export const getFromCacheWithMigration = async <T>(
  key: string,
  migrate: (data: T) => MigrationResult<T>,
): Promise<T | null> => {
  const cached = await getFromCache<T>(key);
  if (!cached) return null;
  const migration = migrate(cached);
  if (migration.changed) {
    void saveToCache(key, migration.value).catch(error => {
      console.warn(`[DB] Failed to write back migrated cache entry: ${key}`, error);
    });
  }
  return migration.value;
};

export const removeFromCache = async (key: string): Promise<void> => {
  try {
    await removeCacheEntry(key);
  } catch (error) {
    console.error('Cache remove failed', error);
  }
};

export const getThemeRegistryEntries = readThemeRegistryEntries;
export const upsertThemeRegistryEntries = writeThemeRegistryEntries;

export const clearCache = async (preserveKeys: string[] = []): Promise<void> => {
  try {
    await clearCacheTables(preserveKeys);
    if (hasElectronAudioCacheBridge() && !preserveKeys.some(key => key.startsWith('audio_'))) {
      await window.electron!.clearAudioCache();
    }
    if (!preserveKeys.some(key => key.startsWith('cover_'))) await clearCoverAssets();
  } catch (error) {
    console.error('Clear cache failed', error);
  }
};

export const getCacheUsage = async (): Promise<number> => {
  try {
    const browserSize = await getBrowserCacheUsage();
    const audioSize = hasElectronAudioCacheBridge() ? await window.electron!.getAudioCacheUsage() : 0;
    return browserSize + audioSize + await getCoverAssetUsage();
  } catch {
    return 0;
  }
};

export const getCacheUsageByCategory = async (): Promise<{
  playlist: number;
  lyrics: number;
  cover: number;
  media: number;
  mediaCount: number;
}> => {
  try {
    const usage = await getBrowserCacheUsageByCategory();
    if (hasElectronAudioCacheStatsBridge()) {
      const stats = await window.electron!.getAudioCacheStats();
      usage.media += stats.size;
      usage.mediaCount += stats.count;
    } else if (hasElectronAudioCacheBridge()) {
      usage.media += await window.electron!.getAudioCacheUsage();
    }
    usage.cover += await getCoverAssetUsage();
    return usage;
  } catch {
    return { playlist: 0, lyrics: 0, cover: 0, media: 0, mediaCount: 0 };
  }
};

export const clearCacheByCategory = async (category: CacheCategory): Promise<void> => {
  try {
    await clearBrowserCacheByCategory(category);
    if (category === 'media' && hasElectronAudioCacheBridge()) {
      await window.electron!.clearAudioCache();
    }
    if (category === 'cover') await clearCoverAssets();
  } catch (error) {
    console.error('Failed to clear cache by category', error);
  }
};

export const saveLocalSong = async (song: LocalSong): Promise<void> => {
  try {
    await ensureLocalLibraryInitialized();
    await assignImportedSongs([song]);
  } catch (error) {
    console.error('Failed to save local song', error);
  }
};

export const saveLocalSongs = async (songs: LocalSong[]): Promise<void> => {
  try {
    await ensureLocalLibraryInitialized();
    await assignImportedSongs(songs);
  } catch (error) {
    console.error('Failed to save local songs', error);
  }
};

export const getLocalSongs = async (): Promise<LocalSong[]> => {
  try {
    await ensureLocalLibraryInitialized();
    return await readLocalSongs();
  } catch (error) {
    console.error('Failed to get local songs', error);
    return [];
  }
};

export const deleteLocalSong = async (id: string): Promise<void> => {
  try {
    await deleteSongAssignment(id);
  } catch (error) {
    console.error('Failed to delete local song', error);
  }
};

export const deleteLocalSongs = async (ids: string[]): Promise<void> => {
  try {
    await deleteSongAssignments(ids);
  } catch (error) {
    console.error('Failed to delete local songs', error);
  }
};

export const clearAllData = async (): Promise<void> => {
  try {
    if (hasElectronAudioCacheBridge()) await window.electron!.clearAudioCache();
    await clearCoverAssets();
    await appDatabase.delete();
    await appDatabase.open();
  } catch (error) {
    console.error('Failed to clear all data', error);
  }
};

export const saveDirHandles = async (handles: Record<string, FileSystemDirectoryHandle>): Promise<void> => {
  await saveToCache('local_dir_handles', handles);
};

export const getDirHandles = async (): Promise<Record<string, FileSystemDirectoryHandle>> => (
  (await getFromCache<Record<string, FileSystemDirectoryHandle>>('local_dir_handles')) || {}
);

export const deleteDirHandle = async (rootFolderName: string): Promise<void> => {
  const handles = await getDirHandles();
  if (!(rootFolderName in handles)) return;
  delete handles[rootFolderName];
  await saveDirHandles(handles);
};

const getLocalSnapshotCacheKey = (rootFolderName: string) => `local_snapshot_${rootFolderName}`;

export const saveLocalLibrarySnapshot = async (snapshot: LocalLibrarySnapshot): Promise<void> => {
  await saveToCache(getLocalSnapshotCacheKey(snapshot.rootFolderName), snapshot);
};

export const getLocalLibrarySnapshot = async (rootFolderName: string): Promise<LocalLibrarySnapshot | null> => (
  await getFromCache<LocalLibrarySnapshot>(getLocalSnapshotCacheKey(rootFolderName))
);

export const deleteLocalLibrarySnapshot = async (rootFolderName: string): Promise<void> => {
  await removeFromCache(getLocalSnapshotCacheKey(rootFolderName));
};
