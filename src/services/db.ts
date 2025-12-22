
import { LyricData, Theme, NeteaseUser, NeteasePlaylist, SongResult, LocalSong } from "../types";

const DB_NAME = 'KineticPlayerDB';
const DB_VERSION = 5; // Incremented version to ensure local_music store is created
const STORE_NAME = 'session';
const CACHE_STORE = 'api_cache';
const USER_CACHE_STORE = 'user_cache';
const MEDIA_CACHE_STORE = 'media_cache';
const METADATA_CACHE_STORE = 'metadata_cache';
const LOCAL_MUSIC_STORE = 'local_music';

export interface SessionData {
  audioFile?: File | Blob;
  fileName?: string;
  lyricId?: string;
  lyrics?: LyricData;
  theme?: Theme;
  cachedAiBg?: string;
  coverUrl?: string;
  timestamp?: number;
}

export interface CacheData {
  key: string;
  data: any;
  timestamp: number;
}

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => reject("IndexedDB error");

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion || 0;

      // Create session store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }

      // Create api_cache store (for backward compatibility: last_song, last_queue, last_theme)
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }

      // Create new stores for table separation (version 3+)
      if (oldVersion < 3) {
        // Create user_cache store
        if (!db.objectStoreNames.contains(USER_CACHE_STORE)) {
          db.createObjectStore(USER_CACHE_STORE, { keyPath: 'key' });
        }

        // Create media_cache store
        if (!db.objectStoreNames.contains(MEDIA_CACHE_STORE)) {
          db.createObjectStore(MEDIA_CACHE_STORE, { keyPath: 'key' });
        }

        // Create metadata_cache store
        if (!db.objectStoreNames.contains(METADATA_CACHE_STORE)) {
          db.createObjectStore(METADATA_CACHE_STORE, { keyPath: 'key' });
        }

        // Migrate user data from api_cache to user_cache
        if (oldVersion > 0 && db.objectStoreNames.contains(CACHE_STORE)) {
          const transaction = (event.target as IDBOpenDBRequest).transaction!;
          const oldStore = transaction.objectStore(CACHE_STORE);
          const newStore = transaction.objectStore(USER_CACHE_STORE);

          const userKeys = ['user_profile', 'user_playlists', 'user_liked_songs'];
          let migratedCount = 0;

          userKeys.forEach(userKey => {
            const req = oldStore.get(userKey);
            req.onsuccess = () => {
              if (req.result) {
                newStore.put(req.result);
                oldStore.delete(userKey);
              }
              migratedCount++;
            };
            req.onerror = () => {
              migratedCount++;
            };
          });
        }
      }

      // Create local_music store (version 4+)
      // Always check if it exists, regardless of version, to handle edge cases
      if (!db.objectStoreNames.contains(LOCAL_MUSIC_STORE)) {
        db.createObjectStore(LOCAL_MUSIC_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
  });
};

export { openDB };

export const saveSessionData = async (key: keyof SessionData, value: any): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to save to DB", e);
  }
};

export const getSessionData = async (): Promise<SessionData> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);

      const keys: (keyof SessionData)[] = ['audioFile', 'fileName', 'lyricId', 'lyrics', 'theme', 'cachedAiBg', 'coverUrl'];
      const result: SessionData = {};
      let completed = 0;

      keys.forEach(key => {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result) {
            // @ts-ignore
            result[key] = request.result;
          }
          completed++;
          if (completed === keys.length) resolve(result);
        };
        request.onerror = () => {
          completed++;
          if (completed === keys.length) resolve(result);
        };
      });
    });
  } catch (e) {
    console.error("Failed to read DB", e);
    return {};
  }
};

export const clearSession = async (): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to clear DB", e);
  }
};

// --- Caching Methods ---

// Helper function to determine which store to use based on key
const getStoreName = (key: string): string => {
  // User data -> user_cache
  if (key === 'user_profile' || key === 'user_playlists' || key === 'user_liked_songs') {
    return USER_CACHE_STORE;
  }

  // Session data -> api_cache (backward compatibility)
  if (key === 'last_song' || key === 'last_queue' || key === 'last_theme') {
    return CACHE_STORE;
  }

  // Media files -> media_cache
  if (key.startsWith('audio_') || key.startsWith('cover_')) {
    return MEDIA_CACHE_STORE;
  }

  // Metadata and playlists -> metadata_cache
  if (key.startsWith('lyric_') || key.startsWith('theme_') ||
    key.startsWith('playlist_tracks_') || key.startsWith('playlist_detail_')) {
    return METADATA_CACHE_STORE;
  }

  // Default to api_cache for backward compatibility
  return CACHE_STORE;
};

export const saveToCache = async (key: string, data: any): Promise<void> => {
  try {
    const db = await openDB();
    const storeName = getStoreName(key);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      // If data is a blob, it stores efficiently. If object, IDB handles structured clone.
      store.put({ key, data, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("Cache save failed", e);
  }
};

export const getFromCache = async <T>(key: string): Promise<T | null> => {
  try {
    const db = await openDB();
    const storeName = getStoreName(key);

    // For backward compatibility, also check api_cache if not found in the primary store
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result.data as T);
        } else {
          // If not found and it's a user data key, check old api_cache for migration
          if ((key === 'user_profile' || key === 'user_playlists' || key === 'user_liked_songs') &&
            storeName === USER_CACHE_STORE) {
            const oldTx = db.transaction([CACHE_STORE], 'readonly');
            const oldStore = oldTx.objectStore(CACHE_STORE);
            const oldReq = oldStore.get(key);
            oldReq.onsuccess = () => {
              if (oldReq.result) {
                // Migrate to new store
                saveToCache(key, oldReq.result.data).then(() => {
                  resolve(oldReq.result.data as T);
                });
              } else {
                resolve(null);
              }
            };
            oldReq.onerror = () => resolve(null);
          } else {
            resolve(null);
          }
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
};

export const removeFromCache = async (key: string): Promise<void> => {
  try {
    const db = await openDB();
    const storeName = getStoreName(key);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error("Cache remove failed", e);
  }
};

export const clearCache = async (preserveKeys: string[] = []): Promise<void> => {
  try {
    const db = await openDB();

    // Group preserve keys by store
    const storeKeys: Record<string, string[]> = {
      [CACHE_STORE]: [],
      [USER_CACHE_STORE]: [],
      [MEDIA_CACHE_STORE]: [],
      [METADATA_CACHE_STORE]: []
    };

    preserveKeys.forEach(key => {
      const storeName = getStoreName(key);
      storeKeys[storeName].push(key);
    });

    // Clear each store
    const clearPromises = Object.entries(storeKeys).map(([storeName, keys]) => {
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);

        if (keys.length > 0) {
          // Selective clear
          const req = store.openCursor();
          req.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result;
            if (cursor) {
              const key = cursor.key as string;
              if (!keys.includes(key)) {
                cursor.delete();
              }
              cursor.continue();
            } else {
              resolve();
            }
          };
          req.onerror = () => reject(req.error);
        } else {
          // Clear all
          store.clear();
          tx.oncomplete = () => resolve();
        }
      });
    });

    await Promise.all(clearPromises);
  } catch (e) {
    console.error("Clear cache failed", e);
  }
};

export const getCacheUsage = async (): Promise<number> => {
  try {
    const db = await openDB();
    const stores = [CACHE_STORE, USER_CACHE_STORE, MEDIA_CACHE_STORE, METADATA_CACHE_STORE];

    let totalSize = 0;
    let completed = 0;

    return new Promise((resolve, reject) => {
      stores.forEach(storeName => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        let storeSize = 0;
        const req = store.openCursor();

        req.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const value = cursor.value;
            if (value.data instanceof Blob) {
              storeSize += value.data.size;
            } else {
              // Approximate size for JSON objects
              const json = JSON.stringify(value.data);
              storeSize += json.length;
            }
            cursor.continue();
          } else {
            totalSize += storeSize;
            completed++;
            if (completed === stores.length) {
              resolve(totalSize);
            }
          }
        };
        req.onerror = () => {
          completed++;
          if (completed === stores.length) {
            resolve(totalSize);
          }
        };
      });
    });
  } catch (e) {
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
    const db = await openDB();
    const stores = [CACHE_STORE, USER_CACHE_STORE, MEDIA_CACHE_STORE, METADATA_CACHE_STORE];

    const usage = {
      playlist: 0,
      lyrics: 0,
      cover: 0,
      media: 0,
      mediaCount: 0
    };

    return new Promise((resolve, reject) => {
      let completed = 0;

      stores.forEach(storeName => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.openCursor();

        req.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const key = cursor.key as string;
            const value = cursor.value;
            let size = 0;

            if (value.data instanceof Blob) {
              size = value.data.size;
            } else {
              size = JSON.stringify(value.data).length;
            }

            // Categorize
            if (key === 'user_playlists' || key.startsWith('playlist_')) {
              usage.playlist += size;
            } else if (key.startsWith('lyric_')) {
              usage.lyrics += size;
            } else if (key.startsWith('cover_')) {
              usage.cover += size;
            } else if (key.startsWith('audio_')) {
              usage.media += size;
              usage.mediaCount++;
            } else if (key === 'user_liked_songs' || key === 'user_profile') {
              // Consider user profile as playlist data mostly
              usage.playlist += size;
            }

            cursor.continue();
          } else {
            completed++;
            if (completed === stores.length) {
              resolve(usage);
            }
          }
        };
        req.onerror = () => {
          completed++;
          if (completed === stores.length) resolve(usage);
        };
      });
    });
  } catch (e) {
    return { playlist: 0, lyrics: 0, cover: 0, media: 0, mediaCount: 0 };
  }
};

export const clearCacheByCategory = async (category: 'playlist' | 'lyrics' | 'cover' | 'media'): Promise<void> => {
  try {
    const db = await openDB();
    const stores = [CACHE_STORE, USER_CACHE_STORE, MEDIA_CACHE_STORE, METADATA_CACHE_STORE];

    const clearPromises = stores.map(storeName => {
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.openCursor();

        req.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const key = cursor.key as string;
            let shouldDelete = false;

            if (category === 'playlist') {
              if (key === 'user_playlists' || key.startsWith('playlist_')) shouldDelete = true;
            } else if (category === 'lyrics') {
              if (key.startsWith('lyric_')) shouldDelete = true;
            } else if (category === 'cover') {
              if (key.startsWith('cover_')) shouldDelete = true;
            } else if (category === 'media') {
              if (key.startsWith('audio_')) shouldDelete = true;
            }

            if (shouldDelete) {
              cursor.delete();
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      });
    });

    await Promise.all(clearPromises);
  } catch (e) {
    console.error("Failed to clear cache by category", e);
  }
};

// --- Local Music Methods ---

export const saveLocalSong = async (song: LocalSong): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([LOCAL_MUSIC_STORE], 'readwrite');
      const store = tx.objectStore(LOCAL_MUSIC_STORE);
      store.put(song);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("Failed to save local song", e);
  }
};

export const getLocalSongs = async (): Promise<LocalSong[]> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([LOCAL_MUSIC_STORE], 'readonly');
      const store = tx.objectStore(LOCAL_MUSIC_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error("Failed to get local songs", e);
    return [];
  }
};

export const deleteLocalSong = async (id: string): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([LOCAL_MUSIC_STORE], 'readwrite');
      const store = tx.objectStore(LOCAL_MUSIC_STORE);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("Failed to delete local song", e);
  }
};
