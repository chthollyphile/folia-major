
import { LyricData, Theme, NeteaseUser, NeteasePlaylist, SongResult } from "../types";

const DB_NAME = 'KineticPlayerDB';
const DB_VERSION = 2; // Incremented version
const STORE_NAME = 'session';
const CACHE_STORE = 'api_cache';

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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
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

export const saveToCache = async (key: string, data: any): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([CACHE_STORE], 'readwrite');
      const store = tx.objectStore(CACHE_STORE);
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
    return new Promise((resolve, reject) => {
      const tx = db.transaction([CACHE_STORE], 'readonly');
      const store = tx.objectStore(CACHE_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result.data as T);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
};

export const clearCache = async (preserveKeys: string[] = []): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([CACHE_STORE], 'readwrite');
      const store = tx.objectStore(CACHE_STORE);

      if (preserveKeys.length > 0) {
        // Selective clear
        const req = store.openCursor();
        req.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const key = cursor.key as string;
            if (!preserveKeys.includes(key)) {
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
  } catch (e) { }
}

export const getCacheUsage = async (): Promise<number> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([CACHE_STORE], 'readonly');
      const store = tx.objectStore(CACHE_STORE);
      let size = 0;
      const req = store.openCursor();

      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const value = cursor.value;
          if (value.data instanceof Blob) {
            size += value.data.size;
          } else {
            // Approximate size for JSON objects
            const json = JSON.stringify(value.data);
            size += json.length;
          }
          cursor.continue();
        } else {
          resolve(size);
        }
      };
      req.onerror = () => reject(0);
    });
  } catch (e) {
    return 0;
  }
};
