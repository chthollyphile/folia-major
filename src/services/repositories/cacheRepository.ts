import type { Table } from 'dexie';
import {
  appDatabase,
  LOCAL_LIBRARY_ARTIST_SPLIT_MARKER_KEY,
  LOCAL_LIBRARY_BOOTSTRAP_MARKER_KEY,
  type StoredCacheEntry,
} from '../appDatabase';

// src/services/repositories/cacheRepository.ts
// Centralizes cache routing, legacy user-cache migration, prefix operations, cleanup, and usage metrics.

export type CacheCategory = 'playlist' | 'lyrics' | 'cover' | 'media';
export type CacheTableName = 'api_cache' | 'user_cache' | 'media_cache' | 'metadata_cache';

const CACHE_TABLE_NAMES: CacheTableName[] = [
  'api_cache',
  'user_cache',
  'media_cache',
  'metadata_cache',
];

const USER_CACHE_KEYS = new Set([
  'user_profile',
  'user_playlists',
  'user_liked_songs',
  'user_cloud_playlist',
]);

export const getCacheTableName = (key: string): CacheTableName => {
  if (USER_CACHE_KEYS.has(key) || (key.startsWith('online_provider_') && key.includes('_user_'))) return 'user_cache';
  if (key === 'last_song' || key === 'last_queue' || key === 'last_theme') return 'api_cache';
  if (key.startsWith('audio_') || key.startsWith('cover_')) return 'media_cache';
  if (
    key.startsWith('lyric_') ||
    key.startsWith('theme_') ||
    key.startsWith('playlist_tracks_') ||
    key.startsWith('playlist_detail_') ||
    (key.startsWith('online_provider_') && (key.includes('_playlist_tracks_') || key.includes('_playlist_detail_')))
  ) return 'metadata_cache';
  return 'api_cache';
};

const getTable = (name: CacheTableName): Table<StoredCacheEntry, string> => appDatabase.table(name);

export const putCacheEntry = async (key: string, data: unknown): Promise<void> => {
  await getTable(getCacheTableName(key)).put({ key, data, timestamp: Date.now() });
};

export const readCacheEntry = async <T>(key: string): Promise<T | null> => {
  const tableName = getCacheTableName(key);
  const entry = await getTable(tableName).get(key);
  if (entry) return entry.data as T;

  if (tableName !== 'user_cache' || !USER_CACHE_KEYS.has(key)) return null;
  const legacy = await appDatabase.api_cache.get(key);
  if (!legacy) return null;

  await appDatabase.transaction('rw', appDatabase.user_cache, appDatabase.api_cache, async () => {
    await appDatabase.user_cache.put({ ...legacy, timestamp: Date.now() });
    await appDatabase.api_cache.delete(key);
  });
  return legacy.data as T;
};

export const readCacheEntriesByPrefix = async <T>(prefix: string) => {
  const entries = await Promise.all(CACHE_TABLE_NAMES.map(name => getTable(name).toArray()));
  const byKey = new Map<string, { key: string; data: T; timestamp: number }>();
  entries.flat().forEach(entry => {
    if (entry.key.startsWith(prefix)) {
      byKey.set(entry.key, {
        key: entry.key,
        data: entry.data as T,
        timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : 0,
      });
    }
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

const getEntrySize = (entry: StoredCacheEntry): number => {
  if (typeof Blob !== 'undefined' && entry.data instanceof Blob) return entry.data.size;
  try {
    return JSON.stringify(entry.data)?.length ?? 0;
  } catch {
    return 0;
  }
};

const matchesCategory = (key: string, category: CacheCategory): boolean => {
  if (category === 'playlist') return key === 'user_playlists' || key.startsWith('playlist_') || (key.startsWith('online_provider_') && key.includes('_playlist'));
  if (category === 'lyrics') return key.startsWith('lyric_');
  if (category === 'cover') return key.startsWith('cover_');
  return key.startsWith('audio_');
};

export const getBrowserCacheUsage = async (): Promise<number> => {
  const entries = await Promise.all(CACHE_TABLE_NAMES.map(name => getTable(name).toArray()));
  return entries.flat().reduce((total, entry) => total + getEntrySize(entry), 0);
};

export const getBrowserCacheUsageByCategory = async () => {
  const usage = { playlist: 0, lyrics: 0, cover: 0, media: 0, mediaCount: 0 };
  const entries = (await Promise.all(CACHE_TABLE_NAMES.map(name => getTable(name).toArray()))).flat();
  entries.forEach(entry => {
    const size = getEntrySize(entry);
    if (matchesCategory(entry.key, 'playlist') || USER_CACHE_KEYS.has(entry.key)) usage.playlist += size;
    else if (matchesCategory(entry.key, 'lyrics')) usage.lyrics += size;
    else if (matchesCategory(entry.key, 'cover')) usage.cover += size;
    else if (matchesCategory(entry.key, 'media')) {
      usage.media += size;
      usage.mediaCount += 1;
    }
  });
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
