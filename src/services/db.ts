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
import { resetFoliaPlaylistStorage } from './foliaPlaylist/foliaPlaylistStorage';
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
 * 不走 ensureLocalLibraryInitialized：那一步要把 local_music 和 assignments 的主键整表读一遍，
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
    // Folia 歌单在它自己的库里（FoliaPlaylistsDB），一起清掉。
    await resetFoliaPlaylistStorage();
    // 歌曲评论（FoliaSongNotesDB）不清：用户定的长期保留（2026-11-24），确认框的文案写明了。
  } catch (error) {
    console.error('Failed to clear all data', error);
  }
};

/**
 * Writes every imported root's directory handle as one row, and returns the roots that row now holds.
 *
 * One handle IndexedDB can no longer serialize fails the whole row ("DataError Failed to write blobs"),
 * and every later import rewrote that same bad handle with the new one, so no new root was ever kept
 * and its songs could not be found again after a restart. When the row fails, each handle is tried
 * alone in a probe row (twice, so one passing failure is not taken for a broken handle), and the
 * real row is written once with the ones that stored: a broken old root costs only itself, and
 * readers never see the row part-way through.
 *
 * When no handle stores at all the trouble is the database rather than a handle: the row on disk is
 * left as it was (it still reads), and null is returned - as it is whenever the row was not rewritten.
 */
export const saveDirHandles = async (handles: Record<string, FileSystemDirectoryHandle>): Promise<string[] | null> => {
  try {
    await putCacheEntry(LOCAL_DIR_HANDLES_KEY, handles);
    return Object.keys(handles);
  } catch (error) {
    console.warn('[LocalMusic] Saving the directory handles failed; trying them one at a time', error);
  }
  const kept: Record<string, FileSystemDirectoryHandle> = {};
  const dropped: string[] = [];
  for (const [root, handle] of Object.entries(handles)) {
    if (await storesAlone(root, handle)) kept[root] = handle;
    else dropped.push(root);
  }
  // No handle stored: either every one is broken, or the database is failing. A row without
  // handles tells them apart - it stores only when the database is fine.
  const databaseWrites = Object.keys(kept).length > 0 || await probeWrites();
  try {
    await removeCacheEntry(LOCAL_DIR_HANDLES_PROBE_KEY);
  } catch (error) {
    console.warn('[LocalMusic] Removing the directory handle probe row failed', error);
  }
  if (!databaseWrites) {
    console.error('[LocalMusic] No directory handle could be stored; the saved ones are left as they were');
    return null;
  }
  try {
    await putCacheEntry(LOCAL_DIR_HANDLES_KEY, kept);
  } catch (error) {
    console.error('[LocalMusic] Saving the directory handles that stored alone failed', error);
    return null;
  }
  if (dropped.length > 0) console.warn(`[LocalMusic] Dropped ${dropped.length} directory handle(s) that can no longer be stored: ${dropped.join(', ')}`);
  return Object.keys(kept);
};

const LOCAL_DIR_HANDLES_KEY = 'local_dir_handles';
// Scratch row for saveDirHandles' one-at-a-time tries, removed right after; never read.
const LOCAL_DIR_HANDLES_PROBE_KEY = 'local_dir_handles_probe';

// Whether the probe row takes a write that holds no handle at all.
const probeWrites = async (): Promise<boolean> => {
  try {
    await putCacheEntry(LOCAL_DIR_HANDLES_PROBE_KEY, {});
    return true;
  } catch (error) {
    console.error('[LocalMusic] The directory handle row cannot be written at all', error);
    return false;
  }
};

// Whether one root's handle can be written on its own, tried twice before it counts as broken.
const storesAlone = async (root: string, handle: FileSystemDirectoryHandle): Promise<boolean> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await putCacheEntry(LOCAL_DIR_HANDLES_PROBE_KEY, { [root]: handle });
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  console.warn(`[LocalMusic] Directory handle for "${root}" cannot be stored any more`, lastError);
  return false;
};

export const getDirHandles = async (): Promise<Record<string, FileSystemDirectoryHandle>> => (
  (await getFromCache<Record<string, FileSystemDirectoryHandle>>('local_dir_handles')) || {}
);

/** Removes one root's directory handle; true when the saved row no longer holds it. */
export const deleteDirHandle = async (rootFolderName: string): Promise<boolean> => {
  const handles = await getDirHandles();
  if (!(rootFolderName in handles)) return true;
  delete handles[rootFolderName];
  // null: the row was not rewritten and still holds this root.
  return (await saveDirHandles(handles)) !== null;
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
