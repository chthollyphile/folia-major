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
  getBrowserCacheUsageByCategory,
  getCacheKeysByPrefix,
  putCacheEntry,
  readCacheEntriesByKey,
  readCacheEntriesByPrefix,
  readCacheEntry,
  removeCacheEntries,
  removeCacheEntriesByPrefix,
  removeCacheEntry,
  type CacheCategory,
  type CacheTableName,
} from './repositories/cacheRepository';
import {
  readLocalSong,
  readLocalSongs,
} from './repositories/localSongRepository';
import { clearSessionValues, putSessionValue, readSession } from './repositories/sessionRepository';
import { readThemeRegistryEntries, writeThemeRegistryEntries } from './repositories/themeRegistryRepository';
import { clearCoverAssets, getCoverAssetUsage } from './binaryAssetStore';
import { clearLocalCoverBinaries } from './localCoverBinaryStore';
import {
  cancelLocalCoverAssetMigration,
  resetLocalCoverAssetRuntime,
} from './localCoverAssetService';

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

export const getCacheEntriesByKey = async <T>(
  predicate: (key: string) => boolean,
  tableNames?: CacheTableName[],
): Promise<Array<{ key: string; data: T; timestamp: number }>> => {
  try {
    return await readCacheEntriesByKey<T>(predicate, tableNames);
  } catch (error) {
    console.error('Cache key scan failed', error);
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

export const getCacheUsageByCategory = async (): Promise<{
  playlist: number;
  lyrics: number;
  cover: number;
  media: number;
  analysis: number;
  volumeBalance: number;
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
    return { playlist: 0, lyrics: 0, cover: 0, media: 0, analysis: 0, volumeBalance: 0, mediaCount: 0 };
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
  await ensureLocalLibraryInitialized();
  await assignImportedSongs([song]);
};

export const saveLocalSongs = async (songs: LocalSong[]): Promise<void> => {
  await ensureLocalLibraryInitialized();
  await assignImportedSongs(songs);
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

/**
 * 按 id 读一首本地歌曲的最新记录。
 * 不走 ensureLocalLibraryInitialized：那一步会把 local_music 和 assignments 整表读一遍，
 * 而这里只服务切歌、匹配写回这类「只关心一首」的热路径。读失败或记录不存在时返回 undefined。
 */
export const getLocalSong = async (id: string): Promise<LocalSong | undefined> => {
  try {
    return await readLocalSong(id);
  } catch (error) {
    console.error('Failed to get local song', error);
    return undefined;
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
    await cancelLocalCoverAssetMigration();
    await clearLocalCoverBinaries();
    resetLocalCoverAssetRuntime();
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
