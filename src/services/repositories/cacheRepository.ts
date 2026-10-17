import type { Table } from 'dexie';
import { isBeatGridKey, isDrumHitsKey } from '../analysis/beatGridKeys';
import {
  appDatabase,
  LOCAL_LIBRARY_ARTIST_SPLIT_MARKER_KEY,
  LOCAL_LIBRARY_BOOTSTRAP_MARKER_KEY,
  type StoredCacheEntry,
} from '../appDatabase';
import {
  countCacheEntry,
  emptyCacheUsage,
  matchesCategory,
  USER_CACHE_KEYS,
  type CacheUsage,
} from './cacheUsage';

// src/services/repositories/cacheRepository.ts
// Centralizes cache routing, legacy user-cache migration, prefix operations, cleanup, and usage metrics.

export type CacheCategory = 'playlist' | 'lyrics' | 'cover' | 'media' | 'analysis';
export type CacheTableName = 'api_cache' | 'user_cache' | 'media_cache' | 'metadata_cache';

const CACHE_TABLE_NAMES: CacheTableName[] = [
  'api_cache',
  'user_cache',
  'media_cache',
  'metadata_cache',
];

export const getCacheTableName = (key: string): CacheTableName => {
  if (USER_CACHE_KEYS.has(key) || (key.startsWith('online_provider_') && key.includes('_user_'))) return 'user_cache';
  if (key === 'last_song' || key === 'last_queue' || key === 'last_theme') return 'api_cache';
  if (key.startsWith('audio_') || key.startsWith('cover_')) return 'media_cache';
  if (
    key.startsWith('automix_profile_') ||
    isBeatGridKey(key) ||
    isDrumHitsKey(key) ||
    key.startsWith('lyric_') ||
    key.startsWith('theme_') ||
    key.startsWith('replayGain_') ||
    key.startsWith('audioLevel_') ||
    key.startsWith('playlist_tracks_') ||
    key.startsWith('playlist_detail_') ||
    (key.startsWith('online_provider_') && (key.includes('_playlist_tracks_') || key.includes('_playlist_detail_')))
  ) return 'metadata_cache';
  return 'api_cache';
};

/**
 * Keys written to the `api_cache` fall-through before their prefix was registered above, and so
 * not in the table `getCacheTableName` now resolves for them.
 *
 * Deliberately a list rather than "check api_cache on every miss": a miss is the ordinary case for
 * covers and lyrics, and a blanket fallback would put a second lookup on all of them.
 */
const movedOutOfApiCache = (key: string): boolean =>
  USER_CACHE_KEYS.has(key) || key.startsWith('automix_profile_');

const getTable = (name: CacheTableName): Table<StoredCacheEntry, string> => appDatabase.table(name);

export const putCacheEntry = async (key: string, data: unknown): Promise<void> => {
  await getTable(getCacheTableName(key)).put({ key, data, timestamp: Date.now() });
};

export const readCacheEntry = async <T>(key: string): Promise<T | null> => {
  const tableName = getCacheTableName(key);
  const entry = await getTable(tableName).get(key);
  if (entry) return entry.data as T;

  // Found where it used to live and moved on the way past. That is the whole migration: no version
  // bump, no startup sweep, and a key nobody reads again is still cleared with its category like
  // any other, because clearing scans every table.
  if (tableName === 'api_cache' || !movedOutOfApiCache(key)) return null;
  const legacy = await appDatabase.api_cache.get(key);
  if (!legacy) return null;

  const table = getTable(tableName);
  await appDatabase.transaction('rw', table, appDatabase.api_cache, async () => {
    await table.put({ ...legacy, timestamp: Date.now() });
    await appDatabase.api_cache.delete(key);
  });
  return legacy.data as T;
};

// Only the rows with the prefix are read. It used to load every row of every table and filter them
// on the page, which on a used install is the same tens of megabytes counting the cache reads; the
// theme sync asks for one prefix this way.
export const readCacheEntriesByPrefix = <T>(prefix: string) =>
  readCacheEntriesByKey<T>(key => key.startsWith(prefix));

/**
 * Reads only the entries whose key passes `predicate`, listing primary keys first so rows that
 * do not match are never deserialized. Loading every row of every table, media blobs included, is
 * too heavy for a scan that runs over a whole library.
 *
 * The matching rows are read ROWS_PER_READ at a time, with a turn of the event loop between reads:
 * the lyric export reads every `lyric_` row, and on a used install (536 rows, 17.9 MB) one bulkGet
 * of them all held the page for up to 58 ms; fifty at a time, for 7-11 ms, in the same total time.
 */
const ROWS_PER_READ = 50;

export const readCacheEntriesByKey = async <T>(
  predicate: (key: string) => boolean,
  tableNames: CacheTableName[] = CACHE_TABLE_NAMES,
): Promise<Array<{ key: string; data: T; timestamp: number }>> => {
  const perTable = await Promise.all(tableNames.map(async name => {
    const table = getTable(name);
    const keys = (await table.toCollection().primaryKeys()).map(String).filter(predicate);
    const rows: StoredCacheEntry[] = [];
    for (let start = 0; start < keys.length; start += ROWS_PER_READ) {
      if (start > 0) await new Promise(resolve => setTimeout(resolve, 0));
      const read = await table.bulkGet(keys.slice(start, start + ROWS_PER_READ));
      read.forEach(row => { if (row) rows.push(row); });
    }
    return rows;
  }));
  const byKey = new Map<string, { key: string; data: T; timestamp: number }>();
  perTable.flat().forEach(entry => {
    byKey.set(entry.key, {
      key: entry.key,
      data: entry.data as T,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : 0,
    });
  });
  return Array.from(byKey.values());
};

export const getCacheKeysByPrefix = async (prefixes: string[]): Promise<string[]> => {
  if (prefixes.length === 0) return [];
  const entries = await Promise.all(CACHE_TABLE_NAMES.map(name => getTable(name).toCollection().primaryKeys()));
  return Array.from(new Set(entries.flat().map(String).filter(key => prefixes.some(prefix => key.startsWith(prefix)))));
};

export const removeCacheEntries = async (keys: string[]): Promise<void> => {
  if (keys.length === 0) return;
  await appDatabase.transaction('rw', CACHE_TABLE_NAMES, async () => {
    await Promise.all(CACHE_TABLE_NAMES.map(name => getTable(name).bulkDelete(keys)));
  });
};

export const removeCacheEntriesByPrefix = async (prefixes: string[]): Promise<void> => {
  await removeCacheEntries(await getCacheKeysByPrefix(prefixes));
};

export const removeCacheEntry = async (key: string): Promise<void> => {
  await getTable(getCacheTableName(key)).delete(key);
};

export const clearCacheTables = async (preserveKeys: string[] = []): Promise<void> => {
  const preserved = new Set([
    ...preserveKeys,
    LOCAL_LIBRARY_BOOTSTRAP_MARKER_KEY,
    LOCAL_LIBRARY_ARTIST_SPLIT_MARKER_KEY,
  ]);
  await appDatabase.transaction('rw', CACHE_TABLE_NAMES, async () => {
    await Promise.all(CACHE_TABLE_NAMES.map(async name => {
      const table = getTable(name);
      const keys = await table.toCollection().primaryKeys();
      const deletedKeys = keys.map(String).filter(key => !preserved.has(key));
      await table.bulkDelete(deletedKeys);
    }));
  });
};

// The count reads every row back and measures it: on a used install tens of megabytes, which held
// the page in one task of 130-175 ms as the settings window opened (the window asks for it as it
// opens). A worker counts the same rows off the page. Where there is no worker, or it fails, or it
// does not see the database, they are counted here.
const countCacheUsageOffThread = (): Promise<CacheUsage> | null => {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('../../workers/cacheUsage.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ usage?: CacheUsage; error?: string }>) => {
      worker.terminate();
      if (event.data.usage) resolve(event.data.usage);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'worker error'));
    };
    worker.postMessage({ databaseName: appDatabase.name, tableNames: CACHE_TABLE_NAMES });
  });
};

export const getBrowserCacheUsageByCategory = async (): Promise<CacheUsage> => {
  const offThread = countCacheUsageOffThread();
  if (offThread) {
    try {
      return await offThread;
    } catch (error) {
      console.warn('[Cache] Counting the cache on the page instead:', error);
    }
  }
  const usage = emptyCacheUsage();
  const entries = (await Promise.all(CACHE_TABLE_NAMES.map(name => getTable(name).toArray()))).flat();
  entries.forEach(entry => countCacheEntry(usage, entry));
  return usage;
};

export const clearBrowserCacheByCategory = async (category: CacheCategory): Promise<void> => {
  await appDatabase.transaction('rw', CACHE_TABLE_NAMES, async () => {
    await Promise.all(CACHE_TABLE_NAMES.map(async name => {
      const table = getTable(name);
      const keys = (await table.toCollection().primaryKeys()).map(String).filter(key => matchesCategory(key, category));
      await table.bulkDelete(keys);
    }));
  });
};
