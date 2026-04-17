import { getFromCache, removeFromCache, saveToCache } from './db';

interface ElectronAudioCacheEntry {
  found: boolean;
  data?: Uint8Array | ArrayBuffer;
  mimeType?: string | null;
}

const isElectronAudioCacheAvailable = () =>
  Boolean(
    window.electron &&
    typeof window.electron.getAudioCache === 'function' &&
    typeof window.electron.hasAudioCache === 'function' &&
    typeof window.electron.saveAudioCache === 'function'
  );

const toBlob = (entry: ElectronAudioCacheEntry): Blob | null => {
  if (!entry.found || !entry.data) {
    return null;
  }

  const mimeType = entry.mimeType || 'audio/mpeg';
  return new Blob([entry.data], { type: mimeType });
};

export async function getCachedAudioBlob(cacheKey: string): Promise<Blob | null> {
  if (isElectronAudioCacheAvailable()) {
    const electronEntry = await window.electron!.getAudioCache(cacheKey);
    const electronBlob = toBlob(electronEntry);
    if (electronBlob) {
      return electronBlob;
    }
  }

  const indexedDbBlob = await getFromCache<Blob>(cacheKey);
  if (!indexedDbBlob) {
    return null;
  }

  if (isElectronAudioCacheAvailable()) {
    try {
      await saveAudioBlob(cacheKey, indexedDbBlob);
      await removeFromCache(cacheKey);
    } catch (error) {
      console.warn('[AudioCache] Failed to migrate IndexedDB audio cache to Electron file cache', error);
    }
  }

  return indexedDbBlob;
}

export async function hasCachedAudio(cacheKey: string): Promise<boolean> {
  if (isElectronAudioCacheAvailable()) {
    const existsInElectronCache = await window.electron!.hasAudioCache(cacheKey);
    if (existsInElectronCache) {
      return true;
    }
  }

  return Boolean(await getFromCache<Blob>(cacheKey));
}

export async function saveAudioBlob(cacheKey: string, blob: Blob): Promise<void> {
  if (isElectronAudioCacheAvailable()) {
    const buffer = await blob.arrayBuffer();
    await window.electron!.saveAudioCache(cacheKey, buffer, blob.type || 'audio/mpeg');
    return;
  }

  await saveToCache(cacheKey, blob);
}
